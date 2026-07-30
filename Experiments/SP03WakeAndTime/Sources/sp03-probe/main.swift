import AppKit
import Foundation
import SP03WakeAndTimeCore

func log(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

func writeStandardOutput(_ text: String) {
    FileHandle.standardOutput.write(Data((text + "\n").utf8))
}

func usageText() -> String {
    """
        사용법: sp03-probe [--scenario <이름>] [--list]
               sp03-probe --observe-seconds <1...900>
               sp03-probe --clock-local <A|B> --clock-peer <A|B>
                 [--confirm-distinct-physical-macs]
               sp03-probe --aggregate-live-evidence < bundles.json

        기본 실행은 결정적 모델 시나리오 전체를 JSON으로 출력한다.
        `--observe-seconds`는 AppKit·NSWorkspace·NWPathMonitor의 실제 사건을
        지정 시간 동안 관찰한다. 실제 sleep, 앱 전환과 network 전환은
        관찰 중 사용자가 수행해야 하며 synthetic 결과로 대체하지 않는다.
        clock mode는 두 Mac에서 A/B를 반대로 지정해 동시에 실행한다.
        확인 flag는 실제로 서로 다른 물리 Mac 두 대에서 실행할 때만 사용한다.
        live·clock 출력의 `evidenceBundle`은 절대 시각·hostname·IP·SSID를
        포함하지 않는 재사용 가능한 조각이다. aggregate mode는 stdin의
        `LiveEvidenceBundle` JSON 한 개 또는 그 배열만 합치며, 빠진 관찰을
        추정하지 않는다. 입력은 최대 1 MiB이고 부분 evidence는 nonzero로 끝난다.
        여러 출력 조각은 `jq -s '[.[].evidenceBundle]' result-*.json`으로 묶는다.
        """
}

func failUsage(_ message: String) -> Never {
    log(message)
    log(usageText())
    exit(2)
}

struct LiveEventRecord: Codable, Sendable {
    let trigger: String
    let elapsedMilliseconds: Int64
    let coordinatorAction: String
}

struct LiveObservationOutput: Codable, Sendable {
    let tool: String
    let mode: String
    let durationSeconds: Double
    let anonymized: Bool
    let events: [LiveEventRecord]
    let evidenceBundle: LiveEvidenceBundle
    let liveGate: LiveGateEvidence
    let sessionsStarted: Int
    let coalescedTriggers: Int
    let peakConcurrentSessions: Int
    let verdict: String
}

struct ClockRoundOutput: Codable, Sendable {
    let round: Int
    let failure: String?
    let t1LocalSentRelativeMilliseconds: Double?
    let t2PeerReceivedRelativeToLocalT1Milliseconds: Double?
    let t3PeerSentRelativeToLocalT1Milliseconds: Double?
    let t4LocalReceivedRelativeToLocalT1Milliseconds: Double?
    let localElapsedMonotonicMilliseconds: Int64?
    let peerProcessingMonotonicMilliseconds: Int64?
    let captureUncertaintyMilliseconds: Int64?
    let offsetLowerBoundMilliseconds: Double?
    let offsetUpperBoundMilliseconds: Double?
    let maximumAbsoluteOffsetMilliseconds: Double?
    let withinFiveHundredMillisecondSafetyMargin: Bool

    init(_ result: ClockExchangeRoundResult) {
        round = result.round
        failure = result.failure?.rawValue

        guard let sample = result.sample else {
            t1LocalSentRelativeMilliseconds = nil
            t2PeerReceivedRelativeToLocalT1Milliseconds = nil
            t3PeerSentRelativeToLocalT1Milliseconds = nil
            t4LocalReceivedRelativeToLocalT1Milliseconds = nil
            localElapsedMonotonicMilliseconds = nil
            peerProcessingMonotonicMilliseconds = nil
            captureUncertaintyMilliseconds = nil
            offsetLowerBoundMilliseconds = nil
            offsetUpperBoundMilliseconds = nil
            maximumAbsoluteOffsetMilliseconds = nil
            withinFiveHundredMillisecondSafetyMargin = false
            return
        }

        let interval = sample.offsetInterval
        let localT1 = Double(
            sample.localSentWallTime.millisecondsSinceUnixEpoch
        )
        t1LocalSentRelativeMilliseconds = 0
        t2PeerReceivedRelativeToLocalT1Milliseconds =
            Double(sample.peerReceivedWallTime.millisecondsSinceUnixEpoch)
            - localT1
        t3PeerSentRelativeToLocalT1Milliseconds =
            Double(sample.peerSentWallTime.millisecondsSinceUnixEpoch)
            - localT1
        t4LocalReceivedRelativeToLocalT1Milliseconds =
            Double(sample.localReceivedWallTime.millisecondsSinceUnixEpoch)
            - localT1
        localElapsedMonotonicMilliseconds =
            sample.localElapsedMonotonicMilliseconds
        peerProcessingMonotonicMilliseconds =
            sample.peerProcessingMonotonicMilliseconds
        captureUncertaintyMilliseconds =
            sample.captureUncertaintyMilliseconds
        offsetLowerBoundMilliseconds = interval?.lowerBoundMilliseconds
        offsetUpperBoundMilliseconds = interval?.upperBoundMilliseconds
        maximumAbsoluteOffsetMilliseconds =
            interval?.maximumAbsoluteOffsetMilliseconds
        withinFiveHundredMillisecondSafetyMargin =
            (interval?.maximumAbsoluteOffsetMilliseconds ?? .infinity) <= 500
    }
}

struct ClockObservationOutput: Codable, Sendable {
    let tool: String
    let mode: String
    let serviceType: String
    let localLabel: String
    let peerLabel: String
    let operatorConfirmedDistinctPhysicalMacs: Bool
    let totalTimeoutMilliseconds: Int64
    let observedInterfaceTypes: [String]
    let inboundCompletedRounds: [Int]
    let reciprocalPeerMatched: Bool
    let pairEvidenceID: String?
    let rounds: [ClockRoundOutput]
    let failure: String?
    let crossHostEvidence: Bool
    let candidateEligibility: String
    let candidateValidation: String
    let allRoundsWithinFiveHundredMillisecondSafetyMargin: Bool
    let policyToleranceMayBeApproved: Bool
    let anonymized: Bool
    let evidenceBundle: LiveEvidenceBundle
    let verdict: String

    init(report: ClockExchangeProbeReport) {
        let validation = report.validateCandidate(
            at: MonotonicInstant(milliseconds: 0)
        )
        let encodedRounds = report.roundResults.map(ClockRoundOutput.init)
        let allWithinSafetyMargin =
            encodedRounds.count == ClockExchangeProbeOptions.requiredRounds
            && encodedRounds.allSatisfy(
                \.withinFiveHundredMillisecondSafetyMargin
            )

        tool = ProbeReport.tool
        mode = "two-mac-clock-exchange"
        serviceType = ClockExchangeProbeOptions.serviceType
        localLabel = report.localLabel
        peerLabel = report.peerLabel
        operatorConfirmedDistinctPhysicalMacs =
            report.operatorConfirmedDistinctPhysicalMacs
        totalTimeoutMilliseconds = report.totalTimeoutMilliseconds
        observedInterfaceTypes =
            report.observedInterfaceTypes.map(\.rawValue)
        inboundCompletedRounds = report.inboundCompletedRounds
        reciprocalPeerMatched = report.reciprocalPeerMatched
        pairEvidenceID = report.pairEvidenceID
        rounds = encodedRounds
        failure = report.failure?.rawValue
        crossHostEvidence = report.crossHostEvidence
        candidateEligibility = Self.describe(report.candidateEligibility)
        candidateValidation = Self.describe(validation)
        allRoundsWithinFiveHundredMillisecondSafetyMargin =
            allWithinSafetyMargin
        // 한 번의 clock 교환은 전체 live matrix나 제품 책임자 승인이 아니다.
        policyToleranceMayBeApproved = false
        anonymized = true
        evidenceBundle = LiveEvidenceBundle(
            clockRuns: [ClockRunLiveEvidence(report: report)]
        )

        if let failure = report.failure {
            verdict = "probe-failed:\(failure.rawValue)"
        } else if case let .ineligible(reason) = report.candidateEligibility {
            verdict = "sample-ineligible:\(reason.rawValue)"
        } else if case .valid = validation {
            verdict = allWithinSafetyMargin
                ? "sample-supports-candidate-with-two-x-margin"
                : "sample-within-candidate-without-two-x-margin"
        } else {
            verdict = "sample-does-not-support-candidate"
        }
    }

    var candidateSampleSupported: Bool {
        candidateValidation == "valid"
    }

    private static func describe(
        _ eligibility: ClockExchangeCandidateEligibility
    ) -> String {
        switch eligibility {
        case .eligible:
            "eligible"
        case let .ineligible(reason):
            "ineligible:\(reason.rawValue)"
        }
    }

    private static func describe(_ validation: ClockValidationState) -> String {
        switch validation {
        case .unverified:
            "unverified"
        case .valid:
            "valid"
        case let .blocked(reason):
            "blocked:\(describe(reason))"
        }
    }

    private static func describe(_ reason: ClockWriteBlockReason) -> String {
        switch reason {
        case .notValidated:
            "notValidated"
        case .offsetExceeded:
            "offsetExceeded"
        case let .unverifiable(reason):
            "unverifiable:\(reason.rawValue)"
        case .stale:
            "stale"
        case .systemClockChanged:
            "systemClockChanged"
        }
    }
}

final class LiveRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private let startedAt = ContinuousClock.now
    private var coordinator = SyncCoordinator()
    private var records: [LiveEventRecord] = []

    func record(_ trigger: SyncTrigger) {
        lock.lock()
        defer { lock.unlock() }

        let elapsed = Self.milliseconds(startedAt.duration(to: ContinuousClock.now))
        let action = coordinator.handle(
            trigger,
            at: MonotonicInstant(milliseconds: elapsed)
        )
        records.append(
            LiveEventRecord(
                trigger: trigger.rawValue,
                elapsedMilliseconds: elapsed,
                coordinatorAction: Self.describe(action)
            )
        )
    }

    func snapshot(durationSeconds: Double) -> LiveObservationOutput {
        lock.lock()
        defer { lock.unlock() }

        let observed = Set(records.map(\.trigger))
        let eventEvidence = SystemEventLiveEvidence(
            observationDurationMilliseconds: max(
                1,
                Int64((durationSeconds * 1_000).rounded(.down))
            ),
            wakeCount: records.count {
                $0.trigger == SyncTrigger.wake.rawValue
            },
            foregroundCount: records.count {
                $0.trigger == SyncTrigger.foreground.rawValue
            },
            networkChangeCount: records.count {
                $0.trigger == SyncTrigger.networkChanged.rawValue
            },
            newPeerDiscoveryCount: records.count {
                $0.trigger == SyncTrigger.peerDiscovered.rawValue
            }
        )
        let liveGate = LiveGateEvidence(
            twoMacClockExchangeObserved: false,
            clockCandidateMatrixPassed: false,
            wakeObserved: observed.contains(SyncTrigger.wake.rawValue),
            foregroundObserved: observed.contains(SyncTrigger.foreground.rawValue),
            networkChangeObserved: observed.contains(SyncTrigger.networkChanged.rawValue),
            // 이 mode는 lifecycle adapter를 관찰할 뿐 실제 Peer 대조와
            // cadence/finalization/network-byte 비용을 수행하지 않는다.
            newPeerDiscoveryObserved: false,
            boundedSessionObserved: false,
            thirtySecondCadenceObserved: false,
            systemClockChangeRevalidationObserved: false,
            awakeDeviceFinalizationObserved: false,
            sleepingDeviceFinalizationObserved: false,
            resourceCostMeasured: false
        )
        return LiveObservationOutput(
            tool: ProbeReport.tool,
            mode: "live-system-events",
            durationSeconds: durationSeconds,
            anonymized: true,
            events: records,
            evidenceBundle: LiveEvidenceBundle(
                systemEvents: [eventEvidence]
            ),
            liveGate: liveGate,
            sessionsStarted: coordinator.sessionsStarted,
            coalescedTriggers: coordinator.coalescedTriggerCount,
            peakConcurrentSessions: coordinator.peakConcurrentSessionCount,
            verdict: liveGate.complete
                ? "live-gate-complete"
                : "partial-live-observation-only"
        )
    }

    private static func milliseconds(_ duration: Duration) -> Int64 {
        let components = duration.components
        let fromSeconds = components.seconds.multipliedReportingOverflow(by: 1_000)
        precondition(!fromSeconds.overflow)
        let fromAttoseconds = components.attoseconds / 1_000_000_000_000_000
        let total = fromSeconds.partialValue.addingReportingOverflow(fromAttoseconds)
        precondition(!total.overflow)
        return max(0, total.partialValue)
    }

    private static func describe(_ action: SyncCoordinatorAction) -> String {
        switch action {
        case let .started(sessionID, _):
            "started:\(sessionID)"
        case let .coalesced(sessionID):
            "coalesced:\(sessionID)"
        case .ignored(.clockChangeIsNotSyncTrigger):
            "ignored:clockChangeIsNotSyncTrigger"
        case .ignored(.failedSessionRequiresMeaningfulTrigger):
            "ignored:failedSessionRequiresMeaningfulTrigger"
        }
    }
}

