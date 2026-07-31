import Foundation

/// 이슈 #4의 완료 조건을 결정적으로 재현하는 시나리오 catalog.
public enum ScenarioCatalog {
    public static let all: [WakeTimeScenario] = [
        triggerBurstCoalesces,
        attemptLimitStopsSession,
        timeLimitStopsSession,
        failedSessionDoesNotSelfRestart,
        normalCadenceIsBounded,
        cadenceSuspendsWithoutPrerequisites,
        dailyCloseNeverReopens,
        finalizationStopsAtOuterLimit,
        localOnlyBaselineAllowsWithoutPeer,
        sharedCandidatePassDoesNotOpenReleaseGate,
        eligiblePeersMustAllAgree,
        clockExceededBlocksSensitiveWrites,
        clockUncertaintyBlocksSensitiveWrites,
        systemClockChangeInvalidatesValidation,
        unverifiableLateEventIsReadOnly
    ]

    public static func named(_ name: String) -> WakeTimeScenario? {
        all.first { $0.name == name }
    }

    private static let triggerBurstCoalesces = WakeTimeScenario(
        name: "trigger-burst-coalesces",
        question: "겹친 lifecycle·network trigger가 동시 세션을 하나만 만드는가?",
        traceIDs: ["PRD-01-FR-09", "PRD-01-FR-10", "PRD-01-AC-03", "POL-02-R-02"],
        expectations: [
            "coalescedTriggers": "99",
            "peakConcurrentSessions": "1",
            "sessionsStarted": "1"
        ]
    ) {
        var coordinator = SyncCoordinator()
        let triggers: [SyncTrigger] = [
            .appLaunch, .foreground, .wake, .networkChanged, .peerDiscovered
        ]
        for index in 0..<100 {
            _ = coordinator.handle(
                triggers[index % triggers.count],
                at: MonotonicInstant(milliseconds: Int64(index))
            )
        }
        return [
            "coalescedTriggers": "\(coordinator.coalescedTriggerCount)",
            "peakConcurrentSessions": "\(coordinator.peakConcurrentSessionCount)",
            "sessionsStarted": "\(coordinator.sessionsStarted)"
        ]
    }

    private static let attemptLimitStopsSession = WakeTimeScenario(
        name: "attempt-limit-stops-session",
        question: "재시도 실패가 세 번째 시도에서 멈추는가?",
        traceIDs: ["PRD-01-AC-03", "POL-02-R-02"],
        expectations: [
            "attempts": "3",
            "elapsedAtMost30000": "true",
            "stopReason": "attemptLimitReached"
        ]
    ) {
        var session = BoundedSyncSession(startedAt: MonotonicInstant(milliseconds: 0))
        for attempt in 0..<3 {
            let start = MonotonicInstant(milliseconds: Int64(attempt * 1_000))
            let end = start.advanced(by: 500)
            _ = session.startAttempt(at: start)
            _ = session.finishAttempt(at: end, outcome: .retryableFailure)
        }
        let result = session.result!
        return [
            "attempts": "\(result.attemptsUsed)",
            "elapsedAtMost30000": "\(result.elapsedMilliseconds <= 30_000)",
            "stopReason": result.stopReason.rawValue
        ]
    }

    private static let timeLimitStopsSession = WakeTimeScenario(
        name: "time-limit-stops-session",
        question: "진행 중 시도가 있어도 단조 30초 바깥 한도에서 취소되는가?",
        traceIDs: ["PRD-01-AC-03", "POL-02-R-02"],
        expectations: [
            "attempts": "1",
            "elapsed": "30000",
            "stopReason": "timeLimitReached"
        ]
    ) {
        var session = BoundedSyncSession(startedAt: MonotonicInstant(milliseconds: 10_000))
        _ = session.startAttempt(at: MonotonicInstant(milliseconds: 10_000))
        _ = session.advanceTime(to: MonotonicInstant(milliseconds: 40_000))
        let result = session.result!
        return [
            "attempts": "\(result.attemptsUsed)",
            "elapsed": "\(result.elapsedMilliseconds)",
            "stopReason": result.stopReason.rawValue
        ]
    }

