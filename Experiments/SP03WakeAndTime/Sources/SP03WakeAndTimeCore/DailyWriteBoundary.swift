import Foundation

/// 한국 시간의 한 운영일 쓰기 단계(`PRD-01-FR-01`, `POL-01-R-01`).
public enum DailyWritePhase: String, Equatable, Sendable {
    case waiting
    case writable
    case closed
}

/// 한 KST 운영일의 terminal-close durable projection.
///
/// 제품 저장 형식을 정하는 타입은 아니다. 독립 스파이크에서 process 재생성
/// 전후에도 같은 운영일의 close latch가 보존되어야 함을 명시한다.
public struct DailyWriteBoundarySnapshot: Equatable, Sendable {
    public let operatingDayStart: WallClockInstant
    public let isTerminallyClosed: Bool

    fileprivate init(
        operatingDayStart: WallClockInstant,
        isTerminallyClosed: Bool
    ) {
        self.operatingDayStart = operatingDayStart
        self.isTerminallyClosed = isTerminallyClosed
    }
}

/// 한 운영일의 `[11:00, 14:30)` 쓰기 경계를 계산한다.
///
/// 인스턴스 하나는 생성 시 선택한 한국 날짜 하나만 담당한다. `closed`에 한 번
/// 들어가면 벽시계가 뒤로 이동해도 다시 열리지 않는다. 다음 운영일은 새
/// 인스턴스를 만들어야 한다.
public struct DailyWriteBoundary: Equatable, Sendable {
    public static let koreaTimeZone = TimeZone(identifier: "Asia/Seoul")!

    public let operatingDayStart: WallClockInstant
    public let sessionStart: WallClockInstant
    public let writeCutoff: WallClockInstant
    public private(set) var isTerminallyClosed: Bool

    public init(operatingDayContaining referenceWallTime: WallClockInstant) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = Self.koreaTimeZone
        let referenceDate = Date(
            timeIntervalSince1970: Double(referenceWallTime.millisecondsSinceUnixEpoch) / 1_000
        )
        let startOfDay = calendar.startOfDay(for: referenceDate)
        let sessionStartDate = calendar.date(byAdding: .hour, value: 11, to: startOfDay)!
        let writeCutoffDate = calendar.date(
            byAdding: .minute,
            value: 14 * 60 + 30,
            to: startOfDay
        )!
        operatingDayStart = Self.wallClockInstant(for: startOfDay)
        sessionStart = Self.wallClockInstant(for: sessionStartDate)
        writeCutoff = Self.wallClockInstant(for: writeCutoffDate)
        isTerminallyClosed = false
    }

    /// 저장된 같은 KST 운영일의 terminal close를 process 재생성 뒤 복원한다.
    public init(restoring snapshot: DailyWriteBoundarySnapshot) {
        self.init(operatingDayContaining: snapshot.operatingDayStart)
        isTerminallyClosed = snapshot.isTerminallyClosed
    }

    /// 현재 운영일의 durable projection 후보.
    public var snapshot: DailyWriteBoundarySnapshot {
        DailyWriteBoundarySnapshot(
            operatingDayStart: operatingDayStart,
            isTerminallyClosed: isTerminallyClosed
        )
    }

    /// 현재 벽시각을 반영한다.
    ///
    /// 앱이 14:30에 잠들어 있었더라도 복귀 시각을 관측하는 첫 호출에서 바로
    /// 닫힌다. 이후 과거 벽시각을 전달해도 terminal close를 되돌리지 않는다.
    @discardableResult
    public mutating func observe(wallTime: WallClockInstant) -> DailyWritePhase {
        if isTerminallyClosed {
            return .closed
        }
        if wallTime >= writeCutoff {
            isTerminallyClosed = true
            return .closed
        }
        if wallTime < sessionStart {
            return .waiting
        }
        return .writable
    }

    private static func wallClockInstant(for date: Date) -> WallClockInstant {
        WallClockInstant(
            millisecondsSinceUnixEpoch: Int64((date.timeIntervalSince1970 * 1_000).rounded())
        )
    }
}
