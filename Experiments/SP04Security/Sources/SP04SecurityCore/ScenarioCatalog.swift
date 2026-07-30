import CryptoKit
import Foundation

/// 시나리오 하나에 주어지는 입력.
public struct ScenarioContext: Sendable {
    public let entropy: any EntropySource
    public let secrets: [PlantedSecret]
    /// 파일 탈취 시나리오가 실제 파일을 쓸 디렉터리.
    public let workingDirectory: URL

    public init(entropy: any EntropySource, secrets: [PlantedSecret], workingDirectory: URL) {
        self.entropy = entropy
        self.secrets = secrets
        self.workingDirectory = workingDirectory
    }
}

/// 저장소에 고정한 위협 시나리오 하나.
///
/// [SP-02](../../../docs/technical/spikes/PRD-01-SP-02-replication-conflicts.md)의
/// fixture와 같은 역할이다. 각 시나리오는 **기대값을 미리 선언**하고 실행 결과와
/// 대조한다. 결과를 보고 나서 기대를 적으면 그 시나리오는 아무것도 검증하지
/// 않는다.
public struct SecurityScenario: Sendable {
    public let name: String
    public let question: String
    public let policyReferences: [String]
    public let expectations: [String: String]
    public let body: @Sendable (ScenarioContext) throws -> [String: String]

    public init(
        name: String,
        question: String,
        policyReferences: [String],
        expectations: [String: String],
        body: @escaping @Sendable (ScenarioContext) throws -> [String: String]
    ) {
        self.name = name
        self.question = question
        self.policyReferences = policyReferences
        self.expectations = expectations
        self.body = body
    }
}

/// 시나리오가 공유하는 기본 구성.
public enum ScenarioFixture {
    /// 지원 네트워크 이름. 실제 사내 SSID를 쓰지 않는다.
    public static let supportedNetworkName = "SP04-NET-A"
    public static let otherNetworkName = "SP04-NET-B"

    /// 심는 평문. 모두 합성 값이며 실제 가게·메뉴·사람이 아니다.
    public static let secrets: [PlantedSecret] = [
        PlantedSecret(label: "store", value: "SP04-STORE-단골식당"),
        PlantedSecret(label: "menu", value: "SP04-MENU-김치찌개곱빼기"),
        PlantedSecret(label: "link", value: "SP04-LINK-https://example.invalid/order/9f3"),
        PlantedSecret(label: "nickname", value: "SP04-NICK-점심대장"),
        PlantedSecret(label: "chat", value: "SP04-CHAT-오늘은-조금-늦어요")
    ]

    public static func supportedScope(mode: NetworkAdmissionMode = .observedNetworkAttributes) -> NetworkScope {
        switch mode {
        case .observedNetworkAttributes:
            NetworkScope(localTag: .observed(networkName: supportedNetworkName))
        case .deployedSharedSecret:
            NetworkScope(
                localTag: .deployed(
                    sharedSecret: Data("SP04-DEPLOYED-SECRET".utf8),
                    networkName: supportedNetworkName
                )
            )
        }
    }

    public static func outsideScope(mode: NetworkAdmissionMode = .observedNetworkAttributes) -> NetworkScope {
        switch mode {
        case .observedNetworkAttributes:
            NetworkScope(localTag: .observed(networkName: otherNetworkName))
        case .deployedSharedSecret:
            NetworkScope(
                localTag: .deployed(
                    sharedSecret: Data("SP04-ATTACKER-GUESS".utf8),
                    networkName: supportedNetworkName
                )
            )
        }
    }

    public static func peer(
        _ label: String,
        entropy: any EntropySource,
        scope: NetworkScope,
        nickname: String? = nil
    ) throws -> PeerNode {
        let created = try DeviceIdentity.createInstallation(entropy: entropy, nickname: nickname)
        return PeerNode(label: label, identity: created.identity, scope: scope, entropy: entropy)
    }

    /// 평문을 실은 메뉴 이벤트 payload.
    public static func menuPayload() -> Data {
        var writer = CanonicalWriter(domain: "SP04/fixture/menu")
        writer.append(secrets[0].value)
        writer.append(secrets[1].value)
        writer.append(secrets[2].value)
        return writer.data
    }

    /// 작성자가 서명한 메뉴 이벤트.
    public static func menuEnvelope(author: PeerNode) throws -> SignedEnvelope {
        try SignedEnvelope.sign(
            OperationalEvent(
                // ID는 서명 시점에 유도된 값으로 대체된다. 여기 값은 무시된다.
                eventID: "",
                daySession: "S1",
                room: "R1",
                authorUser: author.identity.userID.rawValue,
                authorDevice: author.identity.deviceID.rawValue,
                eventType: "menuRevision",
                revision: 1,
                logicalOrder: 10,
                payload: menuPayload()
            ),
            with: author.identity
        )
    }

    public static func boolText(_ value: Bool) -> String { value ? "yes" : "no" }

    public static func labelText(_ labels: [String]) -> String {
        labels.isEmpty ? "none" : labels.sorted().joined(separator: ",")
    }

    /// 실패 이유를 안정적인 짧은 토큰으로 접는다.
    public static func failureToken(_ failure: HandshakeFailure?) -> String {
        guard let failure else { return "none" }
        switch failure {
        case let .outOfSupportedScope(reason): return "outOfSupportedScope:\(reason.rawValue)"
        case .reflectedOwnIdentity: return "reflectedOwnIdentity"
        case let .signatureInvalid(role): return "signatureInvalid:\(role.rawValue)"
        case let .identifiersNotDerivedFromKey(role): return "identifiersNotDerivedFromKey:\(role.rawValue)"
        case let .malformedKey(role): return "malformedKey:\(role.rawValue)"
        case .pinnedKeyMismatch: return "pinnedKeyMismatch"
        case .peerIdentityNotExpected: return "peerIdentityNotExpected"
        case .unexpectedMessage: return "unexpectedMessage"
        }
    }

    public static func outcomeToken(_ outcome: SyncOutcome) -> String {
        switch outcome {
        case .applied: return "applied"
        case let .needsReview(reason): return "needsReview:\(reason.rawValue)"
        }
    }
}

public enum ScenarioCatalog {
    public static var all: [SecurityScenario] {
        [
            authenticatedChannelBaseline,
            wirePlaintextCapture,
            loopbackSocketWire,
            discoveryBeaconMinimization,
            outOfNetworkPeerRejected,
            tamperedFrameRejected,
            replayedFrameRejected,
            reflectedFrameRejected,
            crossSessionFrameRejected,
            replayedHandshakeRejected,
            mitmEphemeralSubstitution,
            mitmFullImpersonationObserved,
            mitmFullImpersonationDeployed,
            mitmBlockedByExpectedPeer,
            mitmWithCapturedAdmissionProof,
            selfHandshakeRejected,
            forgedEventAuthor,
            sameEventIDDifferentPayload,
            stolenStoreFile,
            storeKeyLossIsNotEmptyStore,
            storeRecordTruncationDetected,
            storeReencodeKeepsNonceUnique,
            chatIsNotStorable,
            keyRotationIdentity,
            reinstallIsNewUser,
            nicknameIsNotAuthority,
            internalMaliciousPeerReads,
            diagnosticsVocabulary,
            prohibitedClaimDetection,
            failureNeverReportsSuccess
        ]
    }

    public static func named(_ name: String) -> SecurityScenario? {
        all.first { $0.name == name }
    }

    // MARK: - 정상 경로

