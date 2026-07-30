import CryptoKit
import Foundation

/// 시나리오에 등장하는 기기 하나.
public struct PeerNode: Sendable {
    public let label: String
    public let identity: DeviceIdentity
    public let scope: NetworkScope
    public let directory: PeerDirectory
    public let entropy: any EntropySource

    public init(
        label: String,
        identity: DeviceIdentity,
        scope: NetworkScope,
        directory: PeerDirectory = PeerDirectory(),
        entropy: any EntropySource
    ) {
        self.label = label
        self.identity = identity
        self.scope = scope
        self.directory = directory
        self.entropy = entropy
    }

    public var handshake: Handshake {
        Handshake(identity: identity, scope: scope, entropy: entropy, directory: directory)
    }

    /// 같은 기기가 이름만 바꾼 상태.
    public func renamed(to nickname: String?) -> PeerNode {
        PeerNode(
            label: label,
            identity: identity.renamed(to: nickname),
            scope: scope,
            directory: directory,
            entropy: entropy
        )
    }

    /// 같은 설치가 키를 회전한 상태.
    public func rotatingKey() throws -> PeerNode {
        let rotated = try DeviceIdentity.createInstallation(
            entropy: entropy,
            nickname: identity.nickname
        )
        return PeerNode(
            label: label,
            identity: rotated.identity,
            scope: scope,
            directory: directory,
            entropy: entropy
        )
    }
}

/// 핸드셰이크 메시지를 중간에서 손대는 훅.
///
/// 공격자를 별도 타입으로 만들지 않고 변환 함수로 두는 이유는, 각 시나리오가
/// **정확히 무엇을 바꿨는지** 한 줄로 보이게 하기 위해서다.
public struct MessageInterceptor: Sendable {
    public var hello: @Sendable (HandshakeMessage.Hello) -> HandshakeMessage.Hello
    public var accept: @Sendable (HandshakeMessage.Accept) -> HandshakeMessage.Accept
    public var confirm: @Sendable (HandshakeMessage.Confirm) -> HandshakeMessage.Confirm

    public init(
        hello: @escaping @Sendable (HandshakeMessage.Hello) -> HandshakeMessage.Hello = { $0 },
        accept: @escaping @Sendable (HandshakeMessage.Accept) -> HandshakeMessage.Accept = { $0 },
        confirm: @escaping @Sendable (HandshakeMessage.Confirm) -> HandshakeMessage.Confirm = { $0 }
    ) {
        self.hello = hello
        self.accept = accept
        self.confirm = confirm
    }

    public static let passthrough = MessageInterceptor()
}

/// 연결 시도 결과.
public enum ConnectionOutcome: Sendable {
    case established(initiator: SecureSession, responder: SecureSession)
    case failed(role: HandshakeRole, failure: HandshakeFailure)

    public var isEstablished: Bool {
        if case .established = self { return true }
        return false
    }

    public var failure: HandshakeFailure? {
        if case let .failed(_, failure) = self { return failure }
        return nil
    }
}

