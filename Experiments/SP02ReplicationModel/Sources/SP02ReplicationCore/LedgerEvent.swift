import Foundation

/// 참여가 실패로 끝난 이유.
public enum ParticipationFailureReason: String, Sendable, Equatable {
    /// `POL-02-R-04` 4.1: 요청 기기가 마감 전까지 승인 ACK를 받지 못했다.
    case acknowledgementMissedDeadline = "마감 전 승인 ACK 미수신"
    /// 수락 Peer가 정책 검증에서 거부했다.
    case rejectedByAcceptor = "수락 Peer가 거부"
}

/// 주문 완료 시점에 점검한 참여자와 최신 메뉴 리비전의 스냅샷.
///
/// `POL-02-R-04` 4.3이 "주문 완료 이벤트는 점검에 사용한 참여자와 최신 메뉴
/// 리비전의 스냅샷 식별자를 함께 기록한다"고 요구한다. 이 값이 없으면 늦게
/// 도착한 유효 이벤트가 완료 조건을 깨뜨렸는지 계산할 수 없다.
public struct OrderSnapshot: Equatable, Sendable {
    public let participants: [UserID]
    public let menuHeads: [UserID: EventID]

    public init(participants: [UserID], menuHeads: [UserID: EventID]) {
        self.participants = participants
        self.menuHeads = menuHeads
    }

    /// 순서에 의존하지 않는 표현. payload digest와 projection hash에 쓴다.
    var canonicalForm: String {
        let people = participants.sorted().map(\.rawValue).joined(separator: ",")
        let heads = menuHeads
            .sorted { $0.key < $1.key }
            .map { "\($0.key.rawValue)=\($0.value.rawValue)" }
            .joined(separator: ",")
        return "participants[\(people)];menuHeads[\(heads)]"
    }
}

/// 구조화된 운영 이벤트의 종류.
///
/// `POL-02-R-01`의 최소 식별 정보 중 `이벤트 종류와 내용`에 해당한다. 수정과
/// 삭제는 제자리 덮어쓰기가 아니라 새 revision 또는 tombstone으로 표현하므로,
/// 이 열거형에는 "기존 이벤트를 변경한다"는 종류가 없다.
///
/// 대부분의 case가 `roomRecord` 같은 선행 record ID를 직접 들고 있다. 이렇게
/// 하지 않으면 순서가 뒤집혀 도착한 event를 "의존 record 부족"과 "정책 위반"으로
/// 구분할 수 없고, Room 정보를 아직 못 받은 Peer가 정상 event를 폐기한다.
public enum EventKind: Equatable, Sendable {
    case roomCreated(store: String, orderDeadlineMinute: Int)

    /// 요청 Peer가 append하는 participation request record.
    case participationRequest(roomRecord: EventID)

    /// 수락 Peer가 정책 검증·영속 저장 뒤 만드는 storage·policy ACK evidence.
    case participationAcceptance(requestID: EventID)

    /// 요청 Peer가 마감 전에 ACK를 검증하고 append하는 confirmation record.
    ///
    /// `ackReceivedAtMinute`는 **요청 기기가 ACK를 받은 시각**이다. 수락 Peer가
    /// 언제 저장했는지가 아니다. `POL-02-R-04`가 확정 조건을 "요청 기기가
    /// 마감 전에 ACK를 받았는가"로 정의하므로 이 값이 판정의 유일한 근거다.
    case participationConfirmation(requestID: EventID, acceptanceID: EventID, ackReceivedAtMinute: Int)

    /// 확정에 실패한 참여의 영구 결과. 늦은 ACK로 소급 확정하지 않는다.
    case participationFailure(requestID: EventID, reason: ParticipationFailureReason)

    /// 참여 철회 tombstone. 기존 참여와 그 사용자의 메뉴를 가린다.
    case participationWithdrawal(confirmationID: EventID)

    /// 중복 참여 충돌에서 사용자가 유지할 Room을 고른 결과(`POL-02-R-05`).
    ///
    /// 유지할 confirmation과 무효화할 confirmation을 모두 참조한다. Room ID만
    /// 담으면 다른 Room의 참여를 무효화할 tombstone 대상이 남지 않는다.
    case duplicateParticipationSelection(keptConfirmation: EventID, supersededConfirmations: [EventID])

