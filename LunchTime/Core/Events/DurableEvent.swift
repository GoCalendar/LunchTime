import CryptoKit
import Foundation

/// 이벤트를 만든 사용자와 기기(`POL-02-R-01`).
///
/// 사용자와 기기를 한 값으로 묶으면 "작성자 결합"을 통째로 넘길 수 있어
/// 한쪽만 채워진 envelope가 만들어지지 않는다.
public struct EventAuthor: Hashable, Sendable {
    public let user: UserID
    public let device: DeviceID

    public init(user: UserID, device: DeviceID) {
        self.user = user
        self.device = device
    }
}

/// 이벤트가 바꾸는 대상 엔터티(`POL-02-R-01`의 `대상 엔터티와 리비전`).
public struct EventTarget: Hashable, Sendable {
    public let kind: EntityKind
    public let id: EntityID

    public init(kind: EntityKind, id: EntityID) {
        self.kind = kind
        self.id = id
    }
}

/// 이벤트가 대상에 대해 갖는 형태.
///
/// `POL-02-R-01`은 "수정과 삭제는 새 이벤트 또는 삭제 표식으로 표현한다"고
/// 요구하고, `POL-02-R-05`는 "삭제 표식이 유지되는 동안 이전 데이터가 다시
/// 들어와도 부활시키지 않는다"고 요구한다. 보존·비부활 판정을 하는 계층이
/// 도메인 payload를 해석하지 않고도 삭제 표식을 알아볼 수 있어야 하므로
/// 형태를 envelope에 둔다.
public enum EventForm: String, Hashable, Sendable, CaseIterable {
    /// 대상의 새 내용을 담은 이벤트.
    case revision
    /// 대상을 무효화하는 삭제 표식.
    case tombstone
}

/// 도메인이 정의하는 이벤트 내용(`POL-02-R-01`의 `내용`).
///
/// 이 계약은 payload를 해석하지 않고 불투명한 바이트로만 다룬다. 후속 도메인은
/// 공용 envelope를 확장하지 않고 이 바이트의 의미만 정의한다.
public struct EventPayload: Hashable, Sendable {
    public let data: Data

    public static let empty = EventPayload(data: Data())

    public init(data: Data) { self.data = data }
}

/// 모든 구조화 변경이 공유하는 불변 운영 이벤트 envelope.
///
/// 필드 구성은 `POL-02-R-01`의 "운영 이벤트의 최소 식별 정보"를 그대로 따른다.
/// 아키텍처 `03`은 이 레코드를 `DurableEvent`라 부르며, 프로세스 메모리에만
/// 사는 `EphemeralChatMessage`와 구분한다.
///
/// 불변성은 두 가지로 지킨다.
///
/// - 저장 property는 모두 `let`이고 값을 바꾸는 공개 API가 없다. 수정은
///   ``makingRevision(id:logicalOrder:occurredAt:author:payload:)``, 삭제는
///   ``makingTombstone(id:logicalOrder:occurredAt:author:payload:)``가 만드는
///   **별도 이벤트**로만 표현한다.
/// - 유효하지 않은 값은 값으로 존재하지 못한다. 모든 생성 경로가 검증
///   initializer를 통과하므로 decode한 envelope도 같은 검사를 받는다.
///
/// 위·변조 검증 정보는 실제 서명·MAC이 아니라 두 digest로 모델링한다.
/// ``contentDigest``는 이벤트 ID를 뺀 내용을 접어 `같은 ID·다른 내용` 충돌을
/// 판정하고, ``envelopeDigest``는 ID와 형식 version까지 덮어 전송·저장 중의
/// 손상을 탐지한다. 둘 다 비밀 키가 없으므로 위조를 막지는 못한다. 서명·MAC
/// 표현은 `PRD-01-SP-04`의 미결정 기술이다.
///
/// 이 계약은 아직 의존 record ID를 선언하지 않는다. 아키텍처 `03`·`04`가
/// 요구하는 pending/quarantine은 payload를 열지 않고 부족한 record를 요청해야
/// 하므로 결국 envelope에 의존 목록이 필요하다. 그 필드는 이 이슈의 작업
/// 범위(식별·리비전·논리 순서·불변 encode/decode·tombstone 기반) 밖이므로
/// 후속 작업에서 추가하며, 추가 시 ``EventEnvelopeCodec/envelopeVersion``을
/// 올린다.
public struct DurableEvent: Hashable, Sendable {
    /// 전역적으로 충돌 가능성이 충분히 낮은 이벤트 ID이자 멱등 적용 키.
    public let id: EventID
    /// 이벤트가 속한 운영일.
    public let daySession: DaySessionID
    /// 일일 세션 scope 이벤트는 `nil`이다. 중복 참여 선택이 그 예다.
    public let room: RoomID?
    public let author: EventAuthor
    public let target: EventTarget
    public let type: EventType
    public let form: EventForm
    public let revision: EventRevision
    /// 이 이벤트가 대체하는 선행 리비전. 오름차순으로 정규화해 보관한다.
    ///
    /// 최초 리비전은 비어 있고, 이후 리비전은 최소 하나를 지목한다. 사용자
    /// 재확정처럼 분기 head 여러 개를 한 번에 대체하는 경우까지 담을 수 있도록
    /// 목록으로 둔다. 어떤 분기가 업무상 유효한지는 `POL-02-R-05`가 소유한다.
    public let supersedes: [EventID]
    /// 모든 Peer가 공유하는 1차 정렬 키.
    public let logicalOrder: LogicalOrder
    /// 로컬 발생 시각.
    public let occurredAt: EventTimestamp
    /// 도메인이 정의하는 내용.
    public let payload: EventPayload

