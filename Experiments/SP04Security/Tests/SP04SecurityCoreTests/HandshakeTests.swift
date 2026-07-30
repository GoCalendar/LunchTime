import CryptoKit
import Foundation
import Testing

@testable import SP04SecurityCore

/// 핸드셰이크 계약(`POL-03-R-01`, `POL-03-R-02`, `POL-03-R-03`).
///
/// 여기서 통과한 세션만 운영 데이터를 나르므로, 이 검증이 관대해지면 이
/// 스파이크의 모든 결론이 무너진다.
@Suite("SP-04 핸드셰이크")
struct HandshakeTests {
    private func makePair(
        seed: UInt64 = 7,
        mode: NetworkAdmissionMode = .observedNetworkAttributes
    ) throws -> (initiator: PeerNode, responder: PeerNode) {
        let entropy = DeterministicEntropy(seed: seed)
        let scope = ScenarioFixture.supportedScope(mode: mode)
        return (
            try ScenarioFixture.peer("P1", entropy: entropy, scope: scope),
            try ScenarioFixture.peer("P2", entropy: entropy, scope: scope)
        )
    }

    @Test("지원 네트워크의 두 기기는 세션을 열고 방향별 키를 따로 만든다")
    func establishesSession() throws {
        let pair = try makePair()
        guard case let .established(initiator, responder) = Connector.connect(
            initiator: pair.initiator, responder: pair.responder
        ) else {
            Issue.record("세션이 열리지 않았다")
            return
        }
        #expect(initiator.sessionID == responder.sessionID)
        #expect(initiator.sender.key == responder.receiver.key)
        #expect(initiator.receiver.key == responder.sender.key)
        // 한 키를 양방향에 쓰면 되돌려 보낸 frame이 유효해진다.
        #expect(initiator.sender.key != initiator.receiver.key)
        #expect(initiator.sender.direction == .initiatorToResponder)
        #expect(responder.sender.direction == .responderToInitiator)
    }

    @Test("세션 키는 매번 새로 만들어진다")
    func sessionKeysAreFresh() throws {
        let pair = try makePair()
        guard case let .established(first, _) = Connector.connect(
            initiator: pair.initiator, responder: pair.responder
        ),
        case let .established(second, _) = Connector.connect(
            initiator: pair.initiator, responder: pair.responder
        ) else {
            Issue.record("세션이 열리지 않았다")
            return
        }
        // 임시 키가 세션마다 새로 만들어지지 않으면 순방향 안전성이 없다.
        #expect(first.sessionID != second.sessionID)
        #expect(first.sender.key != second.sender.key)
    }

    @Test("지원 범위 밖 Peer는 accept를 받지 못한다")
    func rejectsOutOfScopePeer() throws {
        let entropy = DeterministicEntropy(seed: 11)
        let inside = try ScenarioFixture.peer(
            "P1", entropy: entropy, scope: ScenarioFixture.supportedScope()
        )
        let outside = try ScenarioFixture.peer(
            "X1", entropy: entropy, scope: ScenarioFixture.outsideScope()
        )
        let recorder = WireRecorder()
        let outcome = Connector.connect(initiator: outside, responder: inside, recorder: recorder)

        #expect(outcome.failure == .outOfSupportedScope(reason: .admissionProofInvalid))
        // hello 하나만 오갔다. 응답 자체가 만들어지지 않는다.
        #expect(recorder.count(label: "handshake.accept") == 0)
        #expect(recorder.count(label: "data.frame") == 0)
    }

    @Test("프로토콜 version이 다르면 admission 전에 거부한다")
    func rejectsUnsupportedVersion() {
        let scope = NetworkScope(localTag: .observed(networkName: "A"), protocolVersion: 1)
        let body = Data("body".utf8)
        let decision = scope.admit(
            peerProof: NetworkAdmissionTag.observed(networkName: "A").proof(over: body),
            over: body,
            peerMode: .observedNetworkAttributes,
            peerProtocolVersion: 2
        )
        #expect(decision == .outOfSupportedScope(reason: .unsupportedProtocolVersion))
    }

