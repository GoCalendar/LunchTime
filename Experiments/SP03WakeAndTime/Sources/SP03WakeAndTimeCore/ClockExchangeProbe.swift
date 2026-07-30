import CryptoKit
import Foundation
import Network

// MARK: - Public contract

/// 두 Mac 사이 시계 교환의 고정 실험 옵션.
///
/// 이 probe는 제품 discovery가 아니다. 실기기 후보 수치를 검증하기 위한
/// 일회성 도구이므로 라벨은 `A`·`B`, 표본은 정확히 3개, 전체 시간은 최대
/// 30초로 제한한다.
public struct ClockExchangeProbeOptions: Equatable, Sendable {
    public static let serviceType = "_lt-sp03._tcp"
    public static let requiredRounds = 3
    public static let maximumTotalTimeoutSeconds: Double = 30

    public let localLabel: String
    public let peerLabel: String
    public let totalTimeoutSeconds: Double
    public let roundTimeoutSeconds: Double
    /// 운영자가 서로 다른 물리 Mac에서 실행했음을 명시적으로 확인했는지.
    ///
    /// interface 종류만으로는 VM·같은 host의 network 경로를 배제할 수 없다.
    public let operatorConfirmedDistinctPhysicalMacs: Bool

    public enum ValidationError: String, Error, Equatable, Sendable {
        case labelsMustBeAAndB
        case labelsMustDiffer
        case invalidTotalTimeout
        case invalidRoundTimeout
    }

    public init(
        localLabel: String,
        peerLabel: String,
        totalTimeoutSeconds: Double = 30,
        roundTimeoutSeconds: Double = 6,
        operatorConfirmedDistinctPhysicalMacs: Bool = false
    ) throws {
        guard Self.isAnonymousProbeLabel(localLabel),
              Self.isAnonymousProbeLabel(peerLabel)
        else {
            throw ValidationError.labelsMustBeAAndB
        }
        guard localLabel != peerLabel else {
            throw ValidationError.labelsMustDiffer
        }
        guard totalTimeoutSeconds.isFinite,
              totalTimeoutSeconds > 0,
              totalTimeoutSeconds <= Self.maximumTotalTimeoutSeconds
        else {
            throw ValidationError.invalidTotalTimeout
        }
        guard roundTimeoutSeconds.isFinite,
              roundTimeoutSeconds > 0,
              roundTimeoutSeconds <= totalTimeoutSeconds,
              roundTimeoutSeconds * Double(Self.requiredRounds) <= totalTimeoutSeconds
        else {
            throw ValidationError.invalidRoundTimeout
        }

        self.localLabel = localLabel
        self.peerLabel = peerLabel
        self.totalTimeoutSeconds = totalTimeoutSeconds
        self.roundTimeoutSeconds = roundTimeoutSeconds
        self.operatorConfirmedDistinctPhysicalMacs =
            operatorConfirmedDistinctPhysicalMacs
    }

    static func isAnonymousProbeLabel(_ value: String) -> Bool {
        value == "A" || value == "B"
    }
}

/// 보고서가 보존할 수 있는 닫힌 interface 분류.
///
/// `en0` 같은 이름, 주소, SSID, hostname은 API에 존재하지 않는다.
public enum ClockExchangeInterfaceType:
    String,
    CaseIterable,
    Codable,
    Equatable,
    Hashable,
    Sendable
{
    case wifi
    case ethernet
    case loopback
    case other
}

/// 네트워크 오류 원문을 보존하지 않는 안정된 실패 분류.
///
/// `NWError.localizedDescription`에는 endpoint나 로컬 환경 정보가 섞일 수 있어
/// 결과에 기록하지 않는다.
public enum ClockExchangeProbeFailure:
    String,
    Error,
    Codable,
    Equatable,
    Sendable
{
    case alreadyRunning
    case listenerUnavailable
    case listenerCancelled
    case peerNotFound
    case browserUnavailable
    case connectionUnavailable
    case connectionCancelled
    case sendFailed
    case receiveFailed
    case timeout
    case malformedFrame
    case protocolMismatch
    case reportingOverflow
    case clockJumpDetected
    case peerResponsesIncomplete
}

public struct ClockExchangeRoundResult: Equatable, Sendable {
    public let round: Int
    public let sample: ClockFourTimestampSample?
    public let failure: ClockExchangeProbeFailure?

    public init(
        round: Int,
        sample: ClockFourTimestampSample?,
        failure: ClockExchangeProbeFailure?
    ) {
        self.round = round
        self.sample = sample
        self.failure = failure
    }
}

public enum ClockExchangeCandidateIneligibility:
    String,
    Equatable,
    Sendable
{
    case probeFailed
    case exactlyThreeOutboundSamplesRequired
    case exactlyThreeInboundResponsesRequired
    case reciprocalPeerNotMatched
    case sameHost
    case distinctPhysicalMacsNotConfirmed
    case crossHostInterfaceNotObserved
    case invalidClockSample
}

public enum ClockExchangeCandidateEligibility: Equatable, Sendable {
    case eligible
    case ineligible(ClockExchangeCandidateIneligibility)
}

/// 3회 양방향 교환과 익명화된 network evidence를 함께 보존한다.
public struct ClockExchangeProbeReport: Equatable, Sendable {
    public let localLabel: String
    public let peerLabel: String
    public let operatorConfirmedDistinctPhysicalMacs: Bool
    public let totalTimeoutMilliseconds: Int64
    public let observedInterfaceTypes: [ClockExchangeInterfaceType]
    public let inboundCompletedRounds: [Int]
    /// outbound로 발견한 Peer와 inbound 요청 Peer가 같은 run instance인지.
    public let reciprocalPeerMatched: Bool
    /// 양쪽에서 동일하지만 다른 run과 연결할 수 없는 SHA-256 pair 식별자.
    ///
    /// 원시 instance ID는 보고서 API에 존재하지 않는다.
    public let pairEvidenceID: String?
    public let roundResults: [ClockExchangeRoundResult]
    public let failure: ClockExchangeProbeFailure?

