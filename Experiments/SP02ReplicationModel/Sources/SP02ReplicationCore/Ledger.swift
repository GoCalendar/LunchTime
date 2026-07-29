import Foundation

/// 이벤트 한 건을 받았을 때의 결과.
///
/// 아키텍처 `03`·`04`의 수신 처리 순서를 그대로 결과 타입으로 만든 것이다.
/// 특히 `pendingDependency`와 `rejected`를 한 값으로 합치지 않는다. 둘을 합치면
/// 순서가 뒤집혀 도착한 정상 event가 조용히 폐기된다.
public enum AppendOutcome: Equatable, Sendable {
    /// 새로 검증해 장부에 append했다.
    case appended
    /// 같은 ID·같은 내용을 이미 보유한다. 재적용하지 않고 기존 저장분을 StorageACK한다.
    case duplicateIdempotent
    /// 같은 ID에 다른 payload가 왔다. 정상 중복이 아니므로 격리한다.
    case integrityConflict(existingDigest: String, receivedDigest: String)
    /// 암호학적으로는 유효하지만 의존 record가 없어 아직 판정할 수 없다.
    case pendingDependency(missing: [EventID])
    /// 정책 검증에 실패했다. 장부·요약·StorageACK·재전파에 넣지 않는다.
    case rejected(reason: RejectionReason)

    public var isAppended: Bool { self == .appended }
}

/// 정책 검증 실패 분류.
public enum RejectionReason: String, Equatable, Sendable {
    case menuAuthorIsNotOwner = "본인이 아닌 사용자의 메뉴 리비전"
    case menuAuthorityDoesNotGrantWrite = "메뉴 작성 권한 record가 이 사용자·Room을 허용하지 않음"
    case menuRevisionNotSequential = "메뉴 리비전이 parent 다음 값이 아님"
    case acceptanceBySameDevice = "요청 기기가 스스로 만든 수락 evidence"
    case acceptanceBySameUser = "요청 사용자가 스스로 만든 수락 evidence"
    case recordOwnedByOtherUser = "다른 사용자의 record를 참조한 이벤트"
    case confirmationAfterDeadline = "마감 뒤 수신한 ACK로 만든 confirmation record"
    case confirmationWrittenAfterDeadline = "마감 뒤에 작성한 confirmation record"
    case withdrawalTargetIsNotConfirmation = "철회 대상이 confirmation record가 아님"
    case confirmationReferencesOtherRequest = "confirmation이 다른 요청의 evidence를 참조"
    case orderEventWithoutParticipation = "참여 권한 record가 없는 주문 상태 이벤트"
    case cancellationByNonCreator = "생성자가 아닌 사용자의 Room 취소"
    case cancellationTargetIsNotRoomRecord = "취소 대상이 Room 생성 record가 아님"
    case participationTargetIsNotRoomRecord = "참여 요청 대상이 Room 생성 record가 아님"
    case acceptanceTargetIsNotRequest = "수락 대상이 참여 요청 record가 아님"
    case failureTargetIsNotRequest = "실패 대상이 참여 요청 record가 아님"
    case recordOwnedByOtherDevice = "다른 기기의 record를 뒤집는 이벤트"
    case writeAfterDailyClose = "14:30 쓰기 종료 뒤 생성된 이벤트"
    case scopeMismatch = "의존 record와 scope가 일치하지 않음"
}