    static let authenticatedChannelBaseline = SecurityScenario(
        name: "authenticated-channel-baseline",
        question: "지원 네트워크의 두 기기가 인증된 암호화 채널을 열고 서명된 이벤트를 적용하는가?",
        policyReferences: ["POL-03-R-01", "POL-03-R-02", "POL-03-R-03", "PRD-01-AC-08"],
        expectations: [
            "handshake": "established",
            "deviceIDDerivedFromKey": "yes",
            "userIDDerivedFromKey": "yes",
            "firstContact": "yes",
            "outcome": "applied",
            "directionalKeysDiffer": "yes"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)

        guard case .established(var initiator, var responder) = Connector.connect(
            initiator: p1, responder: p2
        ) else {
            return ["handshake": "failed"]
        }

        let envelope = try ScenarioFixture.menuEnvelope(author: p1)
        let sent = try OperationalExchange.send(envelope, from: &initiator)
        let outcome = OperationalExchange.receive(wireBytes: sent.bytesOnWire, into: &responder)

        return [
            "handshake": "established",
            "deviceIDDerivedFromKey": ScenarioFixture.boolText(initiator.peer.identifiersMatchKey),
            "userIDDerivedFromKey": ScenarioFixture.boolText(
                UserID(signingPublicKey: initiator.peer.signingPublicKey) == initiator.peer.userID
            ),
            "firstContact": ScenarioFixture.boolText(p1.directory.count == 1),
            "outcome": ScenarioFixture.outcomeToken(outcome),
            "directionalKeysDiffer": ScenarioFixture.boolText(
                initiator.sender.key != initiator.receiver.key
            )
        ]
    }

    // MARK: - 평문 노출

    static let wirePlaintextCapture = SecurityScenario(
        name: "wire-plaintext-capture",
        question: "핸드셰이크와 데이터 frame을 모두 캡처하면 응용 평문이 보이는가?",
        policyReferences: ["POL-03-R-03", "PRD-01-AC-08"],
        expectations: [
            "exposedInCapture": "none",
            "exposedInPlaintextControl": "link,menu,store",
            "capturedFrames": "4",
            "dataFrames": "1"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)
        let recorder = WireRecorder()

        guard case .established(var initiator, var responder) = Connector.connect(
            initiator: p1, responder: p2, recorder: recorder
        ) else {
            return ["exposedInCapture": "handshake-failed"]
        }

        let envelope = try ScenarioFixture.menuEnvelope(author: p1)
        let sent = try OperationalExchange.send(envelope, from: &initiator, recorder: recorder)
        _ = OperationalExchange.receive(wireBytes: sent.bytesOnWire, into: &responder)

        // 대조군: 같은 payload를 암호화하지 않고 그대로 캡처했다면 무엇이
        // 보이는가. 이 값이 `none`이면 검사 자체가 고장 난 것이다.
        let control = PlaintextScanner.exposedLabels(
            in: WireCodec.encode(envelope),
            secrets: context.secrets
        )

        return [
            "exposedInCapture": ScenarioFixture.labelText(
                PlaintextScanner.exposedLabels(in: recorder.capturedBytes, secrets: context.secrets)
            ),
            "exposedInPlaintextControl": ScenarioFixture.labelText(control),
            "capturedFrames": String(recorder.frameCount),
            "dataFrames": String(recorder.count(label: "data.frame"))
        ]
    }

    static let loopbackSocketWire = SecurityScenario(
        name: "loopback-socket-wire",
        question: "같은 바이트가 실제 TCP 소켓을 지나도 형식과 판정이 유지되는가?",
        policyReferences: ["POL-03-R-03"],
        expectations: [
            "socketRoundTrip": "ok",
            "bytesIdentical": "yes",
            "outcome": "applied",
            "exposedInSocketCapture": "none"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)

        guard case .established(var initiator, var responder) = Connector.connect(
            initiator: p1, responder: p2
        ) else {
            return ["socketRoundTrip": "handshake-failed"]
        }

        let envelope = try ScenarioFixture.menuEnvelope(author: p1)
        let sent = try OperationalExchange.send(envelope, from: &initiator)

        let received: [Data]
        do {
            received = try LoopbackTransport.roundTrip(messages: [sent.bytesOnWire])
        } catch {
            // 환경 실패를 성공으로 접지 않는다. 실패한 사실을 그대로 남긴다.
            return ["socketRoundTrip": "failed"]
        }
        guard let delivered = received.first else { return ["socketRoundTrip": "empty"] }

        let outcome = OperationalExchange.receive(wireBytes: delivered, into: &responder)
        return [
            "socketRoundTrip": "ok",
            "bytesIdentical": ScenarioFixture.boolText(delivered == sent.bytesOnWire),
            "outcome": ScenarioFixture.outcomeToken(outcome),
            "exposedInSocketCapture": ScenarioFixture.labelText(
                PlaintextScanner.exposedLabels(in: delivered, secrets: context.secrets)
            )
        ]
    }

    static let discoveryBeaconMinimization = SecurityScenario(
        name: "discovery-beacon-minimization",
        question: "발견 패킷에 사용자 이름·admission 자격·방·가게·메뉴·링크가 실리는가?",
        policyReferences: ["POL-03-R-02", "POL-03-R-03", "PRD-01-AC-08"],
        expectations: [
            "exposedInBeacon": "none",
            "beaconCarriesNickname": "no",
            "beaconCarriesAdmissionTag": "no",
            "beaconIdentifiesDeviceByDerivedID": "yes",
            "advertisesBeforeNickname": "no"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope(mode: .deployedSharedSecret)
        let nickname = context.secrets.first { $0.label == "nickname" }?.value
        let named = try ScenarioFixture.peer(
            "P1", entropy: context.entropy, scope: scope, nickname: nickname
        )
        let unnamed = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)

        guard let beacon = DiscoveryBeacon.advertise(identity: named.identity, scope: scope) else {
            return ["advertisesBeforeNickname": "beacon-missing"]
        }

        return [
            "exposedInBeacon": ScenarioFixture.labelText(
                PlaintextScanner.exposedLabels(in: beacon.wireBytes, secrets: context.secrets)
            ),
            "beaconCarriesNickname": ScenarioFixture.boolText(
                nickname.map {
                    PlaintextScanner.contains(haystack: beacon.wireBytes, needle: Data($0.utf8))
                } ?? false
            ),
            // admission 자격이 방송되면 그 값 자체가 bearer token이 된다.
            "beaconCarriesAdmissionTag": ScenarioFixture.boolText(
                PlaintextScanner.contains(haystack: beacon.wireBytes, needle: scope.localTag.value)
            ),
            "beaconIdentifiesDeviceByDerivedID": ScenarioFixture.boolText(
                beacon.deviceID == DeviceID(signingPublicKey: beacon.signingPublicKey).rawValue
            ),
            // `POL-03-R-02`·`PRD-01-AC-08`: 닉네임 전에는 Peer로 노출하지 않는다.
            "advertisesBeforeNickname": ScenarioFixture.boolText(
                DiscoveryBeacon.advertise(identity: unnamed.identity, scope: scope) != nil
            )
        ]
    }

    // MARK: - 범위 밖 Peer

    static let outOfNetworkPeerRejected = SecurityScenario(
        name: "out-of-network-peer-rejected",
        question: "지원 범위 밖 Peer가 운영 데이터를 받는가?",
        policyReferences: ["POL-03-R-01", "PRD-01-FR-12"],
        expectations: [
            "handshake": "failed",
            "failure": "outOfSupportedScope:admissionProofInvalid",
            "dataFrames": "0",
            "exposedInCapture": "none",
            "outcome": "needsReview:peerOutOfSupportedScope"
        ]
    ) { context in
        let inside = try ScenarioFixture.peer(
            "P1", entropy: context.entropy, scope: ScenarioFixture.supportedScope()
        )
        let outside = try ScenarioFixture.peer(
            "X1", entropy: context.entropy, scope: ScenarioFixture.outsideScope()
        )
        let recorder = WireRecorder()

        let outcome = Connector.connect(initiator: outside, responder: inside, recorder: recorder)
        let failure = outcome.failure

        return [
            "handshake": outcome.isEstablished ? "established" : "failed",
            "failure": ScenarioFixture.failureToken(failure),
            "dataFrames": String(recorder.count(label: "data.frame")),
            "exposedInCapture": ScenarioFixture.labelText(
                PlaintextScanner.exposedLabels(in: recorder.capturedBytes, secrets: context.secrets)
            ),
            "outcome": failure.map { ScenarioFixture.outcomeToken(SyncOutcome(handshakeFailure: $0)) }
                ?? "applied"
        ]
    }

