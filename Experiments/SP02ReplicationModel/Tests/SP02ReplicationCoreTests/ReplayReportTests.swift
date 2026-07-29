import Foundation
import Testing

@testable import SP02ReplicationCore

/// fixture 카탈로그와 보고서 계약.
///
/// 보고서는 이 스파이크의 증거 그 자체다. 값이 실행마다 달라지거나 익명화
/// 경계가 깨지면 증거로 쓸 수 없다.
@Suite("SP-02 replay 보고서")
struct ReplayReportTests {
    @Test("fixture 이름은 중복되지 않는다")
    func fixtureNamesAreUnique() {
        let names = FixtureCatalog.all.map(\.name)
        #expect(Set(names).count == names.count)
    }

    @Test("모든 fixture가 선언한 수렴·순서 독립 기대와 일치한다")
    func allFixturesMatchExpectations() {
        let report = ReplayRunner.run(fixtures: FixtureCatalog.all, permutations: 8)
        for fixture in report.fixtures {
            #expect(fixture.passed, "\(fixture.fixture): \(fixture.verdict)")
        }
    }

    @Test("모든 fixture를 두 번 이상 다른 순서로 실행해 결과를 비교한다")
    func everyFixtureRunsAtLeastTwoOrders() {
        let report = ReplayRunner.run(fixtures: FixtureCatalog.all, permutations: 2)
        #expect(report.fixtures.allSatisfy { $0.permutations >= 2 })
        #expect(report.fixtures.count == FixtureCatalog.all.count)
    }

    @Test("순열 수는 상한과 하한을 벗어나지 않는다")
    func permutationCountIsBounded() {
        // 무한 반복을 막는 상한이 실제로 걸리는지 확인한다.
        let clamped = ReplayRunner.run(fixtures: [FixtureCatalog.deterministicReplay()], permutations: 10_000)
        #expect(clamped.permutations == ReplayRunner.maximumPermutations)
        let raised = ReplayRunner.run(fixtures: [FixtureCatalog.deterministicReplay()], permutations: 1)
        #expect(raised.permutations == 2)
    }

    @Test("순서 의존을 관측해야 하는 fixture는 요청 순열이 적어도 하한까지 올라간다")
    func orderDependentFixtureRaisesPermutationFloor() {
        // 하한 계산이 사라지면 "순서 의존이 존재한다"는 존재 명제가 다시 순열
        // 운에 걸린다. 계산 자체를 고정한다.
        let raised = ReplayRunner.report(
            for: FixtureCatalog.sameIDPayloadConflict(),
            permutations: 2,
            seed: ReplayRunner.defaultSeed
        )
        #expect(raised.permutations == ReplayRunner.minimumPermutationsForOrderDependence)
        // 순서 독립을 기대하는 fixture는 요청 값을 그대로 쓴다.
        let asRequested = ReplayRunner.report(
            for: FixtureCatalog.deterministicReplay(),
            permutations: 2,
            seed: ReplayRunner.defaultSeed
        )
        #expect(asRequested.permutations == 2)
    }

    @Test("같은 seed로 두 번 실행하면 완전히 같은 보고서가 나온다")
    func sameSeedProducesIdenticalReport() {
        let first = ReplayRunner.run(fixtures: FixtureCatalog.all, permutations: 4, seed: 7).jsonString()
        let second = ReplayRunner.run(fixtures: FixtureCatalog.all, permutations: 4, seed: 7).jsonString()
        #expect(first == second)
    }

    @Test("결정적 replay fixture는 모든 Peer가 하나의 hash만 낸다")
    func deterministicReplayHasSingleHashPerPeer() {
        let report = ReplayRunner.report(
            for: FixtureCatalog.deterministicReplay(),
            permutations: 8,
            seed: ReplayRunner.defaultSeed
        )
        #expect(report.convergent == true)
        #expect(report.peers.allSatisfy { $0.distinctHashesAcrossPermutations == 1 })
        #expect(Set(report.peers.map(\.projectionHash)).count == 1)
    }

