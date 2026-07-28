import SwiftUI

/// LunchTime macOS 앱의 진입점.
///
/// 이 파일은 어떤 후속 작업의 변경 허용 경로에도 포함되지 않으며,
/// `LunchTime/App/Navigation/**`을 소유하는 작업도 이 파일 변경을 명시적으로
/// 금지한다. 그래서 진입점은 Scene 목록과 Surface 식별자를 직접 갖지 않고
/// `LunchTime/App/Navigation/`의 `AppScenes`를 참조하는 역할만 맡는다.
///
/// `POL-04-R-01`은 MenuBar 진입점과 별도의 Room·Lounge·History Window를
/// 요구한다. SwiftUI에서 새 창은 `Window` 또는 `WindowGroup` Scene 선언 없이 열
/// 수 없으므로, Scene 목록을 이 파일에 두면 후속 작업이 창을 추가할 수 없다.
@main
struct LunchTimeApp: App {
    var body: some Scene {
        AppScenes()
    }
}