    /// 개인 메뉴 리비전.
    ///
    /// - `parent`: 직전 head. 첫 리비전은 `nil`이다.
    /// - `supersedes`: 사용자가 재확정하며 버린 분기 head 목록.
    /// - `authority`: 이 사용자가 이 Room에 쓸 수 있다는 근거 record.
    ///   일반 경로에서는 자신의 confirmation record, never-shared 단독 Room
    ///   예외에서는 자신이 만든 `roomCreated` event다.
    case menuRevision(items: [String], revision: Int, parent: EventID?, supersedes: [EventID], authority: EventID)

    /// 주문 완료 순서 이벤트. **그 Room의 참여자만** 만들 수 있다.
    ///
    /// `authority`는 메뉴와 같은 의미다. 작성자 자신의 confirmation record이거나
    /// never-shared 단독 Room에서 자신이 만든 `roomCreated`여야 한다. 권한을
    /// 즉석 조회로 판정하면 순서가 뒤집혀 도착한 정상 event가 "권한 없음"으로
    /// 폐기되므로, 근거 record를 event가 직접 지목해 의존으로 만든다.
    ///
    /// 스냅샷의 메뉴 head도 의존 record로 요구한다. 그 record가 없는 Peer는
    /// 완료가 안전했는지 계산할 수 없으므로 완료를 적용해서도 안 된다.
    case orderCompleted(roomRecord: EventID, authority: EventID, snapshot: OrderSnapshot)

    /// 주문 완료 되돌리기 순서 이벤트. 권한 계약은 `orderCompleted`와 같다.
    case orderReverted(roomRecord: EventID, authority: EventID)

    /// Room 취소 tombstone.
    case roomCancelled(roomRecord: EventID)

    var dataKind: DataKind {
        switch self {
        case .roomCreated, .roomCancelled:
            return .roomInfo
        case .participationRequest, .participationAcceptance, .participationConfirmation,
             .participationFailure, .participationWithdrawal:
            return .participation
        case .duplicateParticipationSelection:
            return .userSelection
        case .menuRevision:
            return .menu
        case .orderCompleted, .orderReverted:
            return .orderStatus
        }
    }

    /// 이 event를 정책 검증하려면 먼저 보유해야 하는 record.
    ///
    /// 아키텍처 `04`가 "암호학적으로 유효하지만 의존 record가 부족한 event는
    /// invalid와 구분해 pending/quarantine에 보호"하라고 요구한다. 그 구분을
    /// 하려면 무엇이 의존인지 event 자신이 선언해야 한다.
    var dependencies: [EventID] {
        switch self {
        case .roomCreated:
            return []
        case .participationRequest(let roomRecord):
            return [roomRecord]
        case .participationAcceptance(let requestID):
            return [requestID]
        case .participationConfirmation(let requestID, let acceptanceID, _):
            return [requestID, acceptanceID]
        case .participationFailure(let requestID, _):
            return [requestID]
        case .participationWithdrawal(let confirmationID):
            return [confirmationID]
        case .duplicateParticipationSelection(let keptConfirmation, let supersededConfirmations):
            return [keptConfirmation] + supersededConfirmations
        case .menuRevision(_, _, let parent, let supersedes, let authority):
            return ([parent].compactMap { $0 }) + supersedes + [authority]
        case .orderCompleted(let roomRecord, let authority, let snapshot):
            return [roomRecord, authority] + snapshot.menuHeads.values.sorted()
        case .orderReverted(let roomRecord, let authority):
            return [roomRecord, authority]
        case .roomCancelled(let roomRecord):
            return [roomRecord]
        }
    }

