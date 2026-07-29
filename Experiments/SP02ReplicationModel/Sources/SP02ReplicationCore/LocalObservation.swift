import Foundation

/// 사용자에게 보이는 네 안정 상태(`POL-02-R-03`).
public enum SyncStatus: String, Sendable, Equatable {
    case storedLocally = "이 기기에 저장됨"
    case replicated = "복제됨"
    case reconciled = "동기화됨"
    case needsReview = "확인 필요"
}

/// 로컬 관측 입력.
///
/// 이 값들은 장부에서 계산되지 않는다. 같은 event 집합을 가진 Peer라도
/// StorageACK 수신과 접속 관측이 다르면 동기화 상태가 다를 수 있다는
/// 아키텍처 `04`의 전제를 타입으로 분리한 것이다.
public struct LocalObservation: Sendable {
    /// 전송 호출이 성공한 대상. **StorageACK가 아니다.**
    ///
    /// 이 둘을 한 필드로 합치면 "socket write 성공"이 곧바로 `복제됨`이 된다.
    /// `POL-02-R-04` 4.2와 아키텍처 `03`이 명시적으로 금지하는 판정이다.
    public var transportDelivered: [EventID: Set<PeerID>]
    /// 정확한 event·revision을 영속 저장했다고 회신한 Peer.
    public var storageAcknowledgements: [EventID: Set<PeerID>]
    /// 현재 제한 세션에서 요약 일치를 확인한 scope.
    public var reconciledScopes: Set<EventScope>
    /// 그 대조에서 실제로 양쪽이 함께 보유한 것으로 확인한 event.
    ///
    /// scope만 기억하면 대조가 끝난 **뒤에** 로컬 append한 event까지
    /// `동기화됨`으로 읽힌다. 상대는 그 event를 가진 적이 없는데도 주문 완료가
    /// 통과하므로, 이 스파이크가 막으려는 메뉴 누락이 그대로 생긴다.
    public var reconciledEventIDs: Set<EventID>
    /// 상대가 서로 다른 요약을 알렸지만 대조가 끝나지 않은 scope.
    public var unreconciledAdvertisedScopes: Set<EventScope>
    /// 이 Room이 다른 Peer에 발견·공유된 적이 있는지.
    ///
    /// 장부에서 계산할 수 없다. 아무 event도 오가지 않아도 발견만으로 예외는
    /// 사라지기 때문이다(`POL-02-R-04`, 아키텍처 `03`).
    public var sharedRooms: Set<RoomID>

    public init(
        transportDelivered: [EventID: Set<PeerID>] = [:],
        storageAcknowledgements: [EventID: Set<PeerID>] = [:],
        reconciledScopes: Set<EventScope> = [],
        reconciledEventIDs: Set<EventID> = [],
        unreconciledAdvertisedScopes: Set<EventScope> = [],
        sharedRooms: Set<RoomID> = []
    ) {
        self.transportDelivered = transportDelivered
        self.storageAcknowledgements = storageAcknowledgements
        self.reconciledScopes = reconciledScopes
        self.reconciledEventIDs = reconciledEventIDs
        self.unreconciledAdvertisedScopes = unreconciledAdvertisedScopes
        self.sharedRooms = sharedRooms
    }
}

/// 주문 완료를 막는 사유(`POL-02-R-04` 4.3, `PRD-01-FR-06`).
public enum OrderBlocker: String, Sendable, Comparable {
    case roomCancelled = "취소된 Room"
    case participationNotConfirmed = "참여가 확정되지 않음"
    case menuNotSubmitted = "메뉴 미제출"
    case revisionNotAcknowledged = "최신 리비전의 다른 Peer StorageACK 없음"
    case unresolvedConflict = "해결되지 않은 충돌"
    case peerSummaryDifferenceUnreconciled = "정상 응답 Peer의 요약 차이가 남음"
    case pendingDependencyUnresolved = "의존 record가 아직 없는 이벤트 보유"
    case integrityConflictQuarantined = "같은 ID·다른 payload로 격리한 이벤트 보유"

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// 주문 전 점검 결과.
public struct OrderReadiness: Equatable, Sendable {
    public let room: RoomID
    public let blockers: [OrderBlocker]
    /// `POL-02-R-04`의 엄격한 never-shared 단독 Room 예외가 성립하는지.
    public let soloRoomExceptionApplies: Bool

