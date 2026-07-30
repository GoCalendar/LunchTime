import Foundation

/// 시나리오 하나의 실행 결과.
public struct ScenarioResult: Sendable {
    public struct Observation: Sendable {
        public let key: String
        public let expected: String
        public let actual: String
        public var matched: Bool { expected == actual }
    }

    public let name: String
    public let question: String
    public let policyReferences: [String]
    public let observations: [Observation]
    /// 시나리오가 오류를 던졌을 때의 종류. 원문 메시지는 넣지 않는다.
    public let executionError: String?

    public var passed: Bool {
        executionError == nil && observations.allSatisfy(\.matched)
    }

    public var mismatchedKeys: [String] {
        observations.filter { !$0.matched }.map(\.key)
    }
}

/// 실행 전체 결과.
public struct ProbeReport: Sendable {
    public let entropyLabel: String
    public let scenarios: [ScenarioResult]
    public let keyCustody: KeyCustodySummary
    public let environment: KeyCustodyEnvironmentReport?
    /// 심은 평문이 이 출력 자체에 남아 있지 않은지 **실제로 검사한** 결과.
    ///
    /// 상수로 선언하지 않는다. 익명화가 깨진 순간에도 그대로 `true`인 값은
    /// 증거가 되지 못한다.
    public let anonymized: Bool
    public let anonymizationLeaks: [String]

    public struct KeyCustodySummary: Sendable {
        public let recommendedOptionID: String
        public let optionIDs: [String]
    }

    public var allPassed: Bool { scenarios.allSatisfy(\.passed) && anonymized }

    public var verdict: String {
        if !anonymized {
            return "출력에 심은 평문이 남아 있습니다: \(anonymizationLeaks.joined(separator: ", "))"
        }
        let failed = scenarios.filter { !$0.passed }
        if failed.isEmpty {
            return "모든 시나리오가 기대한 결과와 일치합니다(\(scenarios.count)개)."
        }
        return "기대와 다른 시나리오 \(failed.count)개: " + failed.map(\.name).joined(separator: ", ")
    }
}

public enum ProbeReportEncoder {
    /// 결과를 JSON 문자열로 만든다.
    ///
    /// 키 정렬을 고정한다. 정렬하지 않으면 같은 결과가 실행마다 다른 바이트가
    /// 되고, 두 실행을 파일로 대조할 수 없다.
    public static func json(_ report: ProbeReport) -> String {
        var root: [String: Any] = [:]
        root["entropy"] = report.entropyLabel
        root["anonymized"] = report.anonymized
        root["anonymizationLeaks"] = report.anonymizationLeaks
        root["verdict"] = report.verdict
        root["allPassed"] = report.allPassed
        root["keyCustody"] = [
            "recommended": report.keyCustody.recommendedOptionID,
            "options": report.keyCustody.optionIDs
        ]
        if let environment = report.environment {
            root["environment"] = [
                "secureEnclaveAvailable": environment.secureEnclaveAvailable,
                "observations": environment.observations.map { observation -> [String: Any] in
                    var entry: [String: Any] = [
                        "name": observation.name,
                        "succeeded": observation.succeeded
                    ]
                    if let status = observation.status { entry["status"] = status }
                    return entry
                }
            ]
        }
        root["scenarios"] = report.scenarios.map { scenario -> [String: Any] in
            var entry: [String: Any] = [
                "name": scenario.name,
                "question": scenario.question,
                "policyReferences": scenario.policyReferences,
                "passed": scenario.passed,
                "observations": scenario.observations
                    .sorted { $0.key < $1.key }
                    .map { observation in
                        [
                            "key": observation.key,
                            "expected": observation.expected,
                            "actual": observation.actual,
                            "matched": observation.matched
                        ] as [String: Any]
                    }
            ]
            if let error = scenario.executionError { entry["executionError"] = error }
            return entry
        }

        guard let data = try? JSONSerialization.data(
            withJSONObject: root,
            options: [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
        ), let text = String(data: data, encoding: .utf8) else {
            return "{\"error\":\"직렬화에 실패했습니다\"}"
        }
        return text
    }
}