    public init(
        localLabel: String,
        peerLabel: String,
        operatorConfirmedDistinctPhysicalMacs: Bool,
        totalTimeoutMilliseconds: Int64,
        observedInterfaceTypes: [ClockExchangeInterfaceType],
        inboundCompletedRounds: [Int],
        reciprocalPeerMatched: Bool,
        pairEvidenceID: String?,
        roundResults: [ClockExchangeRoundResult],
        failure: ClockExchangeProbeFailure?
    ) {
        self.localLabel = localLabel
        self.peerLabel = peerLabel
        self.operatorConfirmedDistinctPhysicalMacs =
            operatorConfirmedDistinctPhysicalMacs
        self.totalTimeoutMilliseconds = totalTimeoutMilliseconds
        self.observedInterfaceTypes = Array(Set(observedInterfaceTypes))
            .sorted { $0.rawValue < $1.rawValue }
        self.inboundCompletedRounds = Array(Set(inboundCompletedRounds)).sorted()
        self.reciprocalPeerMatched = reciprocalPeerMatched
        self.pairEvidenceID =
            reciprocalPeerMatched
                && pairEvidenceID?.utf8.count == 64
                && pairEvidenceID?.utf8.allSatisfy({
                    (48...57).contains($0) || (97...102).contains($0)
                }) == true
            ? pairEvidenceID
            : nil
        self.roundResults = roundResults.sorted { $0.round < $1.round }
        self.failure = failure
    }

    public var samples: [ClockFourTimestampSample] {
        roundResults.compactMap(\.sample)
    }

    public var loopbackObserved: Bool {
        observedInterfaceTypes.contains(.loopback)
    }

    /// 음성 증거인 "loopback이 없음"만으로 두 Mac이라고 추정하지 않는다.
    /// Wi‑Fi 또는 Ethernet의 양성 관측이 있어야 한다.
    public var crossHostEvidence: Bool {
        guard operatorConfirmedDistinctPhysicalMacs,
              !loopbackObserved
        else { return false }
        return observedInterfaceTypes.contains(.wifi)
            || observedInterfaceTypes.contains(.ethernet)
    }

    public var candidateEligibility: ClockExchangeCandidateEligibility {
        guard failure == nil else { return .ineligible(.probeFailed) }

        let outboundRounds = roundResults.compactMap { result in
            result.sample == nil ? nil : result.round
        }
        guard roundResults.count == ClockExchangeProbeOptions.requiredRounds,
              outboundRounds == Array(1...ClockExchangeProbeOptions.requiredRounds)
        else {
            return .ineligible(.exactlyThreeOutboundSamplesRequired)
        }
        guard inboundCompletedRounds == Array(1...ClockExchangeProbeOptions.requiredRounds) else {
            return .ineligible(.exactlyThreeInboundResponsesRequired)
        }
        guard reciprocalPeerMatched, pairEvidenceID != nil else {
            return .ineligible(.reciprocalPeerNotMatched)
        }
        guard !loopbackObserved else { return .ineligible(.sameHost) }
        guard operatorConfirmedDistinctPhysicalMacs else {
            return .ineligible(.distinctPhysicalMacsNotConfirmed)
        }
        guard crossHostEvidence else {
            return .ineligible(.crossHostInterfaceNotObserved)
        }
        guard samples.allSatisfy({ $0.offsetInterval != nil }) else {
            return .ineligible(.invalidClockSample)
        }
        return .eligible
    }

    /// 이 단일 교환을 후보 수치 판정에 넣어도 되는지.
    ///
    /// `true`여도 10회 행렬, 다른 live gate와 제품 책임자 승인이 남아 있으므로
    /// Policy 허용 오차가 승인됐다는 뜻은 아니다.
    public var candidateEvidenceEligible: Bool {
        candidateEligibility == .eligible
    }

    /// 실기기 evidence가 충족된 표본만 후보 gate에 정상 Peer 표본으로 넣는다.
    public func validateCandidate(
        at now: MonotonicInstant,
        candidate: UnconfirmedClockSafetyCandidate = .sp03RealDeviceUnconfirmed
    ) -> ClockValidationState {
        var gate = ClockSkewGate(candidate: candidate)
        return gate.validate(
            samples: samples,
            normalPeerAvailable: candidateEvidenceEligible,
            at: now
        )
    }

}

// MARK: - Length-prefixed wire

struct ClockExchangeWireMessage: Codable, Equatable, Sendable {
    enum Kind: String, Codable, Sendable {
        case request
        case response
    }

    static let version = 1

    let protocolVersion: Int
    let kind: Kind
    let requestID: String
    let round: Int
    let fromLabel: String
    let toLabel: String
    let fromInstanceID: String
    let toInstanceID: String
    let localSentWallMilliseconds: Int64
    let peerReceivedWallMilliseconds: Int64?
    let peerSentWallMilliseconds: Int64?
    let peerProcessingMonotonicMilliseconds: Int64?
    let peerCaptureUncertaintyMilliseconds: Int64?

    static func request(
        requestID: String,
        round: Int,
        fromLabel: String,
        toLabel: String,
        fromInstanceID: String,
        toInstanceID: String,
        localSentWallMilliseconds: Int64
    ) -> ClockExchangeWireMessage {
        ClockExchangeWireMessage(
            protocolVersion: version,
            kind: .request,
            requestID: requestID,
            round: round,
            fromLabel: fromLabel,
            toLabel: toLabel,
            fromInstanceID: fromInstanceID,
            toInstanceID: toInstanceID,
            localSentWallMilliseconds: localSentWallMilliseconds,
            peerReceivedWallMilliseconds: nil,
            peerSentWallMilliseconds: nil,
            peerProcessingMonotonicMilliseconds: nil,
            peerCaptureUncertaintyMilliseconds: nil
        )
    }

    static func response(
        to request: ClockExchangeWireMessage,
        fromLabel: String,
        toLabel: String,
        fromInstanceID: String,
        toInstanceID: String,
        peerReceivedWallMilliseconds: Int64,
        peerSentWallMilliseconds: Int64,
        peerProcessingMonotonicMilliseconds: Int64,
        peerCaptureUncertaintyMilliseconds: Int64
    ) -> ClockExchangeWireMessage {
        ClockExchangeWireMessage(
            protocolVersion: version,
            kind: .response,
            requestID: request.requestID,
            round: request.round,
            fromLabel: fromLabel,
            toLabel: toLabel,
            fromInstanceID: fromInstanceID,
            toInstanceID: toInstanceID,
            localSentWallMilliseconds: request.localSentWallMilliseconds,
            peerReceivedWallMilliseconds: peerReceivedWallMilliseconds,
            peerSentWallMilliseconds: peerSentWallMilliseconds,
            peerProcessingMonotonicMilliseconds: peerProcessingMonotonicMilliseconds,
            peerCaptureUncertaintyMilliseconds: peerCaptureUncertaintyMilliseconds
        )
    }

