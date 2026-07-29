import Foundation

extension DurableEvent: Codable {
    /// 직렬화 key는 ``EventEnvelopeField``와 같은 이름을 쓴다.
    ///
    /// 오류가 지목하는 필드와 wire의 key가 갈라지면 "어떤 필드가 없어서
    /// 거부됐는지"를 수신 쪽에서 다시 추측해야 한다.
    private enum CodingKeys: String, CodingKey {
        case envelopeVersion
        case eventID
        case daySession
        case room
        case authorUser
        case authorDevice
        case entityKind
        case entityID
        case eventType
        case form
        case revision
        case supersedes
        case logicalOrder
        case occurredAt
        case payload
        case envelopeDigest
    }

    /// 값 타입은 각자 직렬화 표현을 갖지 않는다. wire 표현을 이 한 곳이 모두
    /// 소유해야 형식 version과 fixture 호환성의 책임이 흩어지지 않는다.
    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(EventEnvelopeCodec.envelopeVersion, forKey: .envelopeVersion)
        try container.encode(id.rawValue, forKey: .eventID)
        try container.encode(daySession.rawValue, forKey: .daySession)
        try container.encodeIfPresent(room?.rawValue, forKey: .room)
        try container.encode(author.user.rawValue, forKey: .authorUser)
        try container.encode(author.device.rawValue, forKey: .authorDevice)
        try container.encode(target.kind.rawValue, forKey: .entityKind)
        try container.encode(target.id.rawValue, forKey: .entityID)
        try container.encode(type.rawValue, forKey: .eventType)
        try container.encode(form.rawValue, forKey: .form)
        try container.encode(revision.value, forKey: .revision)
        try container.encode(supersedes.map(\.rawValue), forKey: .supersedes)
        try container.encode(logicalOrder.value, forKey: .logicalOrder)
        try container.encode(occurredAt.epochMilliseconds, forKey: .occurredAt)
        try container.encode(payload.data, forKey: .payload)
        try container.encode(envelopeDigest, forKey: .envelopeDigest)
    }

    /// 직렬화된 envelope를 검증하며 복원한다.
    ///
    /// 생성 initializer와 같은 검사를 통과시켜, decode 경로로 들어온 값만
    /// 예외적으로 유효하지 않은 상태가 되는 일을 막는다. 마지막에 무결성 값을
    /// 다시 계산해 비교하므로 내용이 훼손된 envelope는 projection 이전에
    /// 거부된다(아키텍처 `03`).
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        /// 키가 없으면 어떤 필드인지 지목하고, 값의 형태가 다르면 같은 오류
        /// 모델의 `unsupportedFieldValue`로 접는다.
        ///
        /// `DecodingError`를 그대로 올리면 `codingPath`와 `debugDescription`이
        /// 호출자의 진단 경로로 새어 `POL-02-R-07`의 어휘 제한이 이 경로에서만
        /// 무너진다.
        func decodeIfPresent<T: Decodable>(
            _ type: T.Type,
            _ key: CodingKeys,
            _ field: EventEnvelopeField
        ) throws -> T? {
            do {
                return try container.decodeIfPresent(type, forKey: key)
            } catch is DecodingError {
                throw EventEnvelopeError.unsupportedFieldValue(field: field)
            }
        }

        func require<T: Decodable>(_ key: CodingKeys, _ field: EventEnvelopeField) throws -> T {
            guard let value = try decodeIfPresent(T.self, key, field) else {
                throw EventEnvelopeError.missingIdentity(field: field)
            }
            return value
        }

        let version: Int = try require(.envelopeVersion, .envelopeVersion)
        guard version == EventEnvelopeCodec.envelopeVersion else {
            throw EventEnvelopeError.unsupportedEnvelopeVersion(value: version)
        }

        let formToken: String = try require(.form, .form)
        guard let form = EventForm(rawValue: formToken) else {
            throw EventEnvelopeError.unsupportedFieldValue(field: .form)
        }

        // 선행 리비전 목록과 payload는 비어 있을 수 있으므로 기본값으로 복원한다.
        // 전송 중 실제로 유실된 경우는 아래 무결성 비교가 잡는다.
        let supersedes = try decodeIfPresent([String].self, .supersedes, .supersedes) ?? []
        let payload = try decodeIfPresent(Data.self, .payload, .payload) ?? Data()
        let room = try decodeIfPresent(String.self, .room, .room)

        try self.init(
            id: EventID(try require(.eventID, .eventID)),
            daySession: DaySessionID(try require(.daySession, .daySession)),
            room: room.map(RoomID.init),
            author: EventAuthor(
                user: UserID(try require(.authorUser, .authorUser)),
                device: DeviceID(try require(.authorDevice, .authorDevice))
            ),
            target: EventTarget(
                kind: EntityKind(try require(.entityKind, .entityKind)),
                id: EntityID(try require(.entityID, .entityID))
            ),
            type: EventType(try require(.eventType, .eventType)),
            form: form,
            revision: EventRevision(try require(.revision, .revision)),
            supersedes: supersedes.map(EventID.init),
            logicalOrder: LogicalOrder(try require(.logicalOrder, .logicalOrder)),
            occurredAt: EventTimestamp(epochMilliseconds: try require(.occurredAt, .occurredAt)),
            payload: EventPayload(data: payload)
        )

        let declaredDigest: String = try require(.envelopeDigest, .envelopeDigest)
        let actualDigest = envelopeDigest
        guard declaredDigest == actualDigest else {
            throw EventEnvelopeError.integrityMismatch(
                id: id,
                expected: declaredDigest,
                actual: actualDigest
            )
        }
    }
}

/// 운영 이벤트 envelope의 표준 직렬화 형식.
///
/// 같은 이벤트는 어느 Peer에서 인코딩해도 같은 바이트가 나와야 한다. 그래야
/// 고정 fixture로 형식 호환성을 회귀 검증할 수 있고, 저장·전송 계층이 바이트를
/// 그대로 비교할 수 있다. 그래서 key 정렬을 고정하고 실행 환경에 따라 달라지는
/// 인코딩 설정을 쓰지 않는다.
///
/// 구체적인 wire schema와 저장 schema는 아키텍처 `03`·`04`의 미결정 기술이다.
/// 이 형식은 공용 envelope 계약을 검증 가능하게 만드는 기준 표현이며, 전송
/// 계층이 다른 표현을 고르더라도 여기의 식별·순서 계약을 보존해야 한다.
public enum EventEnvelopeCodec {
    /// envelope 형식 version. 필드 구성이 바뀌면 올린다.
    public static let envelopeVersion = 1

    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }

    public static func makeDecoder() -> JSONDecoder {
        JSONDecoder()
    }

    public static func encode(_ event: DurableEvent) throws -> Data {
        try makeEncoder().encode(event)
    }

    public static func decode(_ data: Data) throws -> DurableEvent {
        try makeDecoder().decode(DurableEvent.self, from: data)
    }
}