    // MARK: - 위·변조와 재전송

    static let tamperedFrameRejected = SecurityScenario(
        name: "tampered-frame-rejected",
        question: "전송 중 한 비트만 바뀐 frame이 적용되는가?",
        policyReferences: ["POL-03-R-03", "PRD-01-FR-12"],
        expectations: [
            "tamperedCiphertext": "needsReview:transportAuthenticationFailed",
            "tamperedSequenceHeader": "needsReview:transportAuthenticationFailed",
            "untouched": "applied"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)
        guard case .established(var initiator, var responder) = Connector.connect(
            initiator: p1, responder: p2
        ) else { return ["tamperedCiphertext": "handshake-failed"] }

        let envelope = try ScenarioFixture.menuEnvelope(author: p1)

        let first = try OperationalExchange.send(envelope, from: &initiator)
        var tamperedReceiver = responder
        let ciphertextResult = OperationalExchange.receive(
            wireBytes: Tamper.flipLastBit(first.bytesOnWire), into: &tamperedReceiver
        )

        // 순서 번호 헤더만 바꾼다. AAD에 묶여 있으므로 tag가 맞지 않는다.
        let second = try OperationalExchange.send(envelope, from: &initiator)
        var headerReceiver = responder
        let headerResult = OperationalExchange.receive(
            wireBytes: Tamper.flipBit(second.bytesOnWire, atByte: 9), into: &headerReceiver
        )

        let third = try OperationalExchange.send(envelope, from: &initiator)
        let cleanResult = OperationalExchange.receive(wireBytes: third.bytesOnWire, into: &responder)

        return [
            "tamperedCiphertext": ScenarioFixture.outcomeToken(ciphertextResult),
            "tamperedSequenceHeader": ScenarioFixture.outcomeToken(headerResult),
            "untouched": ScenarioFixture.outcomeToken(cleanResult)
        ]
    }

    static let replayedFrameRejected = SecurityScenario(
        name: "replayed-frame-rejected",
        question: "이미 처리한 frame을 그대로 다시 보내면 두 번 적용되는가?",
        policyReferences: ["POL-03-R-03"],
        expectations: [
            "firstDelivery": "applied",
            "immediateReplay": "needsReview:replayRejected",
            "replayAfterOthers": "needsReview:replayRejected",
            "outOfOrderButFresh": "applied"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)
        guard case .established(var initiator, var responder) = Connector.connect(
            initiator: p1, responder: p2
        ) else { return ["firstDelivery": "handshake-failed"] }

        let envelope = try ScenarioFixture.menuEnvelope(author: p1)
        let first = try OperationalExchange.send(envelope, from: &initiator)
        let second = try OperationalExchange.send(envelope, from: &initiator)
        let third = try OperationalExchange.send(envelope, from: &initiator)

        // 순서 2를 먼저 넣어 창을 앞으로 밀고, 순서 1을 늦게 넣는다. 늦게 온
        // 정상 frame은 통과해야 한다 — 창이 없으면 여기서 오탐이 난다.
        let firstResult = OperationalExchange.receive(wireBytes: first.bytesOnWire, into: &responder)
        let replayResult = OperationalExchange.receive(wireBytes: first.bytesOnWire, into: &responder)
        _ = OperationalExchange.receive(wireBytes: third.bytesOnWire, into: &responder)
        let lateResult = OperationalExchange.receive(wireBytes: second.bytesOnWire, into: &responder)
        let lateReplay = OperationalExchange.receive(wireBytes: first.bytesOnWire, into: &responder)

        return [
            "firstDelivery": ScenarioFixture.outcomeToken(firstResult),
            "immediateReplay": ScenarioFixture.outcomeToken(replayResult),
            "replayAfterOthers": ScenarioFixture.outcomeToken(lateReplay),
            "outOfOrderButFresh": ScenarioFixture.outcomeToken(lateResult)
        ]
    }

    static let reflectedFrameRejected = SecurityScenario(
        name: "reflected-frame-rejected",
        question: "상대가 보낸 frame을 그대로 되돌려 보내면 유효한가?",
        policyReferences: ["POL-03-R-03"],
        expectations: ["reflected": "needsReview:transportAuthenticationFailed"]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)
        guard case .established(var initiator, _) = Connector.connect(
            initiator: p1, responder: p2
        ) else { return ["reflected": "handshake-failed"] }

