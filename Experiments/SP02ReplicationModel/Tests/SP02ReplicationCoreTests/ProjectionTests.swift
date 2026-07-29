import Foundation
import Testing

@testable import SP02ReplicationCore

/// 구조화 projection 계약.
///
/// `POL-02-R-05`가 금지한 자동 승자 선택이 어딘가에 숨어 있으면 이 suite가
/// 실패해야 한다. 그래서 결과 값뿐 아니라 "무엇을 고르지 않았는지"도 확인한다.
@Suite("SP-02 구조화 projection")
struct ProjectionTests {
    private let base = BaseRoom()

    private func ledger(_ events: [LedgerEvent]) -> Ledger {
        var ledger = Ledger()
        for event in events { ledger.receive(event) }
        return ledger
    }

    private func projection(_ events: [LedgerEvent]) -> StructuredProjection {
        ProjectionReducer.reduce(daySession: FixtureBase.daySession, ledger: ledger(events))
    }

    /// 무작위 없이 서로 다른 도착 순서를 만드는 결정적 회전.
    private func rotations(of events: [LedgerEvent]) -> [[LedgerEvent]] {
        (0..<events.count).map { offset in
            Array(events[offset...] + events[..<offset])
        }
    }

    @Test("같은 이벤트 집합은 도착 순서가 달라도 같은 projection hash를 만든다")
    func projectionIsOrderIndependent() {
        let ordered = base.all.sorted(by: LedgerEvent.deterministicOrder)
        var hashes = Set<String>()
        for arrival in rotations(of: ordered) + [ordered.reversed()] {
            hashes.insert(projection(arrival).hash)
        }
        #expect(hashes.count == 1, "도착 순서가 projection을 바꿨다")
    }

    @Test("중복 수신은 projection을 바꾸지 않는다")
    func duplicatesDoNotChangeProjection() {
        let ordered = base.all.sorted(by: LedgerEvent.deterministicOrder)
        #expect(projection(ordered).hash == projection(ordered + ordered + ordered).hash)
    }