    private static let failedSessionDoesNotSelfRestart = WakeTimeScenario(
        name: "failed-session-does-not-self-restart",
        question: "실패 뒤 cadence timer는 멈추고 새 의미 있는 trigger만 한 세션을 여는가?",
        traceIDs: ["PRD-01-FR-09", "PRD-01-AC-03", "POL-02-R-02"],
        expectations: [
            "cadenceIgnored": "true",
            "manualRefreshStarted": "true",
            "sessionsAfterTimer": "1",
            "sessionsAfterTrigger": "2"
        ]
    ) {
        var coordinator = SyncCoordinator()
        _ = coordinator.handle(.appLaunch, at: MonotonicInstant(milliseconds: 0))
        let token = coordinator.startActiveAttempt(
            at: MonotonicInstant(milliseconds: 0)
        )!
        _ = coordinator.finishActiveAttempt(
            token,
            at: MonotonicInstant(milliseconds: 1),
            outcome: .terminalFailure
        )
        let cadence = coordinator.handleCadenceTick(at: MonotonicInstant(milliseconds: 30_000))
        let afterTimer = coordinator.sessionsStarted
        let refresh = coordinator.handle(
            .manualRefresh,
            at: MonotonicInstant(milliseconds: 30_001)
        )
        return [
            "cadenceIgnored": "\(cadence == .ignored(.failedSessionRequiresMeaningfulTrigger))",
            "manualRefreshStarted": "\(isStarted(refresh))",
            "sessionsAfterTimer": "\(afterTimer)",
            "sessionsAfterTrigger": "\(coordinator.sessionsStarted)"
        ]
    }

    private static let normalCadenceIsBounded = WakeTimeScenario(
        name: "normal-anti-entropy-within-30-seconds",
        question: "정상 조건의 다음 대조가 마지막 시작에서 30초 이내에 due가 되는가?",
        traceIDs: ["PRD-01-FR-09", "PRD-01-AC-03", "POL-02-R-02"],
        expectations: [
            "at29999": "waiting:1",
            "at30000": "due",
            "interval": "30000"
        ]
    ) {
        var cadence = AntiEntropyCadence()
        cadence.recordSessionStarted(at: MonotonicInstant(milliseconds: 5_000))
        return [
            "at29999": cadenceDescription(
                cadence.decision(
                    at: MonotonicInstant(milliseconds: 34_999),
                    conditions: .normal
                )
            ),
            "at30000": cadenceDescription(
                cadence.decision(
                    at: MonotonicInstant(milliseconds: 35_000),
                    conditions: .normal
                )
            ),
            "interval": "\(cadence.intervalMilliseconds)"
        ]
    }

    private static let cadenceSuspendsWithoutPrerequisites = WakeTimeScenario(
        name: "anti-entropy-suspends-without-prerequisites",
        question: "데이터·정상 Peer 부재와 14:30 종료가 주기 대조를 중단하는가?",
        traceIDs: ["PRD-01-FR-01", "PRD-01-FR-09", "POL-02-R-02"],
        expectations: [
            "closed": "suspended:dailyWriteClosed",
            "noData": "suspended:noData",
            "noPeer": "suspended:noHealthyPeer"
        ]
    ) {
        let cadence = AntiEntropyCadence()
        let now = MonotonicInstant(milliseconds: 0)
        return [
            "closed": cadenceDescription(
                cadence.decision(
                    at: now,
                    conditions: AntiEntropyConditions(
                        hasData: true,
                        hasHealthyPeer: true,
                        dailyWriteClosed: true
                    )
                )
            ),
            "noData": cadenceDescription(
                cadence.decision(
                    at: now,
                    conditions: AntiEntropyConditions(
                        hasData: false,
                        hasHealthyPeer: true,
                        dailyWriteClosed: false
                    )
                )
            ),
            "noPeer": cadenceDescription(
                cadence.decision(
                    at: now,
                    conditions: AntiEntropyConditions(
                        hasData: true,
                        hasHealthyPeer: false,
                        dailyWriteClosed: false
                    )
                )
            )
        ]
    }

