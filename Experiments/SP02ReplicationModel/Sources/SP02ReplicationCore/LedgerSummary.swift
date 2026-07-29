import Foundation

/// 한 scope의 보유 범위 요약.
///
/// 아키텍처 `03`은 요약의 구체 자료구조(version vector, Merkle, set
/// reconciliation)를 미결정으로 남겼다. 이 모델은 그 선택을 하지 않고 요약이
/// 만족해야 하는 **논리 계약**만 고정한다.
///
/// 1. 일일 세션·Room·데이터 종류 scope를 구분한다.
/// 2. 어떤 이벤트가 누락됐는지 후속 request로 식별할 수 있다.
/// 3. 검증 장부만 담는다. pending/quarantine payload는 넣지 않는다.
public struct ScopeSummary: Equatable, Sendable {
    public let scope: EventScope
    /// 정렬된 보유 event ID.
    public let eventIDs: [EventID]

    public var digest: String {
        Digest.hex(of: "\(scope.description)|" + eventIDs.map(\.rawValue).joined(separator: ","))
    }
}

/// Peer 간 비교에 쓰는 장부 요약 전체.
public struct LedgerSummary: Equatable, Sendable {
    public let scopes: [EventScope: ScopeSummary]

    /// 검증된 이벤트만으로 요약을 만든다.
    ///
    /// pending/quarantine을 포함하면 상대가 그것을 정상 event로 오해해 relay하고,
    /// 재검증 전 payload가 장부에 퍼진다.
    public init(ledger: Ledger) {
        var grouped: [EventScope: [EventID]] = [:]
        for event in ledger.validated.values {
            grouped[event.scope, default: []].append(event.id)
        }
        scopes = grouped.reduce(into: [:]) { result, entry in
            result[entry.key] = ScopeSummary(scope: entry.key, eventIDs: entry.value.sorted())
        }
    }

    /// 상대가 보유하고 내가 보유하지 않은 event ID.
    public func missing(comparedTo other: LedgerSummary) -> [EventID] {
        let mine = Set(scopes.values.flatMap(\.eventIDs))
        let theirs = Set(other.scopes.values.flatMap(\.eventIDs))
        return theirs.subtracting(mine).sorted()
    }

    /// 비교한 scope가 모두 같은 digest인지.
    ///
    /// 한쪽에만 있는 scope는 불일치로 본다. 요약 충돌이나 불완전 응답을 "차이
    /// 없음"으로 처리하지 않는다는 아키텍처 `03`의 요구다.
    public func matchesEveryScope(of other: LedgerSummary) -> Bool {
        let allScopes = Set(scopes.keys).union(other.scopes.keys)
        return allScopes.allSatisfy { scope in
            scopes[scope]?.digest == other.scopes[scope]?.digest
        }
    }
}
