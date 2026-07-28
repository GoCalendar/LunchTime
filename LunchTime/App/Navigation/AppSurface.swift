/// 앱 Surface의 사용자에게 보이는 이름과 창 식별자.
///
/// 진입점이 후속 작업의 변경 금지 경로이므로 Surface 식별자도 이 폴더에서
/// 관리한다. `POL-04-R-01`의 새 Window를 추가하는 후속 작업은 여기에 창
/// 식별자를 더한다.
enum AppSurface {
    /// 사용자에게 보이는 앱 이름.
    static let displayName = "LunchTime"

    /// 상세 작업을 수행하는 기본 앱 창 식별자.
    static let mainWindowID = "main"
}