    private static let dailyCloseNeverReopens = WakeTimeScenario(
        name: "daily-close-never-reopens",
        question: "14:30 이후 복귀하거나 벽시계를 되돌려도 쓰기가 다시 열리지 않는가?",
        traceIDs: ["PRD-01-FR-01", "PRD-01-AC-05", "POL-01-R-01", "POL-01-R-04"],
        expectations: [
            "at142959": "writable",
            "at143000": "closed",
            "afterRollback": "closed"
        ]
    ) {
        let before = koreaDate(hour: 14, minute: 29, second: 59)
        let cutoff = koreaDate(hour: 14, minute: 30, second: 0)
        let rolledBack = koreaDate(hour: 14, minute: 0, second: 0)
        var boundary = DailyWriteBoundary(operatingDayContaining: before)
        return [
            "at142959": boundary.observe(wallTime: before).rawValue,
            "at143000": boundary.observe(wallTime: cutoff).rawValue,
            "afterRollback": boundary.observe(wallTime: rolledBack).rawValue
        ]
    }

    private static let finalizationStopsAtOuterLimit = WakeTimeScenario(
        name: "finalization-completes-within-120-seconds",
        question: "최신 리비전을 확인하지 못한 finalization이 단조 120초에서 멈추는가?",
        traceIDs: ["PRD-01-FR-01", "PRD-01-AC-05", "POL-01-R-01", "POL-01-R-04"],
        expectations: [
            "innerAttemptsWithinLimit": "true",
            "sessionsObserved": "1",
            "stateAt120Seconds": "latestRevisionUnconfirmedAtOuterLimit"
        ]
    ) {
        var coordinator = FinalizationCoordinator()
        _ = coordinator.start(at: MonotonicInstant(milliseconds: 1_000))
        let session = FinalizationSessionResult(
            attemptsUsed: 3,
            elapsedMilliseconds: 30_000,
            latestRevisionConfirmed: false
        )
        _ = coordinator.record(session, at: MonotonicInstant(milliseconds: 31_000))
        let state = coordinator.advance(to: MonotonicInstant(milliseconds: 121_000))
        return [
            "innerAttemptsWithinLimit": "\(session.attemptsUsed <= 3)",
            "sessionsObserved": "\(coordinator.sessionsObserved)",
            "stateAt120Seconds": finalizationDescription(state)
        ]
    }

    private static let localOnlyBaselineAllowsWithoutPeer = WakeTimeScenario(
        name: "local-only-baseline-allows-without-peer",
        question: "local-only Room은 유효한 macOS baseline이면 Peer 없이 허용되는가?",
        traceIDs: ["PRD-01-AC-09", "PRD-01-SP-03", "POL-02-R-08"],
        expectations: [
            "releaseDecision": "allowed",
            "sharingHistory": "localOnly"
        ]
    ) {
        var gate = clockGate(sharingHistory: .localOnly)
        return [
            "releaseDecision": clockReleaseDecisionDescription(
                gate.releaseDecision(
                    for: .participationAcceptance,
                    at: MonotonicInstant(milliseconds: 1)
                )
            ),
            "sharingHistory": gate.sharingHistory.rawValue
        ]
    }

    private static let sharedCandidatePassDoesNotOpenReleaseGate = WakeTimeScenario(
        name: "shared-clock-candidate-does-not-open-release-gate",
        question: "공유 Room의 후보 판정 성공과 출시 허용이 분리되는가?",
        traceIDs: ["PRD-01-AC-09", "PRD-01-SP-03", "POL-02-R-08"],
        expectations: [
            "candidateDecision": "allowed",
            "evidenceStatus": "requiresRealDeviceEvidence",
            "releaseDecision": "blocked:pendingRealDeviceApproval",
            "state": "valid"
        ]
    ) {
        var gate = clockGate(sharingHistory: .everShared)
        let state = gate.validate(
            samples: clockSamples(offsetMilliseconds: 400),
            at: MonotonicInstant(milliseconds: 0)
        )
        let candidateDecision = gate.candidateDecision(
            for: .participationAcceptance,
            at: MonotonicInstant(milliseconds: 1)
        )
        return [
            "candidateDecision": clockDecisionDescription(candidateDecision),
            "evidenceStatus": gate.candidate.evidenceStatus.rawValue,
            "releaseDecision": clockReleaseDecisionDescription(
                gate.releaseDecision(
                    for: .participationAcceptance,
                    at: MonotonicInstant(milliseconds: 1)
                )
            ),
            "state": clockStateDescription(state)
        ]
    }

