import Foundation
import Testing

@testable import SP02ReplicationCore

/// 장부 수신 계약.
///
/// 여기서 통과한 이벤트만 요약·StorageACK·projection에 들어가므로, 이 검증이
/// 관대해지면 스파이크의 모든 결론이 무너진다.
@Suite("SP-02 장부 수신 계약")
struct LedgerTests {
    private let base = BaseRoom()

    private func ledgerWithBaseRoom() -> Ledger {
        var ledger = Ledger()
        for event in base.all.sorted(by: LedgerEvent.deterministicOrder) {
            ledger.receive(event)
        }
        return ledger
    }

    @Test("같은 ID·같은 payload를 다시 받으면 재적용하지 않고 멱등 처리한다")
    func duplicateIsIdempotent() {
        var ledger = ledgerWithBaseRoom()
        let before = ledger.validated.count
        #expect(ledger.receive(base.menuU2) == .duplicateIdempotent)
        #expect(ledger.validated.count == before)
    }

    @Test("같은 ID에 다른 payload가 오면 정상 중복으로 인정하지 않고 격리한다")
    func sameIDDifferentPayloadIsQuarantined() {
        var ledger = ledgerWithBaseRoom()
        let forged = makeEvent(
            "E09", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 9, at: 676,
            kind: .menuRevision(
                items: ["다른 내용"], revision: 1, parent: nil, supersedes: [], authority: EventID("E05")
            )
        )
        guard case .integrityConflict = ledger.receive(forged) else {
            Issue.record("같은 ID·다른 payload를 무결성 충돌로 분류하지 않았다")
            return
        }
        #expect(ledger.quarantined[EventID("E09")]?.count == 1)
        // 기존 저장분은 그대로 남는다. 뒤에 온 payload가 덮지 않는다.
        #expect(ledger.validated[EventID("E09")] == base.menuU2)
    }

    @Test("pending 구간의 envelope도 payload 교체 창이 되지 않는다")
    func pendingEnvelopeCannotBeSwapped() {
        var ledger = Ledger()
        // 의존 record가 없으므로 pending에 들어간다.
        guard case .pendingDependency = ledger.receive(base.menuU2) else {
            Issue.record("의존 record가 없는 event를 pending으로 보호하지 않았다")
            return
        }
        let forged = makeEvent(
            "E09", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 9, at: 676,
            kind: .menuRevision(
                items: ["다른 내용"], revision: 1, parent: nil, supersedes: [], authority: EventID("E05")
            )
        )
        guard case .integrityConflict = ledger.receive(forged) else {
            Issue.record("pending 구간에서 payload 교체를 허용했다")
            return
        }
    }

    @Test("의존 record가 없는 event는 폐기하지 않고 보호했다가 승격한다")
    func pendingEventIsPromotedAfterDependencies() {
        var ledger = Ledger()
        // 완전히 뒤집힌 순서로 넣는다.
        for event in base.all.sorted(by: LedgerEvent.deterministicOrder).reversed() {
            ledger.receive(event)
        }
        #expect(ledger.pending.isEmpty)
        #expect(ledger.rejected.isEmpty)
        #expect(ledger.validated.count == base.all.count)
    }

    @Test("pending event가 있으면 부족한 의존 record ID를 식별할 수 있다")
    func missingDependenciesAreIdentifiable() {
        var ledger = Ledger()
        ledger.receive(base.confirmationU2)
        #expect(ledger.pending.count == 1)
        #expect(ledger.missingDependencyIDs == [EventID("E03"), EventID("E04")])
    }

    @Test("pending payload는 장부 요약에 들어가지 않는다")
    func summaryExcludesPending() {
        var ledger = Ledger()
        ledger.receive(base.confirmationU2)
        let summary = LedgerSummary(ledger: ledger)
        #expect(summary.scopes.isEmpty)
    }

    @Test("14:30 쓰기 종료 뒤 생성된 이벤트는 복제돼도 장부에 넣지 않는다")
    func writeAfterDailyCloseIsRejected() {
        var ledger = ledgerWithBaseRoom()
        let afterClose = makeEvent(
            "E90", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1,
            order: 90, at: DaySchedule.writeCloseMinute,
            kind: .menuRevision(
                items: ["늦은 메뉴"], revision: 2, parent: EventID("E09"), supersedes: [],
                authority: EventID("E05")
            )
        )
        #expect(ledger.receive(afterClose) == .rejected(reason: .writeAfterDailyClose))
    }