enum Mode {
    case model(scenario: String?)
    case list
    case live(seconds: Double)
    case clock(options: ClockExchangeProbeOptions)
    case aggregateLiveEvidence
}

var selectedScenario: String?
var listOnly = false
var observationSeconds: Double?
var clockLocalLabel: String?
var clockPeerLabel: String?
var operatorConfirmedDistinctPhysicalMacs = false
var aggregateLiveEvidence = false
var arguments = Array(CommandLine.arguments.dropFirst())

while let argument = arguments.first {
    arguments.removeFirst()
    switch argument {
    case "--list":
        listOnly = true
    case "--scenario":
        guard let value = arguments.first else {
            failUsage("`--scenario` 값이 없습니다.")
        }
        arguments.removeFirst()
        selectedScenario = value
    case "--observe-seconds":
        guard let value = arguments.first,
              let seconds = Double(value),
              (1...900).contains(seconds)
        else {
            failUsage("`--observe-seconds`는 1 이상 900 이하 숫자여야 합니다.")
        }
        arguments.removeFirst()
        observationSeconds = seconds
    case "--clock-local":
        guard let value = arguments.first else {
            failUsage("`--clock-local` 값이 없습니다.")
        }
        arguments.removeFirst()
        clockLocalLabel = value
    case "--clock-peer":
        guard let value = arguments.first else {
            failUsage("`--clock-peer` 값이 없습니다.")
        }
        arguments.removeFirst()
        clockPeerLabel = value
    case "--confirm-distinct-physical-macs":
        operatorConfirmedDistinctPhysicalMacs = true
    case "--aggregate-live-evidence":
        aggregateLiveEvidence = true
    case "--help", "-h":
        writeStandardOutput(usageText())
        exit(0)
    default:
        failUsage("알 수 없는 인자입니다: \(argument)")
    }
}

