import CryptoKit
import Foundation

/// 이 모델이 다루는 운영 이벤트.
///
/// 앱의 `DurableEvent`(`LunchTime/Core/Events`)를 그대로 쓰지 않는다. 이
/// 스파이크의 변경 금지 경로가 `LunchTime/Core/**`이므로 그 타입을 확장할 수
/// 없고, 여기서 필요한 것은 **서명이 무엇을 덮어야 하는가**뿐이다. 그래서
/// 식별 필드와 payload만 남긴 최소 표현을 쓴다.
///
/// `DurableEvent`의 문서 주석은 "위·변조 검증 정보는 실제 서명·MAC이 아니라 두
/// digest로 모델링한다. 둘 다 비밀 키가 없으므로 위조를 막지는 못한다.
/// 서명·MAC 표현은 `PRD-01-SP-04`의 미결정 기술이다"라고 남겨 두었다. 이
/// 파일과 ``SignedEnvelope``가 그 자리를 채운다.
public struct OperationalEvent: Hashable, Sendable {
    public let eventID: String
    public let daySession: String
    public let room: String?
    public let authorUser: String
    public let authorDevice: String
    public let eventType: String
    public let revision: UInt64
    public let logicalOrder: UInt64
    public let payload: Data

    public init(
        eventID: String,
        daySession: String,
        room: String?,
        authorUser: String,
        authorDevice: String,
        eventType: String,
        revision: UInt64,
        logicalOrder: UInt64,
        payload: Data
    ) {
        self.eventID = eventID
        self.daySession = daySession
        self.room = room
        self.authorUser = authorUser
        self.authorDevice = authorDevice
        self.eventType = eventType
        self.revision = revision
        self.logicalOrder = logicalOrder
        self.payload = payload
    }

    /// 이벤트 ID를 뺀 내용의 정규 바이트.
    ///
    /// ID를 빼는 이유는 ID가 이 값의 함수이기 때문이다(``EventIDDerivation``).
    /// 포함시키면 순환이 생긴다.
    public var contentBytes: Data {
        var writer = CanonicalWriter(domain: SP04Protocol.eventDomain)
        writer.append(daySession)
        writer.appendOptional(room)
        writer.append(authorUser)
        writer.append(authorDevice)
        writer.append(eventType)
        writer.append(revision)
        writer.append(logicalOrder)
        writer.append(payload)
        return writer.data
    }

    /// 서명이 덮는 바이트. 이벤트 ID까지 포함한다.
    public var signedBytes: Data {
        var writer = CanonicalWriter(domain: SP04Protocol.eventDomain + "/signed")
        writer.append(eventID)
        writer.append(contentBytes)
        return writer.data
    }

    /// 이 이벤트가 선언한 ID를 바꾼 사본. 위조 시나리오가 쓴다.
    public func claiming(eventID: String) -> OperationalEvent {
        OperationalEvent(
            eventID: eventID,
            daySession: daySession,
            room: room,
            authorUser: authorUser,
            authorDevice: authorDevice,
            eventType: eventType,
            revision: revision,
            logicalOrder: logicalOrder,
            payload: payload
        )
    }

    /// payload만 바꾼 사본. `같은 ID·다른 내용` 시나리오가 쓴다.
    public func replacingPayload(_ newPayload: Data) -> OperationalEvent {
        OperationalEvent(
            eventID: eventID,
            daySession: daySession,
            room: room,
            authorUser: authorUser,
            authorDevice: authorDevice,
            eventType: eventType,
            revision: revision,
            logicalOrder: logicalOrder,
            payload: newPayload
        )
    }
}

