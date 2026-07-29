import Foundation

/// envelope가 검사하는 필드 이름.
///
/// 오류가 어떤 필드 때문에 났는지 문자열로 조립하면 진단 코드가 오타로 조용히
/// 깨진다. 그래서 검사 대상 필드를 열거형으로 고정하고 직렬화 key와 오류
/// 메시지가 같은 원본을 쓰게 한다.
///
/// `POL-02-R-07`이 진단에 익명 식별자와 상태 코드만 허용하므로 이 값은 필드
/// 이름만 담고 사용자 입력값을 담지 않는다.
public enum EventEnvelopeField: String, Sendable, CaseIterable {
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
    case contentDigest
    case envelopeDigest
}

/// 운영 이벤트 envelope 계약을 위반한 결과.
///
/// 아키텍처 `03`은 수신 이벤트를 projection에 넣기 전에 거부·격리하라고
/// 요구한다. 그 거부 사유를 값으로 남겨야 호출자가 `확인 필요` 표시, 격리와
/// 재요청을 구분해 처리할 수 있다.
public enum EventEnvelopeError: Error, Hashable, Sendable {
    /// 필수 식별 필드가 없거나 공백뿐이다.
    case missingIdentity(field: EventEnvelopeField)

    /// 리비전 번호가 1 미만이다.
    case invalidRevision(value: Int)

    /// 리비전 번호와 선행 리비전 참조가 맞지 않다.
    ///
    /// 최초 리비전은 대체할 선행 이벤트가 없고, 이후 리비전은 자신이 무엇을
    /// 대체하는지 반드시 지목해야 한다. 이 규칙이 없으면 리비전 사슬이 끊긴
    /// 이벤트를 "새 대상의 최초 리비전"과 구분할 수 없다.
    case revisionPredecessorMismatch(revision: Int, supersedesCount: Int)

    /// 같은 선행 이벤트를 두 번 지목했다.
    case duplicateSupersededEvent(id: EventID)

    /// 이벤트가 자기 자신을 대체한다고 선언했다.
    case selfSupersedingEvent(id: EventID)

    /// 직렬화된 무결성 값이 내용에서 다시 계산한 값과 다르다.
    ///
    /// 아키텍처 `03`의 "인증·무결성 검증 실패는 거부한다"에 해당한다.
    case integrityMismatch(id: EventID, expected: String, actual: String)

    /// 같은 이벤트 ID로 서로 다른 내용이 들어왔다.
    ///
    /// 아키텍처 `03`·`04`가 "같은 ID·다른 내용은 충돌이나 공격 가능성이므로
    /// 격리한다"고 요구한다. 정상 중복(같은 ID·같은 내용)과 반드시 구분한다.
    case identityConflict(id: EventID, storedDigest: String, incomingDigest: String)

    /// 알 수 없는 envelope 형식 version이다.
    case unsupportedEnvelopeVersion(value: Int)

    /// 필드에 이 계약이 모르는 값이 들어왔다.
    ///
    /// 값 자체는 담지 않는다. `POL-02-R-07`이 진단 자료의 범위를 제한하므로
    /// 오류는 어떤 필드가 문제인지까지만 알린다.
    case unsupportedFieldValue(field: EventEnvelopeField)
}

extension EventEnvelopeError: CustomStringConvertible {
    public var description: String {
        switch self {
        case .missingIdentity(let field):
            return "필수 식별 필드 누락: \(field.rawValue)"
        case .invalidRevision(let value):
            return "리비전은 1 이상이어야 한다: \(value)"
        case .revisionPredecessorMismatch(let revision, let count):
            return "리비전 \(revision)과 선행 리비전 참조 \(count)개가 맞지 않다"
        case .duplicateSupersededEvent(let id):
            return "중복된 선행 리비전 참조: \(id.rawValue)"
        case .selfSupersedingEvent(let id):
            return "이벤트가 자기 자신을 대체할 수 없다: \(id.rawValue)"
        // digest 값은 associated value로만 남긴다. 키 없는 SHA-256이고 payload
        // 도메인이 좁아, 나머지 필드를 아는 상대에게는 digest가 메뉴 이름 같은
        // 내용에 대한 대입 가능한 commitment가 된다. `POL-02-R-07`이 진단 어휘를
        // 이벤트 ID·상태 코드·소요 시간·익명 기기 식별자로 닫아 두었다.
        case .integrityMismatch(let id, _, _):
            return "무결성 불일치: \(id.rawValue)"
        case .identityConflict(let id, _, _):
            return "같은 ID의 다른 내용: \(id.rawValue)"
        case .unsupportedEnvelopeVersion(let value):
            return "지원하지 않는 envelope version: \(value)"
        case .unsupportedFieldValue(let field):
            return "알 수 없는 필드 값: \(field.rawValue)"
        }
    }
}