    func validateStructure() throws {
        guard protocolVersion == Self.version,
              (1...ClockExchangeProbeOptions.requiredRounds).contains(round),
              ClockExchangeProbeOptions.isAnonymousProbeLabel(fromLabel),
              ClockExchangeProbeOptions.isAnonymousProbeLabel(toLabel),
              fromLabel != toLabel,
              requestID.count == 32,
              requestID.utf8.allSatisfy(Self.isLowercaseHexByte),
              Self.isEphemeralInstanceID(fromInstanceID),
              Self.isEphemeralInstanceID(toInstanceID),
              fromInstanceID != toInstanceID
        else {
            throw ClockExchangeWireError.invalidMessage
        }

        switch kind {
        case .request:
            guard peerReceivedWallMilliseconds == nil,
                  peerSentWallMilliseconds == nil,
                  peerProcessingMonotonicMilliseconds == nil,
                  peerCaptureUncertaintyMilliseconds == nil
            else {
                throw ClockExchangeWireError.invalidMessage
            }
        case .response:
            guard peerReceivedWallMilliseconds != nil,
                  peerSentWallMilliseconds != nil,
                  let processing = peerProcessingMonotonicMilliseconds,
                  processing >= 0,
                  let uncertainty = peerCaptureUncertaintyMilliseconds,
                  uncertainty >= 0
            else {
                throw ClockExchangeWireError.invalidMessage
            }
            guard processing
                    <= ClockFourTimestampSample.maximumMeasuredDurationMilliseconds,
                  uncertainty
                    <= ClockFourTimestampSample.maximumMeasuredDurationMilliseconds
            else {
                throw ClockExchangeWireError.reportingOverflow
            }
        }
    }

    static func isEphemeralInstanceID(_ value: String) -> Bool {
        value.utf8.count == 32
            && value.utf8.allSatisfy(isLowercaseHexByte)
    }

    private static func isLowercaseHexByte(_ byte: UInt8) -> Bool {
        (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte)
            || (UInt8(ascii: "a")...UInt8(ascii: "f")).contains(byte)
    }
}

enum ClockExchangeWireError: Error, Equatable {
    case invalidLength
    case malformedPayload
    case invalidMessage
    case reportingOverflow
    case bufferedDataLimitExceeded
}

enum ClockExchangeWireCodec {
    static let prefixBytes = 4
    static let maximumPayloadBytes = 2_048
    static let maximumBufferedBytes = prefixBytes + maximumPayloadBytes

    static func encode(_ message: ClockExchangeWireMessage) throws -> Data {
        try message.validateStructure()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let payload: Data
        do {
            payload = try encoder.encode(message)
        } catch {
            throw ClockExchangeWireError.malformedPayload
        }
        guard !payload.isEmpty, payload.count <= maximumPayloadBytes else {
            throw ClockExchangeWireError.invalidLength
        }

        let length = UInt32(payload.count)
        var frame = Data(capacity: prefixBytes + payload.count)
        frame.append(UInt8((length >> 24) & 0xff))
        frame.append(UInt8((length >> 16) & 0xff))
        frame.append(UInt8((length >> 8) & 0xff))
        frame.append(UInt8(length & 0xff))
        frame.append(payload)
        return frame
    }

    static func decodeNext(from buffer: inout Data) throws -> ClockExchangeWireMessage? {
        guard buffer.count >= prefixBytes else { return nil }
        let length = buffer.prefix(prefixBytes).reduce(UInt32(0)) {
            ($0 << 8) | UInt32($1)
        }
        guard length > 0, length <= UInt32(maximumPayloadBytes) else {
            throw ClockExchangeWireError.invalidLength
        }

        let frameBytes = prefixBytes + Int(length)
        guard buffer.count >= frameBytes else {
            guard buffer.count <= maximumBufferedBytes else {
                throw ClockExchangeWireError.bufferedDataLimitExceeded
            }
            return nil
        }

        let payload = buffer.subdata(in: prefixBytes..<frameBytes)
        let message: ClockExchangeWireMessage
        do {
            message = try JSONDecoder().decode(ClockExchangeWireMessage.self, from: payload)
        } catch {
            throw ClockExchangeWireError.malformedPayload
        }
        try message.validateStructure()
        buffer.removeSubrange(0..<frameBytes)
        return message
    }
}

struct ClockExchangeFrameDecoder {
    private(set) var buffer = Data()

    mutating func append(_ data: Data) throws {
        guard buffer.count + data.count <= ClockExchangeWireCodec.maximumBufferedBytes else {
            throw ClockExchangeWireError.bufferedDataLimitExceeded
        }
        buffer.append(data)
    }

    mutating func nextMessage() throws -> ClockExchangeWireMessage? {
        try ClockExchangeWireCodec.decodeNext(from: &buffer)
    }

    var bufferedByteCount: Int { buffer.count }
}

// MARK: - Deterministic run safety state

struct ClockInboundAdmissionState: Equatable, Sendable {
    static let maximumConnections = 1

    private(set) var admittedConnections = 0

    mutating func admit() -> Bool {
        guard admittedConnections < Self.maximumConnections else {
            return false
        }
        admittedConnections += 1
        return true
    }
}

struct ClockProbeLifecycleState: Equatable, Sendable {
    enum Phase: Equatable, Sendable {
        case idle
        case running(UInt64)
        case stopping(UInt64)
    }

    private(set) var phase: Phase = .idle
    private var nextToken: UInt64 = 0

    mutating func begin() -> UInt64? {
        guard phase == .idle else { return nil }
        nextToken &+= 1
        phase = .running(nextToken)
        return nextToken
    }

    @discardableResult
    mutating func requestStop() -> UInt64? {
        switch phase {
        case .idle:
            return nil
        case let .running(token):
            phase = .stopping(token)
            return token
        case let .stopping(token):
            return token
        }
    }

    @discardableResult
    mutating func finish(token: UInt64) -> Bool {
        switch phase {
        case let .running(activeToken) where activeToken == token:
            phase = .idle
            return true
        case let .stopping(activeToken) where activeToken == token:
            phase = .idle
            return true
        case .idle, .running, .stopping:
            return false
        }
    }
}

struct ClockReciprocalEvidenceState: Equatable, Sendable {
    let localInstanceID: String

    private(set) var discoveredPeerInstanceID: String?
    private(set) var inboundPeerInstanceID: String?
    private(set) var inboundCompletedRounds: Set<Int> = []
    private(set) var identityMismatchObserved = false

    init(localInstanceID: String) {
        precondition(ClockExchangeWireMessage.isEphemeralInstanceID(localInstanceID))
        self.localInstanceID = localInstanceID
    }