/// 한 Peer의 검증된 로컬 장부와 보호된 pending/quarantine 경계.
///
/// 검증 장부와 pending/quarantine은 **다른 저장 경계**다. pending payload는
/// 장부 summary, StorageACK, projection과 재전파의 입력으로 쓰지 않는다
/// (아키텍처 `04`). 이 구분을 타입으로 강제해 두면 요약 계산이 실수로 pending을
/// 포함하는 회귀를 막을 수 있다.
public struct Ledger: Sendable {
    /// 검증을 통과해 append한 불변 이벤트.
    public private(set) var validated: [EventID: LedgerEvent] = [:]
    /// 의존 record를 기다리는 보호된 envelope.
    public private(set) var pending: [EventID: LedgerEvent] = [:]
    /// 같은 ID·다른 payload로 격리한 event.
    public private(set) var quarantined: [EventID: [LedgerEvent]] = [:]
    /// 정책 검증에 실패해 적용하지 않은 event와 이유.
    public private(set) var rejected: [EventID: RejectionReason] = [:]
    /// 거부한 event의 payload digest.
    ///
    /// 거부는 그 ID를 비워 두지 않는다. 같은 ID에 다른 payload를 다시 실어 보내
    /// 검증을 우회하는 경로를 막으려면 거부한 내용도 기억해야 한다.
    private var rejectedDigests: [EventID: String] = [:]

    public init() {}

    /// 논리 순서와 이벤트 ID로 정렬한 검증 이벤트.
    public var orderedValidatedEvents: [LedgerEvent] {
        validated.values.sorted(by: LedgerEvent.deterministicOrder)
    }

    /// 아직 확보하지 못한 의존 record ID.
    ///
    /// 제한 세션은 이 집합만 요청한다. pending payload 자체를 상대에게 정상
    /// event로 광고하거나 relay하지 않는다.
    public var missingDependencyIDs: [EventID] {
        var missing: Set<EventID> = []
        for event in pending.values {
            for dependency in event.dependencies where validated[dependency] == nil {
                missing.insert(dependency)
            }
        }
        return missing.sorted()
    }

    /// 이벤트 하나를 수신 처리한다.
    ///
    /// 반환값이 `.pendingDependency`인 event는 보관되며, 이후 의존 record가
    /// 도착하면 `promotePending()`이 처음부터 다시 검증한다.
    @discardableResult
    public mutating func receive(_ event: LedgerEvent) -> AppendOutcome {
        if let existing = validated[event.id] {
            guard existing.payloadDigest == event.payloadDigest else {
                quarantined[event.id, default: []].append(event)
                return .integrityConflict(existingDigest: existing.payloadDigest, receivedDigest: event.payloadDigest)
            }
            return .duplicateIdempotent
        }

        if let held = pending[event.id], held.payloadDigest != event.payloadDigest {
            // 아직 승격하지 못한 envelope에도 같은 ID 규칙을 적용한다. 그러지 않으면
            // pending 구간이 payload 교체 창이 된다.
            quarantined[event.id, default: []].append(event)
            return .integrityConflict(existingDigest: held.payloadDigest, receivedDigest: event.payloadDigest)
        }

        if let rejectedDigest = rejectedDigests[event.id], rejectedDigest != event.payloadDigest {
            // 거부된 ID도 마찬가지다. 거부를 빈 자리로 두면 같은 ID에 다른 내용을
            // 다시 실어 보내는 것만으로 검증을 통과시킬 수 있다.
            quarantined[event.id, default: []].append(event)
            return .integrityConflict(existingDigest: rejectedDigest, receivedDigest: event.payloadDigest)
        }

        let missing = event.dependencies.filter { validated[$0] == nil }
        if !missing.isEmpty {
            pending[event.id] = event
            return .pendingDependency(missing: Array(Set(missing)).sorted())
        }

        if let reason = validate(event) {
            pending.removeValue(forKey: event.id)
            rejected[event.id] = reason
            rejectedDigests[event.id] = event.payloadDigest
            return .rejected(reason: reason)
        }

        validated[event.id] = event
        pending.removeValue(forKey: event.id)
        rejected.removeValue(forKey: event.id)
        rejectedDigests.removeValue(forKey: event.id)
        promotePending()
        return .appended
    }