    private static let eligiblePeersMustAllAgree = WakeTimeScenario(
        name: "eligible-room-peers-must-all-agree",
        question: "각 eligible Room Peer의 최소 표본과 전체 충돌 검사가 fail-closed하는가?",
        traceIDs: ["PRD-01-FR-10", "PRD-01-SP-03", "POL-02-R-08"],
        expectations: [
            "conflictingPeers": "blocked:inconsistentSamples",
            "shortPeer": "blocked:insufficientSamples"
        ]
    ) {
        let peerA = EligibleRoomPeerClockSamples(
            peerID: "peer-a",
            samples: clockSamples(offsetMilliseconds: 400)
        )
        let peerB = EligibleRoomPeerClockSamples(
            peerID: "peer-b",
            samples: clockSamples(offsetMilliseconds: -400)
        )
        let shortPeer = EligibleRoomPeerClockSamples(
            peerID: "peer-b",
            samples: Array(clockSamples(offsetMilliseconds: 400).prefix(2))
        )

        var conflictGate = clockGate(sharingHistory: .everShared)
        let conflictingPeers = conflictGate.validate(
            eligiblePeers: [peerA, peerB],
            at: MonotonicInstant(milliseconds: 0)
        )
        var shortGate = clockGate(sharingHistory: .everShared)
        let insufficient = shortGate.validate(
            eligiblePeers: [peerA, shortPeer],
            at: MonotonicInstant(milliseconds: 0)
        )
        return [
            "conflictingPeers": clockStateDescription(conflictingPeers),
            "shortPeer": clockStateDescription(insufficient)
        ]
    }

    private static let clockExceededBlocksSensitiveWrites = WakeTimeScenario(
        name: "clock-skew-exceeded-blocks-writes",
        question: "허용 오차를 벗어난 시계가 세 민감 쓰기를 모두 차단하는가?",
        traceIDs: ["PRD-01-FR-01", "PRD-01-AC-09", "POL-02-R-08"],
        expectations: [
            "manualRefresh": "allowed",
            "orderDeadlineModification": "blocked:offsetExceeded",
            "orderStatusChange": "blocked:offsetExceeded",
            "participationAcceptance": "blocked:offsetExceeded"
        ]
    ) {
        var gate = clockGate(sharingHistory: .everShared)
        _ = gate.validate(
            samples: clockSamples(offsetMilliseconds: 1_500),
            at: MonotonicInstant(milliseconds: 0)
        )
        return [
            "manualRefresh": clockDecisionDescription(
                gate.candidateDecision(
                    for: .manualRefresh,
                    at: MonotonicInstant(milliseconds: 1)
                )
            ),
            "orderDeadlineModification": clockDecisionDescription(
                gate.candidateDecision(
                    for: .orderDeadlineModification,
                    at: MonotonicInstant(milliseconds: 1)
                )
            ),
            "orderStatusChange": clockDecisionDescription(
                gate.candidateDecision(
                    for: .orderStatusChange,
                    at: MonotonicInstant(milliseconds: 1)
                )
            ),
            "participationAcceptance": clockDecisionDescription(
                gate.candidateDecision(
                    for: .participationAcceptance,
                    at: MonotonicInstant(milliseconds: 1)
                )
            )
        ]
    }

    private static let clockUncertaintyBlocksSensitiveWrites = WakeTimeScenario(
        name: "clock-skew-unverifiable-blocks-writes",
        question: "불확실성 구간이 후보 경계를 걸치면 fail-closed하는가?",
        traceIDs: ["PRD-01-FR-10", "PRD-01-SP-03", "POL-02-R-08"],
        expectations: [
            "read": "allowed",
            "state": "blocked:uncertaintyCrossesTolerance",
            "write": "blocked:unverifiable:uncertaintyCrossesTolerance"
        ]
    ) {
        var gate = clockGate(sharingHistory: .everShared)
        let state = gate.validate(
            samples: clockSamples(
                offsetMilliseconds: 950,
                localRoundTripMilliseconds: 220,
                peerProcessingMilliseconds: 20
            ),
            at: MonotonicInstant(milliseconds: 0)
        )
        return [
            "read": clockDecisionDescription(
                gate.candidateDecision(
                    for: .read,
                    at: MonotonicInstant(milliseconds: 1)
                )
            ),
            "state": clockStateDescription(state),
            "write": clockDecisionDescription(
                gate.candidateDecision(
                    for: .orderStatusChange,
                    at: MonotonicInstant(milliseconds: 1)
                )
            )
        ]
    }