    @Test("admission 모드가 다르면 값이 우연히 같아도 거부한다")
    func rejectsAdmissionModeMismatch() {
        let observed = NetworkAdmissionTag.observed(networkName: "A")
        let scope = NetworkScope(localTag: observed)
        let sameValueOtherMode = NetworkAdmissionTag(
            mode: .deployedSharedSecret, value: observed.value
        )
        let body = Data("body".utf8)
        #expect(
            scope.admit(
                peerProof: sameValueOtherMode.proof(over: body),
                over: body,
                peerMode: .deployedSharedSecret,
                peerProtocolVersion: SP04Protocol.version
            ) == .outOfSupportedScope(reason: .admissionModeMismatch)
        )
    }

    @Test("주장한 기기 ID가 공개키에서 유도되지 않으면 거부한다")
    func rejectsUnboundDeviceID() throws {
        let pair = try makePair()
        let interceptor = MessageInterceptor(hello: { hello in
            HandshakeMessage.Hello(
                protocolVersion: hello.protocolVersion,
                admissionMode: hello.admissionMode,
                admissionProof: hello.admissionProof,
                staticSigningPublicKey: hello.staticSigningPublicKey,
                ephemeralPublicKey: hello.ephemeralPublicKey,
                nonce: hello.nonce,
                claimedDeviceID: "D-이건내가고른값",
                claimedUserID: hello.claimedUserID
            ).reproofed(with: ScenarioFixture.supportedScope().localTag)
        })
        let outcome = Connector.connect(
            initiator: pair.initiator, responder: pair.responder, interceptor: interceptor
        )
        #expect(outcome.failure == .identifiersNotDerivedFromKey(role: .initiator))
    }

    @Test("주장한 사용자 ID가 공개키에서 유도되지 않으면 거부한다")
    func rejectsUnboundUserID() throws {
        let pair = try makePair()
        // 기기 ID는 정직하게 두고 사용자 ID만 바꾼다. 사용자 ID가 권한 주체이므로
        // 이 경로만 열려도 소유권 사칭이 된다(`POL-03-R-02`).
        let interceptor = MessageInterceptor(hello: { hello in
            HandshakeMessage.Hello(
                protocolVersion: hello.protocolVersion,
                admissionMode: hello.admissionMode,
                admissionProof: hello.admissionProof,
                staticSigningPublicKey: hello.staticSigningPublicKey,
                ephemeralPublicKey: hello.ephemeralPublicKey,
                nonce: hello.nonce,
                claimedDeviceID: hello.claimedDeviceID,
                claimedUserID: "U-남의사용자ID"
            ).reproofed(with: ScenarioFixture.supportedScope().localTag)
        })
        let outcome = Connector.connect(
            initiator: pair.initiator, responder: pair.responder, interceptor: interceptor
        )
        #expect(outcome.failure == .identifiersNotDerivedFromKey(role: .initiator))
    }

    @Test("transcript의 어느 필드를 바꿔도 서명이 깨진다")
    func transcriptBindingCoversEveryField() throws {
        let pair = try makePair()
        let mutations: [(String, @Sendable (HandshakeMessage.Accept) -> HandshakeMessage.Accept)] = [
            ("nonce", { accept in
                HandshakeMessage.Accept(
                    protocolVersion: accept.protocolVersion,
                    admissionMode: accept.admissionMode,
                    admissionProof: accept.admissionProof,
                    staticSigningPublicKey: accept.staticSigningPublicKey,
                    ephemeralPublicKey: accept.ephemeralPublicKey,
                    nonce: Tamper.flipLastBit(accept.nonce),
                    claimedDeviceID: accept.claimedDeviceID,
                    claimedUserID: accept.claimedUserID,
                    signature: accept.signature
                ).reproofed(with: ScenarioFixture.supportedScope().localTag)
            }),
            ("ephemeralPublicKey", { accept in
                HandshakeMessage.Accept(
                    protocolVersion: accept.protocolVersion,
                    admissionMode: accept.admissionMode,
                    admissionProof: accept.admissionProof,
                    staticSigningPublicKey: accept.staticSigningPublicKey,
                    ephemeralPublicKey: Tamper.flipLastBit(accept.ephemeralPublicKey),
                    nonce: accept.nonce,
                    claimedDeviceID: accept.claimedDeviceID,
                    claimedUserID: accept.claimedUserID,
                    signature: accept.signature
                ).reproofed(with: ScenarioFixture.supportedScope().localTag)
            }),
            ("signature", { accept in
                HandshakeMessage.Accept(
                    protocolVersion: accept.protocolVersion,
                    admissionMode: accept.admissionMode,
                    admissionProof: accept.admissionProof,
                    staticSigningPublicKey: accept.staticSigningPublicKey,
                    ephemeralPublicKey: accept.ephemeralPublicKey,
                    nonce: accept.nonce,
                    claimedDeviceID: accept.claimedDeviceID,
                    claimedUserID: accept.claimedUserID,
                    signature: Tamper.flipLastBit(accept.signature)
                ).reproofed(with: ScenarioFixture.supportedScope().localTag)
            })
        ]

        for (field, mutate) in mutations {
            let outcome = Connector.connect(
                initiator: pair.initiator,
                responder: pair.responder,
                interceptor: MessageInterceptor(accept: mutate)
            )
            #expect(
                outcome.failure == .signatureInvalid(role: .responder),
                "\(field)를 바꿨는데 서명 검증이 통과했다"
            )
        }
    }

    @Test("확인 메시지 서명이 깨지면 응답자가 세션을 열지 않는다")
    func rejectsInvalidConfirm() throws {
        let pair = try makePair()
        let outcome = Connector.connect(
            initiator: pair.initiator,
            responder: pair.responder,
            interceptor: MessageInterceptor(confirm: { confirm in
                HandshakeMessage.Confirm(signature: Tamper.flipLastBit(confirm.signature))
            })
        )
        #expect(outcome.failure == .signatureInvalid(role: .initiator))
    }

    @Test("캡처한 핸드셰이크를 그대로 재생하면 세션이 열리지 않는다")
    func rejectsReplayedHandshake() throws {
        let pair = try makePair()
        let recorder = WireRecorder()
        #expect(
            Connector.connect(
                initiator: pair.initiator, responder: pair.responder, recorder: recorder
            ).isEstablished
        )

        let captured = recorder.recorded
        let hello = try WireCodec.decodeHello(
            #require(captured.first { $0.label == "handshake.hello" }).bytes
        )
        let confirm = try WireCodec.decodeConfirm(
            #require(captured.first { $0.label == "handshake.confirm" }).bytes
        )

        // 응답자는 재생된 hello에도 응답한다. 그것 자체는 막을 수 없다 —
        // 새 임시 키와 nonce로 응답할 뿐이다. 재생을 죽이는 것은 그다음이다.
        let handshake = pair.responder.handshake
        guard case let .success(responded) = handshake.respond(to: hello) else {
            Issue.record("재생된 hello에 응답하지 못했다")
            return
        }
        let result = handshake.completeResponder(pending: responded.pending, confirm: confirm)
        guard case let .failure(failure) = result else {
            Issue.record("재생된 confirm으로 세션이 열렸다")
            return
        }
        #expect(failure == .signatureInvalid(role: .initiator))
    }

    @Test("아는 기기에 연결하려던 것이면 다른 신원을 거부한다")
    func rejectsUnexpectedPeerIdentity() throws {
        let entropy = DeterministicEntropy(seed: 21)
        let scope = ScenarioFixture.supportedScope()
        let initiator = try ScenarioFixture.peer("P1", entropy: entropy, scope: scope)
        let expected = try ScenarioFixture.peer("P2", entropy: entropy, scope: scope)
        let other = try ScenarioFixture.peer("X1", entropy: entropy, scope: scope)

        let outcome = Connector.connect(
            initiator: initiator,
            responder: other,
            expectedPeer: expected.identity.deviceID
        )
        #expect(
            outcome.failure
                == .peerIdentityNotExpected(
                    expected: expected.identity.deviceID.rawValue,
                    actual: other.identity.deviceID.rawValue
                )
        )
    }

    @Test("저차 임시 공개키를 보내면 키 합의가 실패한다")
    func rejectsLowOrderEphemeralKey() throws {
        // 상대가 저차 점(low-order point)을 임시 키로 보내면 공유 비밀이
        // 상수가 되어 세션 키를 공격자가 미리 안다. 서명이 정상인 악의적
        // 응답자를 직접 만들어 이 경로만 시험한다 — 중간에서 바꾸면 서명
        // 검증이 먼저 걸려 이 분기에 닿지 않는다.
        let entropy = DeterministicEntropy(seed: 41)
        let scope = ScenarioFixture.supportedScope()
        let initiator = try ScenarioFixture.peer("P1", entropy: entropy, scope: scope)
        let malicious = try ScenarioFixture.peer("X1", entropy: entropy, scope: scope)

        let started = try initiator.handshake.startInitiator()
        let lowOrder = Data([
            0x5f, 0x9c, 0x95, 0xbc, 0xa3, 0x50, 0x8c, 0x24,
            0xb1, 0xd0, 0xb1, 0x55, 0x9c, 0x83, 0xef, 0x5b,
            0x04, 0x44, 0x5c, 0xc4, 0x58, 0x1c, 0x8e, 0x86,
            0xd8, 0x22, 0x4e, 0xdd, 0xd0, 0x9f, 0x11, 0xd7
        ])
        let body = HandshakeMessage.Accept(
            protocolVersion: scope.protocolVersion,
            admissionMode: scope.localTag.mode,
            admissionProof: Data(),
            staticSigningPublicKey: Data(malicious.identity.signingKey.publicKey.rawRepresentation),
            ephemeralPublicKey: lowOrder,
            nonce: entropy.bytes(32),
            claimedDeviceID: malicious.identity.deviceID.rawValue,
            claimedUserID: malicious.identity.userID.rawValue,
            signature: Data()
        ).reproofed(with: scope.localTag)
        let transcript = Handshake.transcript(hello: started.message, accept: body)
        let signed = HandshakeMessage.Accept(
            protocolVersion: body.protocolVersion,
            admissionMode: body.admissionMode,
            admissionProof: body.admissionProof,
            staticSigningPublicKey: body.staticSigningPublicKey,
            ephemeralPublicKey: body.ephemeralPublicKey,
            nonce: body.nonce,
            claimedDeviceID: body.claimedDeviceID,
            claimedUserID: body.claimedUserID,
            signature: try malicious.identity.signingKey.signature(for: transcript.responderSigned)
        )

        let result = initiator.handshake.completeInitiator(pending: started.pending, accept: signed)
        guard case let .failure(failure) = result else {
            Issue.record("저차 임시 키로 세션이 열렸다")
            return
        }
        #expect(failure == .malformedKey(role: .responder))
    }

    @Test("admission 증명은 그 메시지 본문에 묶여 있다")
    func admissionProofIsBoundToMessageBody() throws {
        // 증명이 본문을 덮지 않으면 tag마다 상수가 되고, 링크에서 한 번 관측한
        // 값을 자기 메시지에 그대로 붙이면 통과한다. 그러면 tag를 wire에서 뺀
        // 의미가 없어진다 — 증명 자체가 새 bearer token이 될 뿐이다.
        let tag = NetworkAdmissionTag.deployed(
            sharedSecret: Data("SP04-SECRET".utf8), networkName: "N"
        )
        #expect(tag.proof(over: Data("A".utf8)) != tag.proof(over: Data("B".utf8)))

        let entropy = DeterministicEntropy(seed: 51)
        let scope = ScenarioFixture.supportedScope(mode: .deployedSharedSecret)
        let insider = try ScenarioFixture.peer("P1", entropy: entropy, scope: scope)
        let responder = try ScenarioFixture.peer("P2", entropy: entropy, scope: scope)
        let outsider = try ScenarioFixture.peer(
            "X1",
            entropy: entropy,
            scope: ScenarioFixture.outsideScope(mode: .deployedSharedSecret)
        )

        // 공격자가 정직한 hello에서 증명값을 그대로 베껴 자기 hello에 붙인다.
        let capturedProof = try insider.handshake.startInitiator().message.admissionProof
        let outcome = Connector.connect(
            initiator: outsider,
            responder: responder,
            interceptor: MessageInterceptor(hello: { hello in
                HandshakeMessage.Hello(
                    protocolVersion: hello.protocolVersion,
                    admissionMode: hello.admissionMode,
                    admissionProof: capturedProof,
                    staticSigningPublicKey: hello.staticSigningPublicKey,
                    ephemeralPublicKey: hello.ephemeralPublicKey,
                    nonce: hello.nonce,
                    claimedDeviceID: hello.claimedDeviceID,
                    claimedUserID: hello.claimedUserID
                )
            })
        )
        #expect(outcome.failure == .outOfSupportedScope(reason: .admissionProofInvalid))
    }

    @Test("응답자는 자기 hello에 accept를 만들지 않는다")
    func responderRejectsOwnHello() throws {
        // 초기자 쪽 검사만 두면 응답자는 자기 자신에게 `accept`를 만들어 내보낸다.
        // 두 자리에 모두 있어야 어느 방향으로 반사해도 죽는다.
        let entropy = DeterministicEntropy(seed: 52)
        let peer = try ScenarioFixture.peer(
            "P1", entropy: entropy, scope: ScenarioFixture.supportedScope()
        )
        let ownHello = try peer.handshake.startInitiator().message
        guard case let .failure(failure) = peer.handshake.respond(to: ownHello) else {
            Issue.record("응답자가 자기 hello에 accept를 만들었다")
            return
        }
        #expect(failure == .reflectedOwnIdentity)
    }

    @Test("연결 상대를 지정하지 않으면 처음 보는 Peer를 그대로 받아들인다")
    func acceptsUnknownPeerWithoutExpectation() throws {
        // 이것은 결함이 아니라 자동 신뢰의 정의다(`POL-03-R-01`). 시험으로
        // 고정해 두어야 나중에 "막고 있다"고 오해하지 않는다.
        let pair = try makePair(seed: 31)
        let outcome = Connector.connect(initiator: pair.initiator, responder: pair.responder)
        guard case let .established(session, _) = outcome else {
            Issue.record("세션이 열리지 않았다")
            return
        }
        #expect(pair.initiator.directory.known(deviceID: session.peer.deviceID) != nil)
    }
}
