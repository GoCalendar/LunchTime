import Testing

@testable import SP03WakeAndTimeCore

@Suite("SP-03 시계 차이 중 늦은 이벤트")
struct LateEventClockSafetyTests {
    @Test("14:30 이전 생성 여부를 검증할 수 없으면 열람용 스냅샷만 계산한다")
    func unverifiableLateEventCannotCorrectSuccess() {
        let disposition = LateEventClockSafety.disposition(
            for: .claimedBeforeCutoffButUnverifiable
        )

        #expect(disposition.includeInReadOnlySnapshot)
        #expect(!disposition.permitsAutomaticSuccessCorrection)
        #expect(!disposition.permitsAutomaticOrderCompletionCorrection)
        #expect(!disposition.permitsAutomaticSuccessHistoryCorrection)
        #expect(disposition.requiresIncompleteFinalization)
    }

    @Test("검증된 14:30 이전 이벤트만 정상 재계산 후보가 된다")
    func verifiedPreCutoffEventCanUseNormalRecalculation() {
        let disposition = LateEventClockSafety.disposition(for: .verifiedBeforeCutoff)

        #expect(disposition.includeInReadOnlySnapshot)
        #expect(disposition.permitsAutomaticSuccessCorrection)
        #expect(disposition.permitsAutomaticOrderCompletionCorrection)
        #expect(disposition.permitsAutomaticSuccessHistoryCorrection)
        #expect(!disposition.requiresIncompleteFinalization)
    }

    @Test("14:30 이후 생성이 확인된 이벤트를 종료 이전 동작으로 소급하지 않는다")
    func verifiedPostCutoffEventIsNotRetroactive() {
        let disposition = LateEventClockSafety.disposition(for: .verifiedAtOrAfterCutoff)

        #expect(!disposition.includeInReadOnlySnapshot)
        #expect(!disposition.permitsAutomaticSuccessCorrection)
        #expect(!disposition.permitsAutomaticOrderCompletionCorrection)
        #expect(!disposition.permitsAutomaticSuccessHistoryCorrection)
        #expect(!disposition.requiresIncompleteFinalization)
    }
}
