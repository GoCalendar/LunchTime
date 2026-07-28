import Foundation
import Network

/// Bonjour 광고·탐색과 직접 TCP 연결을 반복 측정한다.
///
/// Network 객체는 모두 하나의 직렬 큐에 고정하고 상태는 `NSLock`으로 보호한다.
/// 그래서 `@unchecked Sendable`을 사용한다. Network.framework 콜백이 임의의
/// 큐에서 오지 않도록 모든 `start(queue:)` 호출에 같은 큐를 넘긴다.
public final class DiscoveryProbe: @unchecked Sendable {
    private let options: ProbeOptions
    private let report: @Sendable (ProbeProgress) -> Void
    private let queue = DispatchQueue(label: "sp01-probe.network")
    private let lock = NSLock()

    /// 광고용 listener. 상대가 우리에게 연결해 왕복을 측정할 수 있게 유지한다.
    private var listener: NWListener?
    /// listener가 받아들인 연결. 회차가 끝나도 상대가 측정 중일 수 있어 보관한다.
    ///
    /// echo가 끝난 연결은 즉시 제거한다. append만 하면 프로세스 수명이 긴 실행에서
    /// 취소된 객체가 무한히 쌓인다.
    private var inboundConnections: [NWConnection] = []
    /// 상대가 우리에게 연결해 바이트를 돌려받은 횟수.
    private var inboundEchoCount = 0

    /// - Parameter progress: 관측한 사건을 실시간으로 받는다. 기본값은 아무것도 하지 않는다.
    public init(
        options: ProbeOptions,
        progress: @escaping @Sendable (ProbeProgress) -> Void = { _ in }
    ) {
        self.options = options
        self.report = progress
    }

    // MARK: - 실행

    /// 회차 측정까지 수행하고 보고서를 돌려준다. 광고는 계속 유지된다.
    ///
    /// 유예 대기를 이 함수 안에 두지 않는 이유는 결과 보존이다. 대기를 안에 두면
    /// 보고서가 대기 뒤에야 호출자에게 도착하고, 대기 중에 사용자가 종료하면 이미
    /// 완성된 측정 결과가 사라진다. 실제로 그렇게 잃은 실행이 있었다. 호출자가 보고서를
    /// 먼저 보존하고 그 뒤에 `holdAdvertisement()`를 기다려야 한다.
    public func measure() async throws -> ProbeReport {
        do {
            try await startListener()
        } catch {
            stopListener()
            throw error
        }

        // 회차를 세기 전에 먼저 상대를 만난다. 사람 두 명이 초 단위로 동시에 실행할 수는
        // 없으므로, 이 단계가 없으면 늦게 시작한 쪽을 기다리는 앞 회차가 실패하고 그
        // 실패가 네트워크 경계 차단과 구분되지 않는다.
        let rendezvous = await meetPeer()
        let rendezvousMilliseconds = rendezvous.milliseconds

        var results: [RoundResult] = []
        if rendezvousMilliseconds != nil {
            for round in 1...options.rounds {
                if round > 1, options.cooldown > 0 {
                    try? await Task.sleep(nanoseconds: UInt64(options.cooldown * 1_000_000_000))
                }
                results.append(await measureRound(round))
            }
        }

        return ProbeReport(
            serviceType: ProbeOptions.serviceType,
            localLabel: options.label,
            peerLabel: options.peer,
            rounds: options.rounds,
            roundTimeoutSeconds: options.roundTimeout,
            rendezvousMilliseconds: rendezvousMilliseconds,
            rendezvousInterfaceTypes: rendezvous.interfaceTypes,
            rendezvousFailure: rendezvous.failure,
            inboundEchoCount: lock.withLock { inboundEchoCount },
            results: results
        )
    }

    /// 상대가 아직 측정 중일 수 있으므로 광고를 유예 시간만큼 유지한다.
    ///
    /// 만남에 실패했을 때도 유지한다. 상대가 더 늦게 시작했다면 아직 우리를 찾고 있다.
    public func holdAdvertisement() async {
        guard options.linger > 0 else { return }
        report(.lingering(seconds: options.linger))
        try? await Task.sleep(nanoseconds: UInt64(options.linger * 1_000_000_000))
    }

