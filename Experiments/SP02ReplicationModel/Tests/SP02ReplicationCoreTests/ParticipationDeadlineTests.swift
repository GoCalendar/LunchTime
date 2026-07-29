import Foundation
import Testing

@testable import SP02ReplicationCore

/// 마감 경계의 참여 확정 계약.
///
/// `PRD-01-AC-09`와 `POL-02-R-04` 4.1이 정한 세 결과를 구분한다.
/// 1. 마감 전 ACK를 받은 참여는 늦게 전파돼도 유효하다.
/// 2. 마감까지 ACK를 받지 못한 요청은 영구 실패다.
/// 3. 마감 뒤 처음 받은 ACK로 소급 확정하지 않는다.
@Suite("SP-02 마감과 늦은 전파")
struct ParticipationDeadlineTests {
    private func ledger(_ events: [LedgerEvent]) -> Ledger {
        var ledger = Ledger()
        for event in events { ledger.receive(event) }
        return ledger
    }

    private func room(_ events: [LedgerEvent]) -> RoomProjection? {
        ProjectionReducer
            .reduce(daySession: FixtureBase.daySession, ledger: ledger(events))
            .rooms[FixtureBase.r1]
    }

    private var roomCreated: LedgerEvent {
        makeEvent(
            "E01", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 1, at: 665,
            kind: .roomCreated(store: "S1", orderDeadlineMinute: 720)
        )
    }

    /// 마감 1분 전 ACK를 받아 확정한 참여.
    private var confirmedBeforeDeadline: [LedgerEvent] {
        [
            makeEvent(
                "E10", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 10, at: 715,
                kind: .participationRequest(roomRecord: EventID("E01"))
            ),
            makeEvent(
                "E11", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 11, at: 717,
                kind: .participationAcceptance(requestID: EventID("E10"))
            ),
            makeEvent(
                "E12", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 12, at: 719,
                kind: .participationConfirmation(
                    requestID: EventID("E10"), acceptanceID: EventID("E11"), ackReceivedAtMinute: 719
                )
            )
        ]
    }

    @Test("마감 전 ACK로 확정한 참여는 confirmation이 가장 늦게 도착해도 유효하다")
    func lateArrivalOfPreDeadlineConfirmationStaysValid() {
        // confirmation을 맨 마지막에 넣어 늦은 전파를 만든다.
        let events = [roomCreated] + confirmedBeforeDeadline
        let lateArrival = [roomCreated, confirmedBeforeDeadline[0], confirmedBeforeDeadline[1], confirmedBeforeDeadline[2]]
        let reversedArrival = Array(events.reversed())
        #expect(room(lateArrival)?.participants[FixtureBase.u2] == .confirmed(confirmation: EventID("E12")))
        #expect(room(reversedArrival)?.participants[FixtureBase.u2] == .confirmed(confirmation: EventID("E12")))
    }

    @Test("마감까지 ACK를 받지 못한 요청은 영구 실패다")
    func missedAcknowledgementIsPermanentFailure() {
        let request = makeEvent(
            "E13", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 13, at: 716,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let failure = makeEvent(
            "E15", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 15, at: 719,
            kind: .participationFailure(requestID: EventID("E13"), reason: .acknowledgementMissedDeadline)
        )
        #expect(room([roomCreated, request, failure])?.participants[FixtureBase.u3]
            == .failed(.acknowledgementMissedDeadline))
    }

    @Test("마감 뒤 처음 받은 ACK로 소급 확정하지 않는다")
    func lateAcknowledgementDoesNotRetroactivelyConfirm() {
        let request = makeEvent(
            "E13", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 13, at: 716,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let acceptance = makeEvent(
            "E14", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 14, at: 718,
            kind: .participationAcceptance(requestID: EventID("E13"))
        )
        let failure = makeEvent(
            "E15", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 15, at: 719,
            kind: .participationFailure(requestID: EventID("E13"), reason: .acknowledgementMissedDeadline)
        )
        let lateConfirmation = makeEvent(
            "E16", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 16, at: 725,
            kind: .participationConfirmation(
                requestID: EventID("E13"), acceptanceID: EventID("E14"), ackReceivedAtMinute: 725
            )
        )
        let events = [roomCreated, request, acceptance, failure, lateConfirmation]
        let store = ledger(events)
        #expect(store.rejected[EventID("E16")] == .confirmationAfterDeadline)
        #expect(ProjectionReducer
            .reduce(daySession: FixtureBase.daySession, ledger: store)
            .rooms[FixtureBase.r1]?
            .participants[FixtureBase.u3] == .failed(.acknowledgementMissedDeadline))
    }

