import CryptoKit
import Foundation

/// SP-04 핸드셰이크 메시지.
///
/// 세 번 왕복으로 끝난다.
///
/// ```text
/// I → R  hello    (admission tag, I 정적 서명 공개키, I 임시 X25519 공개키, nonce)
/// R → I  accept   (admission tag, R 정적 서명 공개키, R 임시 X25519 공개키, nonce, sig_R)
/// I → R  confirm  (sig_I)
/// ```
///
/// 두 서명은 모두 **transcript 전체**를 덮는다. 그래서 중간에서 어느 필드
/// 하나만 바꿔도 서명이 깨진다. 세션 키는 두 임시 키의 X25519 결과를 HKDF로
/// 확장한 값이고, 임시 키는 세션이 끝나면 버린다(순방향 안전성).
public enum HandshakeMessage: Sendable {
    case hello(Hello)
    case accept(Accept)
    case confirm(Confirm)

    public struct Hello: Sendable {
        public let protocolVersion: UInt64
        public let admissionMode: NetworkAdmissionMode
        /// 지원 네트워크 tag를 키로 이 메시지 본문에 만든 증명.
        ///
        /// tag 값 자체는 wire에 나가지 않는다. 나가면 그것이 곧 bearer token이다.
        public let admissionProof: Data
        public let staticSigningPublicKey: Data
        public let ephemeralPublicKey: Data
        public let nonce: Data
        /// 주장한 기기·사용자 ID. 검증 대상이며 신뢰 대상이 아니다.
        public let claimedDeviceID: String
        public let claimedUserID: String

        /// 증명이 덮는 본문.
        public var admissionBody: Data {
            Handshake.admissionBody(
                role: .initiator,
                protocolVersion: protocolVersion,
                mode: admissionMode,
                staticSigningPublicKey: staticSigningPublicKey,
                ephemeralPublicKey: ephemeralPublicKey,
                nonce: nonce,
                claimedDeviceID: claimedDeviceID,
                claimedUserID: claimedUserID
            )
        }
    }

    public struct Accept: Sendable {
        public let protocolVersion: UInt64
        public let admissionMode: NetworkAdmissionMode
        public let admissionProof: Data
        public let staticSigningPublicKey: Data
        public let ephemeralPublicKey: Data
        public let nonce: Data
        public let claimedDeviceID: String
        public let claimedUserID: String
        public let signature: Data

        public var admissionBody: Data {
            Handshake.admissionBody(
                role: .responder,
                protocolVersion: protocolVersion,
                mode: admissionMode,
                staticSigningPublicKey: staticSigningPublicKey,
                ephemeralPublicKey: ephemeralPublicKey,
                nonce: nonce,
                claimedDeviceID: claimedDeviceID,
                claimedUserID: claimedUserID
            )
        }
    }

    public struct Confirm: Sendable {
        public let signature: Data
    }
}

extension HandshakeMessage.Hello {
    /// 필드를 바꾼 뒤 admission 증명을 다시 계산한 사본.
    ///
    /// 관측 모드에서는 tag가 공개 정보이므로 같은 링크의 누구나 이 계산을 할 수
    /// 있다. 서명 방어만 고립해서 시험하려면 공격자가 이 단계를 밟는 것으로
    /// 모델링해야 한다 — 그러지 않으면 admission 검사가 먼저 걸려 정작 시험하려던
    /// 방어선에 닿지 않는다.
    public func reproofed(with tag: NetworkAdmissionTag) -> Self {
        HandshakeMessage.Hello(
            protocolVersion: protocolVersion,
            admissionMode: admissionMode,
            admissionProof: tag.proof(over: admissionBody),
            staticSigningPublicKey: staticSigningPublicKey,
            ephemeralPublicKey: ephemeralPublicKey,
            nonce: nonce,
            claimedDeviceID: claimedDeviceID,
            claimedUserID: claimedUserID
        )
    }
}

extension HandshakeMessage.Accept {
    public func reproofed(with tag: NetworkAdmissionTag) -> Self {
        HandshakeMessage.Accept(
            protocolVersion: protocolVersion,
            admissionMode: admissionMode,
            admissionProof: tag.proof(over: admissionBody),
            staticSigningPublicKey: staticSigningPublicKey,
            ephemeralPublicKey: ephemeralPublicKey,
            nonce: nonce,
            claimedDeviceID: claimedDeviceID,
            claimedUserID: claimedUserID,
            signature: signature
        )
    }
}