    /// 의존 record가 채워진 pending event를 전체 재검증해 승격한다.
    ///
    /// 한 번 승격하면 그 event가 다른 pending event의 의존일 수 있으므로 더 이상
    /// 승격이 일어나지 않을 때까지 반복한다. 반복 횟수는 pending 개수로 상한이
    /// 있으므로 무한 반복이 되지 않는다.
    private mutating func promotePending() {
        var progressed = true
        while progressed {
            progressed = false
            for event in pending.values.sorted(by: LedgerEvent.deterministicOrder) {
                guard event.dependencies.allSatisfy({ validated[$0] != nil }) else { continue }
                pending.removeValue(forKey: event.id)
                if let reason = validate(event) {
                    rejected[event.id] = reason
                    rejectedDigests[event.id] = event.payloadDigest
                } else {
                    validated[event.id] = event
                }
                progressed = true
            }
        }
    }

    /// 의존 record가 모두 있는 event의 권한·scope·revision·시간 검증.
    ///
    /// 반환값이 `nil`이면 유효하다. 여기서 통과한 event만 장부에 들어가므로,
    /// 이 함수가 관대해지면 스파이크의 모든 결론이 무너진다.
    private func validate(_ event: LedgerEvent) -> RejectionReason? {
        // 14:30 쓰기 종료는 쓰기 가능 여부에서 복제된 이벤트보다 우선한다
        // (`POL-02-R-05`). 마감 뒤 생성된 event는 어느 Peer에서도 장부에 들어가지
        // 않으므로, 늦게 도착한 유효 이벤트와 종료 뒤 새 쓰기가 뒤섞이지 않는다.
        guard DaySchedule.isWritable(minute: event.occurredAtMinute) else {
            return .writeAfterDailyClose
        }

        switch event.kind {
        case .roomCreated:
            return nil

        case .participationRequest(let roomRecord):
            if let mismatch = sameRoom(event, as: roomRecord) { return mismatch }
            // 참여 요청이 지목한 record가 곧 그 요청의 마감 근거가 된다.
            // 종류를 보지 않으면 마감을 계산할 수 없는 record가 들어온다.
            guard let record = validated[roomRecord], case .roomCreated = record.kind else {
                return .participationTargetIsNotRoomRecord
            }
            return nil

        case .participationAcceptance(let requestID):
            if let mismatch = sameRoom(event, as: requestID) { return mismatch }
            guard let request = validated[requestID] else { return .scopeMismatch }
            // 종류를 보지 않으면 참여 요청이 아닌 record 위에 세운 수락·확정이
            // 검증 장부에 남고, `writeAuthority`가 그 confirmation을 권한
            // 근거로 받아들인다.
            guard case .participationRequest = request.kind else {
                return .acceptanceTargetIsNotRequest
            }
            // 자기 요청을 자기 기기가 수락하면 원격 ACK가 아니다.
            // `POL-02-R-03`이 `복제됨`을 "최소 한 대의 다른 피어"로 정의한다.
            guard request.authorDevice != event.authorDevice else { return .acceptanceBySameDevice }
            // 기기만 보면 같은 사용자 ID를 주장하는 두 번째 기기가 자기 참여를
            // 스스로 확정할 수 있다. `POL-03-R-02`가 사용자 ID를 참여 권한의
            // 주체로 정의하므로 사용자도 함께 본다.
            guard request.authorUser != event.authorUser else { return .acceptanceBySameUser }
            return nil

        case .participationConfirmation(let requestID, let acceptanceID, let ackReceivedAtMinute):
            if let mismatch = sameRoom(event, as: requestID) { return mismatch }
            if let mismatch = sameRoom(event, as: acceptanceID) { return mismatch }
            guard let request = validated[requestID], let acceptance = validated[acceptanceID] else {
                return .scopeMismatch
            }
            // confirmation은 요청 기기만 만들 수 있다.
            guard request.authorUser == event.authorUser, request.authorDevice == event.authorDevice else {
                return .recordOwnedByOtherUser
            }
            guard case .participationAcceptance(let acknowledgedRequestID) = acceptance.kind,
                  acknowledgedRequestID == requestID else {
                return .confirmationReferencesOtherRequest
            }
            // 마감 전 ACK 수신이 확정의 유일한 조건이다. 이 검사가 없으면 늦은
            // ACK가 소급 확정으로 통과한다(`POL-02-R-04`, `PRD-01-AC-09`).
            //
            // 마감 값은 **요청이 지목한 생성 record**에서 가져온다. 그 record는
            // 요청의 선언된 의존이므로 여기까지 온 event에는 항상 있고, 값이
            // 도착 순서에 흔들리지 않는다. 장부 전체에서 최소 마감을 찾으면
            // 그 시점까지 받은 생성 record에만 의존하므로, 마감을 줄여 잡은
            // 두 번째 record가 늦게 온 Peer와 먼저 온 Peer의 **장부가 갈린다.**
            // 전체 집합의 최소 마감 판정은 `ProjectionReducer`가 소유한다.
            guard let deadline = declaredOrderDeadlineMinute(ofRequest: request) else { return .scopeMismatch }
            guard ackReceivedAtMinute < deadline else { return .confirmationAfterDeadline }
            // 수신 시각만 보면 마감 뒤에 작성한 record가 "마감 전에 받았다"고
            // 자기 신고하는 것만으로 통과한다. record 자신의 작성 시각도
            // 마감 전이어야 한다. 이 값은 14:30 게이트가 이미 쓰는 값이므로
            // `PRD-01-SP-03`의 시계 결정과 무관하게 지금 검사할 수 있다.
            guard event.occurredAtMinute < deadline else { return .confirmationWrittenAfterDeadline }
            return nil

        case .participationFailure(let requestID, _):
            if let mismatch = sameRoom(event, as: requestID) { return mismatch }
            guard let request = validated[requestID] else { return .scopeMismatch }
            guard case .participationRequest = request.kind else { return .failureTargetIsNotRequest }
            guard request.authorUser == event.authorUser else { return .recordOwnedByOtherUser }
            // 실패는 종결이므로(불변식 25) 사용자 ID만 보면 같은 ID를 주장하는
            // 다른 기기가 확정 참여를 영구 실패로 뒤집는다. 해소 event가 없어
            // 그 Room의 주문 완료가 그대로 막힌다. 요청 기기만 자기 요청의
            // 실패를 기록할 수 있다(불변식 20과 같은 근거).
            guard request.authorDevice == event.authorDevice else { return .recordOwnedByOtherDevice }
            return nil

        case .participationWithdrawal(let confirmationID):
            if let mismatch = sameRoom(event, as: confirmationID) { return mismatch }
            guard let confirmation = validated[confirmationID] else { return .scopeMismatch }
            guard confirmation.authorUser == event.authorUser else { return .recordOwnedByOtherUser }
            // 철회도 같은 이유로 기기까지 본다. 확정 참여를 되돌리는 tombstone은
            // 그 confirmation을 만든 기기만 만들 수 있다.
            guard confirmation.authorDevice == event.authorDevice else { return .recordOwnedByOtherDevice }
            // 대상 종류를 보지 않으면 검증되지 않은 tombstone이 철회 집합에 들어간다.
            guard case .participationConfirmation = confirmation.kind else {
                return .withdrawalTargetIsNotConfirmation
            }
            return nil

        case .duplicateParticipationSelection(let keptConfirmation, let supersededConfirmations):
            // 일일 세션 scope 이벤트이므로 Room 일치를 요구하지 않는다. 대신
            // 참조가 같은 운영일인지는 확인해야 한다.
            guard event.room == nil else { return .scopeMismatch }
            for referenced in [keptConfirmation] + supersededConfirmations {
                guard let confirmation = validated[referenced] else { return .scopeMismatch }
                guard confirmation.daySession == event.daySession else { return .scopeMismatch }
                guard confirmation.authorUser == event.authorUser else { return .recordOwnedByOtherUser }
                // 선택은 철회와 같은 종결 효과를 낸다 — 지목되지 않은 Room의
                // 참여가 `supersededByUserSelection`으로 무효화되고 그 메뉴가
                // `revoked`가 되며, 그 사이 `확인 필요` 차단까지 사라진다.
                // 사용자 ID만 보면 같은 ID를 주장하는 다른 기기가 남의 확정
                // 참여와 메뉴를 아무 신호 없이 주문에서 제거할 수 있다.
                // 불변식 20·25와 같은 근거로 기기까지 본다.
                guard confirmation.authorDevice == event.authorDevice else {
                    return .recordOwnedByOtherDevice
                }
                guard case .participationConfirmation = confirmation.kind else { return .scopeMismatch }
            }
            return nil

        case .menuRevision(_, let revision, let parent, let supersedes, let authority):
            if let reason = writeAuthority(for: event, authority: authority) { return reason }
            // 버릴 분기 head도 본인·같은 Room의 메뉴여야 한다. 이 검사가 없으면
            // 남의 메뉴 head를 지목하는 event가 검증 장부에 들어가 재전파된다.
            for droppedHead in supersedes {
                if let mismatch = sameRoom(event, as: droppedHead) { return mismatch }
                guard let dropped = validated[droppedHead] else { return .scopeMismatch }
                guard dropped.authorUser == event.authorUser else { return .recordOwnedByOtherUser }
                guard dropped.authorDevice == event.authorDevice else { return .recordOwnedByOtherDevice }
                guard case .menuRevision = dropped.kind else { return .scopeMismatch }
            }
            if let parent {
                if let mismatch = sameRoom(event, as: parent) { return mismatch }
                guard let parentEvent = validated[parent] else { return .scopeMismatch }
                guard parentEvent.authorUser == event.authorUser else { return .menuAuthorIsNotOwner }
                // 기기를 보지 않으면 같은 ID를 주장하는 다른 기기가 남의 메뉴에
                // 리비전을 이어 붙여 head를 조용히 교체한다. 분기가 아니므로
                // `확인 필요`도 붙지 않는다.
                guard parentEvent.authorDevice == event.authorDevice else {
                    return .recordOwnedByOtherDevice
                }
                guard case .menuRevision(_, let parentRevision, _, _, _) = parentEvent.kind,
                      revision == parentRevision + 1 else {
                    return .menuRevisionNotSequential
                }
            } else if revision != 1 {
                return .menuRevisionNotSequential
            }
            return nil

        case .orderCompleted(let roomRecord, let authority, _):
            if let mismatch = sameRoom(event, as: roomRecord) { return mismatch }
            // `POL-01-R-04` 권한 표는 주문 완료·되돌리기를 "방 참여자 누구나"로
            // 한정한다. 권한 record를 event가 직접 지목하게 해야 순서가 뒤집혀
            // 도착해도 "권한 없음"과 "의존 record 부족"을 구분할 수 있다.
            return writeAuthority(for: event, authority: authority, missing: .orderEventWithoutParticipation)

        case .orderReverted(let roomRecord, let authority):
            if let mismatch = sameRoom(event, as: roomRecord) { return mismatch }
            return writeAuthority(for: event, authority: authority, missing: .orderEventWithoutParticipation)

        case .roomCancelled(let roomRecord):
            if let mismatch = sameRoom(event, as: roomRecord) { return mismatch }
            guard let room = validated[roomRecord] else { return .scopeMismatch }
            // 대상 종류를 보지 않으면 "생성자만 취소한다"가 "그 Room에 자기
            // record를 하나라도 가진 사람은 누구나 취소한다"가 된다. 자기
            // `participationRequest`를 지목하는 것만으로 작성자 검사가 통과한다.
            guard case .roomCreated = room.kind else { return .cancellationTargetIsNotRoomRecord }
            // `POL-01-R-04` 권한 표는 전체 취소를 Room 생성자에게만 허용한다.
            // 다만 여기서 볼 수 있는 것은 **참조된 생성 record의 작성자**까지다.
            // 같은 Room ID로 자기 생성 record를 심으면 이 검사를 통과하므로,
            // 정본 생성자와 대조하는 판정은 전체 검증 집합을 보는 reducer가
            // 소유한다. 생성자가 현재 참여 중인지와 주문 상태가 `진행 중`인지도
            // projection 상태이므로 여기서 판정하지 않는다.
            guard room.authorUser == event.authorUser else { return .cancellationByNonCreator }
            return nil
        }
    }

