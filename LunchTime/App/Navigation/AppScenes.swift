import SwiftUI

/// 앱이 제공하는 Scene 목록.
///
/// 진입점 `LunchTime/App/LunchTimeApp.swift`는 후속 작업의 변경 금지 경로이므로
/// Scene 선언을 이 폴더에 둔다. `POL-04-R-01`이 요구하는 Room Window,
/// Lounge Window와 History Window는 SwiftUI `Window` 또는 `WindowGroup` Scene
/// 선언 없이 열 수 없다. 해당 Surface를 구현하는 후속 작업이 이 타입의 `body`에
/// Scene을 추가한다.
///
/// 이 골격은 앱 창과 MenuBar 진입점만 형태로 확보하고 Surface 동작은 정의하지
/// 않는다.
struct AppScenes: Scene {
    var body: some Scene {
        Window(AppSurface.displayName, id: AppSurface.mainWindowID) {
            AppRootView()
        }

        MenuBarExtra(AppSurface.displayName, systemImage: "fork.knife") {
            MenuBarRootView()
        }
    }
}
