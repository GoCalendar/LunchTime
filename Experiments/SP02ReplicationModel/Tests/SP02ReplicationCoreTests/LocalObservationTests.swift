import Foundation
import Testing

@testable import SP02ReplicationCore

/// 로컬 관측과 주문 전 점검 계약.
///
/// `POL-02-R-03`의 네 안정 상태와 `POL-02-R-04` 4.3의 차단 조건을 확인한다.
/// 전송 성공을 저장 확인으로 승격하는 경로가 하나라도 생기면 여기서 실패해야
/// 한다.
@Suite("SP-02 로컬 관측과 주문 전 점검")
struct LocalObservationTests {
    private let base = BaseRoom()

    private func state(_ events: [LedgerEvent], device: DeviceID, peer: PeerID) -> PeerState {
        var state = PeerState(id: peer, device: device)
        for event in events { state.ledger.receive(event) }
        return state
    }

    @Test("전송 호출 성공만으로는 복제됨이 되지 않는다")
    func transportSuccessAloneIsNotReplicated() {
        var peer = state(base.all, device: FixtureBase.d1, peer: FixtureBase.p1)
        peer.observation.transportDelivered[base.menuU1.id] = [FixtureBase.p2, FixtureBase.p3]
        let local = peer.localProjection(daySession: FixtureBase.daySession)
        #expect(local.status(of: base.menuU1.id) == .storedLocally)
        #expect(local.orderReadiness(room: FixtureBase.r1).blockers.contains(.revisionNotAcknowledged))
    }

    @Test("정확한 리비전 저장 회신이 있어야 복제됨이 된다")
    func storageAcknowledgementMakesReplicated() {
        var peer = state(base.all, device: FixtureBase.d1, peer: FixtureBase.p1)
        peer.observation.storageAcknowledgements[base.menuU1.id] = [FixtureBase.p2]
        peer.observation.storageAcknowledgements[base.confirmationU1.id] = [FixtureBase.p2]
        let local = peer.localProjection(daySession: FixtureBase.daySession)
        #expect(local.status(of: base.menuU1.id) == .replicated)
        #expect(local.orderReadiness(room: FixtureBase.r1).canCompleteOrder)
    }

    @Test("남이 만든 이벤트를 내가 보유하면 이미 복제본이 둘이다")
    func holdingAnotherDevicesEventIsAlreadyReplicated() {
        let peer = state(base.all, device: FixtureBase.d1, peer: FixtureBase.p1)
        let local = peer.localProjection(daySession: FixtureBase.daySession)
        // 작성 기기(D2)와 이 기기(D1)가 함께 보유한다.
        #expect(local.status(of: base.menuU2.id) == .replicated)
        // 내 이벤트는 남의 회신이 없으면 아직 로컬 저장이다.
        #expect(local.status(of: base.menuU1.id) == .storedLocally)
    }

    @Test("대조가 끝난 scope만 동기화됨으로 표시한다")
    func reconciledScopeBecomesSynchronized() {
        var peer = state(base.all, device: FixtureBase.d1, peer: FixtureBase.p1)
        peer.observation.reconciledScopes = [base.menuU1.scope]
        peer.observation.reconciledEventIDs = [base.menuU1.id]
        let local = peer.localProjection(daySession: FixtureBase.daySession)
        #expect(local.status(of: base.menuU1.id) == .reconciled)
        #expect(local.status(of: base.confirmationU1.id) == .storedLocally)
    }