    mutating func selectDiscoveredPeer(instanceID: String) -> Bool {
        guard ClockExchangeWireMessage.isEphemeralInstanceID(instanceID),
              instanceID != localInstanceID
        else {
            return false
        }
        if let selected = discoveredPeerInstanceID {
            return selected == instanceID
        }
        if let inbound = inboundPeerInstanceID, inbound != instanceID {
            return false
        }
        discoveredPeerInstanceID = instanceID
        return true
    }

    mutating func validateInboundPeer(
        instanceID: String,
        targetInstanceID: String
    ) -> Bool {
        guard ClockExchangeWireMessage.isEphemeralInstanceID(instanceID),
              instanceID != localInstanceID,
              targetInstanceID == localInstanceID
        else {
            identityMismatchObserved = true
            return false
        }
        if let discovered = discoveredPeerInstanceID,
           discovered != instanceID {
            identityMismatchObserved = true
            return false
        }
        if let inbound = inboundPeerInstanceID,
           inbound != instanceID {
            identityMismatchObserved = true
            return false
        }
        inboundPeerInstanceID = instanceID
        return true
    }

    mutating func completeInboundRound(
        _ round: Int,
        peerInstanceID: String,
        targetInstanceID: String
    ) -> Bool {
        guard validateInboundPeer(
            instanceID: peerInstanceID,
            targetInstanceID: targetInstanceID
        ) else {
            return false
        }
        inboundCompletedRounds.insert(round)
        return true
    }

    var reciprocalPeerMatched: Bool {
        guard !identityMismatchObserved,
              let discoveredPeerInstanceID,
              discoveredPeerInstanceID == inboundPeerInstanceID,
              inboundCompletedRounds
                == Set(1...ClockExchangeProbeOptions.requiredRounds)
        else {
            return false
        }
        return true
    }

    var pairEvidenceID: String? {
        guard reciprocalPeerMatched, let discoveredPeerInstanceID else {
            return nil
        }
        return ClockPairEvidence.identifier(
            firstInstanceID: localInstanceID,
            secondInstanceID: discoveredPeerInstanceID
        )
    }
}

