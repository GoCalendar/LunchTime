import Foundation

/// 한 Peer가 마지막에 관측한 상태를 사람이 읽을 수 있게 정리한 줄.
public struct PeerObservationReport: Encodable, Sendable {
    public let peer: String
    /// 순열 0의 projection hash.
    public let projectionHash: String
    /// 모든 순열에서 관측한 서로 다른 hash 수.
    ///
    /// 1이면 도착 순서와 무관하다는 뜻이다. 2 이상이면 순서에 의존한 것이므로
    /// 그 자체가 발견이다.
    public let distinctHashesAcrossPermutations: Int
    public let rooms: [RoomObservationReport]
    /// 아직 의존 record를 기다리는 event 수.
    public let pendingEventCount: Int
    /// 같은 ID·다른 payload로 격리한 event 수.
    public let quarantinedEventCount: Int
    /// 정책 검증에 실패해 적용하지 않은 event 수.
    public let rejectedEventCount: Int
}

/// 한 Room에 대한 관측.
public struct RoomObservationReport: Encodable, Sendable {
    public let room: String
    public let participants: [String]
    public let menus: [String]
    public let orderState: String
    public let conflicts: [String]
    /// 각 참여·메뉴 head event의 사용자 표시 상태.
    public let syncStatuses: [String]
    public let orderBlockers: [String]
    public let canCompleteOrder: Bool
    public let soloRoomExceptionApplies: Bool
}

/// 한 fixture의 실행 결과.
public struct FixtureReport: Encodable, Sendable {
    public let fixture: String
    public let question: String
    public let traceIDs: [String]
    public let permutations: Int
    public let seed: String
    /// Peer별로 모든 순열에서 같은 projection hash가 나왔는지.
    public let orderIndependent: Bool
    public let expectsOrderIndependent: Bool
    /// 수렴 대상 Peer가 모두 같은 hash인지. 검사 대상이 없으면 `nil`.
    public let convergent: Bool?
    /// 분기해야 하는 Peer가 실제로 달랐는지. 검사 대상이 없으면 `nil`.
    public let diverged: Bool?
    /// 순열 0의 단계별 Peer hash.
    public let phaseHashes: [String]
    public let peers: [PeerObservationReport]
    public let findings: [String]
    public let verdict: String

    public var passed: Bool { verdict == FixtureReport.passVerdict }

    static let passVerdict = "기대한 수렴·순서 독립 결과와 일치"
}

/// 전체 실행 결과.
public struct ReplayReport: Encodable, Sendable {
    public static let tool = "sp02-replay"

    public let tool: String
    public let seed: String
    public let permutations: Int
    /// fixture가 event에 실은 내용 원문이 출력 어디에도 없는지 **실제로 검사한**
    /// 결과다.
    ///
    /// 이 값을 상수로 선언하면 출력이 스스로를 무조건 익명이라고 주장하게 된다.
    /// 그 선언은 익명화가 깨진 순간에도 그대로 `true`다.
    public let anonymized: Bool
    public let fixtures: [FixtureReport]
    public let verdict: String

    public func jsonString() -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(self), let text = String(data: data, encoding: .utf8) else {
            return "{\"error\":\"결과를 JSON으로 직렬화할 수 없습니다\"}"
        }
        return text
    }
}

/// fixture를 여러 순열로 실행해 보고서를 만든다.
public enum ReplayRunner {
    /// 순열 수의 상한.
    ///
    /// 무한 반복을 막기 위한 값이다. 값 자체에 제품 의미는 없다.
    public static let maximumPermutations = 64
    public static let defaultPermutations = 8
    public static let defaultSeed: UInt64 = 20_260_729
    /// 순서 의존을 **관측해야** 하는 fixture의 최소 순열 수.
    ///
    /// "순서 의존이 존재한다"는 존재 명제라, 순열이 우연히 문제 순서를 만들지
    /// 못하면 근거 없이 실패한다. 실제로 순열 2개에서는 seed 40개 중 18개가
    /// 그렇게 실패했다. 그런 fixture만 하한을 올려 판정을 우연에 맡기지 않는다.
    public static let minimumPermutationsForOrderDependence = 8

    public static func run(
        fixtures: [Fixture],
        permutations: Int = defaultPermutations,
        seed: UInt64 = defaultSeed,
        progress: ((String) -> Void)? = nil
    ) -> ReplayReport {
        let count = max(2, min(permutations, maximumPermutations))
        var reports: [FixtureReport] = []
        for fixture in fixtures {
            progress?("fixture \(fixture.name): 순열 \(count)회 실행")
            reports.append(report(for: fixture, permutations: count, seed: seed))
        }
        let failures = reports.filter { !$0.passed }
        return ReplayReport(
            tool: ReplayReport.tool,
            seed: String(seed),
            permutations: count,
            anonymized: isAnonymous(reports: reports, fixtures: fixtures),
            fixtures: reports,
            verdict: failures.isEmpty
                ? "모든 fixture가 기대한 결과와 일치"
                : "기대와 다른 fixture \(failures.count)개: \(failures.map(\.fixture).joined(separator: ", "))"
        )
    }