    public init(
        id: EventID,
        daySession: DaySessionID,
        room: RoomID?,
        author: EventAuthor,
        target: EventTarget,
        type: EventType,
        form: EventForm,
        revision: EventRevision,
        supersedes: [EventID],
        logicalOrder: LogicalOrder,
        occurredAt: EventTimestamp,
        payload: EventPayload
    ) throws {
        let identifier = try Self.requireIdentity(id, .eventID)

        guard revision.value >= 1, revision <= .maximum else {
            throw EventEnvelopeError.invalidRevision(value: revision.value)
        }

        var predecessors: [EventID] = []
        var seen = Set<EventID>()
        for predecessor in supersedes {
            let normalized = try Self.requireIdentity(predecessor, .supersedes)
            guard normalized != identifier else {
                throw EventEnvelopeError.selfSupersedingEvent(id: identifier)
            }
            guard seen.insert(normalized).inserted else {
                throw EventEnvelopeError.duplicateSupersededEvent(id: normalized)
            }
            predecessors.append(normalized)
        }

        let isInitialRevision = revision == .initial
        guard isInitialRevision == predecessors.isEmpty else {
            throw EventEnvelopeError.revisionPredecessorMismatch(
                revision: revision.value,
                supersedesCount: predecessors.count
            )
        }

        self.id = identifier
        self.daySession = try Self.requireIdentity(daySession, .daySession)
        self.room = try room.map { try Self.requireIdentity($0, .room) }
        self.author = EventAuthor(
            user: try Self.requireIdentity(author.user, .authorUser),
            device: try Self.requireIdentity(author.device, .authorDevice)
        )
        self.target = EventTarget(
            kind: try Self.requireIdentity(target.kind, .entityKind),
            id: try Self.requireIdentity(target.id, .entityID)
        )
        self.type = try Self.requireIdentity(type, .eventType)
        self.form = form
        self.revision = revision
        // 정렬해 두지 않으면 같은 선행 집합을 다른 순서로 적은 두 표현이 다른
        // digest를 만들어 정상 중복이 무결성 충돌로 오판된다.
        self.supersedes = predecessors.sorted()
        self.logicalOrder = logicalOrder
        self.occurredAt = occurredAt
        self.payload = payload
    }