public enum Connector {
    /// 두 기기를 실제 wire 바이트로 연결한다.
    ///
    /// 메시지를 구조체로 바로 넘기지 않고 **매번 직렬화·역직렬화한다.** 그래야
    /// 캡처한 바이트가 실제로 오간 것이고, 형식 오류가 여기서 드러난다.
    public static func connect(
        initiator: PeerNode,
        responder: PeerNode,
        recorder: WireRecorder? = nil,
        interceptor: MessageInterceptor = .passthrough,
        expectedPeer: DeviceID? = nil
    ) -> ConnectionOutcome {
        let initiatorHandshake = initiator.handshake
        let responderHandshake = responder.handshake

        let started: (message: HandshakeMessage.Hello, pending: Handshake.InitiatorPending)
        do {
            started = try initiatorHandshake.startInitiator()
        } catch {
            return .failed(role: .initiator, failure: .malformedKey(role: .initiator))
        }

        let helloOnWire = WireCodec.encode(interceptor.hello(started.message))
        recorder?.record(direction: "I→R", label: "handshake.hello", bytes: helloOnWire)
        guard let receivedHello = try? WireCodec.decodeHello(helloOnWire) else {
            return .failed(role: .responder, failure: .unexpectedMessage)
        }

        let responded: (message: HandshakeMessage.Accept, pending: Handshake.ResponderPending)
        switch responderHandshake.respond(to: receivedHello) {
        case let .success(value): responded = value
        case let .failure(failure): return .failed(role: .responder, failure: failure)
        }

        let acceptOnWire = WireCodec.encode(interceptor.accept(responded.message))
        recorder?.record(direction: "R→I", label: "handshake.accept", bytes: acceptOnWire)
        guard let receivedAccept = try? WireCodec.decodeAccept(acceptOnWire) else {
            return .failed(role: .initiator, failure: .unexpectedMessage)
        }

        let completedInitiator: (result: HandshakeResult, confirm: HandshakeMessage.Confirm)
        switch initiatorHandshake.completeInitiator(
            pending: started.pending,
            accept: receivedAccept,
            expectedPeer: expectedPeer
        ) {
        case let .success(value): completedInitiator = value
        case let .failure(failure): return .failed(role: .initiator, failure: failure)
        }

        let confirmOnWire = WireCodec.encode(interceptor.confirm(completedInitiator.confirm))
        recorder?.record(direction: "I→R", label: "handshake.confirm", bytes: confirmOnWire)
        guard let receivedConfirm = try? WireCodec.decodeConfirm(confirmOnWire) else {
            return .failed(role: .responder, failure: .unexpectedMessage)
        }

        switch responderHandshake.completeResponder(
            pending: responded.pending,
            confirm: receivedConfirm
        ) {
        case let .success(responderResult):
            return .established(
                initiator: SecureSession(result: completedInitiator.result),
                responder: SecureSession(result: responderResult)
            )
        case let .failure(failure):
            return .failed(role: .responder, failure: failure)
        }
    }
}

/// 중간자 공격 결과.
///
/// 공격자는 양쪽에 각각 **자기 신원으로** 핸드셰이크한다. 두 세션이 모두 열리면
/// 공격자가 평문을 본다.
public struct MITMOutcome: Sendable {
    public let initiatorSide: ConnectionOutcome
    public let responderSide: ConnectionOutcome
    /// 공격자가 실제로 복원한 평문에서 발견된 심은 값의 라벨.
    public let attackerReadLabels: [String]
    /// 초기자가 사칭을 알아챘는가.
    public let initiatorDetected: Bool

    public var bothSidesEstablished: Bool {
        initiatorSide.isEstablished && responderSide.isEstablished
    }
}

public enum ManInTheMiddle {
    /// 공격자가 양쪽 사이에 끼어든다.
    ///
    /// `expectedPeer`를 주면 초기자가 "특정 기기에 연결하려던 것"이 되고,
    /// 공격자의 다른 기기 ID가 그 자리에서 걸린다. 주지 않으면 자동 신뢰의
    /// 기본 상태 — 처음 보는 Peer는 전부 받아들이는 상태 — 를 재현한다.
    public static func intercept(
        initiator: PeerNode,
        attacker: PeerNode,
        responder: PeerNode,
        plaintext: Data,
        secrets: [PlantedSecret],
        expectedPeer: DeviceID? = nil,
        recorder: WireRecorder? = nil
    ) -> MITMOutcome {
        // 공격자는 초기자에게 응답자 역할을 한다.
        let initiatorSide = Connector.connect(
            initiator: initiator,
            responder: attacker,
            recorder: recorder,
            expectedPeer: expectedPeer
        )
        // 그리고 응답자에게 초기자 역할을 한다.
        let responderSide = Connector.connect(
            initiator: attacker,
            responder: responder,
            recorder: recorder
        )

        var readLabels: [String] = []
        if case let .established(_, attackerAsResponder) = initiatorSide,
           case .established = responderSide {
            // 초기자가 보낸 평문을 공격자가 실제로 연다.
            var initiatorSession: SecureSession
            if case let .established(session, _) = initiatorSide { initiatorSession = session } else {
                return MITMOutcome(
                    initiatorSide: initiatorSide,
                    responderSide: responderSide,
                    attackerReadLabels: [],
                    initiatorDetected: initiatorSide.isEstablished == false
                )
            }
            var attackerReceiver = attackerAsResponder
            if let frame = try? initiatorSession.sender.seal(plaintext),
               case let .success(opened) = attackerReceiver.receiver.open(frame) {
                readLabels = PlaintextScanner.exposedLabels(in: opened, secrets: secrets)
            }
        }

        return MITMOutcome(
            initiatorSide: initiatorSide,
            responderSide: responderSide,
            attackerReadLabels: readLabels,
            initiatorDetected: !initiatorSide.isEstablished
        )
    }
}

