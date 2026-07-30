import Foundation
import Testing

@testable import SP04SecurityCore

/// 시나리오 카탈로그 자체의 계약.
///
/// 시나리오가 아무것도 관측하지 않거나, 기대를 선언하지 않거나, 실행마다 다른
/// 결과를 내면 보고서의 증거가 근거를 잃는다.
@Suite("SP-04 시나리오 카탈로그")
struct ScenarioCatalogTests {
    private func makeWorkingDirectory() throws -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("sp04-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    @Test("시나리오 이름은 중복되지 않고 기대와 정본 참조를 갖는다")
    func catalogIsWellFormed() {
        let names = ScenarioCatalog.all.map(\.name)
        #expect(Set(names).count == names.count)
        for scenario in ScenarioCatalog.all {
            #expect(!scenario.expectations.isEmpty, "\(scenario.name)에 기대값이 없다")
            #expect(!scenario.policyReferences.isEmpty, "\(scenario.name)에 정본 참조가 없다")
            #expect(scenario.question.hasSuffix("?"), "\(scenario.name)의 질문이 질문 형태가 아니다")
        }
    }

    @Test("고정 seed에서 모든 시나리오가 선언한 기대와 일치한다")
    func allScenariosMatchExpectations() throws {
        let directory = try makeWorkingDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let report = ScenarioRunner.run(
            scenarios: ScenarioCatalog.all,
            seed: 20_260_730,
            useSystemEntropy: false,
            includeEnvironmentProbe: false,
            workingDirectory: directory
        )

        for scenario in report.scenarios where !scenario.passed {
            let error = scenario.executionError.map { " 오류=\($0)" } ?? ""
            Issue.record(
                "\(scenario.name) 불일치: \(scenario.mismatchedKeys.joined(separator: ", "))\(error)"
            )
        }
        #expect(report.allPassed)
        #expect(report.anonymized)
        #expect(report.anonymizationLeaks.isEmpty)
    }

    @Test("seed가 달라도 판정은 같다")
    func verdictIsIndependentOfSeed() throws {
        let directory = try makeWorkingDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        // 암호 연산이 실제이므로 바이트는 달라진다. 같아야 하는 것은 **판정**이다.
        let first = ScenarioRunner.run(
            scenarios: ScenarioCatalog.all,
            seed: 1,
            useSystemEntropy: false,
            includeEnvironmentProbe: false,
            workingDirectory: directory.appendingPathComponent("a")
        )
        let second = ScenarioRunner.run(
            scenarios: ScenarioCatalog.all,
            seed: 2,
            useSystemEntropy: false,
            includeEnvironmentProbe: false,
            workingDirectory: directory.appendingPathComponent("b")
        )
        #expect(first.allPassed)
        #expect(second.allPassed)
        #expect(
            first.scenarios.map { $0.observations.map(\.actual) }
                == second.scenarios.map { $0.observations.map(\.actual) }
        )
    }

    @Test("시스템 난수에서도 같은 판정이 나온다")
    func verdictHoldsWithSystemEntropy() throws {
        let directory = try makeWorkingDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let report = ScenarioRunner.run(
            scenarios: ScenarioCatalog.all,
            seed: 0,
            useSystemEntropy: true,
            includeEnvironmentProbe: false,
            workingDirectory: directory
        )
        for scenario in report.scenarios where !scenario.passed {
            Issue.record("\(scenario.name) 불일치: \(scenario.mismatchedKeys.joined(separator: ", "))")
        }
        #expect(report.allPassed)
    }

    @Test("관측되지 않은 기대 key와 선언되지 않은 관측을 둘 다 불일치로 센다")
    func runnerComparesUnionOfKeys() throws {
        let directory = try makeWorkingDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        // 실제에만 있는 key를 버리면 시나리오가 조용히 다른 것을 관측해도 통과한다.
        let drifting = SecurityScenario(
            name: "test-drift",
            question: "관측이 선언과 어긋나면 잡히는가?",
            policyReferences: ["POL-03-R-01"],
            expectations: ["declared": "yes"]
        ) { _ in ["observed": "yes"] }

        let report = ScenarioRunner.run(
            scenarios: [drifting],
            seed: 0,
            useSystemEntropy: false,
            includeEnvironmentProbe: false,
            workingDirectory: directory
        )
        #expect(!report.allPassed)
        #expect(report.scenarios[0].mismatchedKeys.sorted() == ["declared", "observed"])
    }

    @Test("익명화 표시는 선언이 아니라 실제 검사 결과다")
    func anonymizationIsMeasured() throws {
        let directory = try makeWorkingDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        // 심은 평문을 관측값으로 그대로 내보내는 시나리오를 넣으면 익명화
        // 표시가 `false`가 되어야 한다. 상수로 선언했다면 여기서 통과한다.
        let leaking = SecurityScenario(
            name: "test-leak",
            question: "출력에 평문이 남으면 잡히는가?",
            policyReferences: ["POL-02-R-07"],
            expectations: ["leak": ScenarioFixture.secrets[0].value]
        ) { context in ["leak": context.secrets[0].value] }

        let report = ScenarioRunner.run(
            scenarios: [leaking],
            seed: 0,
            useSystemEntropy: false,
            includeEnvironmentProbe: false,
            workingDirectory: directory
        )
        #expect(!report.anonymized)
        #expect(report.anonymizationLeaks == ["store"])
        #expect(!report.allPassed)
    }

