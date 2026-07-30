import Foundation

/// 실기기에서 직접 관찰해야만 채울 수 있는 출시 gate 증거.
///
/// `false`는 실패라는 뜻이 아니라 아직 그 증거를 수집하지 않았다는 뜻이다.
/// 결정적 모델만 실행한 결과가 실기기 gate를 통과한 것처럼 보이면 안 된다.
public struct LiveGateEvidence: Codable, Equatable, Sendable {
    public let twoMacClockExchangeObserved: Bool
    /// 6.2절의 10회 양방향 행렬 전체가 후보 안전 기준을 통과했는지.
    public let clockCandidateMatrixPassed: Bool
    public let wakeObserved: Bool
    public let foregroundObserved: Bool
    public let networkChangeObserved: Bool
    /// 새 Peer가 실제로 발견되어 bounded 대조를 시작했는지.
    public let newPeerDiscoveryObserved: Bool
    public let boundedSessionObserved: Bool
    /// 정상 조건에서 실제 anti-entropy tick이 30초 안에 관찰됐는지.
    public let thirtySecondCadenceObserved: Bool
    /// system clock 변경으로 무효화된 뒤 새 표본으로 재검증됐는지.
    public let systemClockChangeRevalidationObserved: Bool
    /// 14:30에 깨어 있던 기기의 실제 finalization을 관찰했는지.
    public let awakeDeviceFinalizationObserved: Bool
    /// 14:30을 지나 잠든 뒤 복귀한 기기의 실제 finalization을 관찰했는지.
    public let sleepingDeviceFinalizationObserved: Bool
    public let resourceCostMeasured: Bool

    public init(
        twoMacClockExchangeObserved: Bool,
        clockCandidateMatrixPassed: Bool,
        wakeObserved: Bool,
        foregroundObserved: Bool,
        networkChangeObserved: Bool,
        newPeerDiscoveryObserved: Bool,
        boundedSessionObserved: Bool,
        thirtySecondCadenceObserved: Bool,
        systemClockChangeRevalidationObserved: Bool,
        awakeDeviceFinalizationObserved: Bool,
        sleepingDeviceFinalizationObserved: Bool,
        resourceCostMeasured: Bool
    ) {
        self.twoMacClockExchangeObserved = twoMacClockExchangeObserved
        self.clockCandidateMatrixPassed = clockCandidateMatrixPassed
        self.wakeObserved = wakeObserved
        self.foregroundObserved = foregroundObserved
        self.networkChangeObserved = networkChangeObserved
        self.newPeerDiscoveryObserved = newPeerDiscoveryObserved
        self.boundedSessionObserved = boundedSessionObserved
        self.thirtySecondCadenceObserved = thirtySecondCadenceObserved
        self.systemClockChangeRevalidationObserved =
            systemClockChangeRevalidationObserved
        self.awakeDeviceFinalizationObserved =
            awakeDeviceFinalizationObserved
        self.sleepingDeviceFinalizationObserved =
            sleepingDeviceFinalizationObserved
        self.resourceCostMeasured = resourceCostMeasured
    }

    public static let notRun = LiveGateEvidence(
        twoMacClockExchangeObserved: false,
        clockCandidateMatrixPassed: false,
        wakeObserved: false,
        foregroundObserved: false,
        networkChangeObserved: false,
        newPeerDiscoveryObserved: false,
        boundedSessionObserved: false,
        thirtySecondCadenceObserved: false,
        systemClockChangeRevalidationObserved: false,
        awakeDeviceFinalizationObserved: false,
        sleepingDeviceFinalizationObserved: false,
        resourceCostMeasured: false
    )

    /// 이슈 #4가 요구한 실기기 행렬은 부분 관찰로 완료 처리하지 않는다.
    public var complete: Bool {
        twoMacClockExchangeObserved
            && clockCandidateMatrixPassed
            && wakeObserved
            && foregroundObserved
            && networkChangeObserved
            && newPeerDiscoveryObserved
            && boundedSessionObserved
            && thirtySecondCadenceObserved
            && systemClockChangeRevalidationObserved
            && awakeDeviceFinalizationObserved
            && sleepingDeviceFinalizationObserved
            && resourceCostMeasured
    }
}

/// 모델 실행에서 관측한 비용 대리 지표.
///
/// 이는 Instruments나 `powermetrics`의 에너지 측정값이 아니다. 실기기 비용
/// 측정 전에도 timer wake와 전송량이 무한히 증가하지 않는지 확인하는 값이다.
public struct ResourceCostSummary: Codable, Equatable, Sendable {
    public let sessionStarts: Int
    public let attempts: Int
    public let timerWakeups: Int
    public let transferredBytes: Int

    public init(
        sessionStarts: Int,
        attempts: Int,
        timerWakeups: Int,
        transferredBytes: Int
    ) {
        self.sessionStarts = sessionStarts
        self.attempts = attempts
        self.timerWakeups = timerWakeups
        self.transferredBytes = transferredBytes
    }
}

