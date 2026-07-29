import Foundation
import Testing

@testable import SP02ReplicationCore

/// 제한 세션 계약.
///
/// `POL-02-R-02`는 한 세션에 최대 3회·총 30초를 적용하고 실패한 세션을 타이머로
/// 무한히 다시 시작하지 못하게 한다. 이 suite는 한도가 실제로 걸리는지와
/// 한도를 넘긴 결과를 성공으로 위장하지 않는지 확인한다.
@Suite("SP-02 제한 동기화 세션")
struct SyncSessionTests {
    private let base = BaseRoom()

    private func partitionedPeers() -> (PeerState, PeerState) {
        var left = PeerState(id: FixtureBase.p1, device: FixtureBase.d1)
        var right = PeerState(id: FixtureBase.p2, device: FixtureBase.d2)
        for event in base.authoredByP1.sorted(by: LedgerEvent.deterministicOrder) {
            left.ledger.receive(event)
        }
        for event in base.authoredByP2.sorted(by: LedgerEvent.deterministicOrder) {
            right.ledger.receive(event)
        }
        return (left, right)
    }

    @Test("한 세션의 대조로 양쪽 요약이 일치하면 같은 projection에 도달한다")
    func reconcileConverges() {
        var (left, right) = partitionedPeers()
        let leftBefore = ProjectionReducer.reduce(daySession: FixtureBase.daySession, ledger: left.ledger).hash
        let rightBefore = ProjectionReducer.reduce(daySession: FixtureBase.daySession, ledger: right.ledger).hash
        #expect(leftBefore != rightBefore, "분리 구간에서 두 Peer가 이미 같으면 이 시험이 무의미하다")

        let result = AntiEntropy.reconcile(&left, &right, limits: SessionLimits())
        #expect(result.converged)
        #expect(result.stopReason == .summariesMatched)
        #expect(result.attemptsUsed <= 3)
        let leftAfter = ProjectionReducer.reduce(daySession: FixtureBase.daySession, ledger: left.ledger).hash
        let rightAfter = ProjectionReducer.reduce(daySession: FixtureBase.daySession, ledger: right.ledger).hash
        #expect(leftAfter == rightAfter)
    }

    @Test("대조가 끝난 scope만 동기화됨 판정에 넣는다")
    func convergedSessionMarksScopesReconciled() {
        var (left, right) = partitionedPeers()
        AntiEntropy.reconcile(&left, &right, limits: SessionLimits())
        let local = left.localProjection(daySession: FixtureBase.daySession)
        #expect(local.status(of: base.menuU1.id) == .reconciled)
        #expect(left.observation.unreconciledAdvertisedScopes.isEmpty)
    }