enum ClockPairEvidence {
    static func identifier(
        firstInstanceID: String,
        secondInstanceID: String
    ) -> String {
        let canonical = [firstInstanceID, secondInstanceID]
            .sorted()
            .joined(separator: ":")
        return SHA256.hash(data: Data(canonical.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}

enum ClockExchangeMeasurementBounds {
    static let maximumMilliseconds =
        ClockFourTimestampSample.maximumMeasuredDurationMilliseconds

    static func checkedSum(_ values: Int64...) throws -> Int64 {
        var total: Int64 = 0
        for value in values {
            guard value >= 0, value <= maximumMilliseconds else {
                throw ClockExchangeProbeFailure.reportingOverflow
            }
            let addition = total.addingReportingOverflow(value)
            guard !addition.overflow,
                  addition.partialValue <= maximumMilliseconds
            else {
                throw ClockExchangeProbeFailure.reportingOverflow
            }
            total = addition.partialValue
        }
        return total
    }
}

private protocol ClockProbeCancellation: AnyObject, Sendable {
    func cancel()
}

private final class ClockProbeRunContext: @unchecked Sendable {
    let token: UInt64
    let localInstanceID: String
    let inboundCompletion: ClockProbeSingleResume<Void>

    private let lock = NSLock()
    private var listener: NWListener?
    private var browser: NWBrowser?
    private var outboundConnection: NWConnection?
    private var inboundConnection: NWConnection?
    private var inboundAdmission = ClockInboundAdmissionState()
    private var evidence: ClockReciprocalEvidenceState
    private var waiters: [any ClockProbeCancellation] = []
    private var childTasks: [Task<Void, Never>] = []
    private var cancelled = false

    init(token: UInt64, localInstanceID: String) {
        self.token = token
        self.localInstanceID = localInstanceID
        inboundCompletion = ClockProbeSingleResume<Void>()
        evidence = ClockReciprocalEvidenceState(
            localInstanceID: localInstanceID
        )
        waiters = [inboundCompletion]
    }

    func register(listener: NWListener) -> Bool {
        let accepted = lock.withLock {
            guard !cancelled, self.listener == nil else { return false }
            self.listener = listener
            return true
        }
        if !accepted { listener.cancel() }
        return accepted
    }

    func register(browser: NWBrowser) -> Bool {
        let accepted = lock.withLock {
            guard !cancelled, self.browser == nil else { return false }
            self.browser = browser
            return true
        }
        if !accepted { browser.cancel() }
        return accepted
    }

    func register(outboundConnection: NWConnection) -> Bool {
        let accepted = lock.withLock {
            guard !cancelled, self.outboundConnection == nil else {
                return false
            }
            self.outboundConnection = outboundConnection
            return true
        }
        if !accepted { outboundConnection.cancel() }
        return accepted
    }

    func admit(inboundConnection: NWConnection) -> Bool {
        let accepted = lock.withLock {
            guard !cancelled,
                  inboundAdmission.admit()
            else {
                return false
            }
            self.inboundConnection = inboundConnection
            return true
        }
        if !accepted { inboundConnection.cancel() }
        return accepted
    }

    func register(waiter: any ClockProbeCancellation) {
        let shouldCancel = lock.withLock {
            guard !cancelled else { return true }
            waiters.append(waiter)
            return false
        }
        if shouldCancel { waiter.cancel() }
    }

    func register(task: Task<Void, Never>) {
        let shouldCancel = lock.withLock {
            guard !cancelled else { return true }
            childTasks.append(task)
            return false
        }
        if shouldCancel { task.cancel() }
    }

    func selectDiscoveredPeer(instanceID: String) -> Bool {
        lock.withLock {
            guard !cancelled else { return false }
            return evidence.selectDiscoveredPeer(instanceID: instanceID)
        }
    }

    func validateInboundPeer(
        instanceID: String,
        targetInstanceID: String
    ) -> Bool {
        lock.withLock {
            guard !cancelled else { return false }
            return evidence.validateInboundPeer(
                instanceID: instanceID,
                targetInstanceID: targetInstanceID
            )
        }
    }

    func completeInboundRound(
        _ round: Int,
        peerInstanceID: String,
        targetInstanceID: String
    ) -> Bool {
        let outcome: (accepted: Bool, completedAllRounds: Bool) = lock.withLock {
            guard !cancelled else { return (false, false) }
            guard evidence.completeInboundRound(
                round,
                peerInstanceID: peerInstanceID,
                targetInstanceID: targetInstanceID
            ) else {
                return (false, false)
            }
            return (
                true,
                evidence.inboundCompletedRounds
                    == Set(1...ClockExchangeProbeOptions.requiredRounds)
            )
        }
        if outcome.completedAllRounds {
            inboundCompletion.resume(returning: ())
        }
        return outcome.accepted
    }

    func evidenceSnapshot() -> ClockReciprocalEvidenceState {
        lock.withLock { evidence }
    }

    func failInbound(with failure: ClockExchangeProbeFailure) {
        inboundCompletion.resume(throwing: failure)
    }

    var isCancelled: Bool {
        lock.withLock { cancelled }
    }

    func cancel() {
        let captured: (
            NWListener?,
            NWBrowser?,
            NWConnection?,
            NWConnection?,
            [any ClockProbeCancellation],
            [Task<Void, Never>]
        )? = lock.withLock {
            guard !cancelled else { return nil }
            cancelled = true
            let resources = (
                listener,
                browser,
                outboundConnection,
                inboundConnection,
                waiters,
                childTasks
            )
            listener = nil
            browser = nil
            outboundConnection = nil
            inboundConnection = nil
            waiters.removeAll(keepingCapacity: false)
            childTasks.removeAll(keepingCapacity: false)
            return resources
        }
        guard let captured else { return }
        captured.5.forEach { $0.cancel() }
        captured.4.forEach { $0.cancel() }
        captured.3?.cancel()
        captured.2?.cancel()
        captured.1?.cancel()
        captured.0?.cancel()
    }
}

// MARK: - Live Network.framework probe

/// Bonjour에서 익명 Peer를 만나 NTP 방식 4 timestamp를 정확히 3회 교환한다.
public final class ClockExchangeProbe: @unchecked Sendable {
    private struct DiscoveredPeer: Sendable {
        let endpoint: NWEndpoint
        let interfaceTypes: Set<ClockExchangeInterfaceType>
        let instanceID: String
    }

    private struct WallCapture: Sendable {
        let wall: WallClockInstant
        let monotonicBefore: ContinuousClock.Instant
        let monotonicAfter: ContinuousClock.Instant
        let uncertaintyMilliseconds: Int64
    }

    public let options: ClockExchangeProbeOptions

    private let queue = DispatchQueue(label: "sp03.clock-exchange.network")
    private let lock = NSLock()
    private var lifecycle = ClockProbeLifecycleState()
    private var currentRun: ClockProbeRunContext?

    public init(options: ClockExchangeProbeOptions) {
        self.options = options
    }

    /// listener→browse→connect→3회 교환→상대의 3회 요청 응답을 전체 상한 안에 수행한다.
    public func run() async -> ClockExchangeProbeReport {
        let started = ContinuousClock.now
        guard let context = beginRun() else {
            return makeReport(
                started: started,
                context: nil,
                interfaces: [],
                roundResults: [],
                failure: .alreadyRunning
            )
        }

        return await withTaskCancellationHandler {
            await executeRun(context: context, started: started)
        } onCancel: {
            self.stop(context: context)
        }
    }

    private func executeRun(
        context: ClockProbeRunContext,
        started: ContinuousClock.Instant
    ) async -> ClockExchangeProbeReport {
        defer { finishRun(context: context) }

        var observedInterfaces: Set<ClockExchangeInterfaceType> = []
        var results: [ClockExchangeRoundResult] = []
        var finalFailure: ClockExchangeProbeFailure?

        do {
            try Task.checkCancellation()
            try await startListener(
                context: context,
                timeout: try remainingTimeout(since: started, cappedAt: options.roundTimeoutSeconds)
            )
            let peer = try await discoverPeer(
                context: context,
                timeout: try remainingTimeout(since: started, cappedAt: options.roundTimeoutSeconds)
            )
            observedInterfaces.formUnion(peer.interfaceTypes)

            let connection = try await connect(
                to: peer.endpoint,
                context: context,
                timeout: try remainingTimeout(since: started, cappedAt: options.roundTimeoutSeconds)
            )
            let reader = ClockExchangeConnectionReader(
                connection: connection,
                context: context,
                queue: queue
            )

            for round in 1...ClockExchangeProbeOptions.requiredRounds {
                try Task.checkCancellation()
                let roundStarted = ContinuousClock.now
                do {
                    let sample = try await exchangeRound(
                        round,
                        peerInstanceID: peer.instanceID,
                        context: context,
                        connection: connection,
                        reader: reader,
                        runStarted: started,
                        roundStarted: roundStarted
                    )
                    results.append(ClockExchangeRoundResult(
                        round: round,
                        sample: sample,
                        failure: nil
                    ))
                } catch {
                    let failure = Self.closedFailure(error)
                    results.append(ClockExchangeRoundResult(
                        round: round,
                        sample: nil,
                        failure: failure
                    ))
                    finalFailure = failure
                    break
                }
            }

            if finalFailure == nil {
                try await waitForPeerRounds(
                    context: context,
                    timeout: try remainingTimeout(
                        since: started,
                        cappedAt: options.totalTimeoutSeconds
                    )
                )
            }
        } catch {
            finalFailure = Self.closedFailure(error)
        }

        return makeReport(
            started: started,
            context: context,
            interfaces: observedInterfaces,
            roundResults: results,
            failure: finalFailure
        )
    }

    /// run 중인 listener와 connection을 즉시 닫는다. 반복 호출은 안전하다.
    public func stop() {
        let context: ClockProbeRunContext? = lock.withLock {
            guard lifecycle.requestStop() != nil else { return nil }
            return currentRun
        }
        context?.cancel()
    }

    private func stop(context expectedContext: ClockProbeRunContext) {
        let context: ClockProbeRunContext? = lock.withLock {
            guard currentRun === expectedContext,
                  lifecycle.requestStop() == expectedContext.token
            else {
                return nil
            }
            return currentRun
        }
        context?.cancel()
    }

    private func beginRun() -> ClockProbeRunContext? {
        lock.withLock {
            guard let token = lifecycle.begin() else { return nil }
            let context = ClockProbeRunContext(
                token: token,
                localInstanceID: Self.makeEphemeralInstanceID()
            )
            currentRun = context
            return context
        }
    }

    private func finishRun(context: ClockProbeRunContext) {
        context.cancel()
        lock.withLock {
            guard currentRun === context else { return }
            guard lifecycle.finish(token: context.token) else { return }
            currentRun = nil
        }
    }

    private func makeReport(
        started: ContinuousClock.Instant,
        context: ClockProbeRunContext?,
        interfaces: Set<ClockExchangeInterfaceType>,
        roundResults: [ClockExchangeRoundResult],
        failure: ClockExchangeProbeFailure?
    ) -> ClockExchangeProbeReport {
        let evidence = context?.evidenceSnapshot()
        return ClockExchangeProbeReport(
            localLabel: options.localLabel,
            peerLabel: options.peerLabel,
            operatorConfirmedDistinctPhysicalMacs:
                options.operatorConfirmedDistinctPhysicalMacs,
            totalTimeoutMilliseconds: Self.elapsedMilliseconds(
                from: started,
                to: .now,
                rounding: .up
            ),
            observedInterfaceTypes: Array(interfaces),
            inboundCompletedRounds:
                evidence?.inboundCompletedRounds.sorted() ?? [],
            reciprocalPeerMatched:
                evidence?.reciprocalPeerMatched ?? false,
            pairEvidenceID: evidence?.pairEvidenceID,
            roundResults: roundResults,
            failure: failure
        )
    }

    // MARK: Listener / responder

    private func startListener(
        context: ClockProbeRunContext,
        timeout: Double
    ) async throws {
        let listener: NWListener
        do {
            let parameters = NWParameters.tcp
            parameters.includePeerToPeer = false
            listener = try NWListener(using: parameters)
            listener.service = NWListener.Service(
                name: options.localLabel,
                type: ClockExchangeProbeOptions.serviceType,
                domain: nil,
                txtRecord: NWTXTRecord([
                    "instance": context.localInstanceID,
                    "label": options.localLabel
                ]).data
            )
        } catch {
            throw ClockExchangeProbeFailure.listenerUnavailable
        }

        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection, context: context)
        }
        let ready = ClockProbeSingleResume<Void>()
        context.register(waiter: ready)
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                ready.resume(returning: ())
            case .failed:
                ready.resume(throwing: ClockExchangeProbeFailure.listenerUnavailable)
            case .cancelled:
                ready.resume(throwing: ClockExchangeProbeFailure.listenerCancelled)
            default:
                break
            }
        }