    @Test("request와 acceptance만 있으면 확정이 아니라 확인 필요다")
    func requestAndAcceptanceAloneAreNotConfirmed() {
        let request = makeEvent(
            "E10", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 10, at: 700,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let acceptance = makeEvent(
            "E11", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 11, at: 701,
            kind: .participationAcceptance(requestID: EventID("E10"))
        )
        #expect(room([roomCreated, request, acceptance])?.participants[FixtureBase.u2]
            == .awaitingAcknowledgement)
    }

    @Test("확정 참여를 철회했다가 다시 요청해 확정하면 확정이 유지된다")
    func reconfirmationAfterWithdrawalWins() {
        // 실패·철회를 확정보다 앞세우면 재요청으로 확정된 참여가 사라진다.
        let withdrawal = makeEvent(
            "E17", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 17, at: 700,
            kind: .participationWithdrawal(confirmationID: EventID("E12"))
        )
        let retryRequest = makeEvent(
            "E18", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 18, at: 701,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let retryAcceptance = makeEvent(
            "E19", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 19, at: 702,
            kind: .participationAcceptance(requestID: EventID("E18"))
        )
        let retryConfirmation = makeEvent(
            "E1A", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 20, at: 703,
            kind: .participationConfirmation(
                requestID: EventID("E18"), acceptanceID: EventID("E19"), ackReceivedAtMinute: 703
            )
        )
        let events = [roomCreated] + confirmedBeforeDeadline
            + [withdrawal, retryRequest, retryAcceptance, retryConfirmation]
        #expect(room(events)?.participants[FixtureBase.u2] == .confirmed(confirmation: EventID("E1A")))
        #expect(room(Array(events.reversed()))?.participants[FixtureBase.u2]
            == .confirmed(confirmation: EventID("E1A")))
    }

    @Test("마감 뒤에 작성한 confirmation은 수신 시각을 마감 전으로 신고해도 거부한다")
    func confirmationWrittenAfterDeadlineIsRejected() {
        // `ackReceivedAtMinute`만 보면 마감 뒤에 만든 record가 "마감 전에
        // 받았다"고 자기 신고하는 것만으로 통과한다.
        let request = makeEvent(
            "E13", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 13, at: 716,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let acceptance = makeEvent(
            "E14", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 14, at: 718,
            kind: .participationAcceptance(requestID: EventID("E13"))
        )
        let backdated = makeEvent(
            "E16", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 16, at: 725,
            kind: .participationConfirmation(
                requestID: EventID("E13"), acceptanceID: EventID("E14"), ackReceivedAtMinute: 719
            )
        )
        let store = ledger([roomCreated, request, acceptance, backdated])
        #expect(store.rejected[EventID("E16")] == .confirmationWrittenAfterDeadline)
        #expect(room([roomCreated, request, acceptance, backdated])?.participants[FixtureBase.u3]
            == .awaitingAcknowledgement)
    }