    /// 광고와 받아들인 연결을 정리한다.
    public func stop() {
        stopListener()
    }

    private struct Rendezvous: Sendable {
        let milliseconds: Int?
        let interfaceTypes: [String]
        let failure: String?
    }

    /// 상한 안에 상대를 처음 발견하기까지 걸린 시간과 관측한 인터페이스.
    ///
    /// 실패 원인을 버리지 않는다. 탐색 자체가 즉시 실패하는 경우(권한 미승인 등)와 상한을
    /// 다 기다린 경우는 후속 조치가 다르다.
    private func meetPeer() async -> Rendezvous {
        report(.rendezvousStarted(limitSeconds: options.rendezvous))
        let started = ContinuousClock.now
        do {
            let peer = try await discoverPeer(timeout: options.rendezvous)
            let elapsed = Self.milliseconds(since: started)
            report(.rendezvousMet(
                labels: peer.labels,
                interfaceTypes: peer.interfaceTypes,
                milliseconds: elapsed
            ))
            return Rendezvous(
                milliseconds: elapsed,
                interfaceTypes: peer.interfaceTypes,
                failure: nil
            )
        } catch {
            let failure = Self.describe(error)
            report(.rendezvousMissed(
                limitSeconds: options.rendezvous,
                elapsedMilliseconds: Self.milliseconds(since: started),
                failure: failure
            ))
            return Rendezvous(milliseconds: nil, interfaceTypes: [], failure: failure)
        }
    }

    // MARK: - 광고