    /// payload를 순서에 의존하지 않게 직렬화한 표현.
    ///
    /// 같은 event ID에 다른 payload가 오면 정상 중복이 아니라 무결성 충돌이다
    /// (`POL-02-R-01`, 아키텍처 `03`). 그 판정을 하려면 payload를 비교 가능한
    /// 한 값으로 접어야 한다.
    var canonicalForm: String {
        switch self {
        case .roomCreated(let store, let deadline):
            return "roomCreated(store=\(store),deadline=\(deadline))"
        case .participationRequest(let roomRecord):
            return "participationRequest(room=\(roomRecord.rawValue))"
        case .participationAcceptance(let requestID):
            return "participationAcceptance(request=\(requestID.rawValue))"
        case .participationConfirmation(let requestID, let acceptanceID, let receivedAt):
            return "participationConfirmation(request=\(requestID.rawValue),acceptance=\(acceptanceID.rawValue),ackReceivedAt=\(receivedAt))"
        case .participationFailure(let requestID, let reason):
            return "participationFailure(request=\(requestID.rawValue),reason=\(reason.rawValue))"
        case .participationWithdrawal(let confirmationID):
            return "participationWithdrawal(confirmation=\(confirmationID.rawValue))"
        case .duplicateParticipationSelection(let kept, let superseded):
            let dropped = superseded.sorted().map(\.rawValue).joined(separator: ",")
            return "duplicateParticipationSelection(kept=\(kept.rawValue),superseded=[\(dropped)])"
        case .menuRevision(let items, let revision, let parent, let supersedes, let authority):
            let dropped = supersedes.sorted().map(\.rawValue).joined(separator: ",")
            return "menuRevision(items=[\(items.joined(separator: "|"))],revision=\(revision),parent=\(parent?.rawValue ?? "-"),supersedes=[\(dropped)],authority=\(authority.rawValue))"
        case .orderCompleted(let roomRecord, let authority, let snapshot):
            return "orderCompleted(room=\(roomRecord.rawValue),authority=\(authority.rawValue),\(snapshot.canonicalForm))"
        case .orderReverted(let roomRecord, let authority):
            return "orderReverted(room=\(roomRecord.rawValue),authority=\(authority.rawValue))"
        case .roomCancelled(let roomRecord):
            return "roomCancelled(room=\(roomRecord.rawValue))"
        }
    }
}

/// 불변 운영 이벤트 한 건.
///
/// 필드 구성은 `POL-02-R-01`의 "운영 이벤트의 최소 식별 정보"를 그대로 따른다.
/// 위·변조 검증 정보는 실제 서명·MAC이 아니라 `payloadDigest`로 모델링한다.
/// 서명·MAC 표현은 `PRD-01-SP-04`의 미결정 기술이므로 이 스파이크가 정하지 않는다.
public struct LedgerEvent: Equatable, Sendable {
    public let id: EventID
    public let daySession: String
    /// 일일 세션 scope 이벤트는 `nil`이다.
    public let room: RoomID?
    public let authorUser: UserID
    public let authorDevice: DeviceID
    /// 논리적 순서. 모든 Peer가 공유하는 1차 정렬 키다.
    public let logicalOrder: Int
    /// 로컬 발생 시각(자정 기준 분).
    public let occurredAtMinute: Int
    public let kind: EventKind

    public init(
        id: EventID,
        daySession: String,
        room: RoomID?,
        authorUser: UserID,
        authorDevice: DeviceID,
        logicalOrder: Int,
        occurredAtMinute: Int,
        kind: EventKind
    ) {
        self.id = id
        self.daySession = daySession
        self.room = room
        self.authorUser = authorUser
        self.authorDevice = authorDevice
        self.logicalOrder = logicalOrder
        self.occurredAtMinute = occurredAtMinute
        self.kind = kind
    }

    public var scope: EventScope {
        EventScope(daySession: daySession, room: room, kind: kind.dataKind)
    }

    public var dependencies: [EventID] { kind.dependencies }

    /// 위·변조 검증 정보를 대신하는 payload digest.
    public var payloadDigest: String {
        Digest.hex(of: canonicalForm)
    }

    /// event ID를 뺀 전체 내용. 같은 ID·다른 내용을 판별하는 기준이다.
    var canonicalForm: String {
        "day=\(daySession);room=\(room?.rawValue ?? "-");user=\(authorUser.rawValue);device=\(authorDevice.rawValue);order=\(logicalOrder);at=\(occurredAtMinute);kind=\(kind.canonicalForm)"
    }

    /// 모든 Peer가 같은 결과를 얻는 전순서 키.
    ///
    /// 논리 순서가 같은 서로 다른 이벤트는 event ID로 정렬한다(`POL-02-R-05`).
    /// 수신 시각이나 도착 순서를 쓰면 Peer마다 다른 projection이 나온다.
    static func deterministicOrder(_ lhs: LedgerEvent, _ rhs: LedgerEvent) -> Bool {
        if lhs.logicalOrder != rhs.logicalOrder { return lhs.logicalOrder < rhs.logicalOrder }
        return lhs.id < rhs.id
    }
}