    @Test("요청 기기가 스스로 만든 수락 evidence는 원격 ACK가 아니다")
    func selfAcceptanceIsRejected() {
        var ledger = ledgerWithBaseRoom()
        let selfAcceptance = makeEvent(
            "E91", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 91, at: 677,
            kind: .participationAcceptance(requestID: EventID("E03"))
        )
        #expect(ledger.receive(selfAcceptance) == .rejected(reason: .acceptanceBySameDevice))
    }

    @Test("마감 뒤에 받은 ACK로 만든 confirmation은 거부한다")
    func confirmationAfterDeadlineIsRejected() {
        var ledger = ledgerWithBaseRoom()
        let lateRequest = makeEvent(
            "E92", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 92, at: 715,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let acceptance = makeEvent(
            "E93", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 93, at: 717,
            kind: .participationAcceptance(requestID: EventID("E92"))
        )
        let lateConfirmation = makeEvent(
            "E94", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 94, at: 725,
            kind: .participationConfirmation(
                requestID: EventID("E92"), acceptanceID: EventID("E93"), ackReceivedAtMinute: 725
            )
        )
        ledger.receive(lateRequest)
        ledger.receive(acceptance)
        #expect(ledger.receive(lateConfirmation) == .rejected(reason: .confirmationAfterDeadline))
    }

    @Test("다른 사용자가 만든 confirmation record는 거부한다")
    func confirmationByOtherUserIsRejected() {
        var ledger = ledgerWithBaseRoom()
        let forged = makeEvent(
            "E95", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 95, at: 677,
            kind: .participationConfirmation(
                requestID: EventID("E03"), acceptanceID: EventID("E04"), ackReceivedAtMinute: 670
            )
        )
        #expect(ledger.receive(forged) == .rejected(reason: .recordOwnedByOtherUser))
    }

    @Test("본인이 아닌 사용자의 메뉴 리비전은 거부한다")
    func menuByOtherUserIsRejected() {
        var ledger = ledgerWithBaseRoom()
        let forged = makeEvent(
            "E96", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 96, at: 678,
            kind: .menuRevision(
                items: ["남의 메뉴"], revision: 1, parent: nil, supersedes: [], authority: EventID("E05")
            )
        )
        #expect(ledger.receive(forged) == .rejected(reason: .menuAuthorIsNotOwner))
    }

    @Test("parent 다음 값이 아닌 리비전 번호는 거부한다")
    func nonSequentialRevisionIsRejected() {
        var ledger = ledgerWithBaseRoom()
        let skipped = makeEvent(
            "E97", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 97, at: 679,
            kind: .menuRevision(
                items: ["건너뛴 리비전"], revision: 5, parent: EventID("E09"), supersedes: [],
                authority: EventID("E05")
            )
        )
        #expect(ledger.receive(skipped) == .rejected(reason: .menuRevisionNotSequential))
    }

    @Test("참여 record 없이 메뉴를 쓰려는 event는 권한 근거가 없어 거부한다")
    func menuWithoutParticipationAuthorityIsRejected() {
        var ledger = ledgerWithBaseRoom()
        // 권한 근거로 자신의 참여 요청 record를 제시한다. 요청은 확정이 아니다.
        let forged = makeEvent(
            "E98", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 98, at: 679,
            kind: .menuRevision(
                items: ["권한 없는 메뉴"], revision: 1, parent: nil, supersedes: [],
                authority: EventID("E03")
            )
        )
        #expect(ledger.receive(forged) == .rejected(reason: .menuAuthorityDoesNotGrantWrite))
    }

    @Test("장부 요약은 일일 세션·Room·데이터 종류 scope를 구분한다")
    func summarySeparatesScopes() {
        let ledger = ledgerWithBaseRoom()
        let summary = LedgerSummary(ledger: ledger)
        let kinds = Set(summary.scopes.keys.map(\.kind))
        #expect(kinds == [.roomInfo, .participation, .menu])
        #expect(summary.scopes.keys.allSatisfy { $0.daySession == FixtureBase.daySession })
    }

    @Test("한쪽에만 있는 scope는 요약 일치로 보지 않는다")
    func missingScopeIsNotAMatch() {
        let full = LedgerSummary(ledger: ledgerWithBaseRoom())
        var partialLedger = Ledger()
        partialLedger.receive(base.roomCreated)
        let partial = LedgerSummary(ledger: partialLedger)
        #expect(full.matchesEveryScope(of: partial) == false)
        #expect(partial.missing(comparedTo: full).isEmpty == false)
    }

    // MARK: - 권한 계약

    @Test("참여 권한 record가 없는 사용자의 주문 완료는 거부한다")
    func orderCompletionByNonParticipantIsRejected() {
        // `POL-01-R-04` 권한 표는 주문 완료·되돌리기를 방 참여자로 한정한다.
        var ledger = ledgerWithBaseRoom()
        let snapshot = OrderSnapshot(
            participants: [FixtureBase.u1, FixtureBase.u2],
            menuHeads: [FixtureBase.u1: EventID("E08"), FixtureBase.u2: EventID("E09")]
        )
        let outsider = makeEvent(
            "E50", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 50, at: 700,
            kind: .orderCompleted(
                roomRecord: EventID("E01"), authority: EventID("E05"), snapshot: snapshot
            )
        )
        #expect(ledger.receive(outsider) == .rejected(reason: .orderEventWithoutParticipation))
        #expect(ProjectionReducer
            .reduce(daySession: FixtureBase.daySession, ledger: ledger)
            .rooms[FixtureBase.r1]?.orderState == .inProgress)
    }