    private static let systemClockChangeInvalidatesValidation = WakeTimeScenario(
        name: "system-clock-change-invalidates-validation",
        question: "시계 변경 복구 상태가 durable하고 공유 Room은 fresh Peer 재검증을 요구하는가?",
        traceIDs: ["PRD-01-FR-10", "POL-02-R-08"],
        expectations: [
            "before": "allowed",
            "durableAfterRelaunch": "recoveryRequired",
            "releaseAfterPeer": "blocked:pendingRealDeviceApproval",
            "sensitiveWriteAfter": "blocked:systemClockChanged",
            "sensitiveWriteAfterBaseline": "blocked:notValidated",
            "sensitiveWriteAfterPeer": "allowed"
        ]
    ) {
        var gate = clockGate(sharingHistory: .everShared)
        _ = gate.validate(
            samples: clockSamples(offsetMilliseconds: 100),
            at: MonotonicInstant(milliseconds: 0)
        )
        let before = gate.candidateDecision(
            for: .orderStatusChange,
            at: MonotonicInstant(milliseconds: 1)
        )
        gate.recordSystemClockChange()
        let after = gate.candidateDecision(
            for: .orderStatusChange,
            at: MonotonicInstant(milliseconds: 2)
        )
        var relaunched = ClockSkewGate(
            sharingHistory: gate.sharingHistory,
            durableRecoveryState: gate.durableRecoveryState
        )
        let durableAfterRelaunch = relaunched.durableRecoveryState.rawValue
        relaunched.recoverAfterUserClockCheckAndManualRefresh(
            wallTime: WallClockInstant(millisecondsSinceUnixEpoch: 2_000_000),
            monotonicTime: MonotonicInstant(milliseconds: 3)
        )
        let afterBaseline = relaunched.candidateDecision(
            for: .orderStatusChange,
            at: MonotonicInstant(milliseconds: 3)
        )
        _ = relaunched.validate(
            samples: clockSamples(offsetMilliseconds: 100),
            at: MonotonicInstant(milliseconds: 4)
        )
        return [
            "before": clockDecisionDescription(before),
            "durableAfterRelaunch": durableAfterRelaunch,
            "releaseAfterPeer": clockReleaseDecisionDescription(
                relaunched.releaseDecision(
                    for: .orderStatusChange,
                    at: MonotonicInstant(milliseconds: 4)
                )
            ),
            "sensitiveWriteAfter": clockDecisionDescription(after),
            "sensitiveWriteAfterBaseline": clockDecisionDescription(afterBaseline),
            "sensitiveWriteAfterPeer": clockDecisionDescription(
                relaunched.candidateDecision(
                    for: .orderStatusChange,
                    at: MonotonicInstant(milliseconds: 4)
                )
            )
        ]
    }

    private static let unverifiableLateEventIsReadOnly = WakeTimeScenario(
        name: "unverifiable-late-event-is-read-only",
        question: "14:30 이전 생성 여부를 검증할 수 없는 늦은 이벤트가 성공을 자동 정정하지 않는가?",
        traceIDs: ["PRD-01-AC-05", "PRD-01-AC-09", "POL-02-R-08"],
        expectations: [
            "automaticHistoryCorrection": "false",
            "automaticOrderCorrection": "false",
            "automaticSuccessCorrection": "false",
            "readOnlySnapshot": "true",
            "requiresIncompleteFinalization": "true"
        ]
    ) {
        let result = LateEventClockSafety.disposition(
            for: .claimedBeforeCutoffButUnverifiable
        )
        return [
            "automaticHistoryCorrection": "\(result.permitsAutomaticSuccessHistoryCorrection)",
            "automaticOrderCorrection": "\(result.permitsAutomaticOrderCompletionCorrection)",
            "automaticSuccessCorrection": "\(result.permitsAutomaticSuccessCorrection)",
            "readOnlySnapshot": "\(result.includeInReadOnlySnapshot)",
            "requiresIncompleteFinalization": "\(result.requiresIncompleteFinalization)"
        ]
    }

    private static func isStarted(_ action: SyncCoordinatorAction) -> Bool {
        if case .started = action { return true }
        return false
    }

    private static func cadenceDescription(_ decision: AntiEntropyCadenceDecision) -> String {
        switch decision {
        case .due:
            "due"
        case let .waiting(remainingMilliseconds):
            "waiting:\(remainingMilliseconds)"
        case let .suspended(reason):
            "suspended:\(reason.rawValue)"
        }
    }