        let envelope = try ScenarioFixture.menuEnvelope(author: p1)
        let sent = try OperationalExchange.send(envelope, from: &initiator)
        // 초기자가 자기 frame을 자기 수신기에 넣는다.
        let reflected = OperationalExchange.receive(wireBytes: sent.bytesOnWire, into: &initiator)
        return ["reflected": ScenarioFixture.outcomeToken(reflected)]
    }

    static let crossSessionFrameRejected = SecurityScenario(
        name: "cross-session-frame-rejected",
        question: "이전 세션에서 캡처한 frame을 새 세션에 넣으면 적용되는가?",
        policyReferences: ["POL-03-R-03"],
        expectations: [
            "sessionIDsDiffer": "yes",
            "crossSessionFrame": "needsReview:transportAuthenticationFailed",
            "sameSessionFrame": "applied"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)

        guard case .established(var firstInitiator, _) = Connector.connect(initiator: p1, responder: p2),
              case .established(var secondInitiator, var secondResponder) = Connector.connect(
                initiator: p1, responder: p2
              ) else { return ["crossSessionFrame": "handshake-failed"] }

        let envelope = try ScenarioFixture.menuEnvelope(author: p1)
        let oldFrame = try OperationalExchange.send(envelope, from: &firstInitiator)
        let newFrame = try OperationalExchange.send(envelope, from: &secondInitiator)

        var probeReceiver = secondResponder
        let crossResult = OperationalExchange.receive(
            wireBytes: oldFrame.bytesOnWire, into: &probeReceiver
        )
        let sameResult = OperationalExchange.receive(
            wireBytes: newFrame.bytesOnWire, into: &secondResponder
        )

        return [
            "sessionIDsDiffer": ScenarioFixture.boolText(
                firstInitiator.sessionID != secondInitiator.sessionID
            ),
            "crossSessionFrame": ScenarioFixture.outcomeToken(crossResult),
            "sameSessionFrame": ScenarioFixture.outcomeToken(sameResult)
        ]
    }

    static let replayedHandshakeRejected = SecurityScenario(
        name: "replayed-handshake-rejected",
        question: "캡처한 핸드셰이크 세 메시지를 그대로 재생하면 세션이 열리는가?",
        policyReferences: ["POL-03-R-03"],
        expectations: [
            "originalHandshake": "established",
            "replayedConfirmAccepted": "no",
            "replayFailure": "signatureInvalid:initiator"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)
        let recorder = WireRecorder()

        let original = Connector.connect(initiator: p1, responder: p2, recorder: recorder)
        let captured = recorder.recorded
        guard original.isEstablished,
              let helloBytes = captured.first(where: { $0.label == "handshake.hello" })?.bytes,
              let confirmBytes = captured.first(where: { $0.label == "handshake.confirm" })?.bytes else {
            return ["originalHandshake": "failed"]
        }

        // 공격자가 캡처한 hello를 그대로 다시 보낸다. 응답자는 새 임시 키와
        // 새 nonce로 응답하므로 transcript가 달라지고, 옛 confirm은 맞지 않는다.
        let responderHandshake = p2.handshake
        let replayedHello = try WireCodec.decodeHello(helloBytes)
        guard case let .success(responded) = responderHandshake.respond(to: replayedHello) else {
            return ["originalHandshake": "established", "replayedConfirmAccepted": "respond-failed"]
        }
        let replayedConfirm = try WireCodec.decodeConfirm(confirmBytes)
        let result = responderHandshake.completeResponder(
            pending: responded.pending, confirm: replayedConfirm
        )

        var accepted = "no"
        var failureToken = "none"
        switch result {
        case .success: accepted = "yes"
        case let .failure(failure): failureToken = ScenarioFixture.failureToken(failure)
        }

        return [
            "originalHandshake": "established",
            "replayedConfirmAccepted": accepted,
            "replayFailure": failureToken
        ]
    }

    // MARK: - 중간자

    static let mitmEphemeralSubstitution = SecurityScenario(
        name: "mitm-ephemeral-substitution",
        question: "정적 키는 그대로 두고 임시 키만 바꿔치기하면 채널이 열리는가?",
        policyReferences: ["POL-03-R-03"],
        expectations: [
            "handshake": "failed",
            "failure": "signatureInvalid:responder"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)
        let attackerEphemeral = try Curve25519.KeyAgreement.PrivateKey(
            rawRepresentation: context.entropy.bytes(32)
        )
        let substituted = Data(attackerEphemeral.publicKey.rawRepresentation)

        // 관측 모드이므로 공격자도 admission 증명을 다시 계산할 수 있다.
        // 그렇게 해야 서명 방어선만 고립해서 시험한다.
        let interceptor = MessageInterceptor(accept: { accept in
            HandshakeMessage.Accept(
                protocolVersion: accept.protocolVersion,
                admissionMode: accept.admissionMode,
                admissionProof: accept.admissionProof,
                staticSigningPublicKey: accept.staticSigningPublicKey,
                ephemeralPublicKey: substituted,
                nonce: accept.nonce,
                claimedDeviceID: accept.claimedDeviceID,
                claimedUserID: accept.claimedUserID,
                signature: accept.signature
            ).reproofed(with: scope.localTag)
        })

        let outcome = Connector.connect(initiator: p1, responder: p2, interceptor: interceptor)
        return [
            "handshake": outcome.isEstablished ? "established" : "failed",
            "failure": ScenarioFixture.failureToken(outcome.failure)
        ]
    }

    static let mitmFullImpersonationObserved = SecurityScenario(
        name: "mitm-full-impersonation-observed",
        question: "관측 기반 admission에서 공격자가 양쪽에 자기 신원으로 끼어들면 평문을 읽는가?",
        policyReferences: ["POL-03-R-01", "POL-03-R-06"],
        expectations: [
            "initiatorSide": "established",
            "responderSide": "established",
            "attackerRead": "link,menu,store",
            "initiatorDetected": "no"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope(mode: .observedNetworkAttributes)
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)
        // 공격자는 같은 SSID를 관측할 수 있으므로 같은 admission tag를 만든다.
        let attacker = try ScenarioFixture.peer("X1", entropy: context.entropy, scope: scope)

        let outcome = ManInTheMiddle.intercept(
            initiator: p1,
            attacker: attacker,
            responder: p2,
            plaintext: ScenarioFixture.menuPayload(),
            secrets: context.secrets
        )

        return [
            "initiatorSide": outcome.initiatorSide.isEstablished ? "established" : "failed",
            "responderSide": outcome.responderSide.isEstablished ? "established" : "failed",
            "attackerRead": ScenarioFixture.labelText(outcome.attackerReadLabels),
            "initiatorDetected": ScenarioFixture.boolText(outcome.initiatorDetected)
        ]
    }

    static let mitmFullImpersonationDeployed = SecurityScenario(
        name: "mitm-full-impersonation-deployed",
        question: "배포 공유 비밀 admission에서 그 비밀이 없는 공격자가 끼어들 수 있는가?",
        policyReferences: ["POL-03-R-01"],
        expectations: [
            "initiatorSide": "failed",
            "responderSide": "failed",
            "attackerRead": "none",
            "initiatorFailure": "outOfSupportedScope:admissionProofInvalid",
            "helloCarriesAdmissionTagValue": "no"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope(mode: .deployedSharedSecret)
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)
        let attacker = try ScenarioFixture.peer(
            "X1",
            entropy: context.entropy,
            scope: ScenarioFixture.outsideScope(mode: .deployedSharedSecret)
        )

        let outcome = ManInTheMiddle.intercept(
            initiator: p1,
            attacker: attacker,
            responder: p2,
            plaintext: ScenarioFixture.menuPayload(),
            secrets: context.secrets
        )

        // 정직한 초기자의 hello를 캡처해 admission tag 값이 그 안에 있는지 본다.
        let helloBytes = WireCodec.encode(try p1.handshake.startInitiator().message)

        return [
            "initiatorSide": outcome.initiatorSide.isEstablished ? "established" : "failed",
            "responderSide": outcome.responderSide.isEstablished ? "established" : "failed",
            "attackerRead": ScenarioFixture.labelText(outcome.attackerReadLabels),
            "initiatorFailure": ScenarioFixture.failureToken(outcome.initiatorSide.failure),
            "helloCarriesAdmissionTagValue": ScenarioFixture.boolText(
                PlaintextScanner.contains(haystack: helloBytes, needle: scope.localTag.value)
            )
        ]
    }

    /// 관측형 공격자. 첫 구현이 놓친 경로이며 독립 리뷰가 재현했다.
    static let mitmWithCapturedAdmissionProof = SecurityScenario(
        name: "mitm-with-captured-admission-proof",
        question: "wire에서 관측한 admission 증명을 그대로 재사용하면 끼어들 수 있는가?",
        policyReferences: ["POL-03-R-01", "POL-03-R-03"],
        expectations: [
            "capturedProofFromHello": "yes",
            "initiatorSide": "failed",
            "responderSide": "failed",
            "attackerRead": "none",
            "initiatorFailure": "outOfSupportedScope:admissionProofInvalid"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope(mode: .deployedSharedSecret)
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)

        // 공격자는 링크에서 hello를 캡처하고 그 증명값을 자기 tag로 삼는다.
        // tag를 모르므로 자기 메시지에 대한 증명을 만들 수 없고, 남의 증명은
        // 그 메시지의 키·nonce·식별자를 덮으므로 재사용할 수 없다.
        let capturedHello = try WireCodec.decodeHello(
            WireCodec.encode(try p1.handshake.startInitiator().message)
        )
        let attackerScope = NetworkScope(
            localTag: NetworkAdmissionTag(
                mode: .deployedSharedSecret, value: capturedHello.admissionProof
            )
        )
        let attacker = try ScenarioFixture.peer("X1", entropy: context.entropy, scope: attackerScope)

        let outcome = ManInTheMiddle.intercept(
            initiator: p1,
            attacker: attacker,
            responder: p2,
            plaintext: ScenarioFixture.menuPayload(),
            secrets: context.secrets
        )

        return [
            "capturedProofFromHello": ScenarioFixture.boolText(!capturedHello.admissionProof.isEmpty),
            "initiatorSide": outcome.initiatorSide.isEstablished ? "established" : "failed",
            "responderSide": outcome.responderSide.isEstablished ? "established" : "failed",
            "attackerRead": ScenarioFixture.labelText(outcome.attackerReadLabels),
            "initiatorFailure": ScenarioFixture.failureToken(outcome.initiatorSide.failure)
        ]
    }

    static let selfHandshakeRejected = SecurityScenario(
        name: "self-handshake-rejected",
        question: "캡처한 hello를 작성자에게 되돌려 보내면 자기 자신과 세션이 열리는가?",
        policyReferences: ["POL-03-R-02", "POL-03-R-03"],
        expectations: [
            "selfSession": "failed",
            "failure": "reflectedOwnIdentity",
            "directoryContainsSelf": "no"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let outcome = Connector.connect(initiator: p1, responder: p1)
        return [
            "selfSession": outcome.isEstablished ? "established" : "failed",
            "failure": ScenarioFixture.failureToken(outcome.failure),
            "directoryContainsSelf": ScenarioFixture.boolText(
                p1.directory.known(deviceID: p1.identity.deviceID) != nil
            )
        ]
    }

    static let mitmBlockedByExpectedPeer = SecurityScenario(
        name: "mitm-blocked-by-expected-peer",
        question: "이미 아는 기기에 연결하려던 것이면 사칭이 걸리는가?",
        policyReferences: ["POL-03-R-01", "POL-03-R-02"],
        expectations: [
            "initiatorSide": "failed",
            "initiatorFailure": "peerIdentityNotExpected",
            "attackerRead": "none",
            "initiatorDetected": "yes",
            // 고정은 **고정한 쪽 세션만** 보호한다. 상대 Peer는 공격자와 세션을
            // 그대로 유지하므로 그 Peer가 먼저 보내는 데이터는 읽힌다.
            "responderSide": "established"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope(mode: .observedNetworkAttributes)
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let p2 = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)
        let attacker = try ScenarioFixture.peer("X1", entropy: context.entropy, scope: scope)

        let outcome = ManInTheMiddle.intercept(
            initiator: p1,
            attacker: attacker,
            responder: p2,
            plaintext: ScenarioFixture.menuPayload(),
            secrets: context.secrets,
            expectedPeer: p2.identity.deviceID
        )

        return [
            "initiatorSide": outcome.initiatorSide.isEstablished ? "established" : "failed",
            "initiatorFailure": ScenarioFixture.failureToken(outcome.initiatorSide.failure),
            "attackerRead": ScenarioFixture.labelText(outcome.attackerReadLabels),
            "initiatorDetected": ScenarioFixture.boolText(outcome.initiatorDetected),
            "responderSide": outcome.responderSide.isEstablished ? "established" : "failed"
        ]
    }

    // MARK: - 이벤트 원작성자 결합

    static let forgedEventAuthor = SecurityScenario(
        name: "forged-event-author",
        question: "자동 신뢰된 Peer가 남의 이름으로 이벤트를 만들 수 있는가?",
        policyReferences: ["POL-03-R-02", "POL-02-R-01"],
        expectations: [
            "forgedByOtherKey": "needsReview:eventOriginRejected",
            "claimedVictimUserOnly": "needsReview:eventOriginRejected",
            "honestEvent": "applied"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let victim = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let attacker = try ScenarioFixture.peer("X1", entropy: context.entropy, scope: scope)
        let receiver = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)

        guard case .established(var attackerSession, var receiverSession) = Connector.connect(
            initiator: attacker, responder: receiver
        ) else { return ["forgedByOtherKey": "handshake-failed"] }

        // 1. 공격자가 피해자의 기기·사용자 ID를 그대로 실은 이벤트를 자기 키로
        //    서명한다.
        let forgedBase = OperationalEvent(
            eventID: "",
            daySession: "S1",
            room: "R1",
            authorUser: victim.identity.userID.rawValue,
            authorDevice: victim.identity.deviceID.rawValue,
            eventType: "menuRevision",
            revision: 1,
            logicalOrder: 10,
            payload: ScenarioFixture.menuPayload()
        )
        let forged = try SignedEnvelope.sign(forgedBase, with: attacker.identity)
        let forgedSent = try OperationalExchange.send(forged, from: &attackerSession)
        let forgedResult = OperationalExchange.receive(
            wireBytes: forgedSent.bytesOnWire, into: &receiverSession
        )

        // 2. 기기 ID는 정직하게 두고 사용자 ID만 피해자 것으로 바꾼다. 사용자
        //    ID가 권한 주체이므로 이것만으로도 소유권 사칭이다.
        let honest = try ScenarioFixture.menuEnvelope(author: attacker)
        let userSwapped = SignedEnvelope(
            event: OperationalEvent(
                eventID: honest.event.eventID,
                daySession: honest.event.daySession,
                room: honest.event.room,
                authorUser: victim.identity.userID.rawValue,
                authorDevice: honest.event.authorDevice,
                eventType: honest.event.eventType,
                revision: honest.event.revision,
                logicalOrder: honest.event.logicalOrder,
                payload: honest.event.payload
            ),
            authorSigningPublicKey: honest.authorSigningPublicKey,
            signature: honest.signature
        )
        let swappedSent = try OperationalExchange.send(userSwapped, from: &attackerSession)
        let swappedResult = OperationalExchange.receive(
            wireBytes: swappedSent.bytesOnWire, into: &receiverSession
        )

        let honestSent = try OperationalExchange.send(honest, from: &attackerSession)
        let honestResult = OperationalExchange.receive(
            wireBytes: honestSent.bytesOnWire, into: &receiverSession
        )

        return [
            "forgedByOtherKey": ScenarioFixture.outcomeToken(forgedResult),
            "claimedVictimUserOnly": ScenarioFixture.outcomeToken(swappedResult),
            "honestEvent": ScenarioFixture.outcomeToken(honestResult)
        ]
    }

    static let sameEventIDDifferentPayload = SecurityScenario(
        name: "same-event-id-different-payload",
        question: "SP-02 한계 1의 `같은 ID·다른 payload`를 만들 수 있는가?",
        policyReferences: ["POL-02-R-01", "POL-03-R-02"],
        expectations: [
            "modifiedPayloadKeepingID": "needsReview:eventOriginRejected",
            "reissuedWithNewPayload": "applied",
            "reissuedIDDiffers": "yes",
            "attackerCannotMintVictimID": "yes"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let author = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let attacker = try ScenarioFixture.peer("X1", entropy: context.entropy, scope: scope)
        let receiver = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)

        guard case .established(var authorSession, var receiverSession) = Connector.connect(
            initiator: author, responder: receiver
        ) else { return ["modifiedPayloadKeepingID": "handshake-failed"] }

        let original = try ScenarioFixture.menuEnvelope(author: author)
        let otherPayload = Data("SP04-MENU-다른내용".utf8)

        // 1. ID는 그대로 두고 payload만 바꾼다. ID가 내용 digest의 함수이므로
        //    유도 검증에서 걸린다.
        let modified = SignedEnvelope(
            event: original.event.replacingPayload(otherPayload),
            authorSigningPublicKey: original.authorSigningPublicKey,
            signature: original.signature
        )
        let modifiedSent = try OperationalExchange.send(modified, from: &authorSession)
        let modifiedResult = OperationalExchange.receive(
            wireBytes: modifiedSent.bytesOnWire, into: &receiverSession
        )

        // 2. 같은 작성자가 정직하게 다시 발급하면 통과하지만 ID가 달라진다.
        let reissued = try SignedEnvelope.sign(
            original.event.replacingPayload(otherPayload), with: author.identity
        )
        let reissuedSent = try OperationalExchange.send(reissued, from: &authorSession)
        let reissuedResult = OperationalExchange.receive(
            wireBytes: reissuedSent.bytesOnWire, into: &receiverSession
        )

        // 3. 공격자는 같은 내용을 써도 피해자의 ID를 만들 수 없다.
        let attackerAttempt = try SignedEnvelope.sign(
            OperationalEvent(
                eventID: "",
                daySession: original.event.daySession,
                room: original.event.room,
                authorUser: attacker.identity.userID.rawValue,
                authorDevice: attacker.identity.deviceID.rawValue,
                eventType: original.event.eventType,
                revision: original.event.revision,
                logicalOrder: original.event.logicalOrder,
                payload: original.event.payload
            ),
            with: attacker.identity
        )

        return [
            "modifiedPayloadKeepingID": ScenarioFixture.outcomeToken(modifiedResult),
            "reissuedWithNewPayload": ScenarioFixture.outcomeToken(reissuedResult),
            "reissuedIDDiffers": ScenarioFixture.boolText(
                reissued.event.eventID != original.event.eventID
            ),
            "attackerCannotMintVictimID": ScenarioFixture.boolText(
                attackerAttempt.event.eventID != original.event.eventID
            )
        ]
    }

    // MARK: - 로컬 저장

    static let stolenStoreFile = SecurityScenario(
        name: "stolen-store-file",
        question: "암호화 데이터 파일만 복사하면 구조화 데이터 원문을 읽을 수 있는가?",
        policyReferences: ["POL-03-R-04", "PRD-01-AC-08"],
        expectations: [
            "exposedInFile": "none",
            "recordIDsInFile": "none",
            "decodeWithStolenKey": "decryptionFailed",
            "decodeWithOwnKey": "ok",
            "exposedAfterDecrypt": "link,menu,store"
        ]
    ) { context in
        let owner = try DeviceIdentity.createInstallation(entropy: context.entropy, nickname: nil)
        let thief = try DeviceIdentity.createInstallation(entropy: context.entropy, nickname: nil)

        let secretStore = InMemorySecretStore()
        try secretStore.store(owner.material, account: "owner")

        let store = EncryptedRecordStore(material: try secretStore.load(account: "owner"))
        let records = [
            StoredRecord(id: "R1-menu", kind: .operationalEvent, body: ScenarioFixture.menuPayload()),
            StoredRecord(
                id: "R1-history",
                kind: .reuseHistory,
                body: Data(ScenarioFixture.secrets[0].value.utf8)
            )
        ]
        let bytes = try store.encode(records)

        let file = StoreFile(url: context.workingDirectory.appendingPathComponent("sp04-store.bin"))
        try file.write(bytes)
        let stolenBytes = try file.copyBytes(
            to: context.workingDirectory.appendingPathComponent("sp04-store-stolen.bin")
        )

        // record ID도 파일에 남지 않아야 한다. 남으면 구조가 그대로 보인다.
        let idSecrets = records.map { PlantedSecret(label: $0.id, value: $0.id) }

        let thiefStore = EncryptedRecordStore(material: thief.material)
        var stolenResult = "decoded"
        do {
            _ = try thiefStore.decode(stolenBytes, candidateIDs: records.map(\.id))
        } catch let failure as StoreFailure {
            if case .decryptionFailed = failure { stolenResult = "decryptionFailed" } else {
                stolenResult = "otherFailure"
            }
        }

        let recovered = try store.decode(stolenBytes, candidateIDs: records.map(\.id))
        let recoveredBytes = recovered.reduce(into: Data()) { $0.append($1.body) }

        return [
            "exposedInFile": ScenarioFixture.labelText(
                PlaintextScanner.exposedLabels(in: stolenBytes, secrets: context.secrets)
            ),
            "recordIDsInFile": ScenarioFixture.labelText(
                PlaintextScanner.exposedLabels(in: stolenBytes, secrets: idSecrets)
            ),
            "decodeWithStolenKey": stolenResult,
            "decodeWithOwnKey": recovered.count == records.count ? "ok" : "mismatch",
            "exposedAfterDecrypt": ScenarioFixture.labelText(
                PlaintextScanner.exposedLabels(in: recoveredBytes, secrets: context.secrets)
            )
        ]
    }

    static let storeKeyLossIsNotEmptyStore = SecurityScenario(
        name: "store-key-loss-is-not-empty-store",
        question: "Keychain 소재를 잃으면 저장소가 `비어 있음`으로 보이는가?",
        policyReferences: ["POL-03-R-04", "PRD-01-FR-12"],
        expectations: [
            "loadAfterDelete": "notFound",
            "outcome": "needsReview:localStorageUnreadable",
            "reportedAsEmpty": "no"
        ]
    ) { context in
        let owner = try DeviceIdentity.createInstallation(entropy: context.entropy, nickname: nil)
        let secretStore = InMemorySecretStore()
        try secretStore.store(owner.material, account: "owner")

        let store = EncryptedRecordStore(material: owner.material)
        let records = [
            StoredRecord(id: "R1-menu", kind: .operationalEvent, body: ScenarioFixture.menuPayload())
        ]
        let bytes = try store.encode(records)

        // 재설치처럼 Keychain 항목이 사라진 상태.
        try secretStore.delete(account: "owner")
        var loadToken = "loaded"
        do {
            _ = try secretStore.load(account: "owner")
        } catch let error as SecretStoreError {
            if case .notFound = error { loadToken = "notFound" }
        }

        // 새 설치가 만든 키로는 열 수 없다. 이때 결과는 `비어 있음`이 아니라
        // 명시적 실패여야 한다.
        let fresh = try DeviceIdentity.createInstallation(entropy: context.entropy, nickname: nil)
        let freshStore = EncryptedRecordStore(material: fresh.material)
        var outcome = SyncOutcome.applied(eventID: "none")
        var reportedAsEmpty = "yes"
        do {
            let decoded = try freshStore.decode(bytes, candidateIDs: records.map(\.id))
            reportedAsEmpty = decoded.isEmpty ? "yes" : "no"
        } catch let failure as StoreFailure {
            outcome = SyncOutcome(storeFailure: failure)
            reportedAsEmpty = "no"
        }

        return [
            "loadAfterDelete": loadToken,
            "outcome": ScenarioFixture.outcomeToken(outcome),
            "reportedAsEmpty": reportedAsEmpty
        ]
    }

    static let storeRecordTruncationDetected = SecurityScenario(
        name: "store-record-truncation-detected",
        question: "저장소 파일 끝의 record를 잘라내면 조용히 사라지는가?",
        policyReferences: ["POL-03-R-04", "POL-02-R-06"],
        expectations: [
            "intactDecode": "3",
            "truncatedTailDetected": "truncated",
            "tombstoneSurvivesIntactFile": "yes"
        ]
    ) { context in
        let owner = try DeviceIdentity.createInstallation(entropy: context.entropy, nickname: nil)
        let store = EncryptedRecordStore(material: owner.material)
        let records = [
            StoredRecord(id: "R1", kind: .operationalEvent, body: Data("SP04-A".utf8)),
            StoredRecord(id: "R2", kind: .operationalEvent, body: Data("SP04-B".utf8)),
            // 마지막 record가 삭제 표식이면, 조용한 절단은 삭제된 데이터를
            // 되살린다. `POL-02-R-06`의 비부활 계약에 직접 닿는다.
            StoredRecord(id: "R3", kind: .tombstone, body: Data("SP04-DEL".utf8))
        ]
        let bytes = try store.encode(records)
        let ids = records.map(\.id)
        let intact = try store.decode(bytes, candidateIDs: ids)

        // 마지막 record 블록만 잘라낸다. 남은 record의 순번은 그대로다.
        let twoRecordBytes = try store.encode(Array(records.prefix(2)))
        let tailLength = bytes.count - twoRecordBytes.count
        var truncatedToken = "decoded"
        do {
            _ = try store.decode(bytes.prefix(bytes.count - tailLength), candidateIDs: ids)
        } catch let failure as StoreFailure {
            if case .truncated = failure { truncatedToken = "truncated" } else {
                truncatedToken = "otherFailure"
            }
        }

        return [
            "intactDecode": String(intact.count),
            "truncatedTailDetected": truncatedToken,
            "tombstoneSurvivesIntactFile": ScenarioFixture.boolText(
                intact.contains { $0.kind == .tombstone }
            )
        ]
    }

    static let storeReencodeKeepsNonceUnique = SecurityScenario(
        name: "store-reencode-keeps-nonce-unique",
        question: "같은 record를 내용만 바꿔 다시 저장하면 같은 nonce를 재사용하는가?",
        policyReferences: ["POL-03-R-04"],
        expectations: [
            "nonceReusedAcrossVersions": "no",
            "keystreamReused": "no",
            "sameContentIsDeterministic": "yes"
        ]
    ) { context in
        let owner = try DeviceIdentity.createInstallation(entropy: context.entropy, nickname: nil)
        let store = EncryptedRecordStore(material: owner.material)

        func file(_ body: String) throws -> Data {
            try store.encode([StoredRecord(id: "R1", kind: .operationalEvent, body: Data(body.utf8))])
        }
        // 길이가 같아야 keystream 재사용 여부를 XOR로 볼 수 있다.
        let first = try file("SP04-MENU-AAAA")
        let second = try file("SP04-MENU-BBBB")
        let firstAgain = try file("SP04-MENU-AAAA")

        // 헤더(13) + indexTag(32) + kindTag(32) 뒤 12바이트가 nonce다.
        let nonceStart = 13 + 64
        let nonceA = first.subdata(in: nonceStart..<(nonceStart + 12))
        let nonceB = second.subdata(in: nonceStart..<(nonceStart + 12))

        // 암호문 시작은 nonce(12) + length(4) 뒤다.
        let bodyStart = nonceStart + 16
        let cipherA = first.subdata(in: bodyStart..<(bodyStart + 14))
        let cipherB = second.subdata(in: bodyStart..<(bodyStart + 14))
        let cipherXor = Data(zip(cipherA, cipherB).map { $0 ^ $1 })
        let plainXor = Data(
            zip(Data("SP04-MENU-AAAA".utf8), Data("SP04-MENU-BBBB".utf8)).map { $0 ^ $1 }
        )

        return [
            "nonceReusedAcrossVersions": ScenarioFixture.boolText(nonceA == nonceB),
            "keystreamReused": ScenarioFixture.boolText(cipherXor == plainXor),
            "sameContentIsDeterministic": ScenarioFixture.boolText(first == firstAgain)
        ]
    }

    static let chatIsNotStorable = SecurityScenario(
        name: "chat-is-not-storable",
        question: "채팅 본문을 로컬 저장소에 넣을 수 있는가?",
        policyReferences: ["POL-03-R-04"],
        expectations: [
            "storableKinds": "operationalEvent,peerEntry,reuseHistory,tombstone",
            "chatKindExists": "no"
        ]
    ) { _ in
        [
            "storableKinds": StoredRecordKind.allCases.map(\.rawValue).sorted().joined(separator: ","),
            "chatKindExists": ScenarioFixture.boolText(
                StoredRecordKind.allCases.contains { $0.rawValue.lowercased().contains("chat") }
            )
        ]
    }

    // MARK: - 키 수명

    static let keyRotationIdentity = SecurityScenario(
        name: "key-rotation-identity",
        question: "기기 키를 회전하면 기존 이벤트와 신원은 어떻게 되는가?",
        policyReferences: ["POL-03-R-02"],
        expectations: [
            "deviceIDChanged": "yes",
            "userIDChanged": "yes",
            "oldEventStillVerifies": "yes",
            "rotatedIdentityCannotClaimOldEvents": "yes",
            "transitionRecordValid": "yes",
            "transitionReplayRejected": "yes",
            "directoryEntriesAfterRotation": "2"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let observer = try ScenarioFixture.peer("P2", entropy: context.entropy, scope: scope)
        let before = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let oldEnvelope = try ScenarioFixture.menuEnvelope(author: before)

        _ = Connector.connect(initiator: before, responder: observer)
        let after = try before.rotatingKey()
        _ = Connector.connect(initiator: after, responder: observer)

        // 회전한 신원이 옛 기기 ID를 주장하는 이벤트.
        let claimingOld = try SignedEnvelope.sign(
            OperationalEvent(
                eventID: "",
                daySession: "S1",
                room: "R1",
                authorUser: before.identity.userID.rawValue,
                authorDevice: before.identity.deviceID.rawValue,
                eventType: "menuRevision",
                revision: 2,
                logicalOrder: 11,
                payload: ScenarioFixture.menuPayload()
            ),
            with: after.identity
        )

        let transition = try KeyTransition.issue(
            from: before.identity, to: after.identity, generation: 1
        )
        // 세대가 없으면 전이 record가 영구 재사용 가능한 값이 된다.
        let replayed = transition.supersedes(current: 1)

        return [
            "deviceIDChanged": ScenarioFixture.boolText(
                before.identity.deviceID != after.identity.deviceID
            ),
            "userIDChanged": ScenarioFixture.boolText(
                before.identity.userID != after.identity.userID
            ),
            "oldEventStillVerifies": ScenarioFixture.boolText(
                (try? EnvelopeVerifier.verify(oldEnvelope).get()) != nil
            ),
            "rotatedIdentityCannotClaimOldEvents": ScenarioFixture.boolText(
                (try? EnvelopeVerifier.verify(claimingOld).get()) == nil
            ),
            "transitionRecordValid": ScenarioFixture.boolText(transition.isValid),
            "transitionReplayRejected": ScenarioFixture.boolText(!replayed),
            "directoryEntriesAfterRotation": String(observer.directory.count)
        ]
    }

    static let reinstallIsNewUser = SecurityScenario(
        name: "reinstall-is-new-user",
        question: "재설치가 기존 사용자 신원을 되살릴 수 있는가?",
        policyReferences: ["POL-03-R-02"],
        expectations: [
            "restoredFromMaterialKeepsIdentity": "yes",
            "reinstallWithoutMaterialIsNewUser": "yes",
            "newInstallCannotSignAsOld": "yes"
        ]
    ) { context in
        let original = try DeviceIdentity.createInstallation(entropy: context.entropy, nickname: nil)
        let restored = try DeviceIdentity.restore(from: original.material, nickname: nil)
        let reinstalled = try DeviceIdentity.createInstallation(entropy: context.entropy, nickname: nil)

        let forged = try SignedEnvelope.sign(
            OperationalEvent(
                eventID: "",
                daySession: "S1",
                room: "R1",
                authorUser: original.identity.userID.rawValue,
                authorDevice: original.identity.deviceID.rawValue,
                eventType: "menuRevision",
                revision: 1,
                logicalOrder: 10,
                payload: ScenarioFixture.menuPayload()
            ),
            with: reinstalled.identity
        )

        return [
            "restoredFromMaterialKeepsIdentity": ScenarioFixture.boolText(
                restored.deviceID == original.identity.deviceID
                    && restored.userID == original.identity.userID
            ),
            "reinstallWithoutMaterialIsNewUser": ScenarioFixture.boolText(
                reinstalled.identity.userID != original.identity.userID
            ),
            "newInstallCannotSignAsOld": ScenarioFixture.boolText(
                (try? EnvelopeVerifier.verify(forged).get()) == nil
            )
        ]
    }

    static let nicknameIsNotAuthority = SecurityScenario(
        name: "nickname-is-not-authority",
        question: "닉네임을 바꾸거나 남과 같게 하면 권한·소유권이 바뀌는가?",
        policyReferences: ["POL-03-R-02", "PRD-01-AC-08"],
        expectations: [
            "identityUnchangedAfterRename": "yes",
            "duplicateNicknameAllowed": "yes",
            "duplicateNicknamesHaveDifferentIDs": "yes",
            "eventAuthorUnchangedAfterRename": "yes"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope, nickname: "점심대장")
        let renamed = p1.renamed(to: "다른이름")
        let impostor = try ScenarioFixture.peer(
            "X1", entropy: context.entropy, scope: scope, nickname: "점심대장"
        )

        let beforeEnvelope = try ScenarioFixture.menuEnvelope(author: p1)
        let afterEnvelope = try ScenarioFixture.menuEnvelope(author: renamed)

        return [
            "identityUnchangedAfterRename": ScenarioFixture.boolText(
                renamed.identity.deviceID == p1.identity.deviceID
                    && renamed.identity.userID == p1.identity.userID
            ),
            "duplicateNicknameAllowed": ScenarioFixture.boolText(
                impostor.identity.nickname == "점심대장"
            ),
            "duplicateNicknamesHaveDifferentIDs": ScenarioFixture.boolText(
                impostor.identity.userID != p1.identity.userID
            ),
            "eventAuthorUnchangedAfterRename": ScenarioFixture.boolText(
                beforeEnvelope.event.authorUser == afterEnvelope.event.authorUser
                    && beforeEnvelope.event.eventID == afterEnvelope.event.eventID
            )
        ]
    }

    // MARK: - 방어하지 않는 것

    static let internalMaliciousPeerReads = SecurityScenario(
        name: "internal-malicious-peer-reads",
        question: "지원 네트워크의 악성 LunchTime Peer가 자동 신뢰 범위의 평문을 읽는가?",
        policyReferences: ["POL-03-R-01", "POL-03-R-06", "PRD-01-FR-12"],
        expectations: [
            "handshake": "established",
            "maliciousPeerRead": "link,menu,store",
            "maliciousPeerWriteAccepted": "applied",
            "modelClaimsThisIsBlocked": "no"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let honest = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        // 악성 Peer도 정상 설치다. 프로토콜을 어기지 않는다.
        let malicious = try ScenarioFixture.peer("X1", entropy: context.entropy, scope: scope)

        guard case .established(var honestSession, var maliciousSession) = Connector.connect(
            initiator: honest, responder: malicious
        ) else { return ["handshake": "failed"] }

        let envelope = try ScenarioFixture.menuEnvelope(author: honest)
        let sent = try OperationalExchange.send(envelope, from: &honestSession)
        // 악성 Peer가 **실제로 복원한 바이트**를 검사한다. 송신 측 payload를
        // 검사하면 `applied`가 나오는 한 어떤 내용이든 라벨이 그대로 나온다.
        let received = OperationalExchange.received(
            wireBytes: sent.bytesOnWire, into: &maliciousSession
        )
        let readLabels = received.event.map {
            PlaintextScanner.exposedLabels(in: $0.payload, secrets: context.secrets)
        } ?? []

        // 그리고 자기 유효 권한으로 쓴다.
        let maliciousEvent = try ScenarioFixture.menuEnvelope(author: malicious)
        let maliciousSent = try OperationalExchange.send(maliciousEvent, from: &maliciousSession)
        let maliciousResult = OperationalExchange.receive(
            wireBytes: maliciousSent.bytesOnWire, into: &honestSession
        )
        _ = received.outcome

        let demonstrated = SecurityClaimPolicy.undefended
            .filter { $0.coverage == .demonstrated }
            .map(\.id)

        return [
            "handshake": "established",
            "maliciousPeerRead": ScenarioFixture.labelText(readLabels),
            "maliciousPeerWriteAccepted": ScenarioFixture.outcomeToken(maliciousResult),
            "modelClaimsThisIsBlocked": ScenarioFixture.boolText(
                !demonstrated.contains("auto-trusted-malicious-peer-read")
            )
        ]
    }

    // MARK: - 진단과 표현

    static let diagnosticsVocabulary = SecurityScenario(
        name: "diagnostics-vocabulary",
        question: "실패 진단 기록에 평문이 남는가?",
        policyReferences: ["POL-02-R-07", "POL-03-R-04"],
        expectations: [
            "exposedInDiagnostics": "none",
            "diagnosticLines": "4",
            "everyLineHasStatus": "yes"
        ]
    ) { context in
        let scope = ScenarioFixture.supportedScope()
        let p1 = try ScenarioFixture.peer("P1", entropy: context.entropy, scope: scope)
        let outside = try ScenarioFixture.peer(
            "X1", entropy: context.entropy, scope: ScenarioFixture.outsideScope()
        )

        var records: [DiagnosticRecord] = []
        if let failure = Connector.connect(initiator: outside, responder: p1).failure {
            records.append(
                .from(
                    outcome: SyncOutcome(handshakeFailure: failure),
                    eventID: nil,
                    deviceID: outside.identity.deviceID,
                    durationMilliseconds: 12
                )
            )
        }
        records.append(
            .from(
                outcome: SyncOutcome(channelFailure: .authenticationFailed),
                eventID: "E-0123456789abcdef01234567",
                deviceID: p1.identity.deviceID,
                durationMilliseconds: 3
            )
        )
        records.append(
            .from(
                outcome: SyncOutcome(envelopeRejection: .eventIDNotBoundToAuthor),
                eventID: "E-0123456789abcdef01234567",
                deviceID: p1.identity.deviceID,
                durationMilliseconds: 1
            )
        )
        records.append(
            .from(
                outcome: SyncOutcome(storeFailure: .decryptionFailed(atRecordIndex: 0)),
                eventID: nil,
                deviceID: nil,
                durationMilliseconds: nil
            )
        )

        let joined = records.map(\.logLine).joined(separator: "\n")
        return [
            "exposedInDiagnostics": ScenarioFixture.labelText(
                PlaintextScanner.exposedLabels(in: joined, secrets: context.secrets)
            ),
            "diagnosticLines": String(records.count),
            "everyLineHasStatus": ScenarioFixture.boolText(
                records.allSatisfy { $0.logLine.hasPrefix("status=") }
            )
        ]
    }

    static let prohibitedClaimDetection = SecurityScenario(
        name: "prohibited-claim-detection",
        question: "자동 신뢰가 보장하지 않는 표현을 화면 문구에서 잡아내는가?",
        policyReferences: ["POL-03-R-06", "PRD-01-FR-12"],
        expectations: [
            "violationsInBadCopy": "complete-deletion,end-to-end-encryption,secure-network-label,trusted-peer-label,verified-identity",
            "violationsInApprovedCopy": "none",
            "undefendedThreatCount": "10",
            "demonstratedThreatCount": "4"
        ]
    ) { _ in
        let badCopy = """
        회사 인증을 마친 신뢰된 사용자와 종단간 암호화로 연결됩니다.
        안전한 네트워크에서만 동작하며 종료 시 대화가 완전 삭제됩니다.
        """
        let approvedViolations = SecurityClaimPolicy.approvedPhrasing
            .flatMap { SecurityClaimPolicy.violations(in: $0) }
            .map(\.id)

        return [
            "violationsInBadCopy": ScenarioFixture.labelText(
                SecurityClaimPolicy.violations(in: badCopy).map(\.id)
            ),
            "violationsInApprovedCopy": ScenarioFixture.labelText(approvedViolations),
            "undefendedThreatCount": String(SecurityClaimPolicy.undefended.count),
            "demonstratedThreatCount": String(
                SecurityClaimPolicy.undefended.filter { $0.coverage == .demonstrated }.count
            )
        ]
    }

    static let failureNeverReportsSuccess = SecurityScenario(
        name: "failure-never-reports-success",
        question: "어떤 인증·복호화 실패라도 성공 동기화로 표시될 수 있는가?",
        policyReferences: ["PRD-01-FR-12", "PRD-01-AC-08"],
        expectations: [
            "channelFailuresApplied": "0",
            "envelopeRejectionsApplied": "0",
            "handshakeFailuresApplied": "0",
            "storeFailuresApplied": "0"
        ]
    ) { _ in
        let handshakeFailures: [HandshakeFailure] = [
            .outOfSupportedScope(reason: .admissionProofInvalid),
            .outOfSupportedScope(reason: .admissionModeMismatch),
            .outOfSupportedScope(reason: .unsupportedProtocolVersion),
            .signatureInvalid(role: .initiator),
            .signatureInvalid(role: .responder),
            .identifiersNotDerivedFromKey(role: .initiator),
            .identifiersNotDerivedFromKey(role: .responder),
            .malformedKey(role: .initiator),
            .malformedKey(role: .responder),
            .pinnedKeyMismatch(deviceID: "D-0"),
            .peerIdentityNotExpected(expected: "D-0", actual: "D-1"),
            .unexpectedMessage
        ]
        let storeFailures: [StoreFailure] = [
            .unrecognizedFormat,
            .truncated(atRecordIndex: 0),
            .decryptionFailed(atRecordIndex: 0),
            .fileAccessFailed
        ]

        return [
            "channelFailuresApplied": String(
                ChannelFailure.allCases.filter { SyncOutcome(channelFailure: $0).isApplied }.count
            ),
            "envelopeRejectionsApplied": String(
                EnvelopeRejection.allCases.filter { SyncOutcome(envelopeRejection: $0).isApplied }.count
            ),
            "handshakeFailuresApplied": String(
                handshakeFailures.filter { SyncOutcome(handshakeFailure: $0).isApplied }.count
            ),
            "storeFailuresApplied": String(
                storeFailures.filter { SyncOutcome(storeFailure: $0).isApplied }.count
            )
        ]
    }
}
