import Foundation

/// 장부에서 계산한 참여 상태.
///
/// 자동 승자를 고르는 case가 없다는 점이 이 열거형의 핵심이다. 충돌은
/// `conflictedAcrossRooms`로 남고, 사용자가 고른 결과만 `supersededByUserSelection`을
/// 만든다(`POL-02-R-05`).
public enum ParticipationState: Equatable, Sendable {
    /// 마감 전 ACK를 확인한 requester confirmation record가 있다.
    case confirmed(confirmation: EventID)
    /// request와 acceptance evidence만 있고 confirmation이 없다. 확인 필요.
    case awaitingAcknowledgement
    /// Room 생성자의 자동 참여이며 원격 confirmation record가 없다.
    ///
    /// 이 상태를 곧바로 확정으로 읽으면 안 된다. never-shared 단독 Room 예외는
    /// 로컬 관측이 필요하므로 `LocalObservationProjection`이 판정한다.
    case creatorWithoutRemoteAcknowledgement
    /// 마감까지 ACK를 받지 못했거나 거부된 영구 실패.
    case failed(ParticipationFailureReason)
    /// 철회 tombstone이 덮었다.
    case withdrawn
    /// 같은 운영일에 둘 이상의 Room에서 확정돼 사용자 선택이 필요하다.
    case conflictedAcrossRooms
    /// 사용자가 다른 Room을 선택해 무효화됐다.
    case supersededByUserSelection

    public var canonicalForm: String {
        switch self {
        case .confirmed(let confirmation): return "confirmed(\(confirmation.rawValue))"
        case .awaitingAcknowledgement: return "awaitingAcknowledgement"
        case .creatorWithoutRemoteAcknowledgement: return "creatorWithoutRemoteAcknowledgement"
        case .failed(let reason): return "failed(\(reason.rawValue))"
        case .withdrawn: return "withdrawn"
        case .conflictedAcrossRooms: return "conflictedAcrossRooms"
        case .supersededByUserSelection: return "supersededByUserSelection"
        }
    }

    /// 이 상태만으로 메뉴 쓰기와 주문 완료 점검을 통과할 수 있는지.
    public var isConfirmedByRemoteAcknowledgement: Bool {
        if case .confirmed = self { return true }
        return false
    }
}

/// 장부에서 계산한 개인 메뉴 상태.
///
/// `head`가 내용 digest를 함께 들고 있는 이유가 있다. event ID와 리비전 번호만
/// 담으면 같은 ID에 다른 메뉴 내용이 실린 envelope가 이겨도 projection hash가
/// 그대로다. 그러면 "hash가 같다"가 "주문 요약이 같다"를 뜻하지 못한다.
/// 내용 원문은 담지 않는다(`POL-02-R-07`).
public enum MenuState: Equatable, Sendable {
    case notSubmitted
    case head(EventID, revision: Int, contentDigest: String)
    /// 같은 사용자의 분기 리비전. 자동 선택하지 않고 사용자가 재확정해야 한다.
    case diverged([EventID])
    /// 참여 철회·Room 취소 tombstone이 덮었다.
    case revoked

    public var canonicalForm: String {
        switch self {
        case .notSubmitted: return "notSubmitted"
        case .head(let id, let revision, let digest): return "head(\(id.rawValue),r\(revision),\(digest))"
        case .diverged(let ids): return "diverged([\(ids.sorted().map(\.rawValue).joined(separator: ","))])"
        case .revoked: return "revoked"
        }
    }

    public var headEventID: EventID? {
        if case .head(let id, _, _) = self { return id }
        return nil
    }
}

/// 장부에서 계산한 주문 상태.
public enum OrderState: Equatable, Sendable {
    case inProgress
    case completed(event: EventID, by: UserID, atMinute: Int)
    /// 완료 뒤 스냅샷에 없던 유효 이벤트가 도착해 안전한 완료로 볼 수 없다.
    case completedNeedsReview(event: EventID, by: UserID, atMinute: Int)

    public var canonicalForm: String {
        switch self {
        case .inProgress: return "inProgress"
        case .completed(let event, let user, let minute):
            return "completed(\(event.rawValue),\(user.rawValue),\(minute))"
        case .completedNeedsReview(let event, let user, let minute):
            return "completedNeedsReview(\(event.rawValue),\(user.rawValue),\(minute))"
        }
    }
}

