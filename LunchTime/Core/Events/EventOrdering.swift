import Foundation

/// 모든 Peer가 공유하는 이벤트의 논리적 순서(`POL-02-R-01`).
///
/// 아키텍처 `04`는 "네트워크 수신 순서는 업무 순서가 아니다"라고 못박고,
/// projection이 논리 순서와 결정적 보조 키만 사용하도록 요구한다. 그래서 이
/// 값은 수신 시각이나 도착 순서와 무관한 단조 증가 카운터다.
///
/// Lamport clock, HLC 같은 구체 clock 표현은 아키텍처 `04`의 미결정 기술이며
/// `PRD-01-SP-03`이 정한다. envelope는 "비교 가능한 공유 1차 정렬 키"라는
/// 논리 요구만 고정하고 생성 알고리즘은 정하지 않는다.
public struct LogicalOrder: Hashable, Comparable, Sendable {
    public let value: UInt64

    public init(_ value: UInt64) { self.value = value }

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.value < rhs.value }
}

/// 대상 엔터티에 대한 이벤트의 리비전 번호(`POL-02-R-01`).
///
/// 최초 리비전은 `1`이고 이후 리비전은 자신이 대체하는 선행 리비전을 명시한다.
/// 같은 대상의 전체 리비전 사슬이 단조인지, 어떤 분기가 업무상 유효한지는
/// 이벤트 하나가 판정할 수 없다. 그 판정은 장부와 `POL-02-R-05`가 소유한다.
public struct EventRevision: Hashable, Comparable, Sendable {
    /// 1 이상의 리비전 번호. `0`과 음수는 ``DurableEvent`` 생성에서 거부된다.
    public let value: Int

    public static let initial = EventRevision(1)

    public init(_ value: Int) { self.value = value }

    /// ``DurableEvent``가 허용하는 가장 큰 리비전.
    ///
    /// 상한이 없으면 원격 Peer가 보낸 `Int.max` 리비전을 decode한 뒤 그 대상을
    /// 수정할 때 ``next``가 정수 오버플로로 프로세스를 종료시킨다. 검증되지
    /// 않은 입력이 crash를 만드는 경로이므로 생성 시점에 막는다.
    public static let maximum = EventRevision(Int.max - 1)

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.value < rhs.value }

    /// 다음 리비전.
    ///
    /// ``DurableEvent``가 보유한 리비전은 항상 ``maximum`` 이하이므로 이벤트의
    /// 리비전에서 호출하면 오버플로가 없다. 검증을 거치지 않은 값에서 직접
    /// 호출하면 오버플로는 프로그래머 오류로 남는다.
    public var next: EventRevision { EventRevision(value + 1) }
}

/// 이벤트의 로컬 발생 시각(`POL-02-R-01`).
///
/// 1970-01-01 UTC 기준 밀리초 정수로 고정한다. 부동소수 초를 직렬화하면 같은
/// 이벤트가 Peer마다 다른 바이트로 인코딩돼 고정 fixture 호환성과 digest 비교가
/// 무너진다.
///
/// 이 값은 순서 판정의 1차 키가 아니다. 시계 차이의 허용 오차와 안전 차단은
/// `POL-02-R-08`이 소유하므로 envelope는 값의 타당성을 판정하지 않는다.
public struct EventTimestamp: Hashable, Comparable, Sendable {
    public let epochMilliseconds: Int64

    public init(epochMilliseconds: Int64) { self.epochMilliseconds = epochMilliseconds }

    /// `Date`를 밀리초로 내림해 변환한다. 표현할 수 없는 시각은 `nil`이다.
    ///
    /// `Double` → `Int64` 변환은 NaN, 무한대와 `Int64` 범위 밖 값에서 trap한다.
    /// `.date`로 나갔다가 돌아오는 왕복이 자연스러운 값 타입이므로, 검증되지
    /// 않은 `occurredAt`을 받은 뒤의 왕복이 프로세스를 죽이지 않도록 실패를
    /// 값으로 돌려준다.
    public init?(_ date: Date) {
        guard let milliseconds = Int64(exactly: (date.timeIntervalSince1970 * 1000).rounded(.down))
        else { return nil }
        self.epochMilliseconds = milliseconds
    }

    public var date: Date { Date(timeIntervalSince1970: Double(epochMilliseconds) / 1000) }

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.epochMilliseconds < rhs.epochMilliseconds }
}