/// 이벤트 ID를 작성자 키와 내용에 결합한다.
///
/// [SP-02](../../../docs/technical/spikes/PRD-01-SP-02-replication-conflicts.md)의
/// 한계 1은 이렇게 남아 있다.
///
/// > 동일 ID·다른 payload는 도착 순서에 의존합니다. (…) **결정적 수렴은 이벤트
/// > ID가 정직하게 발급된다는 전제 위에서만 성립합니다.** 그 전제를 세우는
/// > 원작성자 결합 표현은 `PRD-01-SP-04`의 미결정입니다.
///
/// 이 유도가 그 전제를 만든다.
///
/// ```text
/// eventID = "E-" || hex(SHA256(domain || authorSigningPublicKey || contentBytes))[0..<32]
/// ```
///
/// 절단 폭이 결론을 정합니다. 처음에는 24 hex(96비트)였는데, 그러면 **작성자
/// 자신**에게는 생일 공격이 2^48로 열립니다 — 공개키를 고정한 채 payload만 갈아
/// 넣으면 되기 때문입니다. 아래 두 결과 중 첫 번째가 그 폭에서 무너집니다.
/// 32 hex(128비트)면 2^64가 되어 이 위협 모델에서는 비현실적입니다.
///
/// 결과는 두 가지다.
///
/// - **같은 작성자가 같은 ID에 다른 내용을 실을 수 없다.** ID가 내용 digest의
///   함수이므로 내용이 바뀌면 ID가 바뀐다.
/// - **다른 작성자가 남의 ID를 만들 수 없다.** ID가 작성자 공개키의 함수이므로
///   같은 ID를 내려면 같은 공개키를 써야 하고, 그러면 서명을 만들 수 없다.
///
/// 그래서 SP-02가 격리로 처리하던 `같은 ID·다른 payload`는 **검증 단계에서
/// 형식 오류**가 된다. 격리 대상 자체가 생기지 않으므로 SP-02 한계 20의
/// "임의 Peer가 event 하나로 그날 주문 완료를 영구 차단한다"도 이 경로에서는
/// 사라진다.
///
/// > 남는 것: 이 유도는 **검증하는 Peer에게만** 효과가 있다. 유도를 확인하지
/// > 않고 장부에 넣는 경로가 하나라도 있으면 그 Peer는 그대로 뚫린다. SP-02
/// > 불변식 32·33이 "장부를 직접 읽는 경로를 만들면 같은 보호를 받지 못한다"고
/// > 적은 것과 같은 종류의 위험이다.
public enum EventIDDerivation {
    public static func derive(authorSigningPublicKey: Data, event: OperationalEvent) -> String {
        var writer = CanonicalWriter(domain: SP04Protocol.eventIDDomain)
        writer.append(authorSigningPublicKey)
        writer.append(event.contentBytes)
        return "E-" + writer.digest.fullHex.prefix(SP04Protocol.identifierHexLength)
    }

    /// 선언한 ID가 실제 유도값과 같은지 확인한다.
    public static func matches(authorSigningPublicKey: Data, event: OperationalEvent) -> Bool {
        derive(authorSigningPublicKey: authorSigningPublicKey, event: event) == event.eventID
    }
}

/// 서명된 이벤트 봉투.
///
/// wire와 저장소에 들어가는 최소 단위다. 공개키를 함께 실어 수신 측이 별도
/// 조회 없이 검증할 수 있게 한다. 공개키에서 기기 ID가 유도되므로 이 필드가
/// 곧 작성자 주장이며, 검증은 그 주장이 payload의 `authorDevice`와 맞는지까지
/// 본다.
public struct SignedEnvelope: Hashable, Sendable {
    public let event: OperationalEvent
    public let authorSigningPublicKey: Data
    public let signature: Data

    public init(event: OperationalEvent, authorSigningPublicKey: Data, signature: Data) {
        self.event = event
        self.authorSigningPublicKey = authorSigningPublicKey
        self.signature = signature
    }