        guard context.register(listener: listener) else {
            throw ClockExchangeProbeFailure.listenerCancelled
        }

        listener.start(queue: queue)
        ready.fail(
            after: timeout,
            with: ClockExchangeProbeFailure.timeout
        )
        try await ready.value
    }

    private func accept(
        _ connection: NWConnection,
        context: ClockProbeRunContext
    ) {
        guard context.admit(inboundConnection: connection) else { return }

        connection.start(queue: queue)
        let reader = ClockExchangeConnectionReader(
            connection: connection,
            context: context,
            queue: queue
        )
        let task = Task { [weak self] in
            guard let self else {
                connection.cancel()
                return
            }
            defer { connection.cancel() }

            for _ in 0..<ClockExchangeProbeOptions.requiredRounds {
                do {
                    try Task.checkCancellation()
                    let request = try await reader.nextMessage(
                        timeout: self.options.roundTimeoutSeconds
                    )
                    let response = try self.makeResponse(
                        to: request,
                        context: context
                    )
                    let frame = try ClockExchangeWireCodec.encode(response)
                    try await Self.send(
                        frame,
                        on: connection,
                        timeout: self.options.roundTimeoutSeconds,
                        context: context
                    )
                    guard context.completeInboundRound(
                        request.round,
                        peerInstanceID: request.fromInstanceID,
                        targetInstanceID: request.toInstanceID
                    ) else {
                        return
                    }
                } catch {
                    context.failInbound(with: Self.closedFailure(error))
                    return
                }
            }
        }
        context.register(task: task)
    }

    private func makeResponse(
        to request: ClockExchangeWireMessage,
        context: ClockProbeRunContext
    ) throws -> ClockExchangeWireMessage {
        guard request.kind == .request,
              request.fromLabel == options.peerLabel,
              request.toLabel == options.localLabel,
              context.validateInboundPeer(
                instanceID: request.fromInstanceID,
                targetInstanceID: request.toInstanceID
              )
        else {
            throw ClockExchangeProbeFailure.protocolMismatch
        }

        let received = Self.captureWall()
        let sent = Self.captureWall()
        let processing = Self.elapsedMilliseconds(
            from: received.monotonicBefore,
            to: sent.monotonicAfter,
            rounding: .down
        )
        guard processing
                <= ClockExchangeMeasurementBounds.maximumMilliseconds
        else {
            throw ClockExchangeProbeFailure.reportingOverflow
        }
        let uncertainty = try ClockExchangeMeasurementBounds.checkedSum(
            received.uncertaintyMilliseconds,
            sent.uncertaintyMilliseconds
        )

        return .response(
            to: request,
            fromLabel: options.localLabel,
            toLabel: options.peerLabel,
            fromInstanceID: context.localInstanceID,
            toInstanceID: request.fromInstanceID,
            peerReceivedWallMilliseconds: received.wall.millisecondsSinceUnixEpoch,
            peerSentWallMilliseconds: sent.wall.millisecondsSinceUnixEpoch,
            peerProcessingMonotonicMilliseconds: processing,
            peerCaptureUncertaintyMilliseconds: uncertainty
        )
    }

    // MARK: Browser / initiator

    private func discoverPeer(
        context: ClockProbeRunContext,
        timeout: Double
    ) async throws -> DiscoveredPeer {
        let descriptor = NWBrowser.Descriptor.bonjourWithTXTRecord(
            type: ClockExchangeProbeOptions.serviceType,
            domain: "local."
        )
        let browser = NWBrowser(for: descriptor, using: .tcp)
        let found = ClockProbeSingleResume<DiscoveredPeer>()
        context.register(waiter: found)

        browser.browseResultsChangedHandler = {
            [peerLabel = options.peerLabel] results, _ in
            for result in results {
                guard case .bonjour(let txt) = result.metadata,
                      txt["label"] == peerLabel,
                      let instanceID = txt["instance"],
                      ClockExchangeWireMessage.isEphemeralInstanceID(
                        instanceID
                      ),
                      context.selectDiscoveredPeer(instanceID: instanceID)
                else { continue }
                let types = Set(result.interfaces.map {
                    Self.closedInterfaceType($0.type)
                })
                found.resume(returning: DiscoveredPeer(
                    endpoint: result.endpoint,
                    interfaceTypes: types,
                    instanceID: instanceID
                ))
                return
            }
        }
        browser.stateUpdateHandler = { state in
            if case .failed = state {
                found.resume(throwing: ClockExchangeProbeFailure.browserUnavailable)
            }
        }

        guard context.register(browser: browser) else {
            throw ClockExchangeProbeFailure.browserUnavailable
        }
        browser.start(queue: queue)
        defer { browser.cancel() }
        found.fail(
            after: timeout,
            with: ClockExchangeProbeFailure.peerNotFound
        )
        return try await found.value
    }

    private func connect(
        to endpoint: NWEndpoint,
        context: ClockProbeRunContext,
        timeout: Double
    ) async throws -> NWConnection {
        let connection = NWConnection(to: endpoint, using: .tcp)
        let ready = ClockProbeSingleResume<Void>()
        context.register(waiter: ready)
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                ready.resume(returning: ())
            case .failed:
                ready.resume(throwing: ClockExchangeProbeFailure.connectionUnavailable)
            case .cancelled:
                ready.resume(throwing: ClockExchangeProbeFailure.connectionCancelled)
            default:
                break
            }
        }
        guard context.register(outboundConnection: connection) else {
            throw ClockExchangeProbeFailure.connectionCancelled
        }
        connection.start(queue: queue)
        ready.fail(
            after: timeout,
            with: ClockExchangeProbeFailure.timeout
        )
        do {
            try await ready.value
            return connection
        } catch {
            connection.cancel()
            throw error
        }
    }

    private func exchangeRound(
        _ round: Int,
        peerInstanceID: String,
        context: ClockProbeRunContext,
        connection: NWConnection,
        reader: ClockExchangeConnectionReader,
        runStarted: ContinuousClock.Instant,
        roundStarted: ContinuousClock.Instant
    ) async throws -> ClockFourTimestampSample {
        let sent = Self.captureWall()
        let request = ClockExchangeWireMessage.request(
            requestID: UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased(),
            round: round,
            fromLabel: options.localLabel,
            toLabel: options.peerLabel,
            fromInstanceID: context.localInstanceID,
            toInstanceID: peerInstanceID,
            localSentWallMilliseconds: sent.wall.millisecondsSinceUnixEpoch
        )
        let frame = try ClockExchangeWireCodec.encode(request)
        try await Self.send(
            frame,
            on: connection,
            timeout: try remainingRoundTimeout(
                runStarted: runStarted,
                roundStarted: roundStarted
            ),
            context: context
        )

        let response = try await reader.nextMessage(
            timeout: try remainingRoundTimeout(
                runStarted: runStarted,
                roundStarted: roundStarted
            )
        )
        let received = Self.captureWall()
        guard response.kind == .response,
              response.requestID == request.requestID,
              response.round == round,
              response.fromLabel == options.peerLabel,
              response.toLabel == options.localLabel,
              response.fromInstanceID == peerInstanceID,
              response.toInstanceID == context.localInstanceID,
              response.localSentWallMilliseconds
                == sent.wall.millisecondsSinceUnixEpoch,
              let t2 = response.peerReceivedWallMilliseconds,
              let t3 = response.peerSentWallMilliseconds,
              let peerProcessing = response.peerProcessingMonotonicMilliseconds,
              let peerUncertainty = response.peerCaptureUncertaintyMilliseconds
        else {
            throw ClockExchangeProbeFailure.protocolMismatch
        }

        let localElapsed = Self.elapsedMilliseconds(
            from: sent.monotonicBefore,
            to: received.monotonicAfter,
            rounding: .up
        )
        guard localElapsed
                <= ClockExchangeMeasurementBounds.maximumMilliseconds
        else {
            throw ClockExchangeProbeFailure.reportingOverflow
        }
        let captureUncertainty = try ClockExchangeMeasurementBounds.checkedSum(
            sent.uncertaintyMilliseconds,
            received.uncertaintyMilliseconds,
            peerUncertainty
        )
        let sample = ClockFourTimestampSample(
            localSentWallTime: sent.wall,
            peerReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: t2),
            peerSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: t3),
            localReceivedWallTime: received.wall,
            localElapsedMonotonicMilliseconds: localElapsed,
            peerProcessingMonotonicMilliseconds: peerProcessing,
            captureUncertaintyMilliseconds: captureUncertainty
        )
        // ClockFourTimestampSample의 공통 continuity gate(10ms + capture
        // uncertainty)를 사용해 system-clock notification race와 무관하게 막는다.
        guard sample.offsetInterval != nil else {
            throw ClockExchangeProbeFailure.clockJumpDetected
        }
        return sample
    }

    private func waitForPeerRounds(
        context: ClockProbeRunContext,
        timeout: Double
    ) async throws {
        if context.evidenceSnapshot().inboundCompletedRounds
            == Set(1...ClockExchangeProbeOptions.requiredRounds) {
            return
        }
        context.inboundCompletion.fail(
            after: timeout,
            with: ClockExchangeProbeFailure.peerResponsesIncomplete
        )
        try await context.inboundCompletion.value
    }

    // MARK: Bounds and privacy helpers

    private static func makeEphemeralInstanceID() -> String {
        UUID().uuidString
            .replacingOccurrences(of: "-", with: "")
            .lowercased()
    }

    private func remainingTimeout(
        since runStarted: ContinuousClock.Instant,
        cappedAt cap: Double
    ) throws -> Double {
        let elapsed = Double(Self.elapsedMilliseconds(
            from: runStarted,
            to: .now,
            rounding: .up
        )) / 1_000
        let remaining = options.totalTimeoutSeconds - elapsed
        guard remaining > 0 else { throw ClockExchangeProbeFailure.timeout }
        return min(remaining, cap)
    }

    private func remainingRoundTimeout(
        runStarted: ContinuousClock.Instant,
        roundStarted: ContinuousClock.Instant
    ) throws -> Double {
        let runRemaining = try remainingTimeout(
            since: runStarted,
            cappedAt: options.roundTimeoutSeconds
        )
        let roundElapsed = Double(Self.elapsedMilliseconds(
            from: roundStarted,
            to: .now,
            rounding: .up
        )) / 1_000
        let roundRemaining = options.roundTimeoutSeconds - roundElapsed
        guard roundRemaining > 0 else { throw ClockExchangeProbeFailure.timeout }
        return min(runRemaining, roundRemaining)
    }

    private static func captureWall() -> WallCapture {
        let before = ContinuousClock.now
        let milliseconds = Int64((Date().timeIntervalSince1970 * 1_000).rounded())
        let after = ContinuousClock.now
        return WallCapture(
            wall: WallClockInstant(millisecondsSinceUnixEpoch: milliseconds),
            monotonicBefore: before,
            monotonicAfter: after,
            uncertaintyMilliseconds: elapsedMilliseconds(
                from: before,
                to: after,
                rounding: .up
            )
        )
    }

    private enum MillisecondRounding {
        case up
        case down
    }

    private static func elapsedMilliseconds(
        from start: ContinuousClock.Instant,
        to end: ContinuousClock.Instant,
        rounding: MillisecondRounding
    ) -> Int64 {
        let duration = start.duration(to: end)
        let components = duration.components
        let milliseconds = Double(components.seconds) * 1_000
            + Double(components.attoseconds) / 1_000_000_000_000_000
        switch rounding {
        case .up:
            return max(0, Int64(milliseconds.rounded(.up)))
        case .down:
            return max(0, Int64(milliseconds.rounded(.down)))
        }
    }

    private static func closedInterfaceType(
        _ type: NWInterface.InterfaceType
    ) -> ClockExchangeInterfaceType {
        switch type {
        case .wifi: .wifi
        case .wiredEthernet: .ethernet
        case .loopback: .loopback
        case .cellular, .other: .other
        @unknown default: .other
        }
    }

    private static func closedFailure(_ error: any Error) -> ClockExchangeProbeFailure {
        if let failure = error as? ClockExchangeProbeFailure { return failure }
        if error is CancellationError { return .connectionCancelled }
        if let wireError = error as? ClockExchangeWireError {
            return wireError == .reportingOverflow
                ? .reportingOverflow
                : .malformedFrame
        }
        return .protocolMismatch
    }

    private static func send(
        _ data: Data,
        on connection: NWConnection,
        timeout: Double,
        context: ClockProbeRunContext
    ) async throws {
        let sent = ClockProbeSingleResume<Void>()
        context.register(waiter: sent)
        connection.send(content: data, completion: .contentProcessed { error in
            if error == nil {
                sent.resume(returning: ())
            } else {
                sent.resume(throwing: ClockExchangeProbeFailure.sendFailed)
            }
        })
        sent.fail(
            after: timeout,
            with: ClockExchangeProbeFailure.timeout
        )
        try await sent.value
    }

    deinit {
        stop()
    }
}

