import Foundation

/// 자동 신뢰가 방어하지 **않는** 위협(`POL-03-R-06`).
///
/// 목록을 코드에 두는 이유는 보고서 문장만으로는 회귀를 잡을 수 없기
/// 때문이다. 이 값들은 시나리오가 실제로 재현하거나(내부 악성 Peer 열람),
/// 재현이 불가능하면 그 사실을 명시적으로 남긴다.
public struct UndefendedThreat: Hashable, Sendable, Identifiable {
    public enum Coverage: String, Sendable {
        /// 이 모델이 실제로 재현했다. 방어되지 않음을 시험으로 보였다.
        case demonstrated
        /// 이 모델의 범위 밖이다. 시험하지 않았고 방어한다고 주장하지 않는다.
        case outOfModelScope
    }

    public let id: String
    public let summary: String
    public let coverage: Coverage
    public let policyReference: String

    public init(id: String, summary: String, coverage: Coverage, policyReference: String) {
        self.id = id
        self.summary = summary
        self.coverage = coverage
        self.policyReference = policyReference
    }
}

/// UI와 문서에서 쓰면 안 되는 표현(`POL-03-R-06`).
///
/// > 따라서 UI나 문서는 회사 WiFi를 강한 사용자 인증으로 표현하지 않는다.
/// > `종단간 암호화` 또는 `완전 삭제`라는 표현도 실제 프로토콜과 OS 동작이
/// > 해당 표현을 충족하는지 별도 보안 검토를 통과하기 전에는 사용하지 않는다.
///
/// 금지 문구를 검사 가능한 값으로 두면 화면 문자열을 실제로 훑을 수 있다.
/// 산문으로만 남기면 다음 작업자가 같은 표현을 다시 쓴다.
public struct ProhibitedClaim: Hashable, Sendable, Identifiable {
    public let id: String
    /// 이 표현이 왜 사실이 아닌가.
    public let reason: String
    /// 화면 문자열에서 찾을 부분 문자열.
    public let phrases: [String]

    public init(id: String, reason: String, phrases: [String]) {
        self.id = id
        self.reason = reason
        self.phrases = phrases
    }
}

public enum SecurityClaimPolicy {
    public static let prohibited: [ProhibitedClaim] = [
        ProhibitedClaim(
            id: "end-to-end-encryption",
            reason: "자동 신뢰 Peer 전부가 정당한 복호화 주체이므로 종단이 두 사람으로 좁혀지지 않는다",
            phrases: ["종단간 암호화", "종단 간 암호화", "end-to-end", "E2EE", "E2E 암호화"]
        ),
        ProhibitedClaim(
            id: "complete-deletion",
            reason: "각 Peer가 독립 삭제하고 macOS 스왑·덤프를 통제하지 않으므로 즉시·영구 삭제를 보장할 수 없다",
            phrases: ["완전 삭제", "영구 삭제", "완전히 삭제", "흔적 없이 삭제"]
        ),
        ProhibitedClaim(
            id: "verified-identity",
            reason: "자동 신뢰는 Peer가 지원 네트워크에서 LunchTime 프로토콜을 썼다는 뜻이며 개인 신원 증명이 아니다",
            phrases: ["본인 확인", "신원 확인됨", "인증된 사용자", "사원 인증", "회사 인증"]
        ),
        ProhibitedClaim(
            id: "trusted-peer-label",
            reason: "신뢰 상태 UI를 두지 않기로 했고(POL-03-R-02) 자동 신뢰는 사람에 대한 판단이 아니다",
            phrases: ["신뢰된 사용자", "신뢰할 수 있는 피어", "안전한 상대", "검증된 피어"]
        ),
        ProhibitedClaim(
            id: "secure-network-label",
            reason: "회사 Wi-Fi 접속 가능성은 접근 통제가 아니며 내부 악성 Peer를 걸러내지 못한다",
            phrases: ["안전한 네트워크", "보안 네트워크에서만", "사내망이므로 안전"]
        ),
        ProhibitedClaim(
            id: "tamper-proof",
            reason: "서명은 위조를 막지만 정당한 권한 안의 악의적 쓰기는 막지 못한다",
            phrases: ["위변조 불가", "변조 불가능", "해킹 불가"]
        )
    ]

    /// 화면 문자열이 금지 표현을 담고 있는지 확인한다.
    public static func violations(in text: String) -> [ProhibitedClaim] {
        let normalized = text.precomposedStringWithCanonicalMapping.lowercased()
        return prohibited.filter { claim in
            claim.phrases.contains { phrase in
                normalized.contains(phrase.precomposedStringWithCanonicalMapping.lowercased())
            }
        }
    }