    @Test("대조가 끝난 뒤 만든 로컬 event는 동기화됨으로 승격되지 않는다")
    func localEventAfterReconciliationIsNotSynchronized() {
        // scope만 기억하면 상대가 가진 적 없는 event까지 `동기화됨`이 되고
        // 주문 완료가 통과한다. 이 스파이크가 막으려는 메뉴 누락 그 자체다.
        var peer = state(base.all, device: FixtureBase.d1, peer: FixtureBase.p1)
        peer.observation.reconciledScopes = [base.menuU1.scope, base.confirmationU1.scope]
        peer.observation.reconciledEventIDs = Set(base.all.map(\.id))

        let laterLocalMenu = makeEvent(
            "E60", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 60, at: 700,
            kind: .menuRevision(
                items: ["대조 뒤 수정"], revision: 2, parent: EventID("E08"), supersedes: [],
                authority: EventID("E07")
            )
        )
        #expect(peer.ledger.receive(laterLocalMenu) == .appended)

        let local = peer.localProjection(daySession: FixtureBase.daySession)
        #expect(local.status(of: EventID("E60")) == .storedLocally)
        let readiness = local.orderReadiness(room: FixtureBase.r1)
        #expect(readiness.blockers.contains(.revisionNotAcknowledged))
        #expect(readiness.canCompleteOrder == false)
    }