/// TCP partial/coalesced read를 하나의 length-prefixed frame으로 누적한다.
private final class ClockExchangeConnectionReader: @unchecked Sendable {
    private let connection: NWConnection
    private let context: ClockProbeRunContext
    private let queue: DispatchQueue
    private var decoder = ClockExchangeFrameDecoder()

    init(
        connection: NWConnection,
        context: ClockProbeRunContext,
        queue: DispatchQueue
    ) {
        self.connection = connection
        self.context = context
        self.queue = queue
    }

    func nextMessage(
        timeout: Double
    ) async throws -> ClockExchangeWireMessage {
        let result = ClockProbeSingleResume<ClockExchangeWireMessage>()
        context.register(waiter: result)
        // decoder와 receive 재귀는 모두 NWConnection과 같은 serial queue에 둔다.
        queue.async { [self] in
            receiveUntilFrame(result)
        }
        result.fail(
            after: timeout,
            with: ClockExchangeProbeFailure.timeout
        )
        return try await result.value
    }

    private func receiveUntilFrame(
        _ result: ClockProbeSingleResume<ClockExchangeWireMessage>
    ) {
        do {
            if let message = try decoder.nextMessage() {
                result.resume(returning: message)
                return
            }
        } catch {
            result.resume(throwing: Self.closedWireFailure(error))
            return
        }

        connection.receive(
            minimumIncompleteLength: 1,
            maximumLength: ClockExchangeWireCodec.maximumBufferedBytes
        ) { [self] data, _, isComplete, error in
            if error != nil {
                result.resume(throwing: ClockExchangeProbeFailure.receiveFailed)
                return
            }
            guard let data, !data.isEmpty else {
                result.resume(throwing: isComplete
                    ? ClockExchangeProbeFailure.malformedFrame
                    : ClockExchangeProbeFailure.receiveFailed)
                return
            }
            do {
                try decoder.append(data)
            } catch {
                result.resume(throwing: Self.closedWireFailure(error))
                return
            }
            receiveUntilFrame(result)
        }
    }