    static func report(for fixture: Fixture, permutations: Int, seed: UInt64) -> FixtureReport {
        let effectivePermutations = fixture.expectsOrderIndependentProjection
            ? permutations
            : max(permutations, minimumPermutationsForOrderDependence)
        var runs: [PermutationRun] = []
        for index in 0..<effectivePermutations {
            runs.append(FixtureRunner.run(fixture, permutation: index, seed: seed))
        }

        // 각 Peer가 모든 순열에서 같은 결과를 냈는가.
        let orderIndependent = fixture.peers.keys.allSatisfy { peer in
            Set(runs.compactMap { $0.projectionHashes[peer] }).count == 1
        }

        var convergent: Bool?
        if fixture.convergentPeers.count > 1 {
            convergent = runs.allSatisfy { run in
                Set(fixture.convergentPeers.compactMap { run.projectionHashes[$0] }).count == 1
            }
        }

        var diverged: Bool?
        if fixture.divergentPeers.count > 1 {
            diverged = runs.allSatisfy { run in
                Set(fixture.divergentPeers.compactMap { run.projectionHashes[$0] }).count > 1
            }
        }

        let baseline = runs[0]
        let phaseHashes = baseline.phaseSnapshots.map { snapshot in
            let hashes = snapshot.projectionHashes
                .sorted { $0.key < $1.key }
                .map { "\($0.key.rawValue)=\(shortHash($0.value))" }
                .joined(separator: " ")
            return "\(snapshot.label): \(hashes)"
        }

        let peers = baseline.peers.keys.sorted().map { peer -> PeerObservationReport in
            let state = baseline.peers[peer]!
            let local = state.localProjection(daySession: fixture.daySession)
            return PeerObservationReport(
                peer: peer.rawValue,
                projectionHash: baseline.projectionHashes[peer] ?? "",
                distinctHashesAcrossPermutations: Set(runs.compactMap { $0.projectionHashes[peer] }).count,
                rooms: local.structured.rooms.keys.sorted().map { room in
                    roomReport(room: room, local: local)
                },
                pendingEventCount: state.ledger.pending.count,
                quarantinedEventCount: state.ledger.quarantined.count,
                rejectedEventCount: state.ledger.rejected.count
            )
        }

        var problems: [String] = []
        if orderIndependent != fixture.expectsOrderIndependentProjection {
            problems.append("순서 독립 기대 \(fixture.expectsOrderIndependentProjection), 관측 \(orderIndependent)")
        }
        if let convergent, !convergent {
            problems.append("수렴 대상 Peer의 projection hash가 다름")
        }
        if let diverged, !diverged {
            problems.append("분기해야 할 Peer가 같은 projection hash를 냄")
        }

        return FixtureReport(
            fixture: fixture.name,
            question: fixture.question,
            traceIDs: fixture.traceIDs,
            permutations: effectivePermutations,
            seed: String(seed),
            orderIndependent: orderIndependent,
            expectsOrderIndependent: fixture.expectsOrderIndependentProjection,
            convergent: convergent,
            diverged: diverged,
            phaseHashes: phaseHashes,
            peers: peers,
            findings: fixture.findings,
            verdict: problems.isEmpty ? FixtureReport.passVerdict : problems.joined(separator: "; ")
        )
    }

    private static func roomReport(room: RoomID, local: LocalObservationProjection) -> RoomObservationReport {
        let projection = local.structured.rooms[room]!
        let readiness = local.orderReadiness(room: room)
        var statuses: [String] = []
        for user in projection.participants.keys.sorted() {
            if case .confirmed(let confirmation) = projection.participants[user]! {
                statuses.append("참여 \(user.rawValue): \(local.status(of: confirmation).rawValue)")
            }
            if let head = projection.menus[user]?.headEventID {
                statuses.append("메뉴 \(user.rawValue): \(local.status(of: head).rawValue)")
            }
        }
        return RoomObservationReport(
            room: room.rawValue,
            participants: projection.participants.keys.sorted().map {
                "\($0.rawValue)=\(projection.participants[$0]!.canonicalForm)"
            },
            menus: projection.menus.keys.sorted().map {
                "\($0.rawValue)=\(projection.menus[$0]!.canonicalForm)"
            },
            orderState: projection.orderState.canonicalForm,
            conflicts: (projection.conflicts + local.structured.daySessionConflicts)
                .sorted()
                .map(\.canonicalForm),
            syncStatuses: statuses,
            orderBlockers: readiness.blockers.map(\.rawValue),
            canCompleteOrder: readiness.canCompleteOrder,
            soloRoomExceptionApplies: readiness.soloRoomExceptionApplies
        )
    }

    /// fixture 내용 원문이 보고서 어디에도 남지 않았는지 검사한다.
    ///
    /// 최상위 key만 훑는 검사로는 중첩 필드에 새어 나온 값을 잡지 못하므로
    /// 직렬화한 전체 문자열을 본다.
    static func isAnonymous(reports: [FixtureReport], fixtures: [Fixture]) -> Bool {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(reports),
              let text = String(data: data, encoding: .utf8) else {
            return false
        }
        let literals = Set(fixtures.flatMap(\.contentLiterals))
        return literals.allSatisfy { !text.contains($0) }
    }

    /// 보고서에 넣는 짧은 hash. 전체 값은 `peers[].projectionHash`에 있다.
    static func shortHash(_ value: String) -> String {
        String(value.prefix(12))
    }
}