    /// 강제 완료는 제공하지 않는다. 차단 사유가 하나라도 있으면 완료할 수 없다.
    public var canCompleteOrder: Bool { blockers.isEmpty }
}

/// 장부와 로컬 관측을 함께 읽어 사용자에게 보이는 상태를 계산한다.
public struct LocalObservationProjection: Sendable {
    /// 이 판정을 수행하는 기기.
    public let device: DeviceID
    public let ledger: Ledger
    public let observation: LocalObservation
    public let structured: StructuredProjection

    public init(
        device: DeviceID,
        ledger: Ledger,
        observation: LocalObservation,
        structured: StructuredProjection
    ) {
        self.device = device
        self.ledger = ledger
        self.observation = observation
        self.structured = structured
    }

    /// 이벤트 하나의 안정 상태.
    ///
    /// `복제됨`은 "작성 기기 말고 최소 한 대가 같은 리비전을 저장했다"는 뜻이다
    /// (`POL-02-R-03`). 따라서 판정 결과는 **보는 기기에 따라 다르다.**
    /// 내가 만든 event는 남의 StorageACK가 있어야 하고, 남이 만든 event를 내가
    /// 보유하면 작성 기기와 나로 이미 복제본이 둘이다.
    public func status(of eventID: EventID) -> SyncStatus {
        if ledger.quarantined[eventID] != nil { return .needsReview }
        if ledger.pending[eventID] != nil { return .needsReview }
        if ledger.rejected[eventID] != nil { return .needsReview }
        guard let event = ledger.validated[eventID] else { return .needsReview }

        if observation.unreconciledAdvertisedScopes.contains(event.scope) { return .needsReview }
        // scope 대조 결과는 그 대조에 실제로 포함된 event에만 적용한다.
        if observation.reconciledScopes.contains(event.scope),
           observation.reconciledEventIDs.contains(eventID) {
            return .reconciled
        }
        if event.authorDevice != device { return .replicated }
        // 내 event에서는 전송 성공이 아무 역할도 하지 않는다. 정확한 리비전을
        // 저장했다는 회신만 `복제됨`을 만든다.
        if let acknowledgers = observation.storageAcknowledgements[eventID], !acknowledgers.isEmpty {
            return .replicated
        }
        return .storedLocally
    }

    /// 이 Room에 never-shared 단독 Room 예외를 적용할 수 있는지.
    ///
    /// 조건 셋(단독 참여자, 미공유, 원격 이력 없음)을 **모두** 계속 만족해야
    /// 한다. 하나라도 깨지면 예외는 즉시 사라진다.
    public func soloRoomExceptionApplies(room: RoomID) -> Bool {
        guard let projection = structured.rooms[room], !projection.cancelled else { return false }
        guard !observation.sharedRooms.contains(room) else { return false }

        // 정렬 없는 사전 순회로 "첫 일치"를 고르면 같은 장부가 실행마다 다른
        // 생성 record를 볼 수 있다. 결정적 순서를 먼저 고정한다.
        let roomEvents = ledger.validated.values
            .filter { $0.room == room }
            .sorted(by: LedgerEvent.deterministicOrder)
        let roomRecords = Ledger.roomRecords(in: roomEvents, room: room)
        // 생성 record가 둘 이상이면 Room 정보 자체가 확정되지 않았으므로
        // 단독 Room 예외를 적용할 수 없다.
        guard roomRecords.count == 1, let created = roomRecords.first else { return false }

        // 생성자 기기가 아닌 기기의 event가 하나라도 있으면 원격 이력이다.
        guard roomEvents.allSatisfy({ $0.authorDevice == created.authorDevice }) else { return false }
        // 원격 참여·ACK evidence record가 하나라도 있으면 예외가 아니다.
        let hasRemoteParticipationRecord = roomEvents.contains {
            switch $0.kind {
            case .participationRequest, .participationAcceptance, .participationConfirmation:
                return true
            default:
                return false
            }
        }
        guard !hasRemoteParticipationRecord else { return false }
        // 어떤 event든 다른 Peer가 StorageACK한 이력이 있으면 이미 공유된 Room이다.
        let acknowledged = roomEvents.contains { event in
            !(observation.storageAcknowledgements[event.id]?.isEmpty ?? true)
        }
        guard !acknowledged else { return false }
        // 전송 호출이 성공한 이력도 공유로 본다. StorageACK가 없어도 상대는 봤다.
        let delivered = roomEvents.contains { event in
            !(observation.transportDelivered[event.id]?.isEmpty ?? true)
        }
        guard !delivered else { return false }

        return projection.participants.count == 1 && projection.participants[created.authorUser] != nil
    }

