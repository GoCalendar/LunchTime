import Testing

@testable import SP03WakeAndTimeCore

@Suite("SP-03 anti-entropy cadence")
struct AntiEntropyCadenceTests {
    @Test("정상 조건에서는 늦어도 30000ms에 다시 due가 된다")
    func normalConditionsAreDueWithinThirtySeconds() {
        var cadence = AntiEntropyCadence()
        let start = MonotonicInstant(milliseconds: 5_000)

        #expect(cadence.decision(at: start, conditions: .normal) == .due)
        cadence.recordSessionStarted(at: start)
        #expect(
            cadence.decision(at: start.advanced(by: 29_999), conditions: .normal)
                == .waiting(remainingMilliseconds: 1)
        )
        #expect(
            cadence.decision(at: start.advanced(by: 30_000), conditions: .normal)
                == .due
        )
    }

    @Test("동기화할 데이터가 없으면 cadence를 중단한다")
    func noDataSuspendsCadence() {
        let cadence = AntiEntropyCadence()
        let conditions = AntiEntropyConditions(
            hasData: false,
            hasHealthyPeer: true,
            dailyWriteClosed: false
        )

        #expect(
            cadence.decision(
                at: MonotonicInstant(milliseconds: 0),
                conditions: conditions
            ) == .suspended(.noData)
        )
    }

    @Test("정상 Peer가 없으면 cadence를 중단한다")
    func noHealthyPeerSuspendsCadence() {
        let cadence = AntiEntropyCadence()
        let conditions = AntiEntropyConditions(
            hasData: true,
            hasHealthyPeer: false,
            dailyWriteClosed: false
        )

        #expect(
            cadence.decision(
                at: MonotonicInstant(milliseconds: 0),
                conditions: conditions
            ) == .suspended(.noHealthyPeer)
        )
    }

    @Test("14:30 terminal close 뒤에는 다른 조건과 무관하게 cadence를 중단한다")
    func dailyCloseSuspendsCadence() {
        let cadence = AntiEntropyCadence()
        let conditions = AntiEntropyConditions(
            hasData: true,
            hasHealthyPeer: true,
            dailyWriteClosed: true
        )

        #expect(
            cadence.decision(
                at: MonotonicInstant(milliseconds: 100_000),
                conditions: conditions
            ) == .suspended(.dailyWriteClosed)
        )
    }

    @Test("중단 조건이 사라지면 오래된 cadence는 즉시 due가 된다")
    func resumedNormalConditionsBecomeDue() {
        let start = MonotonicInstant(milliseconds: 0)
        var cadence = AntiEntropyCadence()
        cadence.recordSessionStarted(at: start)

        let suspended = AntiEntropyConditions(
            hasData: false,
            hasHealthyPeer: true,
            dailyWriteClosed: false
        )
        #expect(
            cadence.decision(at: start.advanced(by: 35_000), conditions: suspended)
                == .suspended(.noData)
        )
        #expect(
            cadence.decision(at: start.advanced(by: 35_000), conditions: .normal)
                == .due
        )
    }
}