let mode: Mode
if listOnly {
    guard selectedScenario == nil,
          observationSeconds == nil,
          clockLocalLabel == nil,
          clockPeerLabel == nil,
          !operatorConfirmedDistinctPhysicalMacs,
          !aggregateLiveEvidence
    else {
        failUsage("`--list`는 다른 mode와 함께 사용할 수 없습니다.")
    }
    mode = .list
} else if let observationSeconds {
    guard selectedScenario == nil,
          clockLocalLabel == nil,
          clockPeerLabel == nil,
          !operatorConfirmedDistinctPhysicalMacs,
          !aggregateLiveEvidence
    else {
        failUsage("live 관찰과 결정적 scenario를 동시에 선택할 수 없습니다.")
    }
    mode = .live(seconds: observationSeconds)
} else if clockLocalLabel != nil
    || clockPeerLabel != nil
    || operatorConfirmedDistinctPhysicalMacs
{
    guard selectedScenario == nil,
          let clockLocalLabel,
          let clockPeerLabel,
          !aggregateLiveEvidence
    else {
        failUsage("clock mode에는 `--clock-local`과 `--clock-peer`가 모두 필요합니다.")
    }
    do {
        mode = .clock(
            options: try ClockExchangeProbeOptions(
                localLabel: clockLocalLabel,
                peerLabel: clockPeerLabel,
                operatorConfirmedDistinctPhysicalMacs:
                    operatorConfirmedDistinctPhysicalMacs
            )
        )
    } catch let error as ClockExchangeProbeOptions.ValidationError {
        failUsage("잘못된 clock mode 옵션입니다: \(error.rawValue)")
    } catch {
        failUsage("clock mode 옵션을 만들 수 없습니다.")
    }
} else if aggregateLiveEvidence {
    guard selectedScenario == nil else {
        failUsage("aggregate mode는 결정적 scenario와 함께 사용할 수 없습니다.")
    }
    mode = .aggregateLiveEvidence
} else {
    mode = .model(scenario: selectedScenario)
}

