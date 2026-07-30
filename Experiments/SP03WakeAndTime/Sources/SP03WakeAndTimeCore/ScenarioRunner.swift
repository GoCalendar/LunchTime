import Foundation

/// SP-03 시나리오가 제공하는 증거의 종류.
///
/// 결정적 모델 결과를 실기기 관찰로 오인하지 않도록 결과마다 종류를 남긴다.
public enum EvidenceKind: String, Codable, Equatable, Sendable {
    case deterministicModel
    case liveObservation
}

/// 실행 전에 기대값을 선언한 SP-03 시나리오.
public struct WakeTimeScenario: @unchecked Sendable {
    public typealias Body = @Sendable () throws -> [String: String]

    public let name: String
    public let question: String
    public let traceIDs: [String]
    public let evidenceKind: EvidenceKind
    public let expectations: [String: String]
    public let body: Body

    public init(
        name: String,
        question: String,
        traceIDs: [String],
        evidenceKind: EvidenceKind = .deterministicModel,
        expectations: [String: String],
        body: @escaping Body
    ) {
        self.name = name
        self.question = question
        self.traceIDs = traceIDs
        self.evidenceKind = evidenceKind
        self.expectations = expectations
        self.body = body
    }
}

/// 시나리오의 기대값 하나와 실제 관측값.
public struct ScenarioObservation: Codable, Equatable, Sendable {
    public let key: String
    public let expected: String
    public let actual: String

    public var matched: Bool { expected == actual }
}

/// 시나리오 하나의 실행 결과.
public struct WakeTimeScenarioResult: Codable, Equatable, Sendable {
    public let name: String
    public let question: String
    public let traceIDs: [String]
    public let evidenceKind: EvidenceKind
    public let observations: [ScenarioObservation]
    public let executionError: String?

    public var passed: Bool {
        executionError == nil && observations.allSatisfy(\.matched)
    }
}

/// 기대와 실제의 합집합을 비교하는 결정적 시나리오 실행기.
public enum ScenarioRunner {
    public static func run(_ scenarios: [WakeTimeScenario]) -> [WakeTimeScenarioResult] {
        scenarios.map(run)
    }

    public static func run(_ scenario: WakeTimeScenario) -> WakeTimeScenarioResult {
        var actual: [String: String] = [:]
        var executionError: String?

        do {
            actual = try scenario.body()
        } catch {
            executionError = stableErrorName(error)
        }

        // 기대에 없는 실제 key도 실패로 잡는다. 관측 대상을 몰래 바꾸고도
        // 시나리오가 통과하는 일을 막기 위한 저장소 공통 패턴이다.
        let keys = Set(scenario.expectations.keys).union(actual.keys).sorted()
        let observations = keys.map { key in
            ScenarioObservation(
                key: key,
                expected: scenario.expectations[key] ?? "(선언되지 않음)",
                actual: actual[key] ?? "(관측되지 않음)"
            )
        }

        return WakeTimeScenarioResult(
            name: scenario.name,
            question: scenario.question,
            traceIDs: scenario.traceIDs.sorted(),
            evidenceKind: scenario.evidenceKind,
            observations: observations,
            executionError: executionError
        )
    }

    private static func stableErrorName(_ error: any Error) -> String {
        if let named = error as? any StableScenarioError {
            return named.stableName
        }
        let nsError = error as NSError
        return "\(nsError.domain)=\(nsError.code)"
    }
}

/// 자유 형식 오류 문구 대신 결과에 남길 안정적인 오류 이름.
public protocol StableScenarioError: Error {
    var stableName: String { get }
}
