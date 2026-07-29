import Foundation

/// 운영 이벤트 envelope가 사용하는 불투명 문자열 식별자의 공통 계약.
///
/// `POL-02-R-05`는 "같은 논리 순서의 충돌은 이벤트 ID 등 모든 Peer가 공유하는
/// 결정적 보조 키로 정렬한다"고 요구한다. 보조 키가 되려면 식별자에 모든
/// Peer가 같은 결과를 얻는 전순서가 있어야 하므로 `Comparable`을 포함한다.
///
/// 식별자는 값만 감싸며 형식을 검사하지 않는다. 필수 식별 필드가 비어 있는지는
/// ``DurableEvent`` 생성 시점이 한 곳에서 판정한다. 검사 지점이 흩어지면
/// "decode 또는 적용 전에 명시적 오류로 거부한다"는 계약을 지키는 경로와
/// 우회하는 경로가 함께 생긴다.
///
/// 직렬화 표현도 여기서 정하지 않는다. wire의 key와 형태는
/// ``EventEnvelopeCodec``이 한 곳에서 소유한다.
public protocol OpaqueEventIdentifier: Hashable, Comparable, Sendable, CustomStringConvertible {
    var rawValue: String { get }
    init(_ rawValue: String)
}

extension OpaqueEventIdentifier {
    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }

    public var description: String { rawValue }

    /// 비교·digest·직렬화가 모두 같은 값을 보도록 정규화한 식별자.
    ///
    /// Swift `String`의 `==`와 `hashValue`는 유니코드 정규 동등성을 쓰지만
    /// digest와 wire 바이트는 UTF-8 원본을 쓴다. 정규화 없이 두면 `==`로 같은
    /// 두 이벤트가 서로 다른 digest를 갖고, `EventCollection`이 같은 내용을
    /// 무결성 충돌로 격리한다. 반대로 저장·전송 계층이 문자열 정규화를
    /// 적용하면(APFS 경로, macOS 한글 IME·pasteboard) 정상 envelope가 영구
    /// 거부된다.
    ///
    /// 그래서 양끝 공백을 제거하고 NFC로 고정한 값만 envelope에 들어간다.
    var normalized: Self {
        Self(
            rawValue
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .precomposedStringWithCanonicalMapping
        )
    }
}

/// 전역적으로 충돌 가능성이 충분히 낮은 이벤트 ID(`POL-02-R-01`).
///
/// 이벤트 적용의 멱등 키이자 논리 순서가 같을 때의 결정적 보조 정렬 키다.
/// 값 생성 방식(UUID 등)은 이 계약이 정하지 않는다.
public struct EventID: OpaqueEventIdentifier {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// 일일 세션(운영일) ID.
///
/// 운영일의 시간 경계와 표기 규칙은 `POL-01`이 소유한다. envelope는 이벤트가
/// 어느 운영일에 속하는지만 기록한다.
public struct DaySessionID: OpaqueEventIdentifier {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// 점심방 ID.
public struct RoomID: OpaqueEventIdentifier {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// 작성 사용자 ID. 닉네임이 아니라 권한 판정에 쓰는 불투명 식별자다.
public struct UserID: OpaqueEventIdentifier {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// 작성 기기 ID. MVP에서 사용자와 1:1이지만 계약에서는 분리해 둔다.
public struct DeviceID: OpaqueEventIdentifier {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// 이벤트가 바꾸는 대상 엔터티의 ID(`POL-02-R-01`의 `대상 엔터티`).
public struct EntityID: OpaqueEventIdentifier {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// 대상 엔터티의 데이터 종류.
///
/// 아키텍처 `03`이 장부 요약을 "일일 세션·Room·데이터 종류"로 구분하라고
/// 요구한다. 그 scope를 계산하는 계층이 payload를 해석하지 않아도 되도록
/// 종류를 envelope에 둔다.
///
/// 구체적인 종류 어휘(`menu`, `participation` 등)는 각 도메인 이슈가 정의한다.
/// 닫힌 열거형으로 고정하면 새 도메인이 payload가 아니라 이 공용 계약을
/// 고쳐야 하므로 불투명 문자열로 둔다.
public struct EntityKind: OpaqueEventIdentifier {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// 이벤트 종류(`POL-02-R-01`의 `이벤트 종류`).
///
/// 수신 Peer가 payload를 해석하기 전에 라우팅과 진단에 사용하는 라벨이다.
/// ``EntityKind``와 마찬가지로 어휘는 도메인이 정의한다.
public struct EventType: OpaqueEventIdentifier {
    public let rawValue: String
    public init(_ rawValue: String) { self.rawValue = rawValue }
}