/// 열린 세션 위에서 봉투를 주고받는 얇은 층.
///
/// 채널과 이벤트 검증이 **둘 다** 필요하다는 것을 한 자리에서 보이기 위해
/// 둔다. 채널만 통과하면 위조 이벤트가 그대로 들어오고, 봉투만 검증하면
/// 도청과 재전송이 남는다.
public enum OperationalExchange {
    public struct SendResult: Sendable {
        public let frame: ChannelFrame
        public let bytesOnWire: Data
    }

    public static func send(
        _ envelope: SignedEnvelope,
        from session: inout SecureSession,
        recorder: WireRecorder? = nil
    ) throws -> SendResult {
        let payload = WireCodec.encode(envelope)
        let frame = try session.sender.seal(payload)
        let bytes = frame.wireBytes
        recorder?.record(direction: session.role == .initiator ? "I→R" : "R→I", label: "data.frame", bytes: bytes)
        return SendResult(frame: frame, bytesOnWire: bytes)
    }

    /// 수신 측이 frame을 열고 봉투를 검증한다.
    ///
    /// 반환값이 ``SyncOutcome``인 것이 핵심이다. 어느 단계에서 실패하든 결과는
    /// `확인 필요`이고 `applied`로 가는 경로는 **모든 검증을 통과한 하나**뿐이다.
    public static func receive(
        wireBytes: Data,
        into session: inout SecureSession,
        expectedAuthorDevice: DeviceID? = nil
    ) -> SyncOutcome {
        received(wireBytes: wireBytes, into: &session, expectedAuthorDevice: expectedAuthorDevice)
            .outcome
    }

    /// 결과와 함께 **수신 측이 실제로 복원한 이벤트**를 돌려준다.
    ///
    /// 평문 노출을 확인하는 시나리오는 이 경로를 써야 한다. 송신 측 payload를
    /// 검사하면 "복호화가 실제로 원문을 돌려주는가"를 고정하지 못하고,
    /// `applied`만 나오면 어떤 내용이든 라벨이 그대로 나온다.
    public static func received(
        wireBytes: Data,
        into session: inout SecureSession,
        expectedAuthorDevice: DeviceID? = nil
    ) -> (outcome: SyncOutcome, event: OperationalEvent?) {
        switch session.receiver.openWireBytes(wireBytes) {
        case let .failure(failure):
            return (SyncOutcome(channelFailure: failure), nil)
        case let .success(payload):
            guard let envelope = try? WireCodec.decodeEnvelope(payload) else {
                return (.needsReview(reason: .eventOriginRejected), nil)
            }
            switch EnvelopeVerifier.verify(envelope, expectedAuthorDevice: expectedAuthorDevice) {
            case let .failure(rejection):
                return (SyncOutcome(envelopeRejection: rejection), nil)
            case let .success(event):
                return (.applied(eventID: event.eventID), event)
            }
        }
    }
}

/// 바이트를 손대는 도구.
public enum Tamper {
    /// 지정한 위치의 비트 하나를 뒤집는다.
    public static func flipBit(_ data: Data, atByte index: Int, bit: UInt8 = 0) -> Data {
        guard index >= 0, index < data.count else { return data }
        var bytes = [UInt8](data)
        bytes[index] ^= (1 << bit)
        return Data(bytes)
    }

    /// 마지막 바이트를 뒤집는다. AEAD tag를 건드리는 가장 짧은 방법이다.
    public static func flipLastBit(_ data: Data) -> Data {
        flipBit(data, atByte: data.count - 1)
    }
}