    @Test("시도 횟수 한도를 소진하면 성공으로 표시하지 않고 멈춘다")
    func attemptLimitStopsSession() {
        var (left, right) = partitionedPeers()
        let result = AntiEntropy.reconcile(
            &left, &right,
            limits: SessionLimits(recordsPerAttempt: 1)
        )
        #expect(result.converged == false)
        #expect(result.stopReason == .attemptLimitReached)
        #expect(result.attemptsUsed == 3)
        #expect(left.observation.unreconciledAdvertisedScopes.isEmpty == false)
        let local = left.localProjection(daySession: FixtureBase.daySession)
        #expect(local.orderReadiness(room: FixtureBase.r1)
            .blockers.contains(.peerSummaryDifferenceUnreconciled))
    }

    @Test("총 시간 한도를 먼저 만나면 그 이유로 멈춘다")
    func timeLimitStopsSession() {
        var (left, right) = partitionedPeers()
        let result = AntiEntropy.reconcile(
            &left, &right,
            limits: SessionLimits(
                maxAttempts: 3,
                maxElapsedMilliseconds: 30_000,
                millisecondsPerAttempt: 20_000,
                recordsPerAttempt: 1
            )
        )
        #expect(result.stopReason == .timeLimitReached)
        #expect(result.attemptsUsed == 1)
        #expect(result.elapsedMilliseconds <= 30_000)
    }

    @Test("이미 같은 두 Peer는 한 번도 record를 옮기지 않는다")
    func alreadyEqualPeersTransferNothing() {
        var left = PeerState(id: FixtureBase.p1, device: FixtureBase.d1)
        var right = PeerState(id: FixtureBase.p2, device: FixtureBase.d2)
        for event in base.all.sorted(by: LedgerEvent.deterministicOrder) {
            left.ledger.receive(event)
            right.ledger.receive(event)
        }
        let result = AntiEntropy.reconcile(&left, &right, limits: SessionLimits())
        #expect(result.converged)
        #expect(result.attemptsUsed == 0)
        #expect(result.transferredRecordCount == 0)
    }

    @Test("정책 검증에 실패한 record는 StorageACK를 만들지 않는다")
    func rejectedRecordDoesNotProduceAcknowledgement() {
        var left = PeerState(id: FixtureBase.p1, device: FixtureBase.d1)
        var right = PeerState(id: FixtureBase.p2, device: FixtureBase.d2)
        for event in base.all.sorted(by: LedgerEvent.deterministicOrder) {
            left.ledger.receive(event)
            right.ledger.receive(event)
        }
        // 남의 메뉴를 대신 만든 event. left에서는 이미 거부되므로 복제 대상이 아니다.
        let forged = makeEvent(
            "E70", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 70, at: 700,
            kind: .menuRevision(
                items: ["남의 메뉴"], revision: 1, parent: nil, supersedes: [], authority: EventID("E05")
            )
        )
        #expect(left.ledger.receive(forged) == .rejected(reason: .menuAuthorIsNotOwner))
        let result = AntiEntropy.reconcile(&left, &right, limits: SessionLimits())
        #expect(result.converged)
        #expect(left.observation.storageAcknowledgements[EventID("E70")] == nil)
        #expect(right.ledger.validated[EventID("E70")] == nil)
    }

    @Test("수신 측이 보류한 record에는 StorageACK를 돌려주지 않는다")
    func pendingAtDestinationProducesNoAcknowledgement() {
        // 앞 테스트는 **발신 측에서 이미 거부된** record를 다루므로 애초에 전송
        // 대상이 아니다. 그것만으로는 "수신 측이 보류한 record에 ACK를 주지
        // 않는다"는 분기가 한 번도 실행되지 않는다.
        //
        // `exchange`는 event ID 오름차순으로 예산만큼 옮기므로, 의존 record의
        // ID가 더 큰 쌍을 만들면 수신 측이 의존보다 먼저 종속 event를 받는다.
        var left = PeerState(id: FixtureBase.p1, device: FixtureBase.d1)
        var right = PeerState(id: FixtureBase.p2, device: FixtureBase.d2)
        let roomRecord = makeEvent(
            "Z01", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r2, order: 1, at: 665,
            kind: .roomCreated(store: "S2", orderDeadlineMinute: 720)
        )
        let request = makeEvent(
            "A99", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r2, order: 2, at: 666,
            kind: .participationRequest(roomRecord: EventID("Z01"))
        )
        left.ledger.receive(roomRecord)
        left.ledger.receive(request)
        #expect(left.ledger.pending.isEmpty)

        // 한 번의 시도로 한 건만 옮기면 `A99`가 `Z01`보다 먼저 간다.
        AntiEntropy.reconcile(&left, &right, limits: SessionLimits(maxAttempts: 1, recordsPerAttempt: 1))
        #expect(right.ledger.pending[EventID("A99")] != nil, "수신 측 보류를 만들지 못해 이 계약을 시험하지 못했다")
        #expect(right.ledger.validated[EventID("A99")] == nil)
        // 보류한 record를 보낸 쪽은 저장 회신을 받지 못한다.
        #expect(left.observation.storageAcknowledgements[EventID("A99")]?.contains(right.id) != true)
        // 전송 자체가 성공했다는 관측은 남는다. 둘을 구분하는 것이 이 모델의 핵심이다.
        #expect(left.observation.transportDelivered[EventID("A99")]?.contains(right.id) == true)
    }

    @Test("거부된 record는 요약에 없어 전송되지 않으므로 StorageACK도 없다")
    func rejectedRecordIsNotAdvertisedAndNotAcknowledged() {
        var left = PeerState(id: FixtureBase.p1, device: FixtureBase.d1)
        var right = PeerState(id: FixtureBase.p2, device: FixtureBase.d2)
        let roomRecord = makeEvent(
            "Z01", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r2, order: 1, at: 665,
            kind: .roomCreated(store: "S2", orderDeadlineMinute: 720)
        )
        // 생성자가 아닌 사용자가 만든 취소. 의존 record가 도착한 뒤 거부된다.
        let cancellation = makeEvent(
            "A98", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r2, order: 2, at: 666,
            kind: .roomCancelled(roomRecord: EventID("Z01"))
        )
        // 왼쪽은 취소를 먼저 받아 보류하고, Room record를 나중에 받아 거부한다.
        #expect(left.ledger.receive(cancellation) == .pendingDependency(missing: [EventID("Z01")]))
        left.ledger.receive(roomRecord)
        #expect(left.ledger.rejected[EventID("A98")] == .cancellationByNonCreator)

        AntiEntropy.reconcile(&left, &right, limits: SessionLimits())
        // 거부된 record는 요약에 없으므로 전송되지 않고 ACK도 없다.
        #expect(right.ledger.validated[EventID("A98")] == nil)
        #expect(left.observation.storageAcknowledgements[EventID("A98")] == nil)
    }

    @Test("세션은 스스로 재시작하지 않는다")
    func sessionDoesNotRestartItself() {
        // 한도를 소진한 세션이 같은 호출 안에서 다시 시도하면 시도 횟수가
        // 한도를 넘는다. 그 값이 상한 이하임을 확인해 무한 재시도가 없음을 고정한다.
        var (left, right) = partitionedPeers()
        let limits = SessionLimits(recordsPerAttempt: 1)
        let result = AntiEntropy.reconcile(&left, &right, limits: limits)
        #expect(result.attemptsUsed <= limits.maxAttempts)
        #expect(result.elapsedMilliseconds <= limits.maxElapsedMilliseconds)
        #expect(result.transferredRecordCount <= limits.maxAttempts * limits.recordsPerAttempt * 2)
    }
}