    /// 작성자가 자기 이벤트에 서명한다.
    ///
    /// 이벤트 ID는 호출자가 정하지 않고 유도한다. 정하게 두면 유도 규칙을
    /// 지키는 경로와 지키지 않는 경로가 함께 생긴다.
    public static func sign(
        _ event: OperationalEvent,
        with identity: DeviceIdentity
    ) throws -> SignedEnvelope {
        let publicKey = Data(identity.signingKey.publicKey.rawRepresentation)
        let bound = event.claiming(
            eventID: EventIDDerivation.derive(authorSigningPublicKey: publicKey, event: event)
        )
        return SignedEnvelope(
            event: bound,
            authorSigningPublicKey: publicKey,
            signature: try identity.signingKey.signature(for: bound.signedBytes)
        )
    }
}

/// 봉투 검증이 거부하는 이유.
public enum EnvelopeRejection: String, Error, Equatable, Sendable, CaseIterable {
    /// 서명이 공개키·내용과 맞지 않는다.
    case signatureInvalid
    /// 이벤트 ID가 작성자 키·내용에서 유도되지 않았다.
    case eventIDNotBoundToAuthor
    /// payload가 주장한 작성 기기 또는 작성 사용자가 서명 키에서 유도되지 않는다.
    case authorNotDerivedFromKey
    /// 공개키 형식이 아니다.
    case malformedKey
    /// 세션 상대와 작성자가 다르다(대리 전파 정책 위반).
    case relayedByUnexpectedPeer
}

public enum EnvelopeVerifier {
    /// 봉투 하나를 검증한다.
    ///
    /// `expectedAuthorDevice`를 주면 세션 상대가 자기 이벤트만 보낼 수 있다.
    /// MVP 복제는 남의 이벤트를 대신 전파해야 하므로 기본값은 `nil`이다.
    /// 값을 넣는 시나리오는 "대리 전파를 막으면 무엇이 달라지는가"를 본다.
    public static func verify(
        _ envelope: SignedEnvelope,
        expectedAuthorDevice: DeviceID? = nil
    ) -> Result<OperationalEvent, EnvelopeRejection> {
        guard let publicKey = try? Curve25519.Signing.PublicKey(
            rawRepresentation: envelope.authorSigningPublicKey
        ) else {
            return .failure(.malformedKey)
        }

        // 순서가 중요하다. 서명 검증이 먼저면 유도되지 않은 ID를 가진 봉투도
        // 서명만 맞으면 통과한 뒤 다음 검사에서 걸린다. 결과는 같지만, 검사
        // 하나를 지우는 리팩터링에서 어느 쪽이 남는지가 달라진다. 결합 검사를
        // 먼저 둬 "ID는 항상 유도값"을 불변으로 만든다.
        guard EventIDDerivation.matches(
            authorSigningPublicKey: envelope.authorSigningPublicKey,
            event: envelope.event
        ) else {
            return .failure(.eventIDNotBoundToAuthor)
        }

        // 작성 사용자까지 본다. 기기만 검사하면 정직한 기기 ID를 실은 채
        // `authorUser`만 남의 것으로 바꾼 이벤트가 통과한다. `POL-03-R-02`가
        // 사용자 ID를 "참여, 메뉴 소유권, 하루 한 Room과 충돌 판정의 권한
        // 주체"로 정했으므로 그것이 곧 권한 사칭이다.
        let derivedDevice = DeviceID(signingPublicKey: envelope.authorSigningPublicKey)
        let derivedUser = UserID(signingPublicKey: envelope.authorSigningPublicKey)
        guard derivedDevice.rawValue == envelope.event.authorDevice,
              derivedUser.rawValue == envelope.event.authorUser else {
            return .failure(.authorNotDerivedFromKey)
        }

        guard publicKey.isValidSignature(envelope.signature, for: envelope.event.signedBytes) else {
            return .failure(.signatureInvalid)
        }

        if let expectedAuthorDevice, expectedAuthorDevice != derivedDevice {
            return .failure(.relayedByUnexpectedPeer)
        }

        return .success(envelope.event)
    }
}