    private static func finalizationDescription(_ state: FinalizationState) -> String {
        switch state {
        case .notStarted: "notStarted"
        case .running: "running"
        case .complete: "complete"
        case let .incomplete(reason): reason.rawValue
        }
    }

    private static func clockStateDescription(_ state: ClockValidationState) -> String {
        switch state {
        case .unverified:
            "unverified"
        case .valid:
            "valid"
        case let .blocked(reason):
            switch reason {
            case let .unverifiable(unverifiable):
                "blocked:\(unverifiable.rawValue)"
            case .notValidated:
                "blocked:notValidated"
            case .offsetExceeded:
                "blocked:offsetExceeded"
            case .stale:
                "blocked:stale"
            case .systemClockChanged:
                "blocked:systemClockChanged"
            }
        }
    }

    private static func clockDecisionDescription(_ decision: ClockGateDecision) -> String {
        switch decision {
        case .allowed:
            "allowed"
        case let .blocked(reason):
            switch reason {
            case let .unverifiable(unverifiable):
                "blocked:unverifiable:\(unverifiable.rawValue)"
            case .notValidated:
                "blocked:notValidated"
            case .offsetExceeded:
                "blocked:offsetExceeded"
            case .stale:
                "blocked:stale"
            case .systemClockChanged:
                "blocked:systemClockChanged"
            }
        }
    }

    private static func clockReleaseDecisionDescription(
        _ decision: ClockReleaseGateDecision
    ) -> String {
        switch decision {
        case .allowed:
            "allowed"
        case .blockedPendingRealDeviceApproval:
            "blocked:pendingRealDeviceApproval"
        case let .blocked(reason):
            switch reason {
            case let .unverifiable(unverifiable):
                "blocked:unverifiable:\(unverifiable.rawValue)"
            case .notValidated:
                "blocked:notValidated"
            case .offsetExceeded:
                "blocked:offsetExceeded"
            case .stale:
                "blocked:stale"
            case .systemClockChanged:
                "blocked:systemClockChanged"
            }
        }
    }

    private static func clockGate(
        sharingHistory: RoomClockSharingHistory
    ) -> ClockSkewGate {
        var gate = ClockSkewGate(sharingHistory: sharingHistory)
        _ = gate.establishProcessBaseline(
            wallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_000_000),
            monotonicTime: MonotonicInstant(milliseconds: 0)
        )
        return gate
    }

    private static func koreaDate(
        hour: Int,
        minute: Int,
        second: Int
    ) -> WallClockInstant {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = DailyWriteBoundary.koreaTimeZone
        let date = calendar.date(
            from: DateComponents(
                timeZone: DailyWriteBoundary.koreaTimeZone,
                year: 2026,
                month: 7,
                day: 30,
                hour: hour,
                minute: minute,
                second: second
            )
        )!
        return WallClockInstant(
            millisecondsSinceUnixEpoch: Int64((date.timeIntervalSince1970 * 1_000).rounded())
        )
    }

    private static func clockSamples(
        offsetMilliseconds: Int64,
        localRoundTripMilliseconds: Int64 = 100,
        peerProcessingMilliseconds: Int64 = 20
    ) -> [ClockFourTimestampSample] {
        (0..<3).map { index in
            let base = Int64(index) * 10_000
            let oneWay = (localRoundTripMilliseconds - peerProcessingMilliseconds) / 2
            let localSent = base
            let peerReceived = localSent + oneWay + offsetMilliseconds
            let peerSent = peerReceived + peerProcessingMilliseconds
            let localReceived = localSent + localRoundTripMilliseconds
            return ClockFourTimestampSample(
                localSentWallTime: WallClockInstant(
                    millisecondsSinceUnixEpoch: localSent
                ),
                peerReceivedWallTime: WallClockInstant(
                    millisecondsSinceUnixEpoch: peerReceived
                ),
                peerSentWallTime: WallClockInstant(
                    millisecondsSinceUnixEpoch: peerSent
                ),
                localReceivedWallTime: WallClockInstant(
                    millisecondsSinceUnixEpoch: localReceived
                ),
                localElapsedMonotonicMilliseconds: localRoundTripMilliseconds,
                peerProcessingMonotonicMilliseconds: peerProcessingMilliseconds
            )
        }
    }
}