    @Test("요약 차이가 남은 scope는 확인 필요로 내려간다")
    func unreconciledAdvertisedScopeIsNeedsReview() {
        var peer = state(base.all, device: FixtureBase.d1, peer: FixtureBase.p1)
        peer.observation.storageAcknowledgements[base.menuU1.id] = [FixtureBase.p2]
        peer.observation.unreconciledAdvertisedScopes = [base.menuU1.scope]
        let local = peer.localProjection(daySession: FixtureBase.daySession)
        #expect(local.status(of: base.menuU1.id) == .needsReview)
        #expect(local.orderReadiness(room: FixtureBase.r1)
            .blockers.contains(.peerSummaryDifferenceUnreconciled))
    }

    @Test("의존 record를 기다리는 이벤트가 있으면 주문 완료를 막는다")
    func pendingDependencyBlocksOrder() {
        var peer = state(base.all, device: FixtureBase.d1, peer: FixtureBase.p1)
        peer.observation.storageAcknowledgements = Dictionary(
            uniqueKeysWithValues: base.all.map { ($0.id, Set([FixtureBase.p2])) }
        )
        let orphan = makeEvent(
            "E80", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 80, at: 700,
            kind: .menuRevision(
                items: ["연결이 끊긴 리비전"], revision: 9, parent: EventID("E79"), supersedes: [],
                authority: EventID("E05")
            )
        )
        peer.ledger.receive(orphan)
        let local = peer.localProjection(daySession: FixtureBase.daySession)
        #expect(local.orderReadiness(room: FixtureBase.r1).blockers.contains(.pendingDependencyUnresolved))
    }

    // MARK: - never-shared 단독 Room 예외

    private var soloRoomEvents: [LedgerEvent] {
        let created = makeEvent(
            "S01", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 1, at: 665,
            kind: .roomCreated(store: "S1", orderDeadlineMinute: 720)
        )
        let menu = makeEvent(
            "S02", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 2, at: 670,
            kind: .menuRevision(
                items: ["혼자 메뉴"], revision: 1, parent: nil, supersedes: [], authority: EventID("S01")
            )
        )
        return [created, menu]
    }

    @Test("한 번도 공유되지 않은 단독 Room은 원격 ACK 없이 완료할 수 있다")
    func neverSharedSoloRoomCanCompleteWithoutRemoteAcknowledgement() {
        let peer = state(soloRoomEvents, device: FixtureBase.d1, peer: FixtureBase.p1)
        let local = peer.localProjection(daySession: FixtureBase.daySession)
        let readiness = local.orderReadiness(room: FixtureBase.r1)
        #expect(readiness.soloRoomExceptionApplies)
        #expect(readiness.canCompleteOrder)
    }

    @Test("발견·공유 관측이 생기면 단독 Room 예외가 즉시 사라진다")
    func discoveryDissolvesSoloRoomException() {
        var peer = state(soloRoomEvents, device: FixtureBase.d1, peer: FixtureBase.p1)
        peer.observation.sharedRooms = [FixtureBase.r1]
        let readiness = peer.localProjection(daySession: FixtureBase.daySession)
            .orderReadiness(room: FixtureBase.r1)
        #expect(readiness.soloRoomExceptionApplies == false)
        #expect(readiness.blockers.contains(.participationNotConfirmed))
    }

    @Test("전송 이력만 있어도 단독 Room 예외가 사라진다")
    func transportHistoryDissolvesSoloRoomException() {
        var peer = state(soloRoomEvents, device: FixtureBase.d1, peer: FixtureBase.p1)
        peer.observation.transportDelivered[EventID("S02")] = [FixtureBase.p2]
        let readiness = peer.localProjection(daySession: FixtureBase.daySession)
            .orderReadiness(room: FixtureBase.r1)
        #expect(readiness.soloRoomExceptionApplies == false)
        #expect(readiness.canCompleteOrder == false)
    }

    @Test("원격 참여 record가 하나라도 있으면 단독 Room 예외가 사라진다")
    func remoteParticipationRecordDissolvesSoloRoomException() {
        var events = soloRoomEvents
        events.append(makeEvent(
            "S03", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 3, at: 671,
            kind: .participationRequest(roomRecord: EventID("S01"))
        ))
        let peer = state(events, device: FixtureBase.d1, peer: FixtureBase.p1)
        let readiness = peer.localProjection(daySession: FixtureBase.daySession)
            .orderReadiness(room: FixtureBase.r1)
        #expect(readiness.soloRoomExceptionApplies == false)
        #expect(readiness.canCompleteOrder == false)
    }

    @Test("다인 Room에는 누락을 무시하는 강제 완료 경로가 없다")
    func multiParticipantRoomHasNoForcedCompletion() {
        // 차단 사유가 하나라도 있으면 `canCompleteOrder`는 false이고, 이를
        // 우회하는 다른 진입점이 없다.
        let peer = state(base.all, device: FixtureBase.d1, peer: FixtureBase.p1)
        let readiness = peer.localProjection(daySession: FixtureBase.daySession)
            .orderReadiness(room: FixtureBase.r1)
        #expect(readiness.blockers.isEmpty == false)
        #expect(readiness.canCompleteOrder == false)
        #expect(readiness.soloRoomExceptionApplies == false)
    }

    @Test("격리한 이벤트가 있으면 주문 완료를 막는다")
    func quarantinedEventBlocksOrder() {
        // 격리 대상이 참여 confirmation이나 메뉴 head가 아니어도 Room 정보나
        // 주문 상태를 노린 것일 수 있다. 신호 없이 통과하면 무결성 충돌이
        // 사용자에게 보이지 않는다.
        var peer = state(base.all, device: FixtureBase.d1, peer: FixtureBase.p1)
        peer.observation.storageAcknowledgements = Dictionary(
            uniqueKeysWithValues: base.all.map { ($0.id, Set([FixtureBase.p2])) }
        )
        #expect(peer.localProjection(daySession: FixtureBase.daySession)
            .orderReadiness(room: FixtureBase.r1).canCompleteOrder)

        // 같은 ID `E01`에 마감만 바꾼 payload.
        let forgedRoomRecord = makeEvent(
            "E01", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 1, at: 665,
            kind: .roomCreated(store: "S1", orderDeadlineMinute: 860)
        )
        guard case .integrityConflict = peer.ledger.receive(forgedRoomRecord) else {
            Issue.record("같은 ID·다른 payload를 격리하지 않았다")
            return
        }
        let readiness = peer.localProjection(daySession: FixtureBase.daySession)
            .orderReadiness(room: FixtureBase.r1)
        #expect(readiness.blockers.contains(.integrityConflictQuarantined))
        #expect(readiness.canCompleteOrder == false)
    }

    @Test("생성 record가 둘이면 단독 Room 예외를 적용하지 않는다")
    func duplicateRoomRecordDissolvesSoloRoomException() {
        var events = soloRoomEvents
        events.append(makeEvent(
            "S04", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 4, at: 672,
            kind: .roomCreated(store: "S1-b", orderDeadlineMinute: 800)
        ))
        let peer = state(events, device: FixtureBase.d1, peer: FixtureBase.p1)
        let readiness = peer.localProjection(daySession: FixtureBase.daySession)
            .orderReadiness(room: FixtureBase.r1)
        #expect(readiness.soloRoomExceptionApplies == false)
        #expect(readiness.canCompleteOrder == false)
    }
}