    /// 정규화한 식별자를 돌려주고, 비어 있으면 어떤 필드인지 지목하며 거부한다.
    ///
    /// 검사만 하고 원본을 저장하면 `" 2026-07-29 "`처럼 양끝 공백이 다른 값이
    /// 서로 다른 운영일이 되고, 정규 동등성으로는 같은 두 유니코드 표현이 서로
    /// 다른 digest를 갖는다.
    private static func requireIdentity<Identifier: OpaqueEventIdentifier>(
        _ identifier: Identifier,
        _ field: EventEnvelopeField
    ) throws -> Identifier {
        let normalized = identifier.normalized
        guard !normalized.rawValue.isEmpty else {
            throw EventEnvelopeError.missingIdentity(field: field)
        }
        return normalized
    }
}

extension DurableEvent {
    /// 이 이벤트를 대체하는 다음 리비전 이벤트를 만든다.
    ///
    /// 수신자는 바뀌지 않는다. `POL-02-R-01`의 "이벤트는 수신 뒤 내용을
    /// 제자리에서 덮어쓰지 않는다"를 API 모양으로 강제하는 지점이다.
    ///
    /// 작성자를 인자로 받는 이유는 누가 대상을 바꿀 수 있는지가 `POL-02-R-05`의
    /// 권한 규칙이기 때문이다. 기본값으로 원 작성자를 넣으면 이 계약이 정할 수
    /// 없는 권한 규칙을 암묵적으로 정하게 된다.
    ///
    /// 같은 이유로 삭제 표식 위에 새 리비전을 만드는 것도 여기서 막지 않는다.
    /// "삭제 표식이 유지되는 동안 이전 데이터를 부활시키지 않는다"는
    /// `POL-02-R-05`의 판정이며, 그 이벤트를 장부에 보존한 채 `확인 필요`
    /// projection으로 노출할지는 projection 계층이 소유한다. 구조적으로 유효한
    /// envelope를 만드는 것과 그 변경이 업무상 유효한지는 다른 질문이다.
    public func makingRevision(
        id: EventID,
        logicalOrder: LogicalOrder,
        occurredAt: EventTimestamp,
        author: EventAuthor,
        payload: EventPayload
    ) throws -> DurableEvent {
        try makingSuccessor(
            id: id,
            form: .revision,
            logicalOrder: logicalOrder,
            occurredAt: occurredAt,
            author: author,
            payload: payload
        )
    }

    /// 이 이벤트를 무효화하는 삭제 표식 이벤트를 만든다.
    public func makingTombstone(
        id: EventID,
        logicalOrder: LogicalOrder,
        occurredAt: EventTimestamp,
        author: EventAuthor,
        payload: EventPayload = .empty
    ) throws -> DurableEvent {
        try makingSuccessor(
            id: id,
            form: .tombstone,
            logicalOrder: logicalOrder,
            occurredAt: occurredAt,
            author: author,
            payload: payload
        )
    }

    private func makingSuccessor(
        id: EventID,
        form: EventForm,
        logicalOrder: LogicalOrder,
        occurredAt: EventTimestamp,
        author: EventAuthor,
        payload: EventPayload
    ) throws -> DurableEvent {
        try DurableEvent(
            id: id,
            daySession: daySession,
            room: room,
            author: author,
            target: target,
            type: type,
            form: form,
            revision: revision.next,
            supersedes: [self.id],
            logicalOrder: logicalOrder,
            occurredAt: occurredAt,
            payload: payload
        )
    }
}