    @Test("참여 권한 record가 없는 사용자의 주문 되돌리기도 거부한다")
    func orderRevertByNonParticipantIsRejected() {
        var ledger = ledgerWithBaseRoom()
        let outsider = makeEvent(
            "E51", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 51, at: 700,
            kind: .orderReverted(roomRecord: EventID("E01"), authority: EventID("E05"))
        )
        #expect(ledger.receive(outsider) == .rejected(reason: .orderEventWithoutParticipation))
    }

    @Test("생성자가 아닌 사용자의 Room 취소는 거부한다")
    func cancellationByNonCreatorIsRejected() {
        // 이 검사가 없으면 아무 Peer나 만든 tombstone에 모든 Peer가 결정적으로
        // 수렴해 Room 전체가 복구 경로 없이 사라진다.
        var ledger = ledgerWithBaseRoom()
        let outsider = makeEvent(
            "E52", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 52, at: 700,
            kind: .roomCancelled(roomRecord: EventID("E01"))
        )
        #expect(ledger.receive(outsider) == .rejected(reason: .cancellationByNonCreator))
        #expect(ProjectionReducer
            .reduce(daySession: FixtureBase.daySession, ledger: ledger)
            .rooms[FixtureBase.r1]?.cancelled == false)
    }

    @Test("같은 사용자 ID를 주장하는 다른 기기의 참여 실패 record는 거부한다")
    func failureFromAnotherDeviceIsRejected() {
        // 실패는 종결이므로(불변식 25) 사용자 ID만 보면 다른 기기가 확정 참여를
        // 영구 실패로 뒤집는다. 실패를 해소하는 event가 없어 그 Room의 주문
        // 완료가 그대로 막힌다.
        var ledger = ledgerWithBaseRoom()
        let injected = makeEvent(
            "E58", user: FixtureBase.u2, device: FixtureBase.d3, room: FixtureBase.r1, order: 58, at: 700,
            kind: .participationFailure(requestID: EventID("E03"), reason: .acknowledgementMissedDeadline)
        )
        #expect(ledger.receive(injected) == .rejected(reason: .recordOwnedByOtherDevice))
        #expect(ProjectionReducer
            .reduce(daySession: FixtureBase.daySession, ledger: ledger)
            .rooms[FixtureBase.r1]?
            .participants[FixtureBase.u2] == .confirmed(confirmation: EventID("E05")))
    }

    @Test("같은 사용자 ID를 주장하는 다른 기기의 철회 tombstone은 거부한다")
    func withdrawalFromAnotherDeviceIsRejected() {
        var ledger = ledgerWithBaseRoom()
        let injected = makeEvent(
            "E59", user: FixtureBase.u2, device: FixtureBase.d3, room: FixtureBase.r1, order: 59, at: 700,
            kind: .participationWithdrawal(confirmationID: EventID("E05"))
        )
        #expect(ledger.receive(injected) == .rejected(reason: .recordOwnedByOtherDevice))
        #expect(ProjectionReducer
            .reduce(daySession: FixtureBase.daySession, ledger: ledger)
            .rooms[FixtureBase.r1]?
            .participants[FixtureBase.u2] == .confirmed(confirmation: EventID("E05")))
    }

    @Test("수락·실패 대상이 참여 요청 record가 아니면 거부한다")
    func acceptanceAndFailureTargetsMustBeRequests() {
        // 종류를 보지 않으면 참여 요청이 아닌 record 위에 세운 수락·확정이
        // 장부에 남고 `writeAuthority`가 그 confirmation을 권한으로 받아들인다.
        var ledger = ledgerWithBaseRoom()
        let acceptanceOnMenu = makeEvent(
            "E5A", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 60, at: 700,
            kind: .participationAcceptance(requestID: EventID("E09"))
        )
        let failureOnMenu = makeEvent(
            "E5B", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 61, at: 701,
            kind: .participationFailure(requestID: EventID("E09"), reason: .acknowledgementMissedDeadline)
        )
        #expect(ledger.receive(acceptanceOnMenu) == .rejected(reason: .acceptanceTargetIsNotRequest))
        #expect(ledger.receive(failureOnMenu) == .rejected(reason: .failureTargetIsNotRequest))
    }

    @Test("취소 대상이 생성 record가 아니면 자기 record를 지목해도 거부한다")
    func cancellationTargetMustBeARoomRecord() {
        // 작성자만 보고 종류를 보지 않으면 "생성자만 취소한다"가 "그 Room에 자기
        // record를 하나라도 가진 사람은 누구나 취소한다"가 된다. U2는 생성자가
        // 아니지만 자기 참여 요청 `E03`을 가지고 있다.
        var ledger = ledgerWithBaseRoom()
        let onOwnRequest = makeEvent(
            "E55", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 55, at: 700,
            kind: .roomCancelled(roomRecord: EventID("E03"))
        )
        #expect(ledger.receive(onOwnRequest) == .rejected(reason: .cancellationTargetIsNotRoomRecord))
        #expect(ProjectionReducer
            .reduce(daySession: FixtureBase.daySession, ledger: ledger)
            .rooms[FixtureBase.r1]?.cancelled == false)
    }

    @Test("심은 생성 record를 지목한 취소는 장부 검증만으로는 막지 못한다")
    func cancellationOnPlantedRoomRecordPassesLedgerValidation() {
        // `roomCreated`는 누구나 만들 수 있어야 하므로 작성자 검증이 없다.
        // 장부가 볼 수 있는 것은 "참조된 생성 record의 작성자"까지이므로 이
        // 취소는 append된다. 정본 생성자와 대조하는 판정은 전체 검증 집합을
        // 보는 reducer가 소유한다. 이 테스트는 그 경계를 고정한다.
        var ledger = ledgerWithBaseRoom()
        let planted = makeEvent(
            "E56", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 56, at: 700,
            kind: .roomCreated(store: "S9", orderDeadlineMinute: 860)
        )
        let cancellation = makeEvent(
            "E57", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 57, at: 701,
            kind: .roomCancelled(roomRecord: EventID("E56"))
        )
        #expect(ledger.receive(planted) == .appended)
        #expect(ledger.receive(cancellation) == .appended)
        #expect(ProjectionReducer
            .reduce(daySession: FixtureBase.daySession, ledger: ledger)
            .rooms[FixtureBase.r1]?.cancelled == false)
    }

    @Test("생성자의 Room 취소는 허용한다")
    func cancellationByCreatorIsAccepted() {
        var ledger = ledgerWithBaseRoom()
        let cancellation = makeEvent(
            "E53", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 53, at: 700,
            kind: .roomCancelled(roomRecord: EventID("E01"))
        )
        #expect(ledger.receive(cancellation) == .appended)
    }

    @Test("남의 메뉴 head를 버리려는 리비전은 거부한다")
    func supersedingAnotherUsersHeadIsRejected() {
        var ledger = ledgerWithBaseRoom()
        let crossUser = makeEvent(
            "E54", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 54, at: 700,
            kind: .menuRevision(
                items: ["M1-x"], revision: 2, parent: EventID("E08"), supersedes: [EventID("E09")],
                authority: EventID("E07")
            )
        )
        #expect(ledger.receive(crossUser) == .rejected(reason: .recordOwnedByOtherUser))
    }

    @Test("같은 사용자가 기기만 바꿔 자기 요청을 수락하면 거부한다")
    func selfAcceptanceFromAnotherDeviceIsRejected() {
        // 기기만 보면 같은 사용자 ID를 주장하는 두 번째 기기가 자기 참여를
        // 스스로 확정할 수 있다.
        var ledger = ledgerWithBaseRoom()
        let sameUserAcceptance = makeEvent(
            "E55", user: FixtureBase.u2, device: DeviceID("D9"), room: FixtureBase.r1, order: 55, at: 700,
            kind: .participationAcceptance(requestID: EventID("E03"))
        )
        #expect(ledger.receive(sameUserAcceptance) == .rejected(reason: .acceptanceBySameUser))
    }

    @Test("거부된 event ID에 다른 payload를 실어 다시 보내면 격리한다")
    func rejectedIDCannotBeReusedWithAnotherPayload() {
        // 거부가 그 ID를 빈자리로 남기면, 같은 ID에 다른 내용을 다시 실어 보내는
        // 것만으로 검증을 통과시킬 수 있다.
        var ledger = ledgerWithBaseRoom()
        let rejectedFirst = makeEvent(
            "E56", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 56, at: 700,
            kind: .menuRevision(
                items: ["남의 메뉴"], revision: 1, parent: nil, supersedes: [], authority: EventID("E05")
            )
        )
        #expect(ledger.receive(rejectedFirst) == .rejected(reason: .menuAuthorIsNotOwner))
        let sameIDDifferentPayload = makeEvent(
            "E56", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 56, at: 700,
            kind: .menuRevision(
                items: ["내 메뉴"], revision: 2, parent: EventID("E08"), supersedes: [], authority: EventID("E07")
            )
        )
        guard case .integrityConflict = ledger.receive(sameIDDifferentPayload) else {
            Issue.record("거부된 ID를 다른 payload로 재사용할 수 있었다")
            return
        }
        #expect(ledger.validated[EventID("E56")] == nil)
    }

    // MARK: - 중복 Room 생성 record

    @Test("중복 생성 record가 있으면 가장 이른 마감을 적용한다")
    func duplicateRoomRecordUsesEarliestDeadline() {
        // 늘려 잡은 마감이 이기면 소급 확정 차단이 뚫린다.
        var ledger = ledgerWithBaseRoom()
        let forgedRoomRecord = makeEvent(
            "E60", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 60, at: 700,
            kind: .roomCreated(store: "S9", orderDeadlineMinute: 860)
        )
        ledger.receive(forgedRoomRecord)
        let request = makeEvent(
            "E61", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 61, at: 701,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let acceptance = makeEvent(
            "E62", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 62, at: 702,
            kind: .participationAcceptance(requestID: EventID("E61"))
        )
        let lateConfirmation = makeEvent(
            "E63", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 63, at: 726,
            kind: .participationConfirmation(
                requestID: EventID("E61"), acceptanceID: EventID("E62"), ackReceivedAtMinute: 725
            )
        )
        ledger.receive(request)
        ledger.receive(acceptance)
        #expect(ledger.receive(lateConfirmation) == .rejected(reason: .confirmationAfterDeadline))
    }

    @Test("중복 생성 record에서 마감 판정이 도착 순서에 흔들리지 않는다")
    func duplicateRoomRecordDeadlineIsOrderIndependent() {
        // 정렬 없는 사전 순회로 "첫 일치"를 고르면 같은 입력이 실행마다 다른
        // 마감을 적용한다.
        let forgedRoomRecord = makeEvent(
            "E60", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 60, at: 700,
            kind: .roomCreated(store: "S9", orderDeadlineMinute: 860)
        )
        let request = makeEvent(
            "E61", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 61, at: 701,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let acceptance = makeEvent(
            "E62", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 62, at: 702,
            kind: .participationAcceptance(requestID: EventID("E61"))
        )
        let lateConfirmation = makeEvent(
            "E63", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 63, at: 726,
            kind: .participationConfirmation(
                requestID: EventID("E61"), acceptanceID: EventID("E62"), ackReceivedAtMinute: 725
            )
        )
        let events = base.all + [forgedRoomRecord, request, acceptance, lateConfirmation]
        var outcomes: Set<String> = []
        var deadlines: Set<Int> = []
        for arrival in [events, events.reversed(), events.sorted(by: LedgerEvent.deterministicOrder)] {
            var ledger = Ledger()
            for event in arrival { ledger.receive(event) }
            outcomes.insert(ledger.rejected[EventID("E63")]?.rawValue ?? "VALIDATED")
            let room = ProjectionReducer
                .reduce(daySession: FixtureBase.daySession, ledger: ledger)
                .rooms[FixtureBase.r1]
            deadlines.insert(room?.orderDeadlineMinute ?? -1)
        }
        #expect(outcomes == [RejectionReason.confirmationAfterDeadline.rawValue])
        #expect(deadlines == [720])
    }

    @Test("confirmation이 아닌 record를 지목한 철회는 거부한다")
    func withdrawalOfNonConfirmationIsRejected() {
        var ledger = ledgerWithBaseRoom()
        let bogus = makeEvent(
            "E64", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 64, at: 700,
            kind: .participationWithdrawal(confirmationID: EventID("E09"))
        )
        #expect(ledger.receive(bogus) == .rejected(reason: .withdrawalTargetIsNotConfirmation))
    }
}
