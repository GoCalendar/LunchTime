import Foundation
import Testing

@testable import SP03WakeAndTimeCore

@Suite("SP-03 시나리오 catalog와 보고서")
struct ScenarioCatalogTests {
    @Test("시나리오 이름은 고유하고 질문·추적·기대값이 비어 있지 않다")
    func catalogMetadataIsComplete() {
        let names = ScenarioCatalog.all.map(\.name)
        #expect(Set(names).count == names.count)
        #expect(ScenarioCatalog.all.allSatisfy { !$0.name.isEmpty })
        #expect(ScenarioCatalog.all.allSatisfy { !$0.question.isEmpty })
        #expect(ScenarioCatalog.all.allSatisfy { !$0.traceIDs.isEmpty })
        #expect(ScenarioCatalog.all.allSatisfy { !$0.expectations.isEmpty })
    }

    @Test("이슈 #4의 핵심 정본 ID가 catalog에 모두 연결된다")
    func requiredTraceIDsAreCovered() {
        let traces = Set(ScenarioCatalog.all.flatMap(\.traceIDs))
        for required in [
            "PRD-01-FR-01",
            "PRD-01-FR-09",
            "PRD-01-FR-10",
            "PRD-01-AC-03",
            "PRD-01-AC-05",
            "PRD-01-AC-09",
            "PRD-01-SP-03",
            "POL-01-R-01",
            "POL-01-R-04",
            "POL-02-R-02",
            "POL-02-R-08"
        ] {
            #expect(traces.contains(required), "누락 추적 ID: \(required)")
        }
    }

    @Test("모든 결정적 시나리오가 선언한 기대와 일치한다")
    func allDeterministicScenariosPass() {
        let results = ScenarioRunner.run(ScenarioCatalog.all)
        #expect(results.count == ScenarioCatalog.all.count)
        let allPassed = results.allSatisfy(\.passed)
        #expect(allPassed)
    }

    @Test("기대에 없는 관측과 누락된 관측을 모두 실패로 잡는다")
    func runnerComparesUnionOfKeys() {
        let scenario = WakeTimeScenario(
            name: "union-check",
            question: "합집합을 보는가?",
            traceIDs: ["POL-02-R-02"],
            expectations: ["expectedOnly": "yes", "different": "expected"]
        ) {
            ["actualOnly": "yes", "different": "actual"]
        }
        let result = ScenarioRunner.run(scenario)
        #expect(!result.passed)
        #expect(result.observations.map(\.key) == ["actualOnly", "different", "expectedOnly"])
        #expect(result.observations.allSatisfy { !$0.matched })
    }

    @Test("같은 입력의 보고서는 byte-identical이고 live gate를 통과했다고 주장하지 않는다")
    func deterministicReportIsStableAndHonest() {
        let results = ScenarioRunner.run(ScenarioCatalog.all)
        let cost = ResourceCostSummary(
            sessionStarts: 2,
            attempts: 4,
            timerWakeups: 1,
            transferredBytes: 1_024
        )
        let first = ProbeReport.make(scenarios: results, resourceCost: cost)
        let second = ProbeReport.make(scenarios: results, resourceCost: cost)
        #expect(ProbeReportEncoder.json(first) == ProbeReportEncoder.json(second))
        #expect(first.modelPassed)
        #expect(first.liveGate.complete == false)
        #expect(first.policyToleranceMayBeApproved == false)
        #expect(first.verdict == "model-passed-live-gate-pending")
    }

    @Test("clock 관찰만으로는 부족하고 10회 후보 행렬 통과가 별도 필요하다")
    func clockCandidateMatrixCannotBeImpliedByObservation() {
        let observedWithoutPassingMatrix = LiveGateEvidence(
            twoMacClockExchangeObserved: true,
            clockCandidateMatrixPassed: false,
            wakeObserved: true,
            foregroundObserved: true,
            networkChangeObserved: true,
            newPeerDiscoveryObserved: true,
            boundedSessionObserved: true,
            thirtySecondCadenceObserved: true,
            systemClockChangeRevalidationObserved: true,
            awakeDeviceFinalizationObserved: true,
            sleepingDeviceFinalizationObserved: true,
            resourceCostMeasured: true
        )
        #expect(!observedWithoutPassingMatrix.complete)

        let report = ProbeReport.make(
            scenarios: ScenarioRunner.run(ScenarioCatalog.all),
            resourceCost: ResourceCostSummary(
                sessionStarts: 1,
                attempts: 3,
                timerWakeups: 1,
                transferredBytes: 0
            ),
            liveGate: observedWithoutPassingMatrix
        )
        #expect(!report.policyToleranceMayBeApproved)
    }

    @Test("live 행렬의 typed evidence는 하나라도 없으면 승인 후보가 아니다")
    func everyLiveRequirementIsMandatory() {
        let requirements = [
            "twoMacClockExchange",
            "clockCandidateMatrix",
            "wake",
            "foreground",
            "networkChange",
            "newPeerDiscovery",
            "boundedSession",
            "thirtySecondCadence",
            "systemClockChangeRevalidation",
            "awakeDeviceFinalization",
            "sleepingDeviceFinalization",
            "resourceCost"
        ]

        func evidence(missing requirement: String?) -> LiveGateEvidence {
            LiveGateEvidence(
                twoMacClockExchangeObserved:
                    requirement != "twoMacClockExchange",
                clockCandidateMatrixPassed:
                    requirement != "clockCandidateMatrix",
                wakeObserved: requirement != "wake",
                foregroundObserved: requirement != "foreground",
                networkChangeObserved: requirement != "networkChange",
                newPeerDiscoveryObserved:
                    requirement != "newPeerDiscovery",
                boundedSessionObserved: requirement != "boundedSession",
                thirtySecondCadenceObserved:
                    requirement != "thirtySecondCadence",
                systemClockChangeRevalidationObserved:
                    requirement != "systemClockChangeRevalidation",
                awakeDeviceFinalizationObserved:
                    requirement != "awakeDeviceFinalization",
                sleepingDeviceFinalizationObserved:
                    requirement != "sleepingDeviceFinalization",
                resourceCostMeasured: requirement != "resourceCost"
            )
        }

        let scenarios = ScenarioRunner.run(ScenarioCatalog.all)
        let cost = ResourceCostSummary(
            sessionStarts: 1,
            attempts: 3,
            timerWakeups: 1,
            transferredBytes: 0
        )
        let complete = ProbeReport.make(
            scenarios: scenarios,
            resourceCost: cost,
            liveGate: evidence(missing: nil)
        )
        #expect(complete.liveGate.complete)
        #expect(complete.policyToleranceMayBeApproved)

        for requirement in requirements {
            let incomplete = ProbeReport.make(
                scenarios: scenarios,
                resourceCost: cost,
                liveGate: evidence(missing: requirement)
            )
            #expect(
                !incomplete.liveGate.complete,
                "누락 gate가 complete로 판정됨: \(requirement)"
            )
            #expect(
                !incomplete.policyToleranceMayBeApproved,
                "누락 gate가 승인 후보로 판정됨: \(requirement)"
            )
        }
    }

    @Test("로컬 절대 경로와 네트워크 식별자 marker를 익명화 실패로 잡는다")
    func sanitizerFindsEvidenceLeaks() {
        #expect(EvidenceSanitizer.exposedMarkers(in: "/Users/example/result.json") == ["/Users/"])
        #expect(EvidenceSanitizer.exposedMarkers(in: "{\"hostname\":\"private\"}") == ["\"hostname\""])
        #expect(EvidenceSanitizer.exposedMarkers(in: "{\"scenario\":\"safe\"}").isEmpty)
    }
}