    /// 이 사용자가 이 Room에 쓸 수 있다는 근거 record를 검증한다.
    ///
    /// 일반 경로에서는 자신의 confirmation record, never-shared 단독 Room
    /// 예외에서는 자신이 만든 `roomCreated`가 근거다.
    private func writeAuthority(
        for event: LedgerEvent,
        authority: EventID,
        missing: RejectionReason = .menuAuthorIsNotOwner
    ) -> RejectionReason? {
        if let mismatch = sameRoom(event, as: authority) { return mismatch }
        guard let authorityEvent = validated[authority] else { return .scopeMismatch }
        guard authorityEvent.authorUser == event.authorUser else { return missing }
        // 권한 record도 같은 기기가 만든 것이어야 한다. `POL-03-R-02`가 사용자
        // ID와 설치·기기를 1:1로 묶으므로 기기 불일치는 언제나 사칭이다.
        guard authorityEvent.authorDevice == event.authorDevice else { return missing }
        switch authorityEvent.kind {
        case .participationConfirmation, .roomCreated:
            return nil
        default:
            return missing == .menuAuthorIsNotOwner ? .menuAuthorityDoesNotGrantWrite : missing
        }
    }

    private func sameRoom(_ event: LedgerEvent, as referenceID: EventID) -> RejectionReason? {
        guard let reference = validated[referenceID] else { return .scopeMismatch }
        guard reference.room == event.room, reference.daySession == event.daySession else {
            return .scopeMismatch
        }
        return nil
    }