    @Test("같은 논리 순서의 주문 상태 이벤트는 event ID로 결정적으로 정렬한다")
    func orderStatusTieBreaksByEventID() {
        let snapshot = OrderSnapshot(
            participants: [FixtureBase.u1, FixtureBase.u2],
            menuHeads: [FixtureBase.u1: EventID("E08"), FixtureBase.u2: EventID("E09")]
        )
        let revertedByU1 = makeEvent(
            "E43", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 14, at: 693,
            kind: .orderReverted(roomRecord: EventID("E01"), authority: EventID("E07"))
        )
        let completedByU2 = makeEvent(
            "E44", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 14, at: 693,
            kind: .orderCompleted(roomRecord: EventID("E01"), authority: EventID("E05"), snapshot: snapshot)
        )
        // 두 이벤트를 서로 반대 순서로 적용해도 결과가 같아야 한다.
        let forward = projection(base.all + [revertedByU1, completedByU2])
        let backward = projection(base.all + [completedByU2, revertedByU1])
        #expect(forward.hash == backward.hash)
        #expect(forward.rooms[FixtureBase.r1]?.orderState
            == .completed(event: EventID("E44"), by: FixtureBase.u2, atMinute: 693))
    }

    @Test("분기한 메뉴 리비전에서 자동 승자를 고르지 않는다")
    func divergedMenuKeepsBothHeads() {
        let branchA = makeEvent(
            "E20", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 10, at: 680,
            kind: .menuRevision(
                items: ["M2-a"], revision: 2, parent: EventID("E09"), supersedes: [], authority: EventID("E05")
            )
        )
        let branchB = makeEvent(
            "E21", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 11, at: 681,
            kind: .menuRevision(
                items: ["M2-b"], revision: 2, parent: EventID("E09"), supersedes: [], authority: EventID("E05")
            )
        )
        let room = projection(base.all + [branchA, branchB]).rooms[FixtureBase.r1]
        #expect(room?.menus[FixtureBase.u2] == .diverged([EventID("E20"), EventID("E21")]))
        // 나중 논리 순서나 마지막 쓰기를 자동 채택하지 않았음을 명시적으로 확인한다.
        #expect(room?.menus[FixtureBase.u2]?.headEventID == nil)
        #expect(room?.conflicts.contains { $0.kind == .divergedMenuRevision } == true)
    }

    @Test("사용자가 한 head를 재확정하면 분기가 해소된다")
    func userResolutionCollapsesDivergence() {
        let branchA = makeEvent(
            "E20", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 10, at: 680,
            kind: .menuRevision(
                items: ["M2-a"], revision: 2, parent: EventID("E09"), supersedes: [], authority: EventID("E05")
            )
        )
        let branchB = makeEvent(
            "E21", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 11, at: 681,
            kind: .menuRevision(
                items: ["M2-b"], revision: 2, parent: EventID("E09"), supersedes: [], authority: EventID("E05")
            )
        )
        let resolution = makeEvent(
            "E22", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 12, at: 682,
            kind: .menuRevision(
                items: ["M2-a"], revision: 3, parent: EventID("E20"), supersedes: [EventID("E21")],
                authority: EventID("E05")
            )
        )
        let room = projection(base.all + [branchA, branchB, resolution]).rooms[FixtureBase.r1]
        #expect(room?.menus[FixtureBase.u2]?.headEventID == EventID("E22"))
        #expect(room?.conflicts.isEmpty == true)
    }

    @Test("같은 사용자의 두 Room 참여는 어느 쪽도 자동 채택하지 않는다")
    func duplicateRoomParticipationStaysConflicted() {
        let fixture = FixtureCatalog.duplicateRoomParticipation()
        var ledger = Ledger()
        for event in fixture.authored.values.flatMap({ $0 }).sorted(by: LedgerEvent.deterministicOrder) {
            ledger.receive(event)
        }
        let result = ProjectionReducer.reduce(daySession: fixture.daySession, ledger: ledger)
        #expect(result.rooms[FixtureBase.r1]?.participants[FixtureBase.u2] == .conflictedAcrossRooms)
        #expect(result.rooms[FixtureBase.r2]?.participants[FixtureBase.u2] == .conflictedAcrossRooms)
        #expect(result.daySessionConflicts.contains { $0.kind == .duplicateRoomParticipation })
    }

    @Test("사용자가 유지할 Room을 고르면 나머지 참여가 무효화된다")
    func userSelectionResolvesDuplicateParticipation() {
        let fixture = FixtureCatalog.duplicateRoomParticipation()
        var ledger = Ledger()
        for event in fixture.authored.values.flatMap({ $0 }).sorted(by: LedgerEvent.deterministicOrder) {
            ledger.receive(event)
        }
        let selection = makeEvent(
            "E37", user: FixtureBase.u2, device: FixtureBase.d2, room: nil, order: 20, at: 690,
            kind: .duplicateParticipationSelection(
                keptConfirmation: EventID("E33"), supersededConfirmations: [EventID("E36")]
            )
        )
        ledger.receive(selection)
        let result = ProjectionReducer.reduce(daySession: fixture.daySession, ledger: ledger)
        #expect(result.rooms[FixtureBase.r1]?.participants[FixtureBase.u2] == .confirmed(confirmation: EventID("E33")))
        #expect(result.rooms[FixtureBase.r2]?.participants[FixtureBase.u2] == .supersededByUserSelection)
        #expect(result.daySessionConflicts.isEmpty)
    }

    @Test("선택 이벤트가 둘 이상이면 하나로 좁혀지지 않았다고 표시한다")
    func ambiguousSelectionStaysConflicted() {
        let fixture = FixtureCatalog.duplicateRoomParticipation()
        var ledger = Ledger()
        for event in fixture.authored.values.flatMap({ $0 }).sorted(by: LedgerEvent.deterministicOrder) {
            ledger.receive(event)
        }
        for (index, kept) in [EventID("E33"), EventID("E36")].enumerated() {
            let other = kept == EventID("E33") ? EventID("E36") : EventID("E33")
            ledger.receive(makeEvent(
                "E4\(index)", user: FixtureBase.u2, device: FixtureBase.d2, room: nil,
                order: 20 + index, at: 690 + index,
                kind: .duplicateParticipationSelection(keptConfirmation: kept, supersededConfirmations: [other])
            ))
        }
        let result = ProjectionReducer.reduce(daySession: fixture.daySession, ledger: ledger)
        #expect(result.rooms[FixtureBase.r1]?.participants[FixtureBase.u2] == .conflictedAcrossRooms)
        #expect(result.daySessionConflicts.contains { $0.kind == .ambiguousUserSelection })
    }

    @Test("참여 철회 tombstone은 그 사용자의 참여와 메뉴를 가린다")
    func withdrawalHidesParticipationAndMenu() {
        let withdrawal = makeEvent(
            "E23", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 12, at: 683,
            kind: .participationWithdrawal(confirmationID: EventID("E05"))
        )
        let room = projection(base.all + [withdrawal]).rooms[FixtureBase.r1]
        #expect(room?.participants[FixtureBase.u2] == .withdrawn)
        #expect(room?.menus[FixtureBase.u2] == .revoked)
    }

    @Test("Room 취소 tombstone은 참여·메뉴를 모두 무효화한다")
    func cancellationInvalidatesRoom() {
        let cancellation = makeEvent(
            "E24", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 13, at: 684,
            kind: .roomCancelled(roomRecord: EventID("E01"))
        )
        let room = projection(base.all + [cancellation]).rooms[FixtureBase.r1]
        #expect(room?.cancelled == true)
        #expect(room?.participants.values.allSatisfy { $0 == .withdrawn } == true)
        #expect(room?.menus.values.allSatisfy { $0 == .revoked } == true)
    }

    @Test("완료 스냅샷에 없던 유효 메뉴가 도착하면 안전한 완료로 표시하지 않는다")
    func lateMenuBreaksCompletionSnapshot() {
        let snapshot = OrderSnapshot(
            participants: [FixtureBase.u1, FixtureBase.u2],
            menuHeads: [FixtureBase.u1: EventID("E08"), FixtureBase.u2: EventID("E09")]
        )
        let completed = makeEvent(
            "E41", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 12, at: 690,
            kind: .orderCompleted(roomRecord: EventID("E01"), authority: EventID("E07"), snapshot: snapshot)
        )
        let lateMenu = makeEvent(
            "E40", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 10, at: 682,
            kind: .menuRevision(
                items: ["M2-2"], revision: 2, parent: EventID("E09"), supersedes: [], authority: EventID("E05")
            )
        )
        let safe = projection(base.all + [completed]).rooms[FixtureBase.r1]
        #expect(safe?.orderState == .completed(event: EventID("E41"), by: FixtureBase.u1, atMinute: 690))

        let broken = projection(base.all + [completed, lateMenu]).rooms[FixtureBase.r1]
        #expect(broken?.orderState
            == .completedNeedsReview(event: EventID("E41"), by: FixtureBase.u1, atMinute: 690))
        #expect(broken?.conflicts.contains { $0.kind == .completionSnapshotBroken } == true)
    }

    @Test("메뉴 내용이 다르면 projection hash가 달라진다")
    func menuContentIsPartOfTheHash() {
        // 내용이 hash에 반영되지 않으면 "hash가 같다"가 "주문 요약이 같다"를
        // 뜻하지 못한다. 같은 ID·다른 payload 공격이 조용히 통과하는 경로다.
        let other = makeEvent(
            "E09", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 9, at: 676,
            kind: .menuRevision(
                items: ["다른 메뉴"], revision: 1, parent: nil, supersedes: [], authority: EventID("E05")
            )
        )
        let replaced = base.all.filter { $0.id != base.menuU2.id } + [other]
        #expect(projection(base.all).hash != projection(replaced).hash)
    }

    @Test("projection hash는 실행마다 같은 값을 낸다")
    func hashIsStableAcrossRuns() {
        // `Hasher` 같은 seed 기반 해시를 쓰면 두 실행의 증거를 비교할 수 없다.
        #expect(projection(base.all).hash == projection(base.all).hash)
        #expect(projection(base.all).hash.count == 64)
    }

    @Test("생성 record가 둘이면 뒤에 온 것으로 덮지 않고 확인 필요로 남긴다")
    func duplicateRoomRecordStaysConflicted() {
        // 덮어쓰면 위조 record가 생성자·가게·마감을 통째로 가져간다.
        let forged = makeEvent(
            "E60", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 60, at: 700,
            kind: .roomCreated(store: "S9", orderDeadlineMinute: 860)
        )
        let room = projection(base.all + [forged]).rooms[FixtureBase.r1]
        #expect(room?.creator == FixtureBase.u1)
        #expect(room?.orderDeadlineMinute == 720)
        #expect(room?.conflicts.contains { $0.kind == .duplicateRoomRecord } == true)
        // 도착 순서를 바꿔도 같은 결과여야 한다.
        #expect(projection(base.all + [forged]).hash == projection([forged] + base.all).hash)
    }

    @Test("생성자가 철회한 뒤의 Room 취소는 적용하지 않는다")
    func cancellationAfterCreatorWithdrawalIsNotApplied() {
        // `POL-01-R-04`는 생성자가 철회하면 전체 취소 권한이 종료된다고 정한다.
        let withdrawal = makeEvent(
            "E70", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 70, at: 700,
            kind: .participationWithdrawal(confirmationID: EventID("E07"))
        )
        let cancellation = makeEvent(
            "E71", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 71, at: 701,
            kind: .roomCancelled(roomRecord: EventID("E01"))
        )
        let room = projection(base.all + [withdrawal, cancellation]).rooms[FixtureBase.r1]
        #expect(room?.cancelled == false)
        // 남은 참여자는 그대로 유지된다.
        #expect(room?.participants[FixtureBase.u2] == .confirmed(confirmation: EventID("E05")))
    }

    @Test("생성자 자동 참여도 중복 Room 참여 판정에 들어간다")
    func creatorAutoParticipationCountsTowardDuplicateDetection() {
        // `PRD-01-AC-01`이 생성자 자동 참여를 참여로 정의한다. 확정 참여만 세면
        // "한 방은 생성자로, 다른 방은 확정 참여로"가 판정에서 빠진다.
        let fixture = FixtureCatalog.duplicateRoomParticipation()
        var ledger = Ledger()
        for event in fixture.authored.values.flatMap({ $0 }).sorted(by: LedgerEvent.deterministicOrder) {
            ledger.receive(event)
        }
        // U1은 R1의 생성자다. R2에도 확정 참여시킨다.
        let request = makeEvent(
            "E80", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r2, order: 80, at: 700,
            kind: .participationRequest(roomRecord: EventID("E30"))
        )
        let acceptance = makeEvent(
            "E81", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r2, order: 81, at: 701,
            kind: .participationAcceptance(requestID: EventID("E80"))
        )
        let confirmation = makeEvent(
            "E82", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r2, order: 82, at: 702,
            kind: .participationConfirmation(
                requestID: EventID("E80"), acceptanceID: EventID("E81"), ackReceivedAtMinute: 702
            )
        )
        for event in [request, acceptance, confirmation] { ledger.receive(event) }
        let result = ProjectionReducer.reduce(daySession: fixture.daySession, ledger: ledger)
        #expect(result.rooms[FixtureBase.r1]?.participants[FixtureBase.u1] == .conflictedAcrossRooms)
        #expect(result.rooms[FixtureBase.r2]?.participants[FixtureBase.u1] == .conflictedAcrossRooms)
        #expect(result.daySessionConflicts.contains {
            $0.kind == .duplicateRoomParticipation && $0.user == FixtureBase.u1
        })
    }

    @Test("생성자 방이 낀 충돌은 선택 이벤트로 해소되지 않는다")
    func selectionCannotResolveConflictContainingCreatorRoom() {
        // 생성자 자동 참여 방에는 confirmation record가 없어 선택의 `kept`로
        // 지목될 수도, `supersededByUserSelection`으로 내려갈 수도 없다.
        // 그래서 표현 가능한 유일한 선택(확정 방 유지)을 적용하면 두 방이 모두
        // 살아 있는데 `확인 필요`만 사라지고 생성자 방이 다시 주문 가능해진다.
        let fixture = FixtureCatalog.duplicateRoomParticipation()
        var ledger = Ledger()
        for event in fixture.authored.values.flatMap({ $0 }).sorted(by: LedgerEvent.deterministicOrder) {
            ledger.receive(event)
        }
        // R1의 생성자 U1을 R2에도 확정 참여시킨다.
        let request = makeEvent(
            "E80", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r2, order: 80, at: 700,
            kind: .participationRequest(roomRecord: EventID("E30"))
        )
        let acceptance = makeEvent(
            "E81", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r2, order: 81, at: 701,
            kind: .participationAcceptance(requestID: EventID("E80"))
        )
        let confirmation = makeEvent(
            "E82", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r2, order: 82, at: 702,
            kind: .participationConfirmation(
                requestID: EventID("E80"), acceptanceID: EventID("E81"), ackReceivedAtMinute: 702
            )
        )
        // 모델이 표현할 수 있는 유일한 선택: R2의 confirmation을 유지한다.
        let selection = makeEvent(
            "E83", user: FixtureBase.u1, device: FixtureBase.d1, room: nil, order: 83, at: 703,
            kind: .duplicateParticipationSelection(
                keptConfirmation: EventID("E82"), supersededConfirmations: []
            )
        )
        for event in [request, acceptance, confirmation, selection] { ledger.receive(event) }
        #expect(ledger.rejected[EventID("E83")] == nil, "이 시험의 전제인 선택 통과가 사라졌다")

        let result = ProjectionReducer.reduce(daySession: fixture.daySession, ledger: ledger)
        #expect(result.rooms[FixtureBase.r1]?.participants[FixtureBase.u1] == .conflictedAcrossRooms)
        #expect(result.rooms[FixtureBase.r2]?.participants[FixtureBase.u1] == .conflictedAcrossRooms)
        #expect(result.daySessionConflicts.contains { $0.user == FixtureBase.u1 })

        // 생성자 방이 다시 주문 가능해지지 않는다.
        let local = LocalObservationProjection(
            device: FixtureBase.d1,
            ledger: ledger,
            observation: LocalObservation(),
            structured: result
        )
        #expect(local.orderReadiness(room: FixtureBase.r1).canCompleteOrder == false)
    }

    @Test("참여 상태가 없는 사용자의 메뉴는 projection에 넣지 않는다")
    func menuWithoutParticipationStateIsNotProjected() {
        // 심은 생성 record를 권한 근거로 쓰면 참여자가 아닌 사용자의 메뉴가
        // 수렴 projection에 들어가, `participants`에 없는 사람이 `menus`에 있는
        // 내부 불일치가 생기고 주문 요약에 낯선 메뉴가 표시된다.
        let planted = makeEvent(
            "E70", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 70, at: 700,
            kind: .roomCreated(store: "S9", orderDeadlineMinute: 860)
        )
        let ghostMenu = makeEvent(
            "E71", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 71, at: 701,
            kind: .menuRevision(
                items: ["M3"], revision: 1, parent: nil, supersedes: [], authority: EventID("E70")
            )
        )
        let store = ledger(base.all + [planted, ghostMenu])
        #expect(store.validated[EventID("E71")] != nil, "이 시험의 전제인 장부 통과가 사라졌다")
        let room = ProjectionReducer
            .reduce(daySession: FixtureBase.daySession, ledger: store)
            .rooms[FixtureBase.r1]
        #expect(room?.participants[FixtureBase.u3] == nil)
        #expect(room?.menus[FixtureBase.u3] == nil)
        // 정상 참여자의 메뉴는 그대로 남는다.
        #expect(room?.menus[FixtureBase.u1]?.headEventID == EventID("E08"))
    }

    @Test("충돌이 둘 이상이어도 projection의 충돌 목록은 정렬된 채로 나온다")
    func conflictListStaysSortedWithMultipleConflicts() {
        // 충돌 배열 순서는 `Dictionary` 순회에서 나오고 그 순회는 프로세스마다
        // 달라진다. 한 프로세스 안에서 두 번 계산해 비교하면 이 회귀를 잡을 수
        // 없으므로, 정렬 자체를 단언한다. 정렬이 빠지면 같은 event 집합에서
        // hash는 같은데 값 비교가 다른 답을 낸다.
        let fixture = FixtureCatalog.duplicateRoomParticipation()
        var ledger = Ledger()
        for event in fixture.authored.values.flatMap({ $0 }).sorted(by: LedgerEvent.deterministicOrder) {
            ledger.receive(event)
        }
        // 기본 fixture는 U2 하나만 충돌한다. R1 생성자 U1을 R2에도 확정 참여시켜
        // 일일 세션 충돌을 둘로 만든다.
        let request = makeEvent(
            "E80", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r2, order: 80, at: 700,
            kind: .participationRequest(roomRecord: EventID("E30"))
        )
        let acceptance = makeEvent(
            "E81", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r2, order: 81, at: 701,
            kind: .participationAcceptance(requestID: EventID("E80"))
        )
        let confirmation = makeEvent(
            "E82", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r2, order: 82, at: 702,
            kind: .participationConfirmation(
                requestID: EventID("E80"), acceptanceID: EventID("E81"), ackReceivedAtMinute: 702
            )
        )
        for event in [request, acceptance, confirmation] { ledger.receive(event) }

        let result = ProjectionReducer.reduce(daySession: fixture.daySession, ledger: ledger)
        #expect(result.daySessionConflicts.count > 1, "이 시험의 전제인 다중 충돌이 사라졌다")
        #expect(result.daySessionConflicts == result.daySessionConflicts.sorted())
        for room in result.rooms.values {
            #expect(room.conflicts == room.conflicts.sorted())
        }
        #expect(result == ProjectionReducer.reduce(daySession: fixture.daySession, ledger: ledger))
    }

    @Test("충돌 집합 밖 confirmation을 지목한 선택은 충돌을 해소하지 않는다")
    func selectionOutsideConflictSetDoesNotResolve() {
        // 이 검사가 없으면 사용자가 어느 방에도 남지 않는데 `확인 필요`만 사라진다.
        let fixture = FixtureCatalog.duplicateRoomParticipation()
        var ledger = Ledger()
        for event in fixture.authored.values.flatMap({ $0 }).sorted(by: LedgerEvent.deterministicOrder) {
            ledger.receive(event)
        }
        // U2가 R1에서 세 번째 Room의 confirmation을 지목한다고 가정할 수 없으므로,
        // 충돌 집합(E33·E36) 밖의 자기 confirmation을 새로 만들어 지목한다.
        let otherRequest = makeEvent(
            "E90", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 90, at: 700,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let otherAcceptance = makeEvent(
            "E91", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 91, at: 701,
            kind: .participationAcceptance(requestID: EventID("E90"))
        )
        let otherConfirmation = makeEvent(
            "E92", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 92, at: 702,
            kind: .participationConfirmation(
                requestID: EventID("E90"), acceptanceID: EventID("E91"), ackReceivedAtMinute: 702
            )
        )
        let selection = makeEvent(
            "E93", user: FixtureBase.u2, device: FixtureBase.d2, room: nil, order: 93, at: 703,
            kind: .duplicateParticipationSelection(
                keptConfirmation: EventID("E92"), supersededConfirmations: [EventID("E36")]
            )
        )
        for event in [otherRequest, otherAcceptance, otherConfirmation, selection] { ledger.receive(event) }
        let result = ProjectionReducer.reduce(daySession: fixture.daySession, ledger: ledger)
        // 어느 방에서도 조용히 제거되지 않고 충돌이 남는다.
        #expect(result.rooms[FixtureBase.r2]?.participants[FixtureBase.u2] == .conflictedAcrossRooms)
        #expect(result.daySessionConflicts.isEmpty == false)
    }

    @Test("취소된 Room도 마지막 유효 주문 동작을 숨기지 않는다")
    func cancelledRoomStillReportsOrderState() {
        // 계산을 건너뛰면 완료 상태로 취소된 방이 `진행 중`으로 보인다.
        let snapshot = OrderSnapshot(
            participants: [FixtureBase.u1, FixtureBase.u2],
            menuHeads: [FixtureBase.u1: EventID("E08"), FixtureBase.u2: EventID("E09")]
        )
        let completed = makeEvent(
            "E41", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 12, at: 690,
            kind: .orderCompleted(roomRecord: EventID("E01"), authority: EventID("E07"), snapshot: snapshot)
        )
        let cancellation = makeEvent(
            "E45", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 13, at: 691,
            kind: .roomCancelled(roomRecord: EventID("E01"))
        )
        let room = projection(base.all + [completed, cancellation]).rooms[FixtureBase.r1]
        #expect(room?.cancelled == true)
        #expect(room?.orderState != .inProgress)
    }

    /// 같은 Room ID로 심은 U3의 생성 record와 그것을 근거로 삼는 쓰기들.
    ///
    /// `logicalOrder`를 바꿔 심은 record가 결정적 순서의 첫 record가 되는
    /// 경우와 아닌 경우를 모두 만들 수 있다.
    private func plantedRoomRecordAttack(order: Int) -> (planted: LedgerEvent, cancellation: LedgerEvent, completion: LedgerEvent) {
        let planted = makeEvent(
            "E70", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: order, at: 700,
            kind: .roomCreated(store: "S9", orderDeadlineMinute: 860)
        )
        let cancellation = makeEvent(
            "E71", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 71, at: 701,
            kind: .roomCancelled(roomRecord: EventID("E70"))
        )
        let completion = makeEvent(
            "E72", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 72, at: 702,
            kind: .orderCompleted(
                roomRecord: EventID("E01"),
                authority: EventID("E70"),
                snapshot: OrderSnapshot(
                    participants: [FixtureBase.u1, FixtureBase.u2],
                    menuHeads: [FixtureBase.u1: EventID("E08"), FixtureBase.u2: EventID("E09")]
                )
            )
        )
        return (planted, cancellation, completion)
    }

    @Test("심은 생성 record를 지목한 취소는 Room을 취소하지 못한다")
    func plantedRoomRecordCannotCancelRoom() {
        // 장부는 "참조된 생성 record의 작성자"까지만 본다. 그 판정만 믿으면
        // event 하나를 더 심는 비용으로 모든 Peer가 `cancelled=true`와 참여자
        // 전원 철회에 결정적으로 수렴한다.
        let attack = plantedRoomRecordAttack(order: 70)
        let events = base.all + [attack.planted, attack.cancellation]
        for arrival in rotations(of: events) {
            let room = projection(arrival).rooms[FixtureBase.r1]
            #expect(room?.creator == FixtureBase.u1)
            #expect(room?.cancelled == false)
            #expect(room?.participants[FixtureBase.u1] == .confirmed(confirmation: EventID("E07")))
            #expect(room?.participants[FixtureBase.u2] == .confirmed(confirmation: EventID("E05")))
        }
    }

    @Test("더 이른 논리 순서로 심어 정본 생성자를 가져가도 취소는 적용되지 않는다")
    func earlierPlantedRoomRecordStillCannotCancelRoom() {
        // 심은 record가 결정적 순서의 첫 record가 되면 `creator`와 가게 정보가
        // 공격자 값이 되므로 "정본 생성자와 대조" 하나로는 막지 못한다. 생성
        // record가 둘 이상이면 Room 정보 자체가 확정되지 않았다는 판정이 남은
        // 방어선이다.
        let attack = plantedRoomRecordAttack(order: 0)
        let events = base.all + [attack.planted, attack.cancellation]
        for arrival in rotations(of: events) {
            let room = projection(arrival).rooms[FixtureBase.r1]
            #expect(room?.creator == FixtureBase.u3, "이 시험의 전제가 깨졌다")
            #expect(room?.cancelled == false)
            // 마감은 가장 이른 값으로 fail-closed한다.
            #expect(room?.orderDeadlineMinute == FixtureBase.deadline)
            #expect(room?.conflicts.contains { $0.kind == .duplicateRoomRecord } == true)
        }
    }

    @Test("심은 생성 record를 권한 근거로 쓴 주문 완료는 확정 완료가 아니다")
    func plantedRoomRecordCannotConfirmCompletion() {
        // 스냅샷은 현재 상태와 정확히 일치한다. 따라서 `확인 필요`로 남는 이유는
        // 스냅샷 불일치가 아니라 Room 정보 미확정 하나뿐이다.
        let attack = plantedRoomRecordAttack(order: 70)
        let events = base.all + [attack.planted, attack.completion]
        for arrival in rotations(of: events) {
            let room = projection(arrival).rooms[FixtureBase.r1]
            #expect(room?.orderState == .completedNeedsReview(
                event: EventID("E72"), by: FixtureBase.u3, atMinute: 702
            ))
            // 완료 표식 자체는 지우지 않는다. `POL-01` 4.2가 누가 언제
            // 실행했는지 표시하도록 정한다.
            #expect(room?.conflicts.contains { $0.kind == .duplicateRoomRecord } == true)
            #expect(room?.conflicts.contains { $0.kind == .completionSnapshotBroken } == false)
        }
    }

    @Test("생성 record가 하나뿐이면 정상 완료는 그대로 확정된다")
    func singleRoomRecordStillConfirmsCompletion() {
        // 미확정 판정이 정상 완료까지 막으면 fail-closed가 아니라 기능 정지다.
        let completed = makeEvent(
            "E73", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 73, at: 700,
            kind: .orderCompleted(
                roomRecord: EventID("E01"),
                authority: EventID("E07"),
                snapshot: OrderSnapshot(
                    participants: [FixtureBase.u1, FixtureBase.u2],
                    menuHeads: [FixtureBase.u1: EventID("E08"), FixtureBase.u2: EventID("E09")]
                )
            )
        )
        let room = projection(base.all + [completed]).rooms[FixtureBase.r1]
        #expect(room?.orderState == .completed(event: EventID("E73"), by: FixtureBase.u1, atMinute: 700))
        #expect(room?.conflicts.isEmpty == true)
    }

    @Test("충돌 목록이 정렬돼 Equatable과 hash가 같은 답을 낸다")
    func conflictOrderingIsNormalized() {
        // 정렬하지 않으면 자동 합성 `Equatable`이 배열 순서를 보므로 hash는
        // 같은데 `==`는 다른 값이 나온다.
        let first = projection(base.all)
        let second = projection(base.all.reversed())
        #expect(first.hash == second.hash)
        #expect(first == second)
    }
}
