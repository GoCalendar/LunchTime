import AppKit
import Foundation
import Testing

@testable import SP03WakeAndTimeCore

private final class TriggerRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [SyncTrigger] = []

    func record(_ trigger: SyncTrigger) {
        lock.lock()
        storage.append(trigger)
        lock.unlock()
    }

    var triggers: [SyncTrigger] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

private final class FakeNetworkPathMonitor:
    SystemNetworkPathMonitoring,
    @unchecked Sendable
{
    private let lock = NSLock()
    private var updateHandler: (@Sendable () -> Void)?
    private var retainedUpdateHandler: (@Sendable () -> Void)?
    private var startsStorage = 0
    private var cancelsStorage = 0

    func setUpdateHandler(_ handler: (@Sendable () -> Void)?) {
        lock.lock()
        updateHandler = handler
        if let handler {
            // cancel과 경합해 이미 queue에 들어간 callback을 재현할 때 사용한다.
            retainedUpdateHandler = handler
        }
        lock.unlock()
    }

    func start(queue: DispatchQueue) {
        lock.lock()
        startsStorage += 1
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        cancelsStorage += 1
        lock.unlock()
    }

    func emitPathUpdate() {
        lock.lock()
        let callback = updateHandler
        lock.unlock()
        callback?()
    }

    func emitCallbackCapturedBeforeCancellation() {
        lock.lock()
        let callback = retainedUpdateHandler
        lock.unlock()
        callback?()
    }

    var starts: Int {
        lock.lock()
        defer { lock.unlock() }
        return startsStorage
    }

    var cancels: Int {
        lock.lock()
        defer { lock.unlock() }
        return cancelsStorage
    }
}

private final class FakeNetworkPathMonitorFactory: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [FakeNetworkPathMonitor] = []

    func make() -> any SystemNetworkPathMonitoring {
        let monitor = FakeNetworkPathMonitor()
        lock.lock()
        storage.append(monitor)
        lock.unlock()
        return monitor
    }

    var monitors: [FakeNetworkPathMonitor] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

/// 시스템이 실제 event를 게시하는지는 실기기 prerequisite다.
///
/// 이 suite는 독립 center로 notification 이름→trigger mapping과 lifecycle을
/// 결정적으로 검증한다. 실제 sleep/wake, 앱 focus 전환, Wi‑Fi/Ethernet 변화는
/// `sp03-probe`를 실행한 macOS 기기에서 별도 측정해야 한다.
@MainActor
@Suite("SP-03 system event source")
struct SystemEventSourceTests {
    @Test("launch·foreground·wake·clock·network 사건을 식별 정보 없이 mapping한다")
    func mapsSystemEventsAndSuppressesInitialNetworkPath() {
        let appCenter = NotificationCenter()
        let workspaceCenter = NotificationCenter()
        let recorder = TriggerRecorder()
        let factory = FakeNetworkPathMonitorFactory()
        let source = SystemEventSource(
            notificationCenter: appCenter,
            workspaceNotificationCenter: workspaceCenter,
            makeNetworkPathMonitor: { factory.make() },
            handler: recorder.record
        )

        source.start()
        #expect(factory.monitors.count == 1)
        let monitor = factory.monitors[0]

        appCenter.post(
            name: NSApplication.didBecomeActiveNotification,
            object: nil
        )
        workspaceCenter.post(
            name: NSWorkspace.didWakeNotification,
            object: nil
        )
        appCenter.post(name: .NSSystemClockDidChange, object: nil)

        // 첫 callback은 initial path 관측이다. launch와 중복되므로 버린다.
        monitor.emitPathUpdate()
        #expect(!recorder.triggers.contains(.networkChanged))
        monitor.emitPathUpdate()

        #expect(recorder.triggers == [
            .appLaunch,
            .foreground,
            .wake,
            .systemClockChanged,
            .networkChanged
        ])
        #expect(monitor.starts == 1)
    }

    @Test("실행 중 start와 stop을 반복해도 observer·monitor가 중복되지 않는다")
    func repeatedStartAndStopAreIdempotent() {
        let appCenter = NotificationCenter()
        let workspaceCenter = NotificationCenter()
        let recorder = TriggerRecorder()
        let factory = FakeNetworkPathMonitorFactory()
        let source = SystemEventSource(
            notificationCenter: appCenter,
            workspaceNotificationCenter: workspaceCenter,
            makeNetworkPathMonitor: { factory.make() },
            handler: recorder.record
        )

        source.start()
        source.start()

        #expect(source.isRunning)
        #expect(recorder.triggers == [.appLaunch])
        #expect(factory.monitors.count == 1)
        let monitor = factory.monitors[0]
        #expect(monitor.starts == 1)

        source.stop()
        source.stop()

        #expect(!source.isRunning)
        #expect(monitor.cancels == 1)

        appCenter.post(
            name: NSApplication.didBecomeActiveNotification,
            object: nil
        )
        workspaceCenter.post(
            name: NSWorkspace.didWakeNotification,
            object: nil
        )
        appCenter.post(name: .NSSystemClockDidChange, object: nil)
        monitor.emitPathUpdate()
        #expect(recorder.triggers == [.appLaunch])
    }

    @Test("stop 전에 queue에 잡힌 network callback도 stop 뒤에는 전달하지 않는다")
    func stopInvalidatesCapturedNetworkCallback() {
        let recorder = TriggerRecorder()
        let factory = FakeNetworkPathMonitorFactory()
        let source = SystemEventSource(
            notificationCenter: NotificationCenter(),
            workspaceNotificationCenter: NotificationCenter(),
            makeNetworkPathMonitor: { factory.make() },
            handler: recorder.record
        )

        source.start()
        let monitor = factory.monitors[0]
        source.stop()

        monitor.emitCallbackCapturedBeforeCancellation()
        #expect(recorder.triggers == [.appLaunch])
    }

    @Test("stop 뒤 재시작은 새 monitor를 쓰고 새 주기의 initial path도 구분한다")
    func restartUsesFreshMonitorAndFreshInitialPathPolicy() {
        let recorder = TriggerRecorder()
        let factory = FakeNetworkPathMonitorFactory()
        let source = SystemEventSource(
            notificationCenter: NotificationCenter(),
            workspaceNotificationCenter: NotificationCenter(),
            makeNetworkPathMonitor: { factory.make() },
            handler: recorder.record
        )

        source.start()
        let first = factory.monitors[0]
        first.emitPathUpdate()
        first.emitPathUpdate()
        source.stop()

        source.start()
        #expect(factory.monitors.count == 2)
        let second = factory.monitors[1]
        second.emitPathUpdate()
        second.emitPathUpdate()

        #expect(recorder.triggers == [
            .appLaunch,
            .networkChanged,
            .appLaunch,
            .networkChanged
        ])
        #expect(first.cancels == 1)
        #expect(second.starts == 1)
    }
}
