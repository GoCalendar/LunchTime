import Foundation

/// 모델이 쓰는 식별자는 모두 익명 라벨이다.
///
/// 이 패키지의 어떤 출력에도 사람 이름, 사내 식별자, 가게 원문, 배민 링크와
/// 메뉴 원문을 담지 않는다. `POL-02-R-07`이 진단에 "이벤트 ID, 상태 코드,
/// 소요 시간과 익명화된 기기 식별자만" 허용하므로 fixture도 같은 경계를 지킨다.
public protocol AnonymousLabel: Hashable, Comparable, Sendable, CustomStringConvertible {
    var rawValue: String { get }
    init(_ rawValue: String)
}

extension AnonymousLabel {
    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
    public var description: String { rawValue }
}

/// 전역적으로 충돌 가능성이 충분히 낮은 이벤트 ID.
///
/// `POL-02-R-05`의 "같은 논리 순서의 충돌은 이벤트 ID 등 모든 Peer가 공유하는
/// 결정적 보조 키로 정렬한다"를 만족하려면 이 값이 전순서를 가져야 한다.
/// 그래서 `Comparable`이며, projection reducer의 보조 정렬 키로만 쓴다.
public struct EventID: AnonymousLabel {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// 점심방 ID.
public struct RoomID: AnonymousLabel {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// 사용자 ID. 닉네임이 아니라 권한 판정에 쓰는 불투명 식별자다(`PRD-01` 4절).
public struct UserID: AnonymousLabel {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// 기기 ID. MVP에서 사용자 ID와 1:1이지만 모델에서는 분리해 둔다.
public struct DeviceID: AnonymousLabel {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// 시뮬레이션에 참여하는 Peer.
public struct PeerID: AnonymousLabel {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// 장부 요약이 구분해야 하는 데이터 종류.
///
/// 아키텍처 `03`의 "최소한 일일 세션·Room·데이터 종류의 scope를 구분하고"를
/// 그대로 옮겼다. 구체 자료구조(version vector, Merkle 등)는 미결정이므로
/// 이 모델은 scope 분리라는 논리 요구만 고정한다.
public enum DataKind: String, Sendable, CaseIterable, Comparable {
    case roomInfo = "room-info"
    case participation = "participation"
    case menu = "menu"
    case orderStatus = "order-status"
    case userSelection = "user-selection"

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// 요약·누락 계산의 단위.
public struct EventScope: Hashable, Sendable, Comparable, CustomStringConvertible {
    public let daySession: String
    /// 일일 세션 전체에 걸리는 이벤트는 `nil`이다. 중복 참여 선택이 그 예다.
    public let room: RoomID?
    public let kind: DataKind

    public init(daySession: String, room: RoomID?, kind: DataKind) {
        self.daySession = daySession
        self.room = room
        self.kind = kind
    }

    public var description: String {
        "\(daySession)/\(room?.rawValue ?? "-")/\(kind.rawValue)"
    }

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.description < rhs.description }
}

/// 운영일의 시간 경계. 값의 정본은 `PRD-01` 4절과 `POL-01`이다.
///
/// 모델은 실제 시계를 읽지 않는다. 모든 시각은 `Asia/Seoul` 자정 기준 분이며,
/// fixture가 명시적으로 지정한다. 실제 시간에 의존하면 fixture 결과가
/// 실행 시각에 따라 달라져 `결정적 replay`라는 검증 목적 자체가 무너진다.
public enum DaySchedule {
    /// 11:00. 당일 쓰기 시작.
    public static let writeOpenMinute = 11 * 60
    /// 14:30. 쓰기 종료의 비가역 경계.
    public static let writeCloseMinute = 14 * 60 + 30

    /// 해당 분이 쓰기 가능한 활성 구간인지.
    public static func isWritable(minute: Int) -> Bool {
        minute >= writeOpenMinute && minute < writeCloseMinute
    }
}