    /// 참여 요청이 **선언한** 생성 record의 주문 마감 시각.
    ///
    /// 의존 chain이 `roomCreated`까지 이어지므로 여기까지 온 요청은 그 record를
    /// 이미 보유한다. 값이 없으면 chain이 깨진 것이고 정책 판정을 할 수 없다.
    ///
    /// 이 값은 **다른 생성 record가 몇 개 도착했는지와 무관**하다. 그래서 같은
    /// event가 어느 Peer에서나 같게 판정된다. 마감을 늘려 잡은 record를 지목한
    /// 요청은 이 단계에서 통과하지만, 전체 집합의 최소 마감으로 다시 거르는
    /// `ProjectionReducer`가 확정으로 승격시키지 않는다.
    private func declaredOrderDeadlineMinute(ofRequest request: LedgerEvent) -> Int? {
        guard case .participationRequest(let roomRecord) = request.kind,
              let record = validated[roomRecord],
              case .roomCreated(_, let deadline) = record.kind else {
            return nil
        }
        return deadline
    }

    /// 한 Room의 유효 마감 시각. 중복 `roomCreated`에는 가장 이른 값을 쓴다.
    static func earliestOrderDeadlineMinute(
        in events: some Sequence<LedgerEvent>,
        room: RoomID
    ) -> Int? {
        events.compactMap { event -> Int? in
            guard event.room == room, case .roomCreated(_, let deadline) = event.kind else { return nil }
            return deadline
        }.min()
    }

    /// 한 Room의 `roomCreated` record 전체를 결정적 순서로 반환한다.
    static func roomRecords(in events: some Sequence<LedgerEvent>, room: RoomID) -> [LedgerEvent] {
        events.filter { event in
            guard event.room == room, case .roomCreated = event.kind else { return false }
            return true
        }.sorted(by: LedgerEvent.deterministicOrder)
    }
}
