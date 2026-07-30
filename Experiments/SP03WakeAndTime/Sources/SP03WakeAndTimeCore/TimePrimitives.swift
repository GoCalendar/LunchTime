/// 세션 timeout과 주기 판정에만 쓰는 단조 시각.
///
/// 단위는 밀리초다. Unix epoch나 업무 시각으로 해석할 수 없도록 wall clock과
/// 별도 타입으로 둔다. 잠자기·수동 시계 변경 때문에 wall clock이 움직여도
/// timeout과 cadence 계산은 이 값만 사용해야 한다.
public struct MonotonicInstant: Hashable, Comparable, Sendable {
    public let milliseconds: Int64

    public init(milliseconds: Int64) {
        self.milliseconds = milliseconds
    }

    public func advanced(by milliseconds: Int64) -> MonotonicInstant {
        let (value, overflow) = self.milliseconds.addingReportingOverflow(milliseconds)
        precondition(!overflow, "monotonic millisecond overflow")
        return MonotonicInstant(milliseconds: value)
    }

    /// 더 이른 단조 시각부터 흐른 밀리초.
    public func elapsedMilliseconds(since earlier: MonotonicInstant) -> Int64 {
        let (value, overflow) = milliseconds.subtractingReportingOverflow(earlier.milliseconds)
        precondition(!overflow && value >= 0, "monotonic time must not move backwards")
        return value
    }

    public static func < (lhs: MonotonicInstant, rhs: MonotonicInstant) -> Bool {
        lhs.milliseconds < rhs.milliseconds
    }
}

/// 업무 시간 경계와 Peer 시계 차이 판정에만 쓰는 wall clock 시각.
///
/// 단조 시각과 의도치 않게 빼거나 비교할 수 없도록 별도 타입으로 둔다.
public struct WallClockInstant: Hashable, Comparable, Sendable {
    public let millisecondsSinceUnixEpoch: Int64

    public init(millisecondsSinceUnixEpoch: Int64) {
        self.millisecondsSinceUnixEpoch = millisecondsSinceUnixEpoch
    }

    public static func < (lhs: WallClockInstant, rhs: WallClockInstant) -> Bool {
        lhs.millisecondsSinceUnixEpoch < rhs.millisecondsSinceUnixEpoch
    }
}
