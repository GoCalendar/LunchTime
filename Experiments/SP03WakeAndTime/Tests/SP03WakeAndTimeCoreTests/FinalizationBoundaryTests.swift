import Foundation
import Testing

@testable import SP03WakeAndTimeCore

@Suite("SP-03 일일 쓰기와 finalization 경계")
struct FinalizationBoundaryTests {
    private func wallTime(_ value: String) -> WallClockInstant {
        let date = ISO8601DateFormatter().date(from: value)!
        return WallClockInstant(
            millisecondsSinceUnixEpoch: Int64((date.timeIntervalSince1970 * 1_000).rounded())
        )
    }

    @Test("KST 쓰기 창은 11:00 이상 14:30 미만의 반열린 구간이다")
    func dailyWindowIsHalfOpen() {
        var boundary = DailyWriteBoundary(
            operatingDayContaining: wallTime("2026-07-30T10:00:00+09:00")
        )

        #expect(boundary.observe(wallTime: wallTime("2026-07-30T10:59:59+09:00")) == .waiting)
        #expect(boundary.observe(wallTime: wallTime("2026-07-30T11:00:00+09:00")) == .writable)
        #expect(boundary.observe(wallTime: wallTime("2026-07-30T14:29:59+09:00")) == .writable)
        #expect(boundary.observe(wallTime: wallTime("2026-07-30T14:30:00+09:00")) == .closed)
    }

    @Test("14:30 종료 뒤 벽시계를 되돌려도 쓰기를 다시 열지 않는다")
    func wallClockRollbackDoesNotReopen() {
        var boundary = DailyWriteBoundary(
            operatingDayContaining: wallTime("2026-07-30T11:00:00+09:00")
        )

        #expect(boundary.observe(wallTime: wallTime("2026-07-30T14:30:00+09:00")) == .closed)
        #expect(boundary.isTerminallyClosed)
        #expect(boundary.observe(wallTime: wallTime("2026-07-30T12:00:00+09:00")) == .closed)
    }

    @Test("14:30 terminal close는 process 재생성·rollback·time zone 변경 뒤에도 복원된다")
    func persistedTerminalCloseDoesNotReopen() {
        var original = DailyWriteBoundary(
            operatingDayContaining: wallTime("2026-07-30T11:00:00+09:00")
        )
        #expect(
            original.observe(wallTime: wallTime("2026-07-30T14:30:00+09:00"))
                == .closed
        )

        let durableSnapshot = original.snapshot
        var restored = DailyWriteBoundary(restoring: durableSnapshot)

