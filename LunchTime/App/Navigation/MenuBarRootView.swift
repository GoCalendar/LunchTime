import SwiftUI

/// MenuBar 진입점의 최상위 내용.
///
/// 이 골격은 MenuBar 항목이 실제로 나타난다는 사실만 확보한다. 오늘의 Room
/// 요약과 상태 경고는 `POL-04-R-02`를 구현하는 후속 작업이 소유하며, 긴 입력과
/// 채팅은 `POL-04-R-01`에 따라 MenuBar 안에 두지 않는다.
///
/// 이 view는 `LunchTime/App/Navigation/**`을 소유하는 작업이 교체한다.
struct MenuBarRootView: View {
    var body: some View {
        Text(AppSurface.displayName)
    }
}
