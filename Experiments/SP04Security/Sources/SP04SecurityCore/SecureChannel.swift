import CryptoKit
import Foundation

/// 인증된 암호화 채널의 frame(`POL-03-R-03`).
///
/// 바이트 배치는 이렇다.
///
/// ```text
/// | version(1) | direction(1) | sequence(8, BE) | ciphertext+tag(가변) |
/// ```
///
/// 헤더는 평문이지만 AAD로 묶여 있으므로 한 비트만 바꿔도 복호화가 실패한다.
/// 헤더를 AAD에 넣지 않으면 방향·순서 번호를 바꿔치기해도 tag가 그대로여서,
/// 재전송 판정 자체를 공격자가 조작한다.
public struct ChannelFrame: Hashable, Sendable {
    public let version: UInt8
    public let direction: ChannelDirection
    public let sequence: UInt64
    public let ciphertext: Data

    public var wireBytes: Data {
        var data = Data()
        data.append(version)
        data.append(direction.rawByte)
        data.append(contentsOf: withUnsafeBytes(of: sequence.bigEndian, Array.init))
        data.append(ciphertext)
        return data
    }

    public static func decode(_ data: Data) -> ChannelFrame? {
        guard data.count > 10 else { return nil }
        let bytes = Data(data)
        guard let direction = ChannelDirection(rawByte: bytes[bytes.startIndex + 1]) else { return nil }
        var sequence: UInt64 = 0
        for offset in 0..<8 {
            sequence = (sequence << 8) | UInt64(bytes[bytes.startIndex + 2 + offset])
        }
        return ChannelFrame(
            version: bytes[bytes.startIndex],
            direction: direction,
            sequence: sequence,
            ciphertext: bytes.suffix(from: bytes.startIndex + 10)
        )
    }
}

public enum ChannelDirection: String, Hashable, Sendable {
    case initiatorToResponder
    case responderToInitiator

    var rawByte: UInt8 {
        switch self {
        case .initiatorToResponder: 1
        case .responderToInitiator: 2
        }
    }

    init?(rawByte: UInt8) {
        switch rawByte {
        case 1: self = .initiatorToResponder
        case 2: self = .responderToInitiator
        default: return nil
        }
    }

    var opposite: ChannelDirection {
        switch self {
        case .initiatorToResponder: .responderToInitiator
        case .responderToInitiator: .initiatorToResponder
        }
    }
}

/// 채널이 frame을 거부하는 이유.
public enum ChannelFailure: String, Error, Equatable, Sendable, CaseIterable {
    /// 복호화·무결성 검증 실패. 위조되거나 손상됐다.
    case authenticationFailed
    /// 이미 처리한 순서 번호이거나 창 밖의 옛 번호다.
    case replayDetected
    /// 방향이 맞지 않는다. 되돌려 보낸 frame이다.
    case directionMismatch
    /// frame 형식이 아니다.
    case malformedFrame
    /// 지원하지 않는 frame version이다.
    case unsupportedVersion
    /// 순서 번호가 소진됐다.
    case sequenceExhausted
}

/// 열린 세션 하나의 송신 측.
///
/// **참조 타입이다.** 값 타입이면 세션을 복사하는 것만으로 순서 번호가 갈라지고,
/// 같은 키·같은 nonce로 서로 다른 평문이 봉인된다. 그 순간 기밀성이 무너진다.
/// 이 패키지는 다른 곳에서도 "런타임 검사 대신 타입으로 막는다"를 쓰므로
/// (채팅을 저장 종류로 표현하지 않는 것, `SyncOutcome`에 기본 case를 두지 않는
/// 것) 여기도 같은 원칙을 적용한다.
public final class ChannelSender: @unchecked Sendable {
    public let key: SymmetricKey
    public let direction: ChannelDirection
    private var nextSequence: UInt64
    private let lock = NSLock()

    public init(key: SymmetricKey, direction: ChannelDirection) {
        self.key = key
        self.direction = direction
        self.nextSequence = 0
    }

    /// 평문을 frame으로 봉인한다.
    ///
    /// nonce는 순서 번호에서 유도한다. 난수 nonce를 96비트로 쓰면 생일 한계가
    /// 걱정되는 반면, 순서 번호는 단조 증가가 보장되면 절대 겹치지 않는다.
    /// 대신 순서 번호를 재사용하는 순간 (키, nonce)가 겹쳐 기밀성이 무너지므로
    /// 소진되면 세션을 닫는다.
    public func seal(_ plaintext: Data) throws -> ChannelFrame {
        lock.lock()
        guard nextSequence < UInt64.max else {
            lock.unlock()
            throw ChannelError.failure(.sequenceExhausted)
        }
        let sequence = nextSequence
        nextSequence += 1
        lock.unlock()
        let nonce = try ChaChaPoly.Nonce(data: Self.nonceBytes(sequence: sequence))
        let aad = Self.additionalData(direction: direction, sequence: sequence)
        let sealed = try ChaChaPoly.seal(plaintext, using: key, nonce: nonce, authenticating: aad)
        // `combined`는 nonce를 포함하지만 nonce는 순서 번호에서 유도하므로
        // wire에 다시 실을 이유가 없다. 실으면 검증하지 않는 필드가 하나 는다.
        return ChannelFrame(
            version: UInt8(SP04Protocol.version),
            direction: direction,
            sequence: sequence,
            ciphertext: sealed.ciphertext + sealed.tag
        )
    }