    /// Bonjour 서비스 이름을 익명 라벨로 고정한다.
    ///
    /// 이름을 비우면 Network.framework가 기기 이름을 사용해 사내 식별자가 네트워크에
    /// 노출된다. 이 실험은 그것을 허용하지 않는다.
    private func startListener() async throws {
        let parameters = NWParameters.tcp
        parameters.includePeerToPeer = false
        let listener = try NWListener(using: parameters)
        listener.service = NWListener.Service(
            name: options.label,
            type: ProbeOptions.serviceType,
            domain: "local.",
            txtRecord: NWTXTRecord(["label": options.label]).data
        )

        listener.newConnectionHandler = { [weak self] connection in
            guard let self else {
                connection.cancel()
                return
            }
            self.acceptEcho(connection)
        }

        let ready = SingleResume<Void, Error>()
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                ready.resume(returning: ())
            case .failed(let error):
                ready.resume(throwing: ProbeFailure.listenerFailed(error.localizedDescription))
            case .cancelled:
                ready.resume(throwing: ProbeFailure.listenerCancelled)
            default:
                break
            }
        }

        lock.withLock { self.listener = listener }
        listener.start(queue: queue)
        // Network 콜백은 취소를 관측하지 않으므로 대기 자체에 상한을 건다.
        ready.fail(after: options.roundTimeout, on: queue, with: TimeoutError())
        try await ready.value
    }

    private func stopListener() {
        let (listener, connections): (NWListener?, [NWConnection]) = lock.withLock {
            let taken = (self.listener, self.inboundConnections)
            self.listener = nil
            self.inboundConnections = []
            return taken
        }
        connections.forEach { $0.cancel() }
        listener?.cancel()
    }

    /// 상대가 보낸 바이트를 그대로 돌려준다. 내용은 해석하지 않는다.
    ///
    /// 평문 TCP에는 메시지 경계가 없어 `receiveMessage`는 스트림이 닫힐 때까지
    /// 기다린다. 왕복 지연만 재려면 도착한 바이트를 즉시 받아야 하므로
    /// `receive(minimumIncompleteLength:maximumLength:)`를 사용한다.
    private func acceptEcho(_ connection: NWConnection) {
        lock.withLock { inboundConnections.append(connection) }
        connection.start(queue: queue)

        // 상대가 연결만 하고 바이트를 보내지 않으면 이 수신은 영구히 완료되지 않는다.
        // 무한 대기를 만들지 않기 위해 회차 상한과 같은 값으로 끊는다.
        let finished = SingleResume<Void, Error>()
        finished.fail(after: options.roundTimeout, on: queue, with: TimeoutError())
        Task { [weak self] in
            _ = try? await finished.value
            self?.discardInbound(connection)
        }

        // nonce 길이는 고정이다. `minimumIncompleteLength: 1`이면 세그먼트가 쪼개져 도착할 때
        // 앞부분만 되돌려주고, 요청 측은 그것을 `echoMismatch`로 기록한다. 그 실패는 판정 표에서
        // "직접 연결 차단"으로 읽히므로 프레이밍 잡음이 네트워크 결론으로 승격된다.
        connection.receive(
            minimumIncompleteLength: Self.probeBytes,
            maximumLength: Self.probeBytes
        ) { [weak self, report] data, _, _, _ in
            guard let self, let data, !data.isEmpty else {
                finished.resume(returning: ())
                return
            }
            connection.send(content: data, completion: .contentProcessed { error in
                if error == nil {
                    self.countInboundEcho()
                    report(.echoedToPeer(bytes: data.count))
                }
                finished.resume(returning: ())
            })
        }
    }

    private func countInboundEcho() {
        lock.withLock { inboundEchoCount += 1 }
    }

    /// echo가 끝난 연결을 취소하고 보관 목록에서 제거한다.
    private func discardInbound(_ connection: NWConnection) {
        lock.withLock {
            inboundConnections.removeAll { $0 === connection }
        }
        connection.cancel()
    }

    // MARK: - 회차 측정

    private func measureRound(_ round: Int) async -> RoundResult {
        report(.roundStarted(round: round, total: options.rounds))
        let started = ContinuousClock.now
        do {
            let peer = try await discoverPeer(timeout: options.roundTimeout)
            let discoveryMilliseconds = Self.milliseconds(since: started)

            do {
                let connectStarted = ContinuousClock.now
                try await roundTrip(to: peer.endpoint, timeout: options.roundTimeout)
                let roundTripMilliseconds = Self.milliseconds(since: connectStarted)
                report(.roundSucceeded(
                    round: round,
                    total: options.rounds,
                    labels: peer.labels,
                    interfaceTypes: peer.interfaceTypes,
                    discoveryMilliseconds: discoveryMilliseconds,
                    roundTripMilliseconds: roundTripMilliseconds
                ))
                return RoundResult(
                    round: round,
                    discovered: true,
                    discoveryMilliseconds: discoveryMilliseconds,
                    peerLabels: peer.labels,
                    peerInterfaceTypes: peer.interfaceTypes,
                    connected: true,
                    roundTripMilliseconds: roundTripMilliseconds,
                    failure: nil
                )
            } catch {
                let failure = Self.describe(error)
                report(.roundDiscoveredOnly(
                    round: round,
                    total: options.rounds,
                    labels: peer.labels,
                    interfaceTypes: peer.interfaceTypes,
                    discoveryMilliseconds: discoveryMilliseconds,
                    failure: failure
                ))
                return RoundResult(
                    round: round,
                    discovered: true,
                    discoveryMilliseconds: discoveryMilliseconds,
                    peerLabels: peer.labels,
                    peerInterfaceTypes: peer.interfaceTypes,
                    connected: false,
                    roundTripMilliseconds: nil,
                    failure: failure
                )
            }
        } catch {
            let failure = Self.describe(error)
            report(.roundFailed(round: round, total: options.rounds, failure: failure))
            return RoundResult(
                round: round,
                discovered: false,
                discoveryMilliseconds: nil,
                peerLabels: [],
                peerInterfaceTypes: [],
                connected: false,
                roundTripMilliseconds: nil,
                failure: failure
            )
        }
    }

    private struct DiscoveredPeer: Sendable {
        let endpoint: NWEndpoint
        let labels: [String]
        /// 상대를 발견한 인터페이스 종류. 이름이나 주소가 아니라 분류만 담는다.
        let interfaceTypes: [String]
    }

    /// 인터페이스 종류를 안정된 문자열로 바꾼다.
    ///
    /// 이름(`en0`)이나 주소가 아니라 분류만 남긴다. 이 값이 필요한 이유는 결과가
    /// 실제로 무선 구간을 건넜는지 확인하려면 사람 기억이 아니라 데이터가 근거여야
    /// 하기 때문이다. `loopback`이 보이면 같은 기기에서 두 프로세스를 띄운 것이고,
    /// 그 값은 사내망 측정으로 쓸 수 없다.
    private static func describe(_ type: NWInterface.InterfaceType) -> String {
        switch type {
        case .wifi: return "wifi"
        case .wiredEthernet: return "wiredEthernet"
        case .cellular: return "cellular"
        case .loopback: return "loopback"
        case .other: return "other"
        @unknown default: return "other"
        }
    }

    /// 자신이 아닌 라벨을 광고하는 첫 Peer를 찾는다.
    private func discoverPeer(timeout: Double) async throws -> DiscoveredPeer {
        let descriptor = NWBrowser.Descriptor.bonjourWithTXTRecord(
            type: ProbeOptions.serviceType,
            domain: "local."
        )
        let browser = NWBrowser(for: descriptor, using: .tcp)
        let found = SingleResume<DiscoveredPeer, Error>()

        browser.browseResultsChangedHandler = { [localLabel = options.label, peerLabel = options.peer] results, _ in
            var labels: Set<String> = []
            var interfaceTypes: Set<String> = []
            var match: NWEndpoint?
            for result in results {
                guard case .bonjour(let txt) = result.metadata,
                      let advertised = txt["label"], advertised != localLabel else { continue }

                // 상대가 광고한 값은 다른 호스트가 통제하는 임의 바이트다. 검사 없이 결과 파일과
                // 로그에 넣으면 익명 라벨 계약이 한쪽만 강제되고, 개행이 섞이면 로그 줄을 위조할
                // 수 있다. 형식을 만족하지 않는 값은 원문을 남기지 않는다.
                let label = ProbeOptions.isAnonymousLabel(advertised) ? advertised : "비규격 라벨"
                labels.insert(label)

                // 고정한 상대만 측정한다. 같은 구간에 세 대 이상이 있으면 회차마다 다른 상대에
                // 연결될 수 있고, 그 값을 특정 조합 칸에 넣으면 측정하지 않은 구간을 측정한
                // 것으로 보고하게 된다.
                guard label == peerLabel else { continue }
                for interface in result.interfaces {
                    interfaceTypes.insert(Self.describe(interface.type))
                }
                if match == nil { match = result.endpoint }
            }
            guard let match else { return }
            found.resume(returning: DiscoveredPeer(
                endpoint: match,
                labels: labels.sorted(),
                interfaceTypes: interfaceTypes.sorted()
            ))
        }
        browser.stateUpdateHandler = { state in
            if case .failed(let error) = state {
                found.resume(throwing: ProbeFailure.browserFailed(error.localizedDescription))
            }
        }

        browser.start(queue: queue)
        defer { browser.cancel() }
        found.fail(after: timeout, on: queue, with: TimeoutError())
        return try await found.value
    }

    /// 발견한 endpoint로 직접 연결해 16바이트 nonce의 왕복을 확인한다.
    private func roundTrip(to endpoint: NWEndpoint, timeout: Double) async throws {
        // 세 단계가 한 회차 상한을 나눠 쓴다. 어느 단계도 무한히 기다리지 않는다.
        let slice = max(timeout / 3, 1)
        let connection = NWConnection(to: endpoint, using: .tcp)
        let ready = SingleResume<Void, Error>()
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                ready.resume(returning: ())
            case .failed(let error):
                ready.resume(throwing: ProbeFailure.connectionFailed(error.localizedDescription))
            case .cancelled:
                ready.resume(throwing: ProbeFailure.connectionCancelled)
            default:
                break
            }
        }
        connection.start(queue: queue)
        defer { connection.cancel() }
        ready.fail(after: slice, on: queue, with: TimeoutError())
        try await ready.value

        var nonce = Data(count: Self.probeBytes)
        for index in nonce.indices { nonce[index] = UInt8.random(in: .min ... .max) }

        let sent = SingleResume<Void, Error>()
        connection.send(content: nonce, completion: .contentProcessed { error in
            if let error {
                sent.resume(throwing: ProbeFailure.sendFailed(error.localizedDescription))
            } else {
                sent.resume(returning: ())
            }
        })
        sent.fail(after: slice, on: queue, with: TimeoutError())
        try await sent.value

        let echoed = SingleResume<Data, Error>()
        connection.receive(minimumIncompleteLength: nonce.count, maximumLength: nonce.count) { data, _, _, error in
            if let error {
                echoed.resume(throwing: ProbeFailure.receiveFailed(error.localizedDescription))
                return
            }
            guard let data, !data.isEmpty else {
                echoed.resume(throwing: ProbeFailure.emptyEcho)
                return
            }
            echoed.resume(returning: data)
        }
        echoed.fail(after: slice, on: queue, with: TimeoutError())
        let response = try await echoed.value
        guard response == nonce else { throw ProbeFailure.echoMismatch }
    }

    // MARK: - 보조

    /// 왕복 확인에 쓰는 nonce 길이. 지연만 측정하므로 작게 유지한다.
    static let probeBytes = 16

    private static func milliseconds(since start: ContinuousClock.Instant) -> Int {
        let elapsed = ContinuousClock.now - start
        let components = elapsed.components
        return Int(components.seconds * 1000 + components.attoseconds / 1_000_000_000_000_000)
    }

    private static func describe(_ error: Error) -> String {
        if let failure = error as? ProbeFailure { return failure.description }
        if error is TimeoutError { return TimeoutError().description }
        return "알 수 없는 실패"
    }

}

