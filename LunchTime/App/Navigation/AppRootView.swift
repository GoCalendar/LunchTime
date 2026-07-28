import SwiftUI

/// 앱 창의 최상위 화면.
///
/// 이 골격은 창이 실제로 열린다는 사실만 확보한다. 오늘의 Room 목록, 새 Room
/// 생성과 최상위 탐색은 `LunchTime/App/Navigation/**`을 소유하는 후속 작업이
/// 이 파일과 같은 폴더에서 확장한다.
///
/// 진입점 `LunchTime/App/LunchTimeApp.swift`는 후속 작업의 변경 금지 경로이므로
/// Scene 정의는 같은 폴더의 `AppScenes`가, 창 내용은 이 view가 교체 지점이 된다.
struct AppRootView: View {
    var body: some View {
        Text(AppSurface.displayName)
            .frame(minWidth: 480, minHeight: 320)
    }
}