    /// 주문 전 점검.
    public func orderReadiness(room: RoomID) -> OrderReadiness {
        guard let projection = structured.rooms[room] else {
            return OrderReadiness(room: room, blockers: [.participationNotConfirmed], soloRoomExceptionApplies: false)
        }
        var blockers: Set<OrderBlocker> = []
        let soloException = soloRoomExceptionApplies(room: room)

        if projection.cancelled { blockers.insert(.roomCancelled) }

        if !projection.conflicts.isEmpty { blockers.insert(.unresolvedConflict) }
        if structured.daySessionConflicts.contains(where: { note in
            note.user.map { projection.participants[$0] != nil } ?? false
        }) {
            blockers.insert(.unresolvedConflict)
        }

        for (user, state) in projection.participants {
            switch state {
            case .confirmed(let confirmation):
                if !isAcknowledgedOrReconciled(confirmation) { blockers.insert(.revisionNotAcknowledged) }
            case .creatorWithoutRemoteAcknowledgement:
                // 예외가 성립할 때만 원격 ACK 없이 통과한다.
                if !soloException { blockers.insert(.participationNotConfirmed) }
            case .withdrawn, .supersededByUserSelection:
                continue
            case .awaitingAcknowledgement, .failed:
                blockers.insert(.participationNotConfirmed)
            case .conflictedAcrossRooms:
                blockers.insert(.unresolvedConflict)
            }

            guard state.isConfirmedByRemoteAcknowledgement || (soloException && state == .creatorWithoutRemoteAcknowledgement) else {
                continue
            }
            switch projection.menus[user] ?? .notSubmitted {
            case .notSubmitted:
                blockers.insert(.menuNotSubmitted)
            case .diverged:
                blockers.insert(.unresolvedConflict)
            case .revoked:
                continue
            case .head(let headID, _, _):
                if !soloException, !isAcknowledgedOrReconciled(headID) {
                    blockers.insert(.revisionNotAcknowledged)
                }
            }
        }

        let roomScopes = observation.unreconciledAdvertisedScopes.filter { $0.room == room || $0.room == nil }
        if !roomScopes.isEmpty { blockers.insert(.peerSummaryDifferenceUnreconciled) }

        if ledger.pending.values.contains(where: { $0.room == room || $0.room == nil }) {
            blockers.insert(.pendingDependencyUnresolved)
        }

        // 격리한 envelope는 참여·메뉴 head가 아니어도 Room 정보나 주문 상태를
        // 노린 것일 수 있다. 그런 Room을 주문 가능으로 표시하면 무결성 충돌이
        // 사용자에게 아무 신호도 남기지 않고 지나간다.
        let quarantinedInRoom = ledger.quarantined.values.flatMap { $0 }.contains { event in
            event.room == room || event.room == nil
        }
        if quarantinedInRoom { blockers.insert(.integrityConflictQuarantined) }

        return OrderReadiness(
            room: room,
            blockers: blockers.sorted(),
            soloRoomExceptionApplies: soloException
        )
    }

    private func isAcknowledgedOrReconciled(_ eventID: EventID) -> Bool {
        switch status(of: eventID) {
        case .replicated, .reconciled: return true
        case .storedLocally, .needsReview: return false
        }
    }
}