extension DurableEvent {
    /// 이벤트 ID를 뺀 전체 내용의 결정적 표현.
    ///
    /// 아키텍처 `03`은 수신 이벤트를 "같은 ID·같은 내용"과 "같은 ID·다른 내용"으로
    /// 나눠 처리하라고 요구한다. 그 비교를 하려면 내용을 하나의 값으로 접어야
    /// 한다.
    ///
    /// 각 값을 `길이:값` 형태로 잇는다. 길이 없이 구분자만 쓰면 구분자를
    /// 포함한 값이 다른 경계를 흉내 내 서로 다른 이벤트가 같은 표현으로 접힌다.
    /// 목록 필드 안쪽에도 원소마다 길이를 붙여야 한다. 바깥 한 겹만 감싸면
    /// `["a,b"]`와 `["a", "b"]`가 같은 표현이 된다.
    ///
    /// envelope 형식 version은 포함하지 않는다. 이 값은 `같은 ID·다른 내용`
    /// 판정에 쓰는 **내용의 표현**이며 wire 형식과 분리한다. 다만 필드 구성이
    /// 바뀌면 이 표현도 함께 바뀌므로, 형식을 바꿀 때는
    /// ``EventEnvelopeCodec/envelopeVersion``을 올려 구 형식 이벤트를 훼손이
    /// 아니라 다른 version으로 구분한다.
    var canonicalContent: String {
        var parts: [String] = []
        func append(_ field: EventEnvelopeField, _ value: String) {
            parts.append("\(field.rawValue):\(value.utf8.count):\(value)")
        }

        append(.daySession, daySession.rawValue)
        append(.room, room?.rawValue ?? "")
        append(.authorUser, author.user.rawValue)
        append(.authorDevice, author.device.rawValue)
        append(.entityKind, target.kind.rawValue)
        append(.entityID, target.id.rawValue)
        append(.eventType, type.rawValue)
        append(.form, form.rawValue)
        append(.revision, String(revision.value))
        append(.supersedes, Self.canonicalList(supersedes.map(\.rawValue)))
        append(.logicalOrder, String(logicalOrder.value))
        append(.occurredAt, String(occurredAt.epochMilliseconds))
        append(.payload, payload.data.base64EncodedString())
        return parts.joined(separator: "|")
    }

    /// 원소마다 길이를 붙여 이어 붙인 목록 표현.
    private static func canonicalList(_ values: [String]) -> String {
        values.map { "\($0.utf8.count):\($0)" }.joined()
    }

    /// 이벤트 ID를 뺀 내용의 digest.
    ///
    /// `같은 ID·같은 내용`과 `같은 ID·다른 내용`을 가르는 값이므로 이벤트 ID를
    /// 덮지 않는다(아키텍처 `03`·`04`). 전송 중 ID가 손상됐는지는 이 값이 아니라
    /// ``envelopeDigest``가 판정한다.
    ///
    /// 실행마다 seed가 바뀌는 `Hasher` 대신 SHA-256을 고정한다. 서로 다른 Peer와
    /// 서로 다른 실행이 같은 이벤트에서 같은 값을 얻지 못하면 무결성 비교
    /// 자체가 성립하지 않는다.
    public var contentDigest: String {
        Self.hexDigest(of: canonicalContent)
    }

    /// 이벤트 ID와 형식 version까지 덮는 손상 탐지 digest.
    ///
    /// ``contentDigest``만으로는 멱등 적용 키인 이벤트 ID의 손상을 전혀 잡지
    /// 못한다. ID 한 글자가 바뀐 envelope가 "정상 검증을 통과한 새 이벤트"가
    /// 되면 같은 논리 변경이 두 번 append되고 Peer마다 projection이 갈린다.
    /// 그래서 wire에 싣는 값은 이쪽이다.
    public var envelopeDigest: String {
        Self.hexDigest(
            of: """
                \(EventEnvelopeField.envelopeVersion.rawValue):\
                \(String(EventEnvelopeCodec.envelopeVersion).utf8.count):\
                \(EventEnvelopeCodec.envelopeVersion)|\
                \(EventEnvelopeField.eventID.rawValue):\(id.rawValue.utf8.count):\(id.rawValue)|\
                \(EventEnvelopeField.contentDigest.rawValue):\(contentDigest.utf8.count):\(contentDigest)
                """
        )
    }

    private static func hexDigest(of text: String) -> String {
        SHA256.hash(data: Data(text.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}

extension DurableEvent {
    /// 모든 Peer가 같은 결과를 얻는 전순서 비교.
    ///
    /// 논리 순서를 먼저 적용하고, 같은 논리 순서의 서로 다른 이벤트는 이벤트
    /// ID로 정렬한다(`POL-02-R-05`). 수신 시각이나 도착 순서를 쓰면 Peer마다
    /// 다른 projection이 나온다.
    public static func deterministicallyOrdered(_ lhs: DurableEvent, _ rhs: DurableEvent) -> Bool {
        if lhs.logicalOrder != rhs.logicalOrder { return lhs.logicalOrder < rhs.logicalOrder }
        return lhs.id < rhs.id
    }
}