/// `sp03-probe`의 결정적이고 익명화된 JSON 보고서.
public struct ProbeReport: Codable, Equatable, Sendable {
    public static let tool = "sp03-probe"
    public static let candidateClockToleranceMilliseconds = 1_000
    public static let candidateValidationFreshnessMilliseconds = 30_000

    public let scenarios: [WakeTimeScenarioResult]
    public let resourceCost: ResourceCostSummary
    public let liveGate: LiveGateEvidence
    public let anonymizationLeaks: [String]

    public init(
        scenarios: [WakeTimeScenarioResult],
        resourceCost: ResourceCostSummary,
        liveGate: LiveGateEvidence = .notRun,
        anonymizationLeaks: [String] = []
    ) {
        self.scenarios = scenarios
        self.resourceCost = resourceCost
        self.liveGate = liveGate
        self.anonymizationLeaks = anonymizationLeaks
    }

    public var modelPassed: Bool {
        scenarios
            .filter { $0.evidenceKind == .deterministicModel }
            .allSatisfy(\.passed)
    }

    public var anonymized: Bool { anonymizationLeaks.isEmpty }

    /// 실기기 gate가 완료되기 전에는 후보 허용 오차를 Policy 확정값으로 쓰지 않는다.
    public var policyToleranceMayBeApproved: Bool {
        modelPassed && anonymized && liveGate.complete
    }

    public var verdict: String {
        if !anonymized { return "evidence-not-anonymized" }
        if !modelPassed { return "deterministic-model-failed" }
        if !liveGate.complete { return "model-passed-live-gate-pending" }
        return "release-gate-evidence-complete"
    }

    /// 최종 직렬화 결과를 검사해 익명화 누락을 보고서 안에 다시 넣는다.
    public static func make(
        scenarios: [WakeTimeScenarioResult],
        resourceCost: ResourceCostSummary,
        liveGate: LiveGateEvidence = .notRun
    ) -> ProbeReport {
        let draft = ProbeReport(
            scenarios: scenarios,
            resourceCost: resourceCost,
            liveGate: liveGate
        )
        let text = ProbeReportEncoder.json(draft)
        return ProbeReport(
            scenarios: scenarios,
            resourceCost: resourceCost,
            liveGate: liveGate,
            anonymizationLeaks: EvidenceSanitizer.exposedMarkers(in: text)
        )
    }
}

private struct EncodedProbeReport: Codable {
    let tool: String
    let candidateClockToleranceMilliseconds: Int
    let candidateValidationFreshnessMilliseconds: Int
    let thresholdStatus: String
    let modelPassed: Bool
    let anonymized: Bool
    let policyToleranceMayBeApproved: Bool
    let verdict: String
    let resourceCost: ResourceCostSummary
    let liveGate: LiveGateEvidence
    let anonymizationLeaks: [String]
    let scenarios: [WakeTimeScenarioResult]
}

public enum ProbeReportEncoder {
    public static func json(_ report: ProbeReport) -> String {
        let output = EncodedProbeReport(
            tool: ProbeReport.tool,
            candidateClockToleranceMilliseconds: ProbeReport.candidateClockToleranceMilliseconds,
            candidateValidationFreshnessMilliseconds: ProbeReport.candidateValidationFreshnessMilliseconds,
            thresholdStatus: report.liveGate.complete
                ? "eligible-for-product-owner-approval"
                : "candidate-awaiting-two-mac-live-evidence",
            modelPassed: report.modelPassed,
            anonymized: report.anonymized,
            policyToleranceMayBeApproved: report.policyToleranceMayBeApproved,
            verdict: report.verdict,
            resourceCost: report.resourceCost,
            liveGate: report.liveGate,
            anonymizationLeaks: report.anonymizationLeaks,
            scenarios: report.scenarios.sorted { $0.name < $1.name }
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(output),
              let text = String(data: data, encoding: .utf8) else {
            return "{\"error\":\"report-encoding-failed\"}"
        }
        return text
    }
}

public enum EvidenceSanitizer {
    /// 결과에 로컬 절대 경로나 네트워크 식별자가 들어갔음을 시사하는 marker.
    ///
    /// IP 주소 전체를 정규식으로 찾지 않는다. 시나리오 수치가 우연히 주소처럼
    /// 보일 수 있어 오탐이 생기기 때문이다. 보고 계층은 애초에 주소 필드를 두지
    /// 않고, 이 검사는 대표적인 누출 표면을 마지막에 한 번 더 막는다.
    private static let forbiddenMarkers = [
        "/Users/",
        "\\Users\\",
        "\"hostname\"",
        "\"ssid\"",
        "\"ipAddress\"",
        ".local"
    ]

    public static func exposedMarkers(in text: String) -> [String] {
        forbiddenMarkers.filter { text.localizedCaseInsensitiveContains($0) }
    }
}