    @Test("이름으로 시나리오 하나만 고를 수 있다")
    func lookupByName() {
        #expect(ScenarioCatalog.named("stolen-store-file") != nil)
        #expect(ScenarioCatalog.named("없는이름") == nil)
    }

    @Test("평문 검사기는 UTF-8 바이트 열에서 부분 열을 찾는다")
    func scannerFindsNeedles() {
        var haystack = Data([0xFF, 0xFE])
        haystack.append(Data("SP04-STORE-단골식당".utf8))
        haystack.append(Data([0x00]))
        #expect(
            PlaintextScanner.exposedLabels(in: haystack, secrets: ScenarioFixture.secrets)
                == ["store"]
        )
        #expect(
            PlaintextScanner
                .exposedLabels(in: Data([0x01, 0x02]), secrets: ScenarioFixture.secrets)
                .isEmpty
        )
    }
}

/// wire 형식 계약.
@Suite("SP-04 wire 형식")
struct WireCodecTests {
    @Test("봉투는 wire 왕복에서 그대로 복원된다")
    func envelopeRoundTrips() throws {
        let identity = try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: 1), nickname: nil
        ).identity
        let envelope = try SignedEnvelope.sign(
            OperationalEvent(
                eventID: "",
                daySession: "S1",
                room: nil,
                authorUser: identity.userID.rawValue,
                authorDevice: identity.deviceID.rawValue,
                eventType: "participationSelection",
                revision: 2,
                logicalOrder: 99,
                payload: Data("SP04".utf8)
            ),
            with: identity
        )
        let decoded = try WireCodec.decodeEnvelope(WireCodec.encode(envelope))
        #expect(decoded == envelope)
        // 일일 세션 scope 이벤트의 `room == nil`이 빈 문자열로 접히면 안 된다.
        #expect(decoded.event.room == nil)
    }

    @Test("도메인 라벨이 다르면 디코딩을 거부한다")
    func rejectsWrongDomain() throws {
        var writer = CanonicalWriter(domain: "다른도메인")
        writer.append(UInt64(1))
        #expect(throws: CanonicalReader.ReadError.domainMismatch) {
            _ = try WireCodec.decodeHello(writer.data)
        }
    }

    @Test("메시지 뒤에 붙은 임의 바이트를 거부한다")
    func rejectsTrailingBytes() {
        var padded = WireCodec.encode(HandshakeMessage.Confirm(signature: Data([1, 2, 3])))
        padded.append(Data(repeating: 0, count: 8))
        #expect(throws: CanonicalReader.ReadError.trailingBytes) {
            _ = try WireCodec.decodeConfirm(padded)
        }
    }

    @Test("메시지 종류가 다르면 디코딩을 거부한다")
    func rejectsWrongMessageTag() throws {
        let confirm = WireCodec.encode(HandshakeMessage.Confirm(signature: Data([1, 2, 3])))
        #expect(throws: WireCodec.DecodeError.unknownMessage) {
            _ = try WireCodec.decodeHello(confirm)
        }
    }

    @Test("잘린 바이트는 형식 오류로 거부한다")
    func rejectsTruncatedBytes() {
        let confirm = WireCodec.encode(HandshakeMessage.Confirm(signature: Data([1, 2, 3])))
        #expect(throws: CanonicalReader.ReadError.truncated) {
            _ = try WireCodec.decodeConfirm(confirm.prefix(confirm.count - 2))
        }
    }

    @Test("발견 패킷은 닉네임과 admission 자격을 담을 자리가 없다")
    func beaconCarriesNoNicknameOrCredential() throws {
        let identity = try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: 2), nickname: "SP04-NICK-점심대장"
        ).identity
        let scope = ScenarioFixture.supportedScope(mode: .deployedSharedSecret)
        let beacon = try #require(DiscoveryBeacon.advertise(identity: identity, scope: scope))

        #expect(
            PlaintextScanner
                .exposedLabels(in: beacon.wireBytes, secrets: ScenarioFixture.secrets)
                .isEmpty
        )
        // admission 자격이 방송되면 그 값 자체가 bearer token이 된다.
        #expect(
            !PlaintextScanner.contains(haystack: beacon.wireBytes, needle: scope.localTag.value)
        )
        #expect(beacon.deviceID == identity.deviceID.rawValue)
    }

    @Test("닉네임을 정하기 전에는 Peer로 노출되지 않는다")
    func beaconRequiresNickname() throws {
        // `POL-03-R-02`·`PRD-01-AC-08`: 첫 실행에서 닉네임을 정하기 전에는
        // 네트워크에 Peer로 노출되지 않는다.
        let anonymous = try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: 3), nickname: nil
        ).identity
        #expect(
            DiscoveryBeacon.advertise(
                identity: anonymous, scope: ScenarioFixture.supportedScope()
            ) == nil
        )
        #expect(
            DiscoveryBeacon.advertise(
                identity: anonymous.renamed(to: ""), scope: ScenarioFixture.supportedScope()
            ) == nil
        )
        #expect(
            DiscoveryBeacon.advertise(
                identity: anonymous.renamed(to: "이름"), scope: ScenarioFixture.supportedScope()
            ) != nil
        )
    }

    @Test("loopback 소켓 왕복이 바이트를 보존한다")
    func loopbackPreservesBytes() throws {
        let messages = [Data("SP04-A".utf8), Data(repeating: 0xAB, count: 4_096)]
        let received = try LoopbackTransport.roundTrip(messages: messages)
        #expect(received == messages)
    }
}
