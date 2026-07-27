import SwiftUI

/// LunchTime macOS 앱의 진입점.
///
/// 이 골격은 `POL-04-R-01`이 정의한 Surface 중 진입 경로만 형태로 확보한다.
/// MenuBar는 요약·진입 Surface이고 상세 작업은 별도 앱 창에서 수행한다는 경계만
/// 표현하며, 오늘의 Room 요약·참여·메뉴·동기화 같은 제품 동작은 후속 작업이
/// 각자의 폴더에서 추가한다.
///
/// 이 파일은 어떤 후속 작업의 변경 허용 경로에도 포함되지 않으며,
/// `LunchTime/App/Navigation/**`을 소유하는 작업도 이 파일 변경을 명시적으로
/// 금지한다. 따라서 화면 내용을 Scene에 직접 두지 않고
/// `LunchTime/App/Navigation/`의 `AppRootView`와 `MenuBarRootView`를 교체 지점으로
/// 사용한다.
@main
struct LunchTimeApp: App {
    var body: some Scene {
        Window(Self.appDisplayName, id: Self.mainWindowID) {
            AppRootView()
        }

        MenuBarExtra(Self.appDisplayName, systemImage: "fork.knife") {
            MenuBarRootView()
        }
    }
}

extension LunchTimeApp {
    /// 사용자에게 보이는 앱 이름.
    static let appDisplayName = "LunchTime"

    /// 상세 작업을 수행하는 기본 앱 창 식별자.
    static let mainWindowID = "main"
}