struct TimeoutError: Error, CustomStringConvertible {
    var description: String { "제한 시간 안에 결과를 얻지 못했습니다" }
}

enum ProbeFailure: Error, CustomStringConvertible {
    case listenerFailed(String)
    case listenerCancelled
    case browserFailed(String)
    case connectionFailed(String)
    case connectionCancelled
    case sendFailed(String)
    case receiveFailed(String)
    case emptyEcho
    case echoMismatch

    var description: String {
        switch self {
        case .listenerFailed(let reason):
            return "서비스 광고 실패: \(reason)"
        case .listenerCancelled:
            return "서비스 광고가 취소되었습니다"
        case .browserFailed(let reason):
            return "서비스 탐색 실패: \(reason)"
        case .connectionFailed(let reason):
            return "직접 연결 실패: \(reason)"
        case .connectionCancelled:
            return "직접 연결이 취소되었습니다"
        case .sendFailed(let reason):
            return "전송 실패: \(reason)"
        case .receiveFailed(let reason):
            return "수신 실패: \(reason)"
        case .emptyEcho:
            return "상대가 빈 응답을 보냈습니다"
        case .echoMismatch:
            return "왕복 응답이 보낸 값과 다릅니다"
        }
    }
}

/// 콜백을 async로 잇는 1회용 continuation 상자.
///
/// Network.framework의 상태 핸들러는 같은 상태를 여러 번 통보할 수 있어 중복
/// resume이 크래시를 만든다. 첫 resume만 통과시킨다.
final class SingleResume<Value: Sendable, Failure: Error>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Error>?
    private var pending: Result<Value, Error>?
    private var finished = false

    var value: Value {
        get async throws {
            try await withCheckedThrowingContinuation { continuation in
                let ready: Result<Value, Error>? = lock.withLock {
                    if let pending {
                        self.pending = nil
                        return pending
                    }
                    self.continuation = continuation
                    return nil
                }
                if let ready { continuation.resume(with: ready) }
            }
        }
    }

    func resume(returning value: Value) { complete(.success(value)) }
    func resume(throwing error: Error) { complete(.failure(error)) }

    /// 지정한 시간이 지나면 대기를 실패로 끝낸다.
    ///
    /// Network.framework 콜백은 Swift Concurrency 취소를 관측하지 않는다. 그래서
    /// task를 취소하는 방식으로는 대기를 끊을 수 없고, continuation 자체를
    /// 시간 제한으로 해소해야 한다. 이미 끝난 대기에는 아무 영향이 없다.
    func fail(after seconds: Double, on queue: DispatchQueue, with error: Error) {
        queue.asyncAfter(deadline: .now() + seconds) { [weak self] in
            self?.complete(.failure(error))
        }
    }

    private func complete(_ result: Result<Value, Error>) {
        let waiting: CheckedContinuation<Value, Error>? = lock.withLock {
            guard !finished else { return nil }
            finished = true
            if let continuation {
                self.continuation = nil
                return continuation
            }
            pending = result
            return nil
        }
        waiting?.resume(with: result)
    }
}