/// 핸드셰이크가 실패하는 이유.
///
/// 이유를 하나로 뭉개지 않는 것이 중요하다. `PRD-01-FR-12`는 실패를 "성공
/// 동기화로 표시하지 않고 `확인 필요`와 안내를 제공"하라고 요구하는데, 안내가
/// 달라야 하는 실패를 같은 값으로 접으면 그 계약을 지킬 수 없다.
public enum HandshakeFailure: Error, Equatable, Sendable {
    /// 지원 네트워크 밖이다(`POL-03-R-01`).
    case outOfSupportedScope(reason: NetworkAdmissionDecision.OutOfScopeReason)
    /// transcript 서명이 맞지 않는다. 중간자 또는 손상이다.
    case signatureInvalid(role: HandshakeRole)
    /// 주장한 기기 ID 또는 사용자 ID가 제시한 공개키에서 유도되지 않는다.
    case identifiersNotDerivedFromKey(role: HandshakeRole)
    /// 연결하려던 상대가 아니다. 사칭이거나 다른 기기다.
    case peerIdentityNotExpected(expected: String, actual: String)
    /// 상대가 이 기기의 정적 키를 제시했다. 자기 자신과의 세션은 열지 않는다.
    case reflectedOwnIdentity
    /// 공개키 바이트가 형식에 맞지 않는다.
    case malformedKey(role: HandshakeRole)
    /// 이전에 본 기기 ID인데 공개키가 다르다(고정 위반).
    case pinnedKeyMismatch(deviceID: String)
    /// 메시지 순서가 계약과 다르다.
    case unexpectedMessage
}

public enum HandshakeRole: String, Equatable, Sendable {
    case initiator
    case responder
}

/// 핸드셰이크가 성공했을 때 나오는 것.
public struct HandshakeResult: Sendable {
    public let peer: PeerIdentity
    /// 이 세션에서만 유효한 방향별 키.
    public let sendKey: SymmetricKey
    public let receiveKey: SymmetricKey
    /// 세션 식별자. 같은 두 기기라도 세션마다 다르다.
    public let sessionID: String
    public let role: HandshakeRole
    /// 이 Peer를 처음 본 세션인가.
    ///
    /// 자동 신뢰에서는 **처음 보는 Peer와 사칭된 Peer가 구분되지 않는다.**
    /// 값을 결과에 남겨야 그 사실을 계층 위에서 다룰 수 있다.
    public let firstContact: Bool
}

/// 로컬 Peer 목록(`POL-03-R-02`).
///
/// "공개키, 사용자 ID, 안정적인 기기 ID와 사용자가 설정한 닉네임의 연결"을
/// 보관한다. 기기 ID가 공개키에서 유도되므로 같은 기기 ID에 다른 공개키가
/// 오는 것은 유도가 깨졌거나 사칭이라는 뜻이다.
///
/// 이 목록이 제공하는 것은 **연속성**이지 신원이 아니다. 처음 보는 기기 ID는
/// 그냥 새 Peer로 들어가며, 그것이 사람인지 공격자인지 판정할 근거가 없다.
public final class PeerDirectory: @unchecked Sendable {
    private var entries: [String: PeerIdentity] = [:]
    private let lock = NSLock()

    public init() {}

    public func known(deviceID: DeviceID) -> PeerIdentity? {
        lock.lock()
        defer { lock.unlock() }
        return entries[deviceID.rawValue]
    }

    public func record(_ peer: PeerIdentity) {
        lock.lock()
        defer { lock.unlock() }
        entries[peer.deviceID.rawValue] = peer
    }

    public var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return entries.count
    }
}

/// 핸드셰이크 실행기.
///
/// 두 역할을 한 타입에 두는 이유는 transcript 계산을 **한 곳에서만** 하기
/// 위해서다. 역할마다 별도 구현을 두면 두 계산이 갈라지는 순간 서명이 아무것도
/// 검증하지 않게 된다. 그 실수는 검증이 항상 실패하는 형태가 아니라 항상
/// 성공하는 형태로도 나타난다.
public struct Handshake: Sendable {
    public let identity: DeviceIdentity
    public let scope: NetworkScope
    public let entropy: any EntropySource
    public let directory: PeerDirectory

    public init(
        identity: DeviceIdentity,
        scope: NetworkScope,
        entropy: any EntropySource,
        directory: PeerDirectory
    ) {
        self.identity = identity
        self.scope = scope
        self.entropy = entropy
        self.directory = directory
    }

