import Foundation

public enum ScenarioRunner {
    /// 시나리오 목록을 실행하고 기대와 대조한다.
    ///
    /// 각 시나리오는 **자기 전용 entropy 인스턴스**를 받는다. 하나를 공유하면
    /// 앞 시나리오가 몇 바이트를 썼는지에 따라 뒤 시나리오의 키가 달라지고,
    /// 시나리오 하나를 골라 실행한 결과가 전체 실행과 달라진다.
    public static func run(
        scenarios: [SecurityScenario],
        seed: UInt64,
        useSystemEntropy: Bool,
        includeEnvironmentProbe: Bool,
        workingDirectory: URL,
        progress: (String) -> Void = { _ in }
    ) -> ProbeReport {
        var results: [ScenarioResult] = []

        for (index, scenario) in scenarios.enumerated() {
            progress("[\(index + 1)/\(scenarios.count)] \(scenario.name)")

            let entropy: any EntropySource = useSystemEntropy
                ? SystemEntropy()
                // seed에 시나리오 순번을 섞어 시나리오마다 다른 열을 준다.
                : DeterministicEntropy(seed: seed &+ UInt64(index) &* 0x9E37_79B9_7F4A_7C15)

            let scenarioDirectory = workingDirectory.appendingPathComponent(scenario.name)
            try? FileManager.default.createDirectory(
                at: scenarioDirectory,
                withIntermediateDirectories: true
            )

            let context = ScenarioContext(
                entropy: entropy,
                secrets: ScenarioFixture.secrets,
                workingDirectory: scenarioDirectory
            )

            var actual: [String: String] = [:]
            var executionError: String?
            do {
                actual = try scenario.body(context)
            } catch {
                executionError = describe(error)
            }

            // 기대 key와 실제 key의 합집합을 본다. 실제에만 있는 key를 버리면
            // 시나리오가 조용히 다른 것을 관측해도 통과한다.
            let keys = Set(scenario.expectations.keys).union(actual.keys).sorted()
            let observations = keys.map { key in
                ScenarioResult.Observation(
                    key: key,
                    expected: scenario.expectations[key] ?? "(선언되지 않음)",
                    actual: actual[key] ?? "(관측되지 않음)"
                )
            }

            results.append(
                ScenarioResult(
                    name: scenario.name,
                    question: scenario.question,
                    policyReferences: scenario.policyReferences,
                    observations: observations,
                    executionError: executionError
                )
            )
        }

        let environment = includeEnvironmentProbe ? KeychainEnvironmentProbe.run() : nil
        let draft = ProbeReport(
            entropyLabel: useSystemEntropy ? SystemEntropy().label : "deterministic(seed=\(seed))",
            scenarios: results,
            keyCustody: ProbeReport.KeyCustodySummary(
                recommendedOptionID: KeyCustodyCatalog.recommendedOptionID,
                optionIDs: KeyCustodyCatalog.options.map(\.id)
            ),
            environment: environment,
            anonymized: true,
            anonymizationLeaks: []
        )

        // 익명화 검사는 **직렬화한 최종 출력**을 대상으로 한다. 중간 값만
        // 검사하면 출력 단계에서 새로 붙는 문자열을 놓친다.
        let leaks = PlaintextScanner.exposedLabels(
            in: ProbeReportEncoder.json(draft),
            secrets: ScenarioFixture.secrets
        )

        return ProbeReport(
            entropyLabel: draft.entropyLabel,
            scenarios: results,
            keyCustody: draft.keyCustody,
            environment: environment,
            anonymized: leaks.isEmpty,
            anonymizationLeaks: leaks
        )
    }

    /// 오류를 진단 어휘로 접는다. 원문 메시지에는 파일 경로가 들어갈 수 있다.
    static func describe(_ error: any Error) -> String {
        switch error {
        case let failure as StoreFailure: return "StoreFailure.\(failure)"
        case let failure as SecretStoreError: return "SecretStoreError.\(failure)"
        case let failure as ChannelError: return "ChannelError.\(failure)"
        case let failure as LoopbackTransport.LoopbackError: return "LoopbackError.\(failure)"
        case let failure as CanonicalReader.ReadError: return "ReadError.\(failure)"
        case let failure as WireCodec.DecodeError: return "DecodeError.\(failure)"
        default:
            let nsError = error as NSError
            return "\(nsError.domain)=\(nsError.code)"
        }
    }
}