/// 자동 해결이 금지된 충돌의 분류.
public enum ConflictKind: String, Sendable, Comparable {
    case divergedMenuRevision = "메뉴 리비전 분기"
    case duplicateRoomParticipation = "중복 Room 참여"
    case completionSnapshotBroken = "완료 스냅샷과 현재 상태 불일치"
    case ambiguousUserSelection = "중복 참여 선택이 하나로 좁혀지지 않음"
    case duplicateRoomRecord = "같은 Room에 생성 record가 둘 이상"

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// 사용자에게 `확인 필요`로 노출할 충돌 한 건.
public struct ConflictNote: Equatable, Sendable, Comparable {
    public let kind: ConflictKind
    public let room: RoomID?
    public let user: UserID?
    public let evidence: [EventID]

    public var canonicalForm: String {
        "\(kind.rawValue)/\(room?.rawValue ?? "-")/\(user?.rawValue ?? "-")/[\(evidence.sorted().map(\.rawValue).joined(separator: ","))]"
    }

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.canonicalForm < rhs.canonicalForm }
}

/// 한 Room의 구조화 projection.
public struct RoomProjection: Equatable, Sendable {
    public let room: RoomID
    public let creator: UserID
    /// 가게 정보의 내용 digest. 원문은 담지 않는다(`POL-02-R-07`).
    public let storeDigest: String
    public let orderDeadlineMinute: Int
    public let cancelled: Bool
    public let participants: [UserID: ParticipationState]
    public let menus: [UserID: MenuState]
    public let orderState: OrderState
    public let conflicts: [ConflictNote]

    /// 현재 확정 참여자.
    public var confirmedParticipants: [UserID] {
        participants.filter { $0.value.isConfirmedByRemoteAcknowledgement }.keys.sorted()
    }

    var canonicalForm: String {
        var lines: [String] = []
        lines.append("room=\(room.rawValue);creator=\(creator.rawValue);store=\(storeDigest);deadline=\(orderDeadlineMinute);cancelled=\(cancelled)")
        for user in participants.keys.sorted() {
            lines.append("  participant \(user.rawValue) = \(participants[user]!.canonicalForm)")
        }
        for user in menus.keys.sorted() {
            lines.append("  menu \(user.rawValue) = \(menus[user]!.canonicalForm)")
        }
        lines.append("  order = \(orderState.canonicalForm)")
        for conflict in conflicts.sorted() {
            lines.append("  conflict \(conflict.canonicalForm)")
        }
        return lines.joined(separator: "\n")
    }
}

/// 검증된 장부만으로 계산한 구조화 운영 projection.
///
/// 여기에는 현재 시각, StorageACK 수신 여부와 Peer 관측이 들어가지 않는다.
/// 아키텍처 `04`가 결정적 수렴 대상을 "구조화 운영 projection"으로 한정하고
/// 동기화 상태·일일 상태 overlay를 별도 로컬 관측으로 분리했기 때문이다.
/// 이 경계를 지켜야 "같은 이벤트 집합 → 같은 hash"가 성립한다.
public struct StructuredProjection: Equatable, Sendable {
    public let daySession: String
    public let rooms: [RoomID: RoomProjection]
    /// 일일 세션 scope 충돌. 중복 Room 참여가 여기에 들어간다.
    public let daySessionConflicts: [ConflictNote]

    public var canonicalForm: String {
        var lines: [String] = ["day=\(daySession)"]
        for room in rooms.keys.sorted() {
            lines.append(rooms[room]!.canonicalForm)
        }
        for conflict in daySessionConflicts.sorted() {
            lines.append("dayConflict \(conflict.canonicalForm)")
        }
        return lines.joined(separator: "\n")
    }

    /// 수렴 비교에 쓰는 결정적 hash.
    public var hash: String { Digest.hex(of: canonicalForm) }
}