    @Test("마감을 줄여 잡은 생성 record는 도착 순서와 무관하게 같은 판정을 만든다")
    func lateArrivingShrunkDeadlineDoesNotSplitVerdicts() {
        // 장부는 그 시점까지 받은 생성 record만 보고 마감을 계산한다. 마감을
        // 줄여 잡은 두 번째 record가 confirmation보다 **늦게** 오면 이미
        // append된 confirmation은 다시 판정되지 않는다. 먼저 받은 Peer는 같은
        // confirmation을 거부하므로, 이 검사가 projection에 없으면 같은 이벤트
        // 집합에서 두 Peer의 결과가 갈린다.
        let base = BaseRoom()
        let shrunk = makeEvent(
            "E80", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 80, at: 700,
            kind: .roomCreated(store: "S9", orderDeadlineMinute: 668)
        )
        // 축소 record가 먼저 도착한 Peer. 장부가 confirmation을 거부한다.
        let recordFirst = [base.roomCreated, shrunk, base.requestU2, base.acceptanceForU2, base.confirmationU2]
        // confirmation이 먼저 도착한 Peer. 장부에 confirmation이 남는다.
        let confirmationFirst = [base.roomCreated, base.requestU2, base.acceptanceForU2, base.confirmationU2, shrunk]

        let early = ledger(recordFirst)
        let late = ledger(confirmationFirst)
        // 장부의 마감 근거는 요청이 선언한 생성 record 하나뿐이므로 두 순서에서
        // 같은 판정이 나온다. 장부가 갈리면 이어지는 메뉴 event까지 한쪽에서만
        // 보류돼 projection이 복구할 수 없는 차이가 남는다.
        #expect(early.rejected.isEmpty)
        #expect(late.rejected.isEmpty)
        #expect(Set(early.validated.keys) == Set(late.validated.keys))

        let earlyProjection = ProjectionReducer.reduce(daySession: FixtureBase.daySession, ledger: early)
        let lateProjection = ProjectionReducer.reduce(daySession: FixtureBase.daySession, ledger: late)
        #expect(earlyProjection.hash == lateProjection.hash)
        for result in [earlyProjection, lateProjection] {
            let room = result.rooms[FixtureBase.r1]
            // 확정을 내리는 것은 장부가 아니라 정본 마감으로 다시 거르는 reducer다.
            #expect(room?.orderDeadlineMinute == 668)
            #expect(room?.participants[FixtureBase.u2] == .awaitingAcknowledgement)
        }
    }

    @Test("마감을 늘려 잡은 생성 record를 지목한 요청은 확정으로 승격되지 않는다")
    func requestOnExtendedDeadlineRecordIsNotConfirmed() {
        // 장부가 요청이 선언한 record의 마감만 보므로, 마감을 늘려 잡은 record를
        // 지목하면 늦은 ACK도 장부를 통과한다. 정본 마감으로 다시 거르는 판정이
        // 없으면 이것이 그대로 확정이 된다.
        let base = BaseRoom()
        let extended = makeEvent(
            "E90", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 90, at: 700,
            kind: .roomCreated(store: "S9", orderDeadlineMinute: 860)
        )
        let request = makeEvent(
            "E91", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 91, at: 701,
            kind: .participationRequest(roomRecord: EventID("E90"))
        )
        let acceptance = makeEvent(
            "E92", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 92, at: 702,
            kind: .participationAcceptance(requestID: EventID("E91"))
        )
        // 원래 마감(12:00) 뒤인 12:05에 받은 ACK.
        let confirmation = makeEvent(
            "E93", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 93, at: 726,
            kind: .participationConfirmation(
                requestID: EventID("E91"), acceptanceID: EventID("E92"), ackReceivedAtMinute: 725
            )
        )
        let events = base.all + [extended, request, acceptance, confirmation]
        let store = ledger(events)
        #expect(store.validated[EventID("E93")] != nil, "이 시험의 전제인 장부 통과가 사라졌다")
        let room = ProjectionReducer
            .reduce(daySession: FixtureBase.daySession, ledger: store)
            .rooms[FixtureBase.r1]
        #expect(room?.orderDeadlineMinute == FixtureBase.deadline)
        #expect(room?.participants[FixtureBase.u3] == .awaitingAcknowledgement)
    }

    @Test("영구 실패 outcome은 뒤늦은 confirmation이 덮지 못한다")
    func failureOutcomeIsTerminal() {
        // 아키텍처 04: "Deadline 뒤 처음 받은 ACK는 영구 실패 outcome이며 늦은
        // ACK만으로 소급 확정하지 않는다."
        let request = makeEvent(
            "E13", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 13, at: 716,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let acceptance = makeEvent(
            "E14", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 14, at: 718,
            kind: .participationAcceptance(requestID: EventID("E13"))
        )
        let failure = makeEvent(
            "E15", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 15, at: 719,
            kind: .participationFailure(requestID: EventID("E13"), reason: .acknowledgementMissedDeadline)
        )
        // 마감 전에 작성했고 수신 시각도 마감 전이지만, 이미 실패가 기록됐다.
        let contradicting = makeEvent(
            "E17", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 17, at: 719,
            kind: .participationConfirmation(
                requestID: EventID("E13"), acceptanceID: EventID("E14"), ackReceivedAtMinute: 719
            )
        )
        let events = [roomCreated, request, acceptance, failure, contradicting]
        for arrival in [events, events.reversed()] {
            #expect(room(arrival)?.participants[FixtureBase.u3] == .failed(.acknowledgementMissedDeadline))
        }
    }
}
