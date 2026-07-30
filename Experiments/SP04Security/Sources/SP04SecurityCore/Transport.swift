import Foundation

/// wire에 실제로 나간 바이트를 그대로 모으는 기록기.
///
/// 이 스파이크의 `패킷 캡처` 증거는 여기서 나온다. 무엇을 캡처하는지 정확히
/// 적어 둔다.
///
/// - 기록하는 것: 전송 계층이 OS에 넘기는 **응용 payload 바이트 전부**. 핸드셰이크
///   메시지와 데이터 frame이 모두 들어간다.
/// - 기록하지 않는 것: TCP·IP·Wi-Fi 헤더와 링크 계층 프레이밍. 실제 `tcpdump`
///   캡처와 다른 점이며, 그 차이는 보고서 한계에 남긴다.
///
/// 링크 계층 캡처가 아니어도 결론은 유지된다. 평문이 어디에도 없다는 판정은
/// **응용 payload에 대한 것**이고, 헤더에는 응용 데이터가 실리지 않기 때문이다.
/// 반대로 payload에 평문이 있다면 링크 계층 캡처에도 그대로 보인다.
public final class WireRecorder: @unchecked Sendable {
    public struct Entry: Sendable {
        public let direction: String
        public let label: String
        public let bytes: Data
    }

    private var entries: [Entry] = []
    private let lock = NSLock()

    public init() {}

    public func record(direction: String, label: String, bytes: Data) {
        lock.lock()
        defer { lock.unlock() }
        entries.append(Entry(direction: direction, label: label, bytes: bytes))
    }

    public var recorded: [Entry] {
        lock.lock()
        defer { lock.unlock() }
        return entries
    }

    /// 캡처한 모든 바이트를 이어 붙인 것. 평문 검사 대상이다.
    public var capturedBytes: Data {
        lock.lock()
        defer { lock.unlock() }
        return entries.reduce(into: Data()) { $0.append($1.bytes) }
    }

    public var frameCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return entries.count
    }

    /// 라벨별 개수. "운영 데이터 frame이 0개였다"를 세는 데 쓴다.
    public func count(label: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return entries.filter { $0.label == label }.count
    }
}

/// 실제 loopback TCP 소켓 위에서 바이트를 왕복시킨다.
///
/// 결정적 시나리오는 이 경로를 쓰지 않는다. 그런데도 두는 이유는 하나다 —
/// 인메모리 기록기는 "우리가 만든 바이트"를 보여줄 뿐, 그 바이트가 **실제
/// 소켓을 지나도 같은지**는 답하지 않는다. 직렬화·프레이밍 실수는 그
/// 경계에서만 드러난다.
///
/// 소켓은 127.0.0.1에 열고 커널이 고른 포트를 쓴다. 고정 포트를 쓰면 같은
/// 기계에서 두 실행이 겹칠 때 실패한다.
public enum LoopbackTransport {
    public enum LoopbackError: Error, Equatable {
        case socketSetupFailed(operation: String, errno: Int32)
        case shortWrite(expected: Int, actual: Int)
        case shortRead(expected: Int, actual: Int)
    }

    /// 길이 접두어를 붙인 메시지 목록을 한 방향으로 실제 소켓에 흘려보내고,
    /// 반대편이 읽은 바이트를 그대로 돌려준다.
    ///
    /// 프레이밍은 4바이트 big-endian 길이 접두어다. 스트림 소켓에는 메시지
    /// 경계가 없으므로 접두어 없이 보내면 두 메시지가 한 read에 합쳐진다.
    public static func roundTrip(messages: [Data]) throws -> [Data] {
        var listener: Int32 = -1
        var client: Int32 = -1
        var accepted: Int32 = -1
        defer {
            if accepted >= 0 { close(accepted) }
            if client >= 0 { close(client) }
            if listener >= 0 { close(listener) }
        }

        listener = socket(AF_INET, SOCK_STREAM, 0)
        guard listener >= 0 else { throw LoopbackError.socketSetupFailed(operation: "socket", errno: errno) }

        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr.s_addr = inetLoopback()

        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(listener, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else { throw LoopbackError.socketSetupFailed(operation: "bind", errno: errno) }
        guard listen(listener, 1) == 0 else {
            throw LoopbackError.socketSetupFailed(operation: "listen", errno: errno)
        }

        var boundAddress = sockaddr_in()
        var boundLength = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameResult = withUnsafeMutablePointer(to: &boundAddress) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(listener, $0, &boundLength)
            }
        }
        guard nameResult == 0 else {
            throw LoopbackError.socketSetupFailed(operation: "getsockname", errno: errno)
        }

        client = socket(AF_INET, SOCK_STREAM, 0)
        guard client >= 0 else { throw LoopbackError.socketSetupFailed(operation: "socket", errno: errno) }
        let connectResult = withUnsafePointer(to: &boundAddress) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(client, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard connectResult == 0 else {
            throw LoopbackError.socketSetupFailed(operation: "connect", errno: errno)
        }

        accepted = accept(listener, nil, nil)
        guard accepted >= 0 else { throw LoopbackError.socketSetupFailed(operation: "accept", errno: errno) }

        // 보내는 총량이 소켓 버퍼보다 작으므로 한 번에 쓰고 한 번에 읽는다.
        // 커지면 부분 write가 생기므로 아래 검사가 그것을 실패로 만든다.
        var outbound = Data()
        for message in messages {
            outbound.append(contentsOf: withUnsafeBytes(of: UInt32(message.count).bigEndian, Array.init))
            outbound.append(message)
        }

        let written = outbound.withUnsafeBytes { raw -> Int in
            guard let base = raw.baseAddress else { return -1 }
            return write(client, base, outbound.count)
        }
        guard written == outbound.count else {
            throw LoopbackError.shortWrite(expected: outbound.count, actual: written)
        }

        var inbound = Data()
        var buffer = [UInt8](repeating: 0, count: 65_536)
        while inbound.count < outbound.count {
            let readCount = read(accepted, &buffer, buffer.count)
            guard readCount > 0 else {
                throw LoopbackError.shortRead(expected: outbound.count, actual: inbound.count)
            }
            inbound.append(contentsOf: buffer[0..<readCount])
        }

        var received: [Data] = []
        var cursor = inbound.startIndex
        while cursor < inbound.endIndex {
            guard inbound.endIndex - cursor >= 4 else {
                throw LoopbackError.shortRead(expected: 4, actual: inbound.endIndex - cursor)
            }
            var length: UInt32 = 0
            for offset in 0..<4 { length = (length << 8) | UInt32(inbound[cursor + offset]) }
            cursor += 4
            guard inbound.endIndex - cursor >= Int(length) else {
                throw LoopbackError.shortRead(expected: Int(length), actual: inbound.endIndex - cursor)
            }
            received.append(inbound.subdata(in: cursor..<(cursor + Int(length))))
            cursor += Int(length)
        }
        return received
    }

    private static func inetLoopback() -> in_addr_t {
        // 127.0.0.1을 네트워크 바이트 순서로 만든다.
        (UInt32(127) << 24 | UInt32(1)).bigEndian
    }
}
