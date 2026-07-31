import AppKit
import Foundation
import Network

/// `NWPathMonitor`를 경로 내용이 없는 사건으로 축소하는 내부 경계.
///
/// 실험은 네트워크 변화가 제한 세션을 깨우는지만 확인한다. 따라서 hostname,
/// IP, interface 이름, SSID 같은 기기·네트워크 식별 정보는 읽거나 보존하지 않는다.
protocol SystemNetworkPathMonitoring: AnyObject, Sendable {
    func setUpdateHandler(_ handler: (@Sendable () -> Void)?)
    func start(queue: DispatchQueue)
    func cancel()
}

private final class LiveSystemNetworkPathMonitor:
    SystemNetworkPathMonitoring,
    @unchecked Sendable
{
    private let monitor = NWPathMonitor()

    func setUpdateHandler(_ handler: (@Sendable () -> Void)?) {
        if let handler {
            monitor.pathUpdateHandler = { _ in
                handler()
            }
        } else {
            monitor.pathUpdateHandler = nil
        }
    }

    func start(queue: DispatchQueue) {
        monitor.start(queue: queue)
    }

    func cancel() {
        monitor.cancel()
    }
}

/// 앱 lifecycle·wake·network·시계 변경을 `SyncTrigger`로 정규화한다.
///
/// 이 객체는 각 사건에서 동기화를 직접 시작하지 않는다. 전달받은 handler가
/// `SyncCoordinator`와 `ClockSkewGate`에 사건을 연결하므로, wake 직후 함께
/// 발생하는 foreground·network burst도 한 곳에서 coalescing할 수 있다.
///
/// 첫 `NWPathMonitor` callback은 현재 path의 초기 관측이다. 앱 실행 자체가 이미
/// `.appLaunch`를 전달하므로 초기 관측은 버리고 그 다음 변화부터
/// `.networkChanged`로 전달한다.
public final class SystemEventSource: @unchecked Sendable {
    public typealias Handler = @Sendable (SyncTrigger) -> Void

    private struct Observation {
        let center: NotificationCenter
        let token: NSObjectProtocol
    }

    private let notificationCenter: NotificationCenter
    private let workspaceNotificationCenter: NotificationCenter
    private let makeNetworkPathMonitor: @Sendable () -> any SystemNetworkPathMonitoring
    private let workspaceForegroundProcessIdentifier: pid_t?
    private let workspaceApplicationProcessIdentifier:
        (@Sendable (Notification) -> pid_t?)?
    private let handler: Handler
    private let networkQueue = DispatchQueue(label: "sp03.system-event-source.network")

    /// callback 전달과 stop을 직렬화한다.
    ///
    /// handler가 같은 source의 `stop()`을 호출해도 교착되지 않도록 recursive
    /// lock을 사용한다. `stop()`이 다른 thread에서 반환한 뒤에는 실행 중이던
    /// handler까지 끝났으므로 더 이상 callback이 발생하지 않는다.
    private let lock = NSRecursiveLock()
    private var running = false
    private var generation: UInt64 = 0
    private var awaitingInitialNetworkPath = true
    private var observations: [Observation] = []
    private var networkPathMonitor: (any SystemNetworkPathMonitoring)?

    /// 실제 AppKit·Network event source를 만든다.
    ///
    /// AppKit shared objects는 main actor에서 얻어야 하므로 composition root에서
    /// 이 initializer를 호출한다. event 전달 자체는 내부 lock으로 보호한다.
    @MainActor
    public convenience init(handler: @escaping Handler) {
        self.init(
            notificationCenter: .default,
            workspaceNotificationCenter: NSWorkspace.shared.notificationCenter,
            makeNetworkPathMonitor: { LiveSystemNetworkPathMonitor() },
            workspaceForegroundProcessIdentifier: nil,
            workspaceApplicationProcessIdentifier: nil,
            handler: handler
        )
    }

    /// CLI probe를 시작한 host app의 재활성화를 foreground 사건으로 관찰한다.
    ///
    /// unbundled command-line process는 Terminal·iTerm 같은 host app과 별개의
    /// `NSApplication`이므로 host로 돌아와도
    /// `NSApplication.didBecomeActiveNotification`을 받지 않는다. Probe mode는
    /// 시작 시점의 frontmost app PID만 메모리에 보관하고 workspace activation의
    /// PID가 같을 때만 익명 `.foreground` 사건을 전달한다.
    @MainActor
    public convenience init(
        workspaceForegroundProcessIdentifier: pid_t,
        handler: @escaping Handler
    ) {
        self.init(
            notificationCenter: .default,
            workspaceNotificationCenter: NSWorkspace.shared.notificationCenter,
            makeNetworkPathMonitor: { LiveSystemNetworkPathMonitor() },
            workspaceForegroundProcessIdentifier:
                workspaceForegroundProcessIdentifier,
            workspaceApplicationProcessIdentifier: { notification in
                let application = notification.userInfo?[
                    NSWorkspace.applicationUserInfoKey
                ] as? NSRunningApplication
                return application?.processIdentifier
            },
            handler: handler
        )
    }