    static func nonceBytes(sequence: UInt64) -> Data {
        var data = Data(repeating: 0, count: 4)
        data.append(contentsOf: withUnsafeBytes(of: sequence.bigEndian, Array.init))
        return data
    }

    static func additionalData(direction: ChannelDirection, sequence: UInt64) -> Data {
        var writer = CanonicalWriter(domain: SP04Protocol.frameDomain)
        writer.append(SP04Protocol.version)
        writer.append(direction.rawByte)
        writer.append(sequence)
        return writer.data
    }
}

/// 열린 세션 하나의 수신 측.
public struct ChannelReceiver: Sendable {
    public let key: SymmetricKey
    public let expectedDirection: ChannelDirection
    private var window: ReplayWindow

    public init(key: SymmetricKey, expectedDirection: ChannelDirection) {
        self.key = key
        self.expectedDirection = expectedDirection
        self.window = ReplayWindow()
    }

    /// frame을 검증하고 연다.
    ///
    /// 순서는 **재전송 검사가 복호화보다 먼저**다. 복호화를 먼저 하면 공격자가
    /// 같은 frame을 반복해 보내는 것만으로 AEAD 연산을 강제할 수 있다.
    public mutating func open(_ frame: ChannelFrame) -> Result<Data, ChannelFailure> {
        guard frame.version == UInt8(SP04Protocol.version) else { return .failure(.unsupportedVersion) }
        guard frame.direction == expectedDirection else { return .failure(.directionMismatch) }
        guard window.accepts(frame.sequence) else { return .failure(.replayDetected) }

        guard frame.ciphertext.count > 16 else { return .failure(.malformedFrame) }
        let tagStart = frame.ciphertext.index(frame.ciphertext.endIndex, offsetBy: -16)
        let body = frame.ciphertext[frame.ciphertext.startIndex..<tagStart]
        let tag = frame.ciphertext[tagStart...]

        guard let nonce = try? ChaChaPoly.Nonce(data: ChannelSender.nonceBytes(sequence: frame.sequence)),
              let box = try? ChaChaPoly.SealedBox(nonce: nonce, ciphertext: body, tag: tag) else {
            return .failure(.malformedFrame)
        }
        let aad = ChannelSender.additionalData(direction: frame.direction, sequence: frame.sequence)
        guard let plaintext = try? ChaChaPoly.open(box, using: key, authenticating: aad) else {
            return .failure(.authenticationFailed)
        }

        // 성공한 frame만 창에 기록한다. 실패한 번호를 기록하면 공격자가 위조
        // frame 하나로 정상 frame의 번호를 미리 태워 버린다.
        window.commit(frame.sequence)
        return .success(plaintext)
    }

    public mutating func openWireBytes(_ data: Data) -> Result<Data, ChannelFailure> {
        guard let frame = ChannelFrame.decode(data) else { return .failure(.malformedFrame) }
        return open(frame)
    }
}

public enum ChannelError: Error, Equatable {
    case failure(ChannelFailure)
}

/// 64칸 슬라이딩 재전송 창.
///
/// 순서 번호가 정확히 오름차순으로만 온다고 가정하지 않는다. `POL-02-R-02`의
/// 대조는 여러 요청을 겹쳐 보낼 수 있고, 실제 전송은 순서를 바꿔 도착시킨다.
/// 창이 없으면 늦게 도착한 정상 frame을 재전송으로 오인해 버린다.
struct ReplayWindow: Sendable {
    static let size: UInt64 = 64

    private var highest: UInt64?
    private var bitmap: UInt64 = 0

    /// 이 번호를 받아들일 수 있는가. 상태를 바꾸지 않는다.
    func accepts(_ sequence: UInt64) -> Bool {
        guard let highest else { return true }
        if sequence > highest { return true }
        let distance = highest - sequence
        if distance >= Self.size { return false }
        return (bitmap & (1 << distance)) == 0
    }

    /// 받아들인 번호를 기록한다.
    mutating func commit(_ sequence: UInt64) {
        guard let currentHighest = highest else {
            highest = sequence
            bitmap = 1
            return
        }
        if sequence > currentHighest {
            let shift = sequence - currentHighest
            bitmap = shift >= Self.size ? 0 : (bitmap << shift)
            bitmap |= 1
            highest = sequence
        } else {
            let distance = currentHighest - sequence
            if distance < Self.size {
                bitmap |= (1 << distance)
            }
        }
    }
}

/// 양방향 세션 하나.
///
/// 송신·수신을 한 값으로 묶어, 한쪽만 열린 반쪽 세션이 만들어지지 않게 한다.
public struct SecureSession: Sendable {
    public let peer: PeerIdentity
    public let sessionID: String
    public let role: HandshakeRole
    /// 참조 타입이므로 세션을 복사해도 순서 번호가 갈라지지 않는다.
    public let sender: ChannelSender
    public var receiver: ChannelReceiver

    public init(result: HandshakeResult) {
        let sendDirection: ChannelDirection =
            result.role == .initiator ? .initiatorToResponder : .responderToInitiator
        peer = result.peer
        sessionID = result.sessionID
        role = result.role
        sender = ChannelSender(key: result.sendKey, direction: sendDirection)
        receiver = ChannelReceiver(key: result.receiveKey, expectedDirection: sendDirection.opposite)
    }
}