    @Test("동일 ID 변조 fixture는 순서 의존을 숨기지 않고 드러낸다")
    func forgedEnvelopeFixtureExposesOrderDependence() {
        let report = ReplayRunner.report(
            for: FixtureCatalog.sameIDPayloadConflict(),
            permutations: 8,
            seed: ReplayRunner.defaultSeed
        )
        #expect(report.orderIndependent == false)
        let observer = report.peers.first { $0.peer == "P3" }
        #expect(observer?.distinctHashesAcrossPermutations ?? 0 > 1)
        #expect(observer?.quarantinedEventCount ?? 0 > 0)
        // 변조 envelope를 받지 않은 두 Peer는 계속 수렴한다.
        #expect(report.convergent == true)
    }

    @Test("세션 한도 소진 fixture는 수렴하지 않은 상태를 그대로 보고한다")
    func exhaustedSessionFixtureReportsDivergence() {
        let report = ReplayRunner.report(
            for: FixtureCatalog.boundedSessionExhaustion(),
            permutations: 4,
            seed: ReplayRunner.defaultSeed
        )
        #expect(report.diverged == true)
        #expect(report.peers.allSatisfy { peer in
            peer.rooms.allSatisfy { !$0.canCompleteOrder }
        })
    }

    @Test("보고서에 네트워크·개인 식별자 필드가 없다")
    func reportStaysAnonymous() throws {
        let report = ReplayRunner.run(fixtures: FixtureCatalog.all, permutations: 2)
        let json = report.jsonString()
        let parsed = try #require(
            try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
        )
        #expect(parsed["anonymized"] as? Bool == true)
        // 최상위 key만 보면 중첩 필드로 새어 나온 값을 놓친다. 직렬화한 전체
        // 문자열에서 금지 필드 이름을 찾는다.
        for forbidden in ["ipAddress", "hostname", "ssid", "interfaceName", "endpoint", "nickname"] {
            #expect(parsed[forbidden] == nil, "출력 최상위에 \(forbidden) 필드가 있어서는 안 된다")
            #expect(json.contains("\"\(forbidden)\"") == false, "출력 어딘가에 \(forbidden) 필드가 있다")
        }
        // 메뉴·가게 원문은 digest로만 남는다(`POL-02-R-07`). fixture가 실제로
        // 실은 문자열을 전부 순회한다. 목록을 손으로 관리하면 새 fixture가
        // 검사에서 빠진다.
        let literals = Set(FixtureCatalog.all.flatMap(\.contentLiterals))
        #expect(literals.isEmpty == false, "검사할 내용 원문이 하나도 없다")
        for literal in literals {
            #expect(json.contains(literal) == false, "출력에 내용 원문 \(literal)이 남았다")
        }
    }

    @Test("보고서는 단계별 hash로 분리 전후를 함께 남긴다")
    func phaseHashesShowBeforeAndAfterRejoin() {
        let report = ReplayRunner.report(
            for: FixtureCatalog.partitionAndRejoin(),
            permutations: 2,
            seed: ReplayRunner.defaultSeed
        )
        #expect(report.phaseHashes.count == 2)
        #expect(report.phaseHashes[0].hasPrefix("분리 구간: "))
        #expect(report.phaseHashes[1].hasPrefix("재결합 대조: "))
        // 분리 구간에는 두 Peer가 다르고 재결합 뒤에는 같아야 한다.
        #expect(distinctHashes(in: report.phaseHashes[0]) == 2)
        #expect(distinctHashes(in: report.phaseHashes[1]) == 1)
    }

    /// `"라벨: P1=abc P2=def"` 줄에서 서로 다른 hash 수를 센다.
    private func distinctHashes(in line: String) -> Int {
        let values = line
            .split(separator: " ")
            .compactMap { token -> String? in
                let parts = token.split(separator: "=", maxSplits: 1)
                guard parts.count == 2 else { return nil }
                return String(parts[1])
            }
        return Set(values).count
    }

    @Test("익명화 표시는 선언이 아니라 실제 스캔 결과다")
    func anonymizedFlagIsComputed() {
        // 상수로 선언하면 익명화가 깨진 순간에도 그대로 `true`다.
        let leaking = FixtureCatalog.deterministicReplay()
        let report = ReplayRunner.report(for: leaking, permutations: 2, seed: 7)
        #expect(ReplayRunner.isAnonymous(reports: [report], fixtures: [leaking]))
        // 출력에 실제로 들어 있는 문자열을 내용 원문으로 주장하면 false가 된다.
        let hashLiteral = report.peers[0].projectionHash
        #expect(ReplayRunner.isAnonymous(
            reports: [report],
            fixtures: [
                Fixture(
                    name: "probe",
                    question: "",
                    traceIDs: [],
                    daySession: FixtureBase.daySession,
                    peers: [:],
                    authored: [FixtureBase.p1: [makeEvent(
                        "L01", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1,
                        order: 1, at: 665,
                        kind: .roomCreated(store: hashLiteral, orderDeadlineMinute: 720)
                    )]],
                    phases: [],
                    convergentPeers: [],
                    findings: []
                )
            ]
        ) == false)
    }

    @Test("권한 없는 쓰기 fixture는 어느 Peer에서도 적용되지 않는다")
    func unauthorizedWritesAreRejectedEverywhere() {
        let report = ReplayRunner.report(
            for: FixtureCatalog.unauthorizedWrites(),
            permutations: 4,
            seed: ReplayRunner.defaultSeed
        )
        #expect(report.convergent == true)
        #expect(report.peers.allSatisfy { $0.rejectedEventCount == 4 })
        #expect(report.peers.allSatisfy { peer in
            peer.rooms.allSatisfy { $0.orderState == "inProgress" && $0.conflicts.isEmpty }
        })
    }

    @Test("중복 생성 record fixture는 순서와 무관하게 확인 필요로 남는다")
    func duplicateRoomRecordFixtureStaysDeterministic() {
        let report = ReplayRunner.report(
            for: FixtureCatalog.duplicateRoomRecord(),
            permutations: 8,
            seed: ReplayRunner.defaultSeed
        )
        #expect(report.orderIndependent)
        #expect(report.convergent == true)
        #expect(report.peers.allSatisfy { $0.distinctHashesAcrossPermutations == 1 })
        #expect(report.peers.allSatisfy { peer in
            peer.rejectedEventCount == 1 && peer.rooms.allSatisfy { !$0.canCompleteOrder }
        })
    }

    @Test("심은 생성 record fixture는 취소와 확정 완료를 어느 Peer에서도 만들지 않는다")
    func plantedRoomRecordFixtureGrantsNoAuthority() {
        let report = ReplayRunner.report(
            for: FixtureCatalog.plantedRoomRecordAuthority(),
            permutations: 8,
            seed: ReplayRunner.defaultSeed
        )
        #expect(report.orderIndependent)
        #expect(report.convergent == true)
        // 종류가 틀린 취소 대상 하나만 장부에서 거부된다. 나머지 둘은 장부를
        // 통과하므로 거부 수만 세면 이 fixture는 의미가 없다.
        #expect(report.peers.allSatisfy { $0.rejectedEventCount == 1 })
        for peer in report.peers {
            for room in peer.rooms {
                #expect(room.orderState.hasPrefix("completedNeedsReview("))
                #expect(room.canCompleteOrder == false)
                // 취소가 적용됐다면 참여자가 전원 철회로 바뀐다.
                #expect(room.participants.contains("U1=confirmed(E07)"))
                #expect(room.participants.contains("U2=confirmed(E05)"))
                #expect(room.menus.contains { $0.hasPrefix("U1=head(E08,") })
            }
        }
    }

    @Test("마감 축소 fixture는 장부가 갈려도 같은 projection으로 수렴한다")
    func deadlineShrinkingFixtureConverges() {
        let report = ReplayRunner.report(
            for: FixtureCatalog.deadlineShrinkingRoomRecord(),
            permutations: 8,
            seed: ReplayRunner.defaultSeed
        )
        #expect(report.orderIndependent)
        #expect(report.convergent == true)
        #expect(report.peers.allSatisfy { $0.distinctHashesAcrossPermutations == 1 })
        for peer in report.peers {
            for room in peer.rooms {
                #expect(room.participants.contains("U1=awaitingAcknowledgement"))
                #expect(room.participants.contains("U2=awaitingAcknowledgement"))
                #expect(room.canCompleteOrder == false)
            }
        }
    }
}