        #expect(durableSnapshot.isTerminallyClosed)
        #expect(restored.operatingDayStart == original.operatingDayStart)
        #expect(
            restored.observe(wallTime: wallTime("2026-07-29T20:00:00-07:00"))
                == .closed
        )
        #expect(
            restored.observe(wallTime: wallTime("2026-07-30T12:00:00+09:00"))
                == .closed
        )
    }

    @Test("다음 KST 운영일은 이전 snapshot을 재사용하지 않고 새 경계로 시작한다")
    func nextOperatingDayRequiresNewBoundary() {
        var previous = DailyWriteBoundary(
            operatingDayContaining: wallTime("2026-07-30T11:00:00+09:00")
        )
        _ = previous.observe(wallTime: wallTime("2026-07-30T14:30:00+09:00"))

        var restoredPrevious = DailyWriteBoundary(restoring: previous.snapshot)
        #expect(
            restoredPrevious.observe(wallTime: wallTime("2026-07-31T11:00:00+09:00"))
                == .closed
        )

        var nextDay = DailyWriteBoundary(
            operatingDayContaining: wallTime("2026-07-31T11:00:00+09:00")
        )
        #expect(
            nextDay.observe(wallTime: wallTime("2026-07-31T11:00:00+09:00"))
                == .writable
        )
    }

    @Test("14:30에 잠들어 있던 기기는 복귀 첫 관측에서 바로 닫힌다")
    func resumeAfterCutoffClosesBeforeWriting() {
        var boundary = DailyWriteBoundary(
            operatingDayContaining: wallTime("2026-07-30T13:00:00+09:00")
        )

        #expect(boundary.observe(wallTime: wallTime("2026-07-30T15:00:00+09:00")) == .closed)
        #expect(boundary.isTerminallyClosed)
    }

    @Test("finalization은 monotonic 120000ms에 불완전 종료한다")
    func outerLimitIsMonotonicAndInclusive() {
        var coordinator = FinalizationCoordinator()
        coordinator.start(at: MonotonicInstant(milliseconds: 5_000))

        #expect(
            coordinator.advance(to: MonotonicInstant(milliseconds: 124_999))
                == .running
        )
        #expect(
            coordinator.advance(to: MonotonicInstant(milliseconds: 125_000))
                == .incomplete(.latestRevisionUnconfirmedAtOuterLimit)
        )
    }

    @Test("finalization limit는 양수 축소값만 허용하고 정책 상한을 넘지 않는다")
    func limitsStayWithinPolicyMaxima() {
        let reduced = FinalizationLimits(
            outerMilliseconds: 60_000,
            innerMaxAttempts: 2,
            innerMaxElapsedMilliseconds: 15_000
        )

        #expect(reduced.outerMilliseconds == 60_000)
        #expect(reduced.innerMaxAttempts == 2)
        #expect(reduced.innerMaxElapsedMilliseconds == 15_000)

        var outerCoordinator = FinalizationCoordinator(limits: reduced)
        outerCoordinator.start(at: MonotonicInstant(milliseconds: 0))
        #expect(
            outerCoordinator.advance(to: MonotonicInstant(milliseconds: 59_999))
                == .running
        )
        #expect(
            outerCoordinator.advance(to: MonotonicInstant(milliseconds: 60_000))
                == .incomplete(.latestRevisionUnconfirmedAtOuterLimit)
        )

        for result in [
            FinalizationSessionResult(
                attemptsUsed: 3,
                elapsedMilliseconds: 15_000,
                latestRevisionConfirmed: true
            ),
            FinalizationSessionResult(
                attemptsUsed: 2,
                elapsedMilliseconds: 15_001,
                latestRevisionConfirmed: true
            )
        ] {
            var innerCoordinator = FinalizationCoordinator(limits: reduced)
            innerCoordinator.start(at: MonotonicInstant(milliseconds: 0))
            #expect(
                innerCoordinator.record(
                    result,
                    at: MonotonicInstant(milliseconds: 15_000)
                ) == .incomplete(.innerSessionLimitViolated)
            )
        }

        #expect(
            FinalizationLimits.isWithinPolicyBounds(
                outerMilliseconds: 120_000,
                innerMaxAttempts: 3,
                innerMaxElapsedMilliseconds: 30_000
            )
        )
        #expect(
            !FinalizationLimits.isWithinPolicyBounds(
                outerMilliseconds: 120_001,
                innerMaxAttempts: 3,
                innerMaxElapsedMilliseconds: 30_000
            )
        )
        #expect(
            !FinalizationLimits.isWithinPolicyBounds(
                outerMilliseconds: 120_000,
                innerMaxAttempts: 4,
                innerMaxElapsedMilliseconds: 30_000
            )
        )
        #expect(
            !FinalizationLimits.isWithinPolicyBounds(
                outerMilliseconds: 120_000,
                innerMaxAttempts: 3,
                innerMaxElapsedMilliseconds: 30_001
            )
        )
        #expect(
            !FinalizationLimits.isWithinPolicyBounds(
                outerMilliseconds: 0,
                innerMaxAttempts: 1,
                innerMaxElapsedMilliseconds: 1
            )
        )
        #expect(
            !FinalizationLimits.isWithinPolicyBounds(
                outerMilliseconds: 1,
                innerMaxAttempts: 0,
                innerMaxElapsedMilliseconds: 1
            )
        )
        #expect(
            !FinalizationLimits.isWithinPolicyBounds(
                outerMilliseconds: 1,
                innerMaxAttempts: 1,
                innerMaxElapsedMilliseconds: 0
            )
        )
    }

    @Test("inner session의 정확한 3회 30000ms 결과는 상한 안이다")
    func innerLimitBoundaryCanComplete() {
        var coordinator = FinalizationCoordinator()
        coordinator.start(at: MonotonicInstant(milliseconds: 0))

        let state = coordinator.record(
            FinalizationSessionResult(
                attemptsUsed: 3,
                elapsedMilliseconds: 30_000,
                latestRevisionConfirmed: true
            ),
            at: MonotonicInstant(milliseconds: 30_000)
        )

        #expect(state == .complete)
        #expect(coordinator.sessionsObserved == 1)
    }

    @Test("inner session이 3회 또는 30000ms를 넘으면 불완전 종료한다")
    func rejectsInnerSessionLimitViolation() {
        for result in [
            FinalizationSessionResult(
                attemptsUsed: 4,
                elapsedMilliseconds: 30_000,
                latestRevisionConfirmed: true
            ),
            FinalizationSessionResult(
                attemptsUsed: 3,
                elapsedMilliseconds: 30_001,
                latestRevisionConfirmed: true
            )
        ] {
            var coordinator = FinalizationCoordinator()
            coordinator.start(at: MonotonicInstant(milliseconds: 0))
            #expect(
                coordinator.record(result, at: MonotonicInstant(milliseconds: 30_000))
                    == .incomplete(.innerSessionLimitViolated)
            )
        }
    }

    @Test("미확인 inner session은 자동 재시작하지 않고 outer deadline을 기다린다")
    func unresolvedSessionDoesNotRestartItself() {
        var coordinator = FinalizationCoordinator()
        coordinator.start(at: MonotonicInstant(milliseconds: 0))
        coordinator.record(
            FinalizationSessionResult(
                attemptsUsed: 3,
                elapsedMilliseconds: 30_000,
                latestRevisionConfirmed: false
            ),
            at: MonotonicInstant(milliseconds: 30_000)
        )

        #expect(coordinator.state == .running)
        #expect(coordinator.sessionsObserved == 1)
        #expect(
            coordinator.advance(to: MonotonicInstant(milliseconds: 120_000))
                == .incomplete(.latestRevisionUnconfirmedAtOuterLimit)
        )
        #expect(coordinator.sessionsObserved == 1)
    }

    @Test("complete와 incomplete는 다시 시작해도 열리지 않는 terminal 상태다")
    func terminalStateCannotRestart() {
        var complete = FinalizationCoordinator()
        complete.start(at: MonotonicInstant(milliseconds: 0))
        complete.record(
            FinalizationSessionResult(
                attemptsUsed: 1,
                elapsedMilliseconds: 1,
                latestRevisionConfirmed: true
            ),
            at: MonotonicInstant(milliseconds: 1)
        )
        #expect(complete.start(at: MonotonicInstant(milliseconds: 2)) == .complete)

        var incomplete = FinalizationCoordinator()
        incomplete.start(at: MonotonicInstant(milliseconds: 0))
        incomplete.advance(to: MonotonicInstant(milliseconds: 120_000))
        #expect(
            incomplete.start(at: MonotonicInstant(milliseconds: 120_001))
                == .incomplete(.latestRevisionUnconfirmedAtOuterLimit)
        )
    }
}
