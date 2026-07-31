/// 제한 동기화 세션을 고려하게 만드는 시스템·사용자 사건.
public enum SyncTrigger: String, CaseIterable, Codable, Sendable {
    case appLaunch
    case wake
    case foreground
    case networkChanged
    case peerDiscovered
    case manualRefresh
    case systemClockChanged

    /// 새 제한 세션을 시작할 수 있는 의미 있는 사건인지.
    ///
    /// 시스템 시계 변경은 wall clock 재검증과 fail-closed 전환의 입력이다.
    /// 시간 변경 자체가 반엔트로피 세션을 시작하거나 실패 세션을 재가동해서는
    /// 안 되므로 동기화 trigger에서는 제외한다.
    public var startsBoundedSync: Bool {
        self != .systemClockChanged
    }
}