    private static func closedWireFailure(
        _ error: any Error
    ) -> ClockExchangeProbeFailure {
        guard let wireError = error as? ClockExchangeWireError else {
            return .malformedFrame
        }
        return wireError == .reportingOverflow
            ? .reportingOverflow
            : .malformedFrame
    }
}

/// Network callback을 정확히 한 번 async continuation으로 잇는다.
private final class ClockProbeSingleResume<Value: Sendable>:
    ClockProbeCancellation,
    @unchecked Sendable
{
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Error>?
    private var pending: Result<Value, Error>?
    private var timeoutTasks: [Task<Void, Never>] = []
    private var finished = false

    var value: Value {
        get async throws {
            try await withCheckedThrowingContinuation { continuation in
                let ready: Result<Value, Error>? = lock.withLock {
                    if let pending {
                        self.pending = nil
                        return pending
                    }
                    self.continuation = continuation
                    return nil
                }
                if let ready { continuation.resume(with: ready) }
            }
        }
    }

    func resume(returning value: Value) {
        complete(.success(value))
    }

    func resume(throwing error: any Error) {
        complete(.failure(error))
    }

    func cancel() {
        complete(.failure(ClockExchangeProbeFailure.connectionCancelled))
    }

    func fail(
        after seconds: Double,
        with error: any Error
    ) {
        let nanoseconds = Int64(
            (seconds * 1_000_000_000).rounded(.up)
        )
        let timeout = Task { [weak self] in
            do {
                try await ContinuousClock().sleep(
                    for: .nanoseconds(nanoseconds)
                )
            } catch {
                return
            }
            self?.complete(.failure(error))
        }

        let retained = lock.withLock {
            guard !finished else { return false }
            timeoutTasks.append(timeout)
            return true
        }
        if !retained {
            timeout.cancel()
        }
    }

    private func complete(_ result: Result<Value, Error>) {
        let completion:
            (CheckedContinuation<Value, Error>?, [Task<Void, Never>])? =
            lock.withLock {
            guard !finished else { return nil }
            finished = true
            let timeouts = timeoutTasks
            timeoutTasks.removeAll(keepingCapacity: false)
            if let continuation {
                self.continuation = nil
                return (continuation, timeouts)
            }
            pending = result
            return (nil, timeouts)
        }
        guard let completion else { return }
        completion.1.forEach { $0.cancel() }
        completion.0?.resume(with: result)
    }
}