    /// 독립 notification center와 network monitor를 주입하는 결정적 시험 경계.
    init(
        notificationCenter: NotificationCenter,
        workspaceNotificationCenter: NotificationCenter,
        makeNetworkPathMonitor: @escaping @Sendable () -> any SystemNetworkPathMonitoring,
        workspaceForegroundProcessIdentifier: pid_t? = nil,
        workspaceApplicationProcessIdentifier:
            (@Sendable (Notification) -> pid_t?)? = nil,
        handler: @escaping Handler
    ) {
        self.notificationCenter = notificationCenter
        self.workspaceNotificationCenter = workspaceNotificationCenter
        self.makeNetworkPathMonitor = makeNetworkPathMonitor
        self.workspaceForegroundProcessIdentifier =
            workspaceForegroundProcessIdentifier
        self.workspaceApplicationProcessIdentifier =
            workspaceApplicationProcessIdentifier
        self.handler = handler
    }

    public var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }

    /// 관찰을 한 번 시작하고 이번 process launch를 전달한다.
    ///
    /// 실행 중 다시 호출하면 observer나 monitor를 중복 생성하지 않고 아무 일도
    /// 하지 않는다. `stop()` 뒤 다시 시작할 때는 취소된 monitor를 재사용하지
    /// 않고 새 monitor를 만든다.
    public func start() {
        lock.lock()
        defer { lock.unlock() }

        guard !running else { return }
        running = true
        generation &+= 1
        let currentGeneration = generation
        awaitingInitialNetworkPath = true

        if let foregroundProcessIdentifier =
            workspaceForegroundProcessIdentifier,
           let applicationProcessIdentifier =
            workspaceApplicationProcessIdentifier
        {
            let foreground = workspaceNotificationCenter.addObserver(
                forName: NSWorkspace.didActivateApplicationNotification,
                object: nil,
                queue: nil
            ) { [weak self] notification in
                guard applicationProcessIdentifier(notification)
                    == foregroundProcessIdentifier
                else {
                    return
                }
                self?.deliver(.foreground, generation: currentGeneration)
            }
            observations.append(
                Observation(
                    center: workspaceNotificationCenter,
                    token: foreground
                )
            )
        } else {
            let foreground = notificationCenter.addObserver(
                forName: NSApplication.didBecomeActiveNotification,
                object: nil,
                queue: nil
            ) { [weak self] _ in
                self?.deliver(.foreground, generation: currentGeneration)
            }
            observations.append(
                Observation(center: notificationCenter, token: foreground)
            )
        }

        let clockChanged = notificationCenter.addObserver(
            forName: .NSSystemClockDidChange,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.deliver(.systemClockChanged, generation: currentGeneration)
        }
        observations.append(Observation(center: notificationCenter, token: clockChanged))

        let wake = workspaceNotificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.deliver(.wake, generation: currentGeneration)
        }
        observations.append(Observation(center: workspaceNotificationCenter, token: wake))

        let monitor = makeNetworkPathMonitor()
        monitor.setUpdateHandler { [weak self] in
            self?.receiveNetworkPath(generation: currentGeneration)
        }
        networkPathMonitor = monitor

        // launch를 먼저 전달한 뒤 monitor를 시작해 initial path가 launch와
        // 경쟁하더라도 둘이 별도 동기화 세션으로 취급되지 않게 한다.
        deliverLocked(.appLaunch, generation: currentGeneration)
        guard running, generation == currentGeneration else { return }
        monitor.start(queue: networkQueue)
    }

    /// 모든 관찰을 끝내고 pending callback을 무효화한다.
    ///
    /// 반복 호출은 안전하다. generation 검사는 이미 queue에 들어간 이전
    /// `NWPathMonitor` callback도 이후 실행 주기로 새어 들어오지 못하게 한다.
    public func stop() {
        lock.lock()
        defer { lock.unlock() }

        guard running else { return }
        running = false
        generation &+= 1

        let capturedObservations = observations
        observations.removeAll(keepingCapacity: false)
        for observation in capturedObservations {
            observation.center.removeObserver(observation.token)
        }

        let monitor = networkPathMonitor
        networkPathMonitor = nil
        monitor?.setUpdateHandler(nil)
        monitor?.cancel()
    }

    private func receiveNetworkPath(generation expectedGeneration: UInt64) {
        lock.lock()
        defer { lock.unlock() }

        guard running, generation == expectedGeneration else { return }
        if awaitingInitialNetworkPath {
            awaitingInitialNetworkPath = false
            return
        }
        handler(.networkChanged)
    }

    private func deliver(_ trigger: SyncTrigger, generation expectedGeneration: UInt64) {
        lock.lock()
        defer { lock.unlock() }
        deliverLocked(trigger, generation: expectedGeneration)
    }

    private func deliverLocked(
        _ trigger: SyncTrigger,
        generation expectedGeneration: UInt64
    ) {
        guard running, generation == expectedGeneration else { return }
        handler(trigger)
    }

    deinit {
        stop()
    }
}