    // MARK: - 초기자

    /// 초기자의 진행 중 상태. 임시 개인키를 들고 있으므로 세션이 끝나면 버린다.
    public struct InitiatorPending: Sendable {
        let ephemeralPrivateKey: Curve25519.KeyAgreement.PrivateKey
        let hello: HandshakeMessage.Hello
    }

    public func startInitiator() throws -> (message: HandshakeMessage.Hello, pending: InitiatorPending) {
        let ephemeral = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: entropy.bytes(32))
        let staticKey = Data(identity.signingKey.publicKey.rawRepresentation)
        let ephemeralKey = Data(ephemeral.publicKey.rawRepresentation)
        let nonce = entropy.bytes(32)
        let body = Self.admissionBody(
            role: .initiator,
            protocolVersion: scope.protocolVersion,
            mode: scope.localTag.mode,
            staticSigningPublicKey: staticKey,
            ephemeralPublicKey: ephemeralKey,
            nonce: nonce,
            claimedDeviceID: identity.deviceID.rawValue,
            claimedUserID: identity.userID.rawValue
        )
        let hello = HandshakeMessage.Hello(
            protocolVersion: scope.protocolVersion,
            admissionMode: scope.localTag.mode,
            admissionProof: scope.localTag.proof(over: body),
            staticSigningPublicKey: staticKey,
            ephemeralPublicKey: ephemeralKey,
            nonce: nonce,
            claimedDeviceID: identity.deviceID.rawValue,
            claimedUserID: identity.userID.rawValue
        )
        return (hello, InitiatorPending(ephemeralPrivateKey: ephemeral, hello: hello))
    }

    /// 초기자가 `accept`를 검증하고 세션을 연다.
    public func completeInitiator(
        pending: InitiatorPending,
        accept: HandshakeMessage.Accept,
        expectedPeer: DeviceID? = nil
    ) -> Result<(result: HandshakeResult, confirm: HandshakeMessage.Confirm), HandshakeFailure> {
        let decision = scope.admit(
            peerProof: accept.admissionProof,
            over: accept.admissionBody,
            peerMode: accept.admissionMode,
            peerProtocolVersion: accept.protocolVersion
        )
        guard decision.admits else {
            if case let .outOfSupportedScope(reason) = decision {
                return .failure(.outOfSupportedScope(reason: reason))
            }
            return .failure(.unexpectedMessage)
        }

        // 자기 자신과의 세션을 거부한다. 검사하지 않으면 캡처한 `hello`를 그대로
        // 되돌려 보내는 것만으로 세션이 열리고, Peer 목록에 자기 자신이 들어가며
        // 자기 이벤트가 자기 수신 세션에서 `적용됨`으로 처리된다.
        guard !ConstantTime.equal(
            accept.staticSigningPublicKey,
            Data(identity.signingKey.publicKey.rawRepresentation)
        ) else {
            return .failure(.reflectedOwnIdentity)
        }

        guard let responderStatic = try? Curve25519.Signing.PublicKey(
            rawRepresentation: accept.staticSigningPublicKey
        ) else {
            return .failure(.malformedKey(role: .responder))
        }
        guard let responderEphemeral = try? Curve25519.KeyAgreement.PublicKey(
            rawRepresentation: accept.ephemeralPublicKey
        ) else {
            return .failure(.malformedKey(role: .responder))
        }

        // 기기·사용자 ID는 공개키의 함수다. 검증하지 않으면 유도의 의미가 없다.
        let derivedDeviceID = DeviceID(signingPublicKey: accept.staticSigningPublicKey)
        let derivedUserID = UserID(signingPublicKey: accept.staticSigningPublicKey)
        guard derivedDeviceID.rawValue == accept.claimedDeviceID,
              derivedUserID.rawValue == accept.claimedUserID else {
            return .failure(.identifiersNotDerivedFromKey(role: .responder))
        }

        // 특정 상대에게 연결하려던 것이면 그 상대인지 먼저 본다. 이 검사가
        // 없으면 중간자는 "처음 보는 다른 Peer"로 보일 뿐이고, 자동 신뢰에서는
        // 그것이 거절 사유가 되지 않는다.
        if let expectedPeer, expectedPeer != derivedDeviceID {
            return .failure(
                .peerIdentityNotExpected(
                    expected: expectedPeer.rawValue,
                    actual: derivedDeviceID.rawValue
                )
            )
        }

        let transcript = Self.transcript(hello: pending.hello, accept: accept)
        guard responderStatic.isValidSignature(accept.signature, for: transcript.responderSigned) else {
            return .failure(.signatureInvalid(role: .responder))
        }

        let peer = PeerIdentity(
            deviceID: derivedDeviceID,
            userID: derivedUserID,
            signingPublicKey: accept.staticSigningPublicKey,
            nickname: nil
        )
        if let pinned = directory.known(deviceID: derivedDeviceID),
           !ConstantTime.equal(pinned.signingPublicKey, peer.signingPublicKey) {
            // 기기 ID가 공개키에서 유도되므로 구조적으로는 도달할 수 없다.
            // 유도 규칙이 바뀌거나 우회 경로가 생기면 여기서 잡힌다.
            return .failure(.pinnedKeyMismatch(deviceID: derivedDeviceID.rawValue))
        }
        let firstContact = directory.known(deviceID: derivedDeviceID) == nil
        directory.record(peer)

        let confirmSignature: Data
        do {
            confirmSignature = try identity.signingKey.signature(for: transcript.initiatorSigned)
        } catch {
            return .failure(.signatureInvalid(role: .initiator))
        }

        let shared = try? pending.ephemeralPrivateKey.sharedSecretFromKeyAgreement(
            with: responderEphemeral
        )
        guard let shared else { return .failure(.malformedKey(role: .responder)) }

        let keys = Self.deriveKeys(sharedSecret: shared, transcriptHash: transcript.hash)
        let result = HandshakeResult(
            peer: peer,
            sendKey: keys.initiatorToResponder,
            receiveKey: keys.responderToInitiator,
            sessionID: transcript.hash.fullHex.prefix(16).description,
            role: .initiator,
            firstContact: firstContact
        )
        return .success((result, HandshakeMessage.Confirm(signature: confirmSignature)))
    }

    // MARK: - 응답자

    public struct ResponderPending: Sendable {
        let ephemeralPrivateKey: Curve25519.KeyAgreement.PrivateKey
        let hello: HandshakeMessage.Hello
        let accept: HandshakeMessage.Accept
        let peer: PeerIdentity
        let firstContact: Bool
    }

    /// 응답자가 `hello`를 검증하고 `accept`를 만든다.
    ///
    /// 이 시점에서는 아직 **어떤 운영 데이터도 보내지 않는다.** admission이
    /// 실패하면 `accept` 자체가 만들어지지 않으므로, 범위 밖 Peer는 지원
    /// 네트워크 판정 실패 사실 외에 아무것도 받지 못한다.
    public func respond(
        to hello: HandshakeMessage.Hello
    ) -> Result<(message: HandshakeMessage.Accept, pending: ResponderPending), HandshakeFailure> {
        let decision = scope.admit(
            peerProof: hello.admissionProof,
            over: hello.admissionBody,
            peerMode: hello.admissionMode,
            peerProtocolVersion: hello.protocolVersion
        )
        guard decision.admits else {
            if case let .outOfSupportedScope(reason) = decision {
                return .failure(.outOfSupportedScope(reason: reason))
            }
            return .failure(.unexpectedMessage)
        }

        guard !ConstantTime.equal(
            hello.staticSigningPublicKey,
            Data(identity.signingKey.publicKey.rawRepresentation)
        ) else {
            return .failure(.reflectedOwnIdentity)
        }

        guard (try? Curve25519.Signing.PublicKey(rawRepresentation: hello.staticSigningPublicKey)) != nil else {
            return .failure(.malformedKey(role: .initiator))
        }
        guard let initiatorEphemeral = try? Curve25519.KeyAgreement.PublicKey(
            rawRepresentation: hello.ephemeralPublicKey
        ) else {
            return .failure(.malformedKey(role: .initiator))
        }

        let derivedDeviceID = DeviceID(signingPublicKey: hello.staticSigningPublicKey)
        let derivedUserID = UserID(signingPublicKey: hello.staticSigningPublicKey)
        guard derivedDeviceID.rawValue == hello.claimedDeviceID,
              derivedUserID.rawValue == hello.claimedUserID else {
            return .failure(.identifiersNotDerivedFromKey(role: .initiator))
        }

        let ephemeral: Curve25519.KeyAgreement.PrivateKey
        do {
            ephemeral = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: entropy.bytes(32))
        } catch {
            return .failure(.malformedKey(role: .responder))
        }
        _ = initiatorEphemeral

        let responderStaticKey = Data(identity.signingKey.publicKey.rawRepresentation)
        let responderEphemeralKey = Data(ephemeral.publicKey.rawRepresentation)
        let responderNonce = entropy.bytes(32)
        let acceptAdmissionBody = Self.admissionBody(
            role: .responder,
            protocolVersion: scope.protocolVersion,
            mode: scope.localTag.mode,
            staticSigningPublicKey: responderStaticKey,
            ephemeralPublicKey: responderEphemeralKey,
            nonce: responderNonce,
            claimedDeviceID: identity.deviceID.rawValue,
            claimedUserID: identity.userID.rawValue
        )
        let body = HandshakeMessage.Accept(
            protocolVersion: scope.protocolVersion,
            admissionMode: scope.localTag.mode,
            admissionProof: scope.localTag.proof(over: acceptAdmissionBody),
            staticSigningPublicKey: responderStaticKey,
            ephemeralPublicKey: responderEphemeralKey,
            nonce: responderNonce,
            claimedDeviceID: identity.deviceID.rawValue,
            claimedUserID: identity.userID.rawValue,
            signature: Data()
        )
        let transcript = Self.transcript(hello: hello, accept: body)
        let signature: Data
        do {
            signature = try identity.signingKey.signature(for: transcript.responderSigned)
        } catch {
            return .failure(.signatureInvalid(role: .responder))
        }
        let accept = HandshakeMessage.Accept(
            protocolVersion: body.protocolVersion,
            admissionMode: body.admissionMode,
            admissionProof: body.admissionProof,
            staticSigningPublicKey: body.staticSigningPublicKey,
            ephemeralPublicKey: body.ephemeralPublicKey,
            nonce: body.nonce,
            claimedDeviceID: body.claimedDeviceID,
            claimedUserID: body.claimedUserID,
            signature: signature
        )

        let peer = PeerIdentity(
            deviceID: derivedDeviceID,
            userID: derivedUserID,
            signingPublicKey: hello.staticSigningPublicKey,
            nickname: nil
        )
        let firstContact = directory.known(deviceID: derivedDeviceID) == nil

        return .success((
            accept,
            ResponderPending(
                ephemeralPrivateKey: ephemeral,
                hello: hello,
                accept: accept,
                peer: peer,
                firstContact: firstContact
            )
        ))
    }

    /// 응답자가 `confirm`을 검증하고 세션을 연다.
    ///
    /// **이 검증을 통과하기 전에는 운영 데이터를 한 바이트도 받지 않는다.**
    /// 재전송된 옛 핸드셰이크는 여기서 죽는다 — 응답자의 임시 키와 nonce가
    /// 매번 새로 만들어지고 그 값이 초기자 서명 대상에 들어가므로, 옛 서명은
    /// 새 transcript와 맞지 않는다.
    public func completeResponder(
        pending: ResponderPending,
        confirm: HandshakeMessage.Confirm
    ) -> Result<HandshakeResult, HandshakeFailure> {
        guard let initiatorStatic = try? Curve25519.Signing.PublicKey(
            rawRepresentation: pending.hello.staticSigningPublicKey
        ) else {
            return .failure(.malformedKey(role: .initiator))
        }
        let transcript = Self.transcript(hello: pending.hello, accept: pending.accept)
        guard initiatorStatic.isValidSignature(confirm.signature, for: transcript.initiatorSigned) else {
            return .failure(.signatureInvalid(role: .initiator))
        }

        if let pinned = directory.known(deviceID: pending.peer.deviceID),
           !ConstantTime.equal(pinned.signingPublicKey, pending.peer.signingPublicKey) {
            return .failure(.pinnedKeyMismatch(deviceID: pending.peer.deviceID.rawValue))
        }
        directory.record(pending.peer)

        guard let initiatorEphemeral = try? Curve25519.KeyAgreement.PublicKey(
            rawRepresentation: pending.hello.ephemeralPublicKey
        ),
        let shared = try? pending.ephemeralPrivateKey.sharedSecretFromKeyAgreement(
            with: initiatorEphemeral
        ) else {
            return .failure(.malformedKey(role: .initiator))
        }

        let keys = Self.deriveKeys(sharedSecret: shared, transcriptHash: transcript.hash)
        return .success(
            HandshakeResult(
                peer: pending.peer,
                sendKey: keys.responderToInitiator,
                receiveKey: keys.initiatorToResponder,
                sessionID: transcript.hash.fullHex.prefix(16).description,
                role: .responder,
                firstContact: pending.firstContact
            )
        )
    }

    // MARK: - transcript와 키 유도

    /// admission 증명이 덮는 본문.
    ///
    /// 역할 라벨이 들어가므로 `hello`의 증명을 `accept`에 옮겨 붙일 수 없다.
    /// 자기 정적 키·임시 키·nonce·식별자를 모두 덮으므로, tag를 모르는 쪽은
    /// 남의 증명을 자기 메시지에 재사용할 수 없다.
    static func admissionBody(
        role: HandshakeRole,
        protocolVersion: UInt64,
        mode: NetworkAdmissionMode,
        staticSigningPublicKey: Data,
        ephemeralPublicKey: Data,
        nonce: Data,
        claimedDeviceID: String,
        claimedUserID: String
    ) -> Data {
        var writer = CanonicalWriter(domain: SP04Protocol.admissionProofDomain + "/" + role.rawValue)
        writer.append(protocolVersion)
        writer.append(mode.rawValue)
        writer.append(staticSigningPublicKey)
        writer.append(ephemeralPublicKey)
        writer.append(nonce)
        writer.append(claimedDeviceID)
        writer.append(claimedUserID)
        return writer.data
    }

    struct Transcript {
        let hash: Data
        let responderSigned: Data
        let initiatorSigned: Data
    }

    /// 두 역할이 **같은 함수로** 계산하는 transcript.
    ///
    /// 응답자 서명은 `hello`와 `accept` 본문 전체를, 초기자 서명은 거기에
    /// 역할 라벨을 더한 값을 덮는다. 두 서명 대상이 달라야 한 쪽 서명을 다른
    /// 쪽 서명으로 재사용할 수 없다.
    static func transcript(
        hello: HandshakeMessage.Hello,
        accept: HandshakeMessage.Accept
    ) -> Transcript {
        var writer = CanonicalWriter(domain: SP04Protocol.handshakeDomain)
        writer.append(hello.protocolVersion)
        writer.append(hello.admissionMode.rawValue)
        writer.append(hello.admissionProof)
        writer.append(hello.staticSigningPublicKey)
        writer.append(hello.ephemeralPublicKey)
        writer.append(hello.nonce)
        writer.append(hello.claimedDeviceID)
        writer.append(hello.claimedUserID)
        writer.append(accept.protocolVersion)
        writer.append(accept.admissionMode.rawValue)
        writer.append(accept.admissionProof)
        writer.append(accept.staticSigningPublicKey)
        writer.append(accept.ephemeralPublicKey)
        writer.append(accept.nonce)
        writer.append(accept.claimedDeviceID)
        writer.append(accept.claimedUserID)

        let base = writer.data
        var responderWriter = CanonicalWriter(domain: SP04Protocol.handshakeDomain + "/responder")
        responderWriter.append(base)
        var initiatorWriter = CanonicalWriter(domain: SP04Protocol.handshakeDomain + "/initiator")
        initiatorWriter.append(base)

        return Transcript(
            hash: Data(SHA256.hash(data: base)),
            responderSigned: responderWriter.data,
            initiatorSigned: initiatorWriter.data
        )
    }

    struct DirectionalKeys {
        let initiatorToResponder: SymmetricKey
        let responderToInitiator: SymmetricKey
    }

    /// 방향마다 다른 키를 쓴다.
    ///
    /// 한 키를 양방향에 쓰면 상대가 보낸 frame을 그대로 되돌려 보내는 것만으로
    /// 유효한 frame이 된다(reflection). 순서 번호가 있어도 방향이 구분되지
    /// 않으면 같은 (키, nonce)가 두 번 쓰인다.
    static func deriveKeys(sharedSecret: SharedSecret, transcriptHash: Data) -> DirectionalKeys {
        func derive(_ label: String) -> SymmetricKey {
            sharedSecret.hkdfDerivedSymmetricKey(
                using: SHA256.self,
                salt: transcriptHash,
                sharedInfo: Data("\(SP04Protocol.handshakeDomain)/\(label)".utf8),
                outputByteCount: 32
            )
        }
        return DirectionalKeys(
            initiatorToResponder: derive("i2r"),
            responderToInitiator: derive("r2i")
        )
    }
}
