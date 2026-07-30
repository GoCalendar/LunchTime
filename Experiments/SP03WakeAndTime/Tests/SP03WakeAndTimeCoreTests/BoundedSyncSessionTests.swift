import Testing

@testable import SP03WakeAndTimeCore

@Suite("SP-03 제한 동기화 세션")
struct BoundedSyncSessionTests {
    @Test("재시도 실패는 정확히 세 번 뒤 멈추고 네 번째 시도를 시작하지 않는다")
    func attemptLimitStopsAtThree() {
        var session = BoundedSyncSession(startedAt: MonotonicInstant(milliseconds: 1_000))

        for index in 0..<3 {
            let started = session.startAttempt(
                at: MonotonicInstant(milliseconds: 1_000 + Int64(index * 10))
            )
            #expect(started)
            let result = session.finishAttempt(
                at: MonotonicInstant(milliseconds: 1_001 + Int64(index * 10)),
                outcome: .retryableFailure
            )
            if index < 2 {
                #expect(result == nil)
            }
        }

        #expect(session.result?.stopReason == .attemptLimitReached)
        #expect(session.result?.attemptsUsed == 3)
        #expect(session.startAttempt(at: MonotonicInstant(milliseconds: 2_000)) == false)
        #expect(session.attemptsStarted == 3)
    }

    @Test("단조 deadline 30000ms에서 세션을 끝낸다")
    func timeLimitUsesMonotonicDeadline() {
        let start = MonotonicInstant(milliseconds: 50_000)
        var session = BoundedSyncSession(startedAt: start)

        let started = session.startAttempt(at: start)
        #expect(started)
        let result = session.advanceTime(to: start.advanced(by: 30_000))

        #expect(result?.stopReason == .timeLimitReached)
        #expect(result?.elapsedMilliseconds == 30_000)
        #expect(result?.endedAt == start.advanced(by: 30_000))
        #expect(session.startAttempt(at: start.advanced(by: 30_001)) == false)
    }

    @Test("deadline을 넘겨 도착한 시도 결과는 성공으로 바뀌지 않는다")
    func lateAttemptCompletionTimesOut() {
        let start = MonotonicInstant(milliseconds: 0)
        var session = BoundedSyncSession(startedAt: start)

        let started = session.startAttempt(at: start)
        #expect(started)
        let result = session.finishAttempt(
            at: start.advanced(by: 31_000),
            outcome: .converged
        )

        #expect(result?.stopReason == .timeLimitReached)
        #expect(result?.elapsedMilliseconds == 30_000)
        #expect(result?.succeeded == false)
    }

    @Test("정상 수렴은 실제 단조 소요 시간과 시도 수를 보존한다")
    func convergenceReportsMonotonicDuration() {
        let start = MonotonicInstant(milliseconds: 10_000)
        var session = BoundedSyncSession(startedAt: start)

        let started = session.startAttempt(at: start.advanced(by: 100))
        #expect(started)
        let result = session.finishAttempt(
            at: start.advanced(by: 4_321),
            outcome: .converged
        )

        #expect(result?.stopReason == .converged)
        #expect(result?.attemptsUsed == 1)
        #expect(result?.elapsedMilliseconds == 4_321)
        #expect(result?.succeeded == true)
    }

    @Test("단조 시각과 wall clock 시각은 별도 값으로 유지된다")
    func monotonicAndWallClockAreSeparatePrimitives() {
        let monotonic = MonotonicInstant(milliseconds: 10)
        let wall = WallClockInstant(millisecondsSinceUnixEpoch: 10)

        #expect(monotonic.advanced(by: 5).milliseconds == 15)
        #expect(wall.millisecondsSinceUnixEpoch == 10)
    }
}