    /// 같은 사실을 정확히 말하는 표현.
    ///
    /// 금지 목록만 두면 다음 작업자가 "그럼 뭐라고 쓰는가"에서 다시 막힌다.
    /// 이 문장들은 `POL-03-R-01`·`POL-03-R-06`이 실제로 보장하는 범위만
    /// 말한다. 회귀 테스트가 이 문장들이 금지 목록을 건드리지 않는지 확인한다.
    public static let approvedPhrasing: [String] = [
        "같은 회사 Wi-Fi에서 발견한 LunchTime 앱과 자동으로 연결합니다.",
        "주고받는 내용은 암호화되어 전송되며 같은 네트워크의 다른 장치가 내용을 읽을 수 없습니다.",
        "이 연결은 상대가 같은 회사 Wi-Fi의 LunchTime 앱이라는 뜻이며, 그 사람이 누구인지 확인한 것은 아닙니다.",
        "연결된 앱은 참여하지 않은 방의 메뉴와 채팅도 볼 수 있습니다.",
        "확인에 실패한 내용은 반영하지 않고 확인 필요로 표시합니다.",
        "메뉴 요약을 복사하면 클립보드에 내용이 남습니다. 앱이 지우지 않습니다.",
        "이 Mac에 저장된 내용은 이 기기에서만 열 수 있는 키로 암호화됩니다.",
        "앱을 종료하면 이 기기의 채팅은 사라지며 다시 받아오지 못할 수 있습니다."
    ]

    /// 자동 신뢰가 방어하지 않는 것(`POL-03-R-06`).
    public static let undefended: [UndefendedThreat] = [
        UndefendedThreat(
            id: "auto-trusted-malicious-peer-read",
            summary: "지원 Wi-Fi의 악성 LunchTime Peer가 자동 신뢰 범위의 방·메뉴·채팅을 읽는다",
            coverage: .demonstrated,
            policyReference: "POL-03-R-06"
        ),
        UndefendedThreat(
            id: "auto-trusted-malicious-peer-write",
            summary: "그 Peer가 자기 유효 권한으로 라운지에 쓰고 방에 참여한다",
            coverage: .demonstrated,
            policyReference: "POL-03-R-06"
        ),
        UndefendedThreat(
            id: "nickname-impersonation",
            summary: "닉네임을 남과 같게 설정하거나 허위 닉네임을 쓴다",
            coverage: .demonstrated,
            policyReference: "POL-03-R-06"
        ),
        UndefendedThreat(
            id: "first-contact-impersonation",
            summary: "처음 보는 Peer는 사칭된 Peer와 구분되지 않는다. 자동 신뢰에는 대역 외 확인이 없다",
            coverage: .demonstrated,
            policyReference: "POL-03-R-01"
        ),
        UndefendedThreat(
            id: "screen-capture-and-copy",
            summary: "사용자가 화면을 캡처하거나 내용을 복사해 외부로 내보낸다",
            coverage: .outOfModelScope,
            policyReference: "POL-03-R-06"
        ),
        UndefendedThreat(
            id: "unlocked-mac",
            summary: "잠금 해제된 Mac 또는 탈취된 로그인 세션에서 열람한다",
            coverage: .outOfModelScope,
            policyReference: "POL-03-R-06"
        ),
        UndefendedThreat(
            id: "process-memory-read",
            summary: "악성 소프트웨어가 실행 중인 앱의 메모리나 UI를 읽는다",
            coverage: .outOfModelScope,
            policyReference: "POL-03-R-06"
        ),
        UndefendedThreat(
            id: "os-memory-artifacts",
            summary: "macOS가 메모리를 압축·스왑하거나 시스템 진단 덤프를 만든다",
            coverage: .outOfModelScope,
            policyReference: "POL-03-R-06"
        ),
        UndefendedThreat(
            id: "qr-photography",
            summary: "QR이 보이는 물리적 공간에서 촬영한다",
            coverage: .outOfModelScope,
            policyReference: "POL-03-R-05"
        ),
        UndefendedThreat(
            id: "independent-deletion",
            summary: "각 Peer의 독립 삭제 때문에 모든 복제본을 즉시·영구 삭제하지 못한다",
            coverage: .outOfModelScope,
            policyReference: "POL-03-R-06"
        )
    ]
}