switch mode {
case .list:
    for scenario in ScenarioCatalog.all {
        writeStandardOutput(
            "\(scenario.name)\t\(scenario.evidenceKind.rawValue)\t\(scenario.question)"
        )
    }
    exit(0)

case let .model(selected):
    let scenarios: [WakeTimeScenario]
    if let selected {
        guard let scenario = ScenarioCatalog.named(selected) else {
            failUsage("그런 scenario가 없습니다: \(selected). `--list`로 확인하십시오.")
        }
        scenarios = [scenario]
    } else {
        scenarios = ScenarioCatalog.all
    }

    log("결정적 모델 시나리오 \(scenarios.count)개를 실행합니다.")
    let results = ScenarioRunner.run(scenarios)
    let report = ProbeReport.make(
        scenarios: results,
        // Catalog 전체에서 실제로 시작한 세션·시도와 cadence tick의 상한을
        // 합산한 모델 대리 지표다. 네트워크 payload 모델은 없으므로 byte는 0이다.
        resourceCost: ResourceCostSummary(
            sessionStarts: selected == nil ? 3 : 0,
            attempts: selected == nil ? 7 : 0,
            timerWakeups: selected == nil ? 3 : 0,
            transferredBytes: 0
        )
    )
    writeStandardOutput(ProbeReportEncoder.json(report))
    log("판정: \(report.verdict)")
    exit(report.modelPassed && report.anonymized ? 0 : 1)

case let .clock(options):
    log(
        "\(options.localLabel)→\(options.peerLabel) clock 교환 3회를 시작합니다."
    )
    if !options.operatorConfirmedDistinctPhysicalMacs {
        log("물리 Mac 2대 확인이 없어 이 실행은 후보 evidence가 될 수 없습니다.")
    }
    let report = await ClockExchangeProbe(options: options).run()
    let output = ClockObservationOutput(report: report)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    guard let data = try? encoder.encode(output),
          let text = String(data: data, encoding: .utf8)
    else {
        log("clock 결과를 직렬화하지 못했습니다.")
        exit(1)
    }
    writeStandardOutput(text)
    log("판정: \(output.verdict)")
    exit(output.candidateSampleSupported && output.anonymized ? 0 : 1)

case let .live(seconds):
    log("실기기 system event를 \(seconds)초 동안 관찰합니다.")
    log("필요한 sleep·foreground·network 전환은 관찰 시간 안에 직접 수행하십시오.")
    let recorder = LiveRecorder()
    let source = await MainActor.run {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        let source = SystemEventSource(handler: recorder.record)
        source.start()
        application.activate()
        return source
    }

    await MainActor.run {
        RunLoop.main.run(until: Date(timeIntervalSinceNow: seconds))
        source.stop()
    }

    let output = recorder.snapshot(durationSeconds: seconds)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    guard let data = try? encoder.encode(output),
          let text = String(data: data, encoding: .utf8)
    else {
        log("live 결과를 직렬화하지 못했습니다.")
        exit(1)
    }
    writeStandardOutput(text)
    log("판정: \(output.verdict)")
    exit(0)

case .aggregateLiveEvidence:
    let maximumInputBytes = 1_048_576
    var input = Data()
    while true {
        let chunk = FileHandle.standardInput.availableData
        if chunk.isEmpty { break }
        guard input.count <= maximumInputBytes - chunk.count else {
            log("evidence 입력이 1 MiB 제한을 넘었습니다.")
            exit(2)
        }
        input.append(chunk)
    }
    guard !input.isEmpty,
          let sourceText = String(data: input, encoding: .utf8)
    else {
        log("aggregate mode에는 UTF-8 JSON stdin이 필요합니다.")
        exit(2)
    }

    let decoder = JSONDecoder()
    let bundles: [LiveEvidenceBundle]
    if let many = try? decoder.decode([LiveEvidenceBundle].self, from: input) {
        bundles = many
    } else if let one = try? decoder.decode(LiveEvidenceBundle.self, from: input) {
        bundles = [one]
    } else {
        log("typed live evidence JSON을 해석하지 못했습니다.")
        exit(2)
    }

    let report = LiveEvidenceAggregator.aggregate(
        bundles,
        sourceText: sourceText
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    guard let data = try? encoder.encode(report),
          let text = String(data: data, encoding: .utf8)
    else {
        log("aggregate 결과를 직렬화하지 못했습니다.")
        exit(1)
    }
    writeStandardOutput(text)
    log("판정: \(report.verdict)")
    exit(report.complete ? 0 : 1)
}
