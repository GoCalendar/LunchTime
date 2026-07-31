import Testing

@testable import SP03WakeAndTimeCore

@Suite("SP-03 trigger coalescing")
struct TriggerCoordinatorTests {
    @Test("동시 burst 100개를 활성 세션 하나로 접는다")
    func hundredTriggerBurstKeepsConcurrencyAtOne() {
        var coordinator = SyncCoordinator()
        let now = MonotonicInstant(milliseconds: 1_000)

        let actions = (0..<100).map { _ in
            coordinator.handle(.foreground, at: now)
        }

        #expect(actions.first == .started(sessionID: 1, cause: .trigger(.foreground)))
        #expect(actions.dropFirst().allSatisfy { $0 == .coalesced(sessionID: 1) })
        #expect(coordinator.sessionsStarted == 1)
        #expect(coordinator.activeSessionCount == 1)
        #expect(coordinator.peakConcurrentSessionCount == 1)
        #expect(coordinator.coalescedTriggerCount == 99)
    }

    @Test("attempt 시작 전 trigger burst는 그 attempt가 흡수한다")
    func pendingBurstBeforeAttemptIsConsumedByThatAttempt() {
        var coordinator = SyncCoordinator()
        let start = MonotonicInstant(milliseconds: 0)
        _ = coordinator.handle(.appLaunch, at: start)
        _ = coordinator.handle(.wake, at: start.advanced(by: 1))
        _ = coordinator.handle(.networkChanged, at: start.advanced(by: 2))

        #expect(coordinator.pendingMeaningfulTrigger == .wake)
        let token = coordinator.startActiveAttempt(at: start.advanced(by: 3))!
        #expect(coordinator.pendingMeaningfulTrigger == nil)

        let completion = coordinator.finishActiveAttempt(
            token,
            at: start.advanced(by: 4),
            outcome: .converged
        )
        #expect(completion?.sessionResult?.succeeded == true)
        #expect(completion?.followUpAction == nil)
        #expect(coordinator.sessionsStarted == 1)
        #expect(coordinator.activeSession == nil)
    }