/// 검증된 이벤트 집합을 구조화 projection으로 접는 reducer.
public enum ProjectionReducer {
    public static func reduce(daySession: String, ledger: Ledger) -> StructuredProjection {
        let events = ledger.orderedValidatedEvents.filter { $0.daySession == daySession }
        var rooms: [RoomID: RoomProjection] = [:]
        var dayConflicts: [ConflictNote] = []

        // 1. Room 기본 정보와 취소 tombstone.
        //
        // 같은 Room에 `roomCreated`가 둘 이상이면 뒤에 온 것으로 덮지 않는다.
        // 덮으면 위조 record가 생성자·가게·마감을 통째로 가져갈 수 있다.
        // 결정적 순서의 첫 record를 정보원으로 쓰고, 마감은 가장 이른 값으로
        // fail-closed하며, 그 Room을 `확인 필요`로 남긴다.
        var roomInfo: [RoomID: (creator: UserID, store: String, deadline: Int, createdBy: EventID)] = [:]
        var duplicateRoomRecords: [RoomID: [EventID]] = [:]
        var cancellationEvents: [RoomID: [LedgerEvent]] = [:]
        var roomsWithRecords: Set<RoomID> = []
        for event in events {
            guard let room = event.room else { continue }
            switch event.kind {
            case .roomCreated:
                roomsWithRecords.insert(room)
            case .roomCancelled:
                cancellationEvents[room, default: []].append(event)
            default:
                break
            }
        }
        for room in roomsWithRecords {
            let records = Ledger.roomRecords(in: events, room: room)
            guard let first = records.first,
                  case .roomCreated(let store, _) = first.kind,
                  let deadline = Ledger.earliestOrderDeadlineMinute(in: events, room: room) else { continue }
            roomInfo[room] = (first.authorUser, store, deadline, first.id)
            if records.count > 1 {
                duplicateRoomRecords[room] = records.map(\.id)
            }
        }

        // 2. 참여 record 수집.
        var requests: [EventID: LedgerEvent] = [:]
        var confirmationsByRequest: [EventID: [LedgerEvent]] = [:]
        var failuresByRequest: [EventID: [LedgerEvent]] = [:]
        var withdrawnConfirmations: Set<EventID> = []
        var selectionsByUser: [UserID: [LedgerEvent]] = [:]
        for event in events {
            switch event.kind {
            case .participationRequest:
                requests[event.id] = event
            case .participationConfirmation(let requestID, _, _):
                confirmationsByRequest[requestID, default: []].append(event)
            case .participationFailure(let requestID, _):
                failuresByRequest[requestID, default: []].append(event)
            case .participationWithdrawal(let confirmationID):
                withdrawnConfirmations.insert(confirmationID)
            case .duplicateParticipationSelection:
                selectionsByUser[event.authorUser, default: []].append(event)
            default:
                break
            }
        }

        // 3. Room·사용자별 참여 상태.
        var participation: [RoomID: [UserID: ParticipationState]] = [:]
        for (room, info) in roomInfo {
            participation[room] = [info.creator: .creatorWithoutRemoteAcknowledgement]
        }
        for request in requests.values.sorted(by: LedgerEvent.deterministicOrder) {
            guard let room = request.room, let info = roomInfo[room] else { continue }
            // 마감 판정을 장부에만 맡기면 도착 순서에 갈린다. 장부는 그 시점까지
            // 받은 생성 record만 보고 마감을 계산하는데, 마감을 **줄여 잡은**
            // 두 번째 생성 record가 confirmation보다 늦게 오면 이미 append된
            // confirmation을 다시 판정하지 않는다. 먼저 받은 Peer는 같은
            // confirmation을 거부하므로 두 Peer의 장부가 갈린다. 정본 마감은
            // 전체 검증 집합의 최소값이므로 여기서 한 번 더 본다.
            let onTimeConfirmations = (confirmationsByRequest[request.id] ?? []).filter { confirmation in
                guard case .participationConfirmation(_, _, let ackMinute) = confirmation.kind else { return false }
                return ackMinute < info.deadline && confirmation.occurredAtMinute < info.deadline
            }
            let liveConfirmations = onTimeConfirmations
                .filter { !withdrawnConfirmations.contains($0.id) }
                .sorted(by: LedgerEvent.deterministicOrder)
            let allConfirmations = onTimeConfirmations
            let failures = (failuresByRequest[request.id] ?? []).sorted(by: LedgerEvent.deterministicOrder)

            let state: ParticipationState
            if let failure = failures.first, case .participationFailure(_, let reason) = failure.kind {
                // 실패 outcome은 영구적이다. 뒤늦게 도착한 confirmation이 이것을
                // 덮으면 `POL-02-R-04` 4.1과 아키텍처 `04`의 "늦은 ACK로 소급
                // 확정하지 않는다"가 무너진다. 같은 request에 실패와 확정이 함께
                // 있는 것은 모순이므로 fail-closed로 실패를 택한다.
                state = .failed(reason)
            } else if let confirmation = liveConfirmations.first {
                state = .confirmed(confirmation: confirmation.id)
            } else if !allConfirmations.isEmpty {
                state = .withdrawn
            } else {
                state = .awaitingAcknowledgement
            }
            let existing = participation[room]?[request.authorUser]
            participation[room]?[request.authorUser] = merge(existing: existing, incoming: state)
        }

        // 4. 같은 운영일의 중복 참여. 자동 승자를 고르지 않는다(`POL-02-R-05`).
        // `PRD-01-AC-01`은 생성자의 자동 참여도 참여로 정의한다. 확정 참여만
        // 세면 "생성자로 한 방 + 확정 참여로 다른 방"이 중복 판정에서 빠진다.
        var confirmedRoomsByUser: [UserID: [RoomID]] = [:]
        for (room, states) in participation {
            for (user, state) in states
            where state.isConfirmedByRemoteAcknowledgement || state == .creatorWithoutRemoteAcknowledgement {
                confirmedRoomsByUser[user, default: []].append(room)
            }
        }
        for (user, conflictRooms) in confirmedRoomsByUser where conflictRooms.count > 1 {
            let sortedRooms = conflictRooms.sorted()
            let selections = selectionsByUser[user] ?? []
            let evidence = sortedRooms.compactMap { room -> EventID? in
                guard case .confirmed(let confirmation)? = participation[room]?[user] else { return nil }
                return confirmation
            }
            let conflictConfirmations = Set(evidence)
            // 선택은 **현재 충돌 집합 안의** confirmation을 골라야 한다. 집합
            // 밖의 stale record를 지목한 선택을 그대로 적용하면 사용자가 어느
            // 방에도 남지 않는데 `확인 필요`만 사라진다.
            let usableSelections = selections.filter { selection in
                guard case .duplicateParticipationSelection(let kept, _) = selection.kind else { return false }
                return conflictConfirmations.contains(kept)
            }
            // 생성자 자동 참여 방에는 confirmation record가 없다. 그래서 그 방은
            // 선택의 `kept`로 지목될 수도, `supersededByUserSelection`으로 내려갈
            // 수도 없다. 이 방을 그대로 두고 선택을 해소로 인정하면 두 방이 모두
            // 살아 있는데 `확인 필요`만 사라지고 생성자 방이 다시 주문 가능해진다.
            // 탐지에는 생성자 참여를 넣고 해소에서 빼면 생기는 비대칭이므로,
            // 충돌 집합에 생성자 방이 있는 동안에는 어느 선택도 적용하지 않는다.
            let hasCreatorOnlyRoom = sortedRooms.contains { room in
                participation[room]?[user] == .creatorWithoutRemoteAcknowledgement
            }
            guard !hasCreatorOnlyRoom,
                  usableSelections.count == 1,
                  case .duplicateParticipationSelection(let keptConfirmation, _) = usableSelections[0].kind else {
                // 선택이 없거나 서로 다른 선택이 둘 이상이면 어느 쪽도 채택하지 않는다.
                for room in sortedRooms {
                    participation[room]?[user] = .conflictedAcrossRooms
                }
                dayConflicts.append(ConflictNote(
                    kind: usableSelections.count > 1 ? .ambiguousUserSelection : .duplicateRoomParticipation,
                    room: nil,
                    user: user,
                    evidence: evidence + selections.map(\.id)
                ))
                continue
            }
            for room in sortedRooms {
                guard case .confirmed(let confirmation)? = participation[room]?[user] else { continue }
                if confirmation != keptConfirmation {
                    participation[room]?[user] = .supersededByUserSelection
                }
            }
        }

        // 5. Room별 메뉴와 주문 상태.
        for (room, info) in roomInfo {
            let roomEvents = events.filter { $0.room == room }
            var conflicts: [ConflictNote] = []
            var states = participation[room] ?? [:]

            // 생성 record가 둘 이상이면 생성자·가게·마감이 아직 확정되지 않았다.
            // 확정되지 않은 Room 정보 위에서 취소와 주문 완료를 확정하면 심은
            // record가 그 권한을 그대로 가져간다.
            let roomRecordAmbiguous = duplicateRoomRecords[room] != nil

            // `POL-01-R-04`는 전체 취소를 Room 생성자에게만 허용하고, 생성자가
            // 참여를 철회하면 그 권한이 종료된다고 정한다. 장부가 볼 수 있는
            // 것은 참조된 생성 record의 작성자까지이므로, 정본 생성자와 대조하는
            // 판정은 전체 검증 집합을 보는 여기서 한다.
            //
            // 현재 설계에서 이 filter는 `roomRecordAmbiguous`에 포섭되는 중복
            // 방어다. 심은 record가 있으면 아래 `roomRecordAmbiguous`가 이미
            // 취소를 막고, 없으면 장부의 작성자 검사가 이미 작성자를 정본
            // 생성자로 고정하기 때문이다. 규칙을 표현하는 자리로 남긴다.
            let creatorCancellations = (cancellationEvents[room] ?? []).filter {
                $0.authorUser == info.creator
            }
            let creatorStillParticipating = states[info.creator].map { state in
                state != .withdrawn && state != .supersededByUserSelection
            } ?? false
            let cancelled = !roomRecordAmbiguous
                && !creatorCancellations.isEmpty
                && creatorStillParticipating
            if cancelled {
                // Room 취소 tombstone은 참여·메뉴와 성공 히스토리를 무효화한다.
                states = states.mapValues { _ in .withdrawn }
            }

            if let records = duplicateRoomRecords[room] {
                conflicts.append(ConflictNote(
                    kind: .duplicateRoomRecord,
                    room: room,
                    user: nil,
                    evidence: records
                ))
            }

            var menus: [UserID: MenuState] = [:]
            let menuEvents = roomEvents.filter {
                if case .menuRevision = $0.kind { return true }
                return false
            }
            // 참여 상태가 아예 없는 사용자의 메뉴는 만들지 않는다. 심은 생성
            // record를 권한 근거로 쓰면 참여자가 아닌 사용자의 메뉴가 수렴
            // projection에 들어가, `participants`에 없는 사람이 `menus`에 있는
            // 내부 불일치가 생기고 주문 요약에 낯선 메뉴가 표시된다.
            let menuAuthors = Set(menuEvents.map(\.authorUser)).sorted().filter { states[$0] != nil }
            for user in menuAuthors {
                let owned = menuEvents.filter { $0.authorUser == user }
                var parents: Set<EventID> = []
                var superseded: Set<EventID> = []
                for event in owned {
                    guard case .menuRevision(_, _, let parent, let supersedes, _) = event.kind else { continue }
                    if let parent { parents.insert(parent) }
                    superseded.formUnion(supersedes)
                }
                let heads = owned
                    .filter { !parents.contains($0.id) && !superseded.contains($0.id) }
                    .sorted(by: LedgerEvent.deterministicOrder)

                let userState = states[user] ?? .awaitingAcknowledgement
                if cancelled || userState == .withdrawn
                    || userState == .supersededByUserSelection {
                    menus[user] = .revoked
                    continue
                }
                if heads.count > 1 {
                    menus[user] = .diverged(heads.map(\.id))
                    conflicts.append(ConflictNote(
                        kind: .divergedMenuRevision,
                        room: room,
                        user: user,
                        evidence: heads.map(\.id)
                    ))
                } else if let head = heads.first, case .menuRevision(let items, let revision, _, _, _) = head.kind {
                    menus[user] = .head(
                        head.id,
                        revision: revision,
                        contentDigest: String(Digest.hex(of: items.joined(separator: "|")).prefix(12))
                    )
                } else {
                    menus[user] = .notSubmitted
                }

                // 참여가 확정되지 않은 사용자의 메뉴를 주문 가능한 상태로 읽어서는
                // 안 되지만(`POL-02-R-04` 4.1) 그 판정은 여기서 하지 않는다.
                // never-shared 단독 Room 예외는 로컬 관측이 필요하므로 구조화
                // projection이 결정할 수 없다. 차단은 `orderReadiness`가 소유한다.
            }
            for user in states.keys where menus[user] == nil {
                menus[user] = cancelled ? .revoked : .notSubmitted
            }

            // 주문 상태: 논리 순서와 event ID로 정렬한 마지막 유효 동작.
            let orderingEvents = roomEvents.filter {
                switch $0.kind {
                case .orderCompleted, .orderReverted: return true
                default: return false
                }
            }
            // 취소 Room이어도 마지막 유효 주문 동작은 계산한다. 계산을 건너뛰면
            // 완료 상태로 취소된 방이 `진행 중`으로 보인다.
            var orderState: OrderState = .inProgress
            if let last = orderingEvents.last {
                if case .orderCompleted(_, _, let snapshot) = last.kind {
                    let currentParticipants = states
                        .filter { $0.value.isConfirmedByRemoteAcknowledgement }
                        .keys
                        .sorted()
                    var currentHeads: [UserID: EventID] = [:]
                    for user in currentParticipants {
                        if let head = menus[user]?.headEventID { currentHeads[user] = head }
                    }
                    let intact = snapshot.participants.sorted() == currentParticipants
                        && snapshot.menuHeads == currentHeads
                    // Room 정보가 확정되지 않았으면 완료도 확정으로 승격하지
                    // 않는다. 심은 생성 record를 권한 근거로 쓴 완료가 여기서
                    // `완료`가 되면 비참여자의 완료가 모든 Peer에 확정으로
                    // 표시된다. 완료 표식 자체는 지우지 않는다. `POL-01` 4.2가
                    // 누가 언제 실행했는지 표시하도록 정하기 때문이다.
                    if intact, !roomRecordAmbiguous {
                        orderState = .completed(event: last.id, by: last.authorUser, atMinute: last.occurredAtMinute)
                    } else {
                        orderState = .completedNeedsReview(
                            event: last.id,
                            by: last.authorUser,
                            atMinute: last.occurredAtMinute
                        )
                        // 생성 record 중복은 이미 자기 충돌을 남겼다. 스냅샷이
                        // 실제로 깨졌을 때만 그 사유를 따로 기록한다.
                        if !intact {
                            conflicts.append(ConflictNote(
                                kind: .completionSnapshotBroken,
                                room: room,
                                user: nil,
                                evidence: [last.id]
                            ))
                        }
                    }
                }
            }

            rooms[room] = RoomProjection(
                room: room,
                creator: info.creator,
                storeDigest: String(Digest.hex(of: info.store).prefix(12)),
                orderDeadlineMinute: info.deadline,
                cancelled: cancelled,
                participants: states,
                menus: menus,
                orderState: orderState,
                // 정렬하지 않으면 자동 합성 `Equatable`이 배열 순서를 보므로
                // hash는 같은데 `==`는 다른 값이 나온다.
                conflicts: conflicts.sorted()
            )
        }

        return StructuredProjection(
            daySession: daySession,
            rooms: rooms,
            daySessionConflicts: dayConflicts.sorted()
        )
    }

    /// 한 사용자가 같은 Room에 여러 요청을 남겼을 때의 합성.
    ///
    /// 확정이 하나라도 있으면 확정, 없고 실패가 있으면 실패, 그 밖에는 대기다.
    /// 실패를 확정보다 앞세우면 재요청으로 확정된 참여가 사라진다.
    private static func merge(
        existing: ParticipationState?,
        incoming: ParticipationState
    ) -> ParticipationState {
        guard let existing else { return incoming }
        if existing.isConfirmedByRemoteAcknowledgement { return existing }
        if incoming.isConfirmedByRemoteAcknowledgement { return incoming }
        if case .creatorWithoutRemoteAcknowledgement = existing { return incoming }
        if case .awaitingAcknowledgement = incoming { return existing }
        return incoming
    }
}