    @Test("진행 중 trigger는 하나로 병합되어 세션 종료 뒤 순차 follow-up을 연다")
    func triggerDuringAttemptStartsOneSequentialFollowUp() {
        var coordinator = SyncCoordinator()
        let start = MonotonicInstant(milliseconds: 0)
        _ = coordinator.handle(.appLaunch, at: start)
        let token = coordinator.startActiveAttempt(at: start)!

        _ = coordinator.handle(.wake, at: start.advanced(by: 1))
        _ = coordinator.handle(.networkChanged, at: start.advanced(by: 2))
        #expect(coordinator.pendingMeaningfulTrigger == .wake)

        let completion = coordinator.finishActiveAttempt(
            token,
            at: start.advanced(by: 3),
            outcome: .converged
        )

        #expect(completion?.sessionResult?.succeeded == true)
        #expect(
            completion?.followUpAction
                == .started(sessionID: 2, cause: .trigger(.wake))
        )
        #expect(coordinator.activeSessionID == 2)
        #expect(coordinator.activeSessionCause == .trigger(.wake))
        #expect(coordinator.sessionsStarted == 2)
        #expect(coordinator.peakConcurrentSessionCount == 1)
        #expect(coordinator.coalescedTriggerCount == 2)
    }

    @Test("다음 retry attempt가 pending trigger를 흡수하면 follow-up을 만들지 않는다")
    func retryAttemptConsumesPendingTrigger() {
        var coordinator = SyncCoordinator()
        let start = MonotonicInstant(milliseconds: 0)
        _ = coordinator.handle(.appLaunch, at: start)
        let firstToken = coordinator.startActiveAttempt(at: start)!
        _ = coordinator.handle(.wake, at: start.advanced(by: 1))

        let retry = coordinator.finishActiveAttempt(
            firstToken,
            at: start.advanced(by: 2),
            outcome: .retryableFailure
        )
        #expect(retry != nil)
        #expect(retry?.sessionResult == nil)
        #expect(coordinator.pendingMeaningfulTrigger == .wake)

        let secondToken = coordinator.startActiveAttempt(at: start.advanced(by: 3))!
        #expect(coordinator.pendingMeaningfulTrigger == nil)
        let completion = coordinator.finishActiveAttempt(
            secondToken,
            at: start.advanced(by: 4),
            outcome: .converged
        )

        #expect(completion?.sessionResult?.succeeded == true)
        #expect(completion?.followUpAction == nil)
        #expect(coordinator.sessionsStarted == 1)
        #expect(coordinator.activeSession == nil)
    }

    @Test("timeout 뒤 이전 attempt callback은 새 세션에 적용되지 않는다")
    func lateCompletionCannotFinishReplacementSession() {
        var coordinator = SyncCoordinator()
        let start = MonotonicInstant(milliseconds: 0)
        _ = coordinator.handle(.appLaunch, at: start)
        let expiredToken = coordinator.startActiveAttempt(at: start)!
        _ = coordinator.handle(.wake, at: start.advanced(by: 1))

        let timeout = coordinator.advanceActiveSessionTime(
            to: start.advanced(by: 30_000)
        )
        #expect(timeout?.sessionResult?.stopReason == .timeLimitReached)
        #expect(
            timeout?.followUpAction
                == .started(sessionID: 2, cause: .trigger(.wake))
        )
        #expect(coordinator.activeSessionID == 2)

        let replacementToken = coordinator.startActiveAttempt(
            at: start.advanced(by: 30_000)
        )!
        let stale = coordinator.finishActiveAttempt(
            expiredToken,
            at: start.advanced(by: 30_001),
            outcome: .converged
        )

        #expect(stale == nil)
        #expect(coordinator.activeSessionID == 2)
        #expect(coordinator.activeAttemptToken == replacementToken)
        #expect(coordinator.lastResult?.stopReason == .timeLimitReached)

        let current = coordinator.finishActiveAttempt(
            replacementToken,
            at: start.advanced(by: 30_002),
            outcome: .terminalFailure
        )
        #expect(current?.sessionResult?.stopReason == .terminalFailure)
        #expect(coordinator.activeSession == nil)
    }

    @Test("이전 retry attempt token은 같은 세션의 다음 attempt에 적용되지 않는다")
    func priorAttemptTokenCannotFinishNextAttempt() {
        var coordinator = SyncCoordinator()
        let start = MonotonicInstant(milliseconds: 0)
        _ = coordinator.handle(.appLaunch, at: start)
        let firstToken = coordinator.startActiveAttempt(at: start)!
        _ = coordinator.finishActiveAttempt(
            firstToken,
            at: start.advanced(by: 1),
            outcome: .retryableFailure
        )
        let secondToken = coordinator.startActiveAttempt(at: start.advanced(by: 2))!

        let stale = coordinator.finishActiveAttempt(
            firstToken,
            at: start.advanced(by: 3),
            outcome: .converged
        )
        #expect(stale == nil)
        #expect(coordinator.activeAttemptToken == secondToken)

        let current = coordinator.finishActiveAttempt(
            secondToken,
            at: start.advanced(by: 4),
            outcome: .converged
        )
        #expect(current?.sessionResult?.succeeded == true)
    }

    @Test("다른 coordinator의 같은 번호 token도 적용되지 않는다")
    func foreignCoordinatorTokenIsRejected() {
        let start = MonotonicInstant(milliseconds: 0)
        var first = SyncCoordinator()
        var second = SyncCoordinator()
        _ = first.handle(.appLaunch, at: start)
        _ = second.handle(.appLaunch, at: start)
        let firstToken = first.startActiveAttempt(at: start)!
        let secondToken = second.startActiveAttempt(at: start)!

        #expect(firstToken.session.sessionID == secondToken.session.sessionID)
        #expect(firstToken != secondToken)
        #expect(
            second.finishActiveAttempt(
                firstToken,
                at: start.advanced(by: 1),
                outcome: .converged
            ) == nil
        )
        #expect(second.activeAttemptToken == secondToken)
    }

    @Test("pending trigger가 없는 deadline timer는 follow-up을 만들지 않는다")
    func deadlineTimerDoesNotRestartByItself() {
        var coordinator = SyncCoordinator()
        let start = MonotonicInstant(milliseconds: 0)
        _ = coordinator.handle(.appLaunch, at: start)
        _ = coordinator.startActiveAttempt(at: start)

        let timeout = coordinator.advanceActiveSessionTime(
            to: start.advanced(by: 30_000)
        )

        #expect(timeout?.sessionResult?.stopReason == .timeLimitReached)
        #expect(timeout?.followUpAction == nil)
        #expect(coordinator.sessionsStarted == 1)
        #expect(coordinator.activeSession == nil)
    }

    @Test("모든 lifecycle·network·peer·사용자 trigger가 제한 세션을 시작할 수 있다")
    func meaningfulTriggersStartSessions() {
        let triggers: [SyncTrigger] = [
            .appLaunch, .wake, .foreground, .networkChanged, .peerDiscovered, .manualRefresh
        ]

        for (index, trigger) in triggers.enumerated() {
            var coordinator = SyncCoordinator()
            let action = coordinator.handle(
                trigger,
                at: MonotonicInstant(milliseconds: Int64(index))
            )
            #expect(action == .started(sessionID: 1, cause: .trigger(trigger)))
        }
    }

    @Test("시계 변경은 동기화 세션을 시작하지 않는다")
    func clockChangeDoesNotStartSync() {
        var coordinator = SyncCoordinator()

        let action = coordinator.handle(
            .systemClockChanged,
            at: MonotonicInstant(milliseconds: 0)
        )

        #expect(action == .ignored(.clockChangeIsNotSyncTrigger))
        #expect(coordinator.sessionsStarted == 0)
        #expect(coordinator.activeSession == nil)
    }

    @Test("실패 뒤 timer만으로 재시작하지 않고 의미 있는 trigger가 다시 연다")
    func failureNeedsMeaningfulTriggerBeforeCadenceCanRestart() {
        var coordinator = SyncCoordinator()
        let start = MonotonicInstant(milliseconds: 0)
        #expect(
            coordinator.handle(.appLaunch, at: start)
                == .started(sessionID: 1, cause: .trigger(.appLaunch))
        )

        for index in 0..<3 {
            let attemptStart = start.advanced(by: Int64(index * 10))
            let token = coordinator.startActiveAttempt(at: attemptStart)
            #expect(token != nil)
            guard let token else { continue }
            _ = coordinator.finishActiveAttempt(
                token,
                at: attemptStart.advanced(by: 1),
                outcome: .retryableFailure
            )
        }

        #expect(coordinator.activeSession == nil)
        #expect(coordinator.lastResult?.stopReason == .attemptLimitReached)
        #expect(coordinator.cadenceSuppressedAfterFailure)

        let timerOnly = coordinator.handleCadenceTick(at: start.advanced(by: 30_000))
        #expect(timerOnly == .ignored(.failedSessionRequiresMeaningfulTrigger))
        #expect(coordinator.sessionsStarted == 1)

        let meaningful = coordinator.handle(
            .manualRefresh,
            at: start.advanced(by: 30_001)
        )
        #expect(meaningful == .started(sessionID: 2, cause: .trigger(.manualRefresh)))
        #expect(coordinator.sessionsStarted == 2)
        #expect(coordinator.cadenceSuppressedAfterFailure == false)
    }

    @Test("성공 뒤 정상 cadence는 다음 세션을 시작할 수 있다")
    func successAllowsCadenceSession() {
        var coordinator = SyncCoordinator()
        let start = MonotonicInstant(milliseconds: 0)
        _ = coordinator.handle(.wake, at: start)
        let token = coordinator.startActiveAttempt(at: start)
        #expect(token != nil)
        let completion = coordinator.finishActiveAttempt(
            token!,
            at: start.advanced(by: 10),
            outcome: .converged
        )
        #expect(completion?.sessionResult?.succeeded == true)

        let cadence = coordinator.handleCadenceTick(at: start.advanced(by: 30_000))
        #expect(cadence == .started(sessionID: 2, cause: .cadence))
        #expect(coordinator.peakConcurrentSessionCount == 1)
    }
}
