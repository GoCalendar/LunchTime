import Foundation

/// 이벤트 하나를 collection에 넣은 결과.
public enum EventInsertionOutcome: Hashable, Sendable {
    /// 처음 보는 이벤트를 넣었다.
    case inserted
    /// 같은 ID·같은 내용을 이미 갖고 있어 다시 적용하지 않았다.
    ///
    /// 아키텍처 `04`의 "같은 ID·같은 내용은 이미 적용한 결과를 바꾸지 않는다"에
    /// 해당한다. 호출자는 이 결과로 저장한 리비전에 대한 StorageACK 재전송을
    /// 판단할 수 있다.
    case alreadyPresent
}

/// 이벤트 ID로 중복을 제거하고 결정적 순서를 계산하는 이벤트 집합.
///
/// `POL-02-R-01`의 "현재 화면 상태는 검증된 이벤트 집합에서 결정적으로 계산한
/// 결과다"가 요구하는 입력 자료구조다. 적용 키는 이벤트 ID이며, 넣은 순서는
/// 결과에 영향을 주지 않는다.
///
/// 영속 장부가 아니다. 저장 엔진, 장부 요약, pending·quarantine 경계와
/// projection 계산은 각각의 계층이 소유한다. 이 타입은 공용 envelope 계약이
/// 보장해야 하는 멱등성과 결정적 정렬만 담는다.
public struct EventCollection: Hashable, Sendable {
    /// 이벤트와 그 내용 digest.
    ///
    /// digest를 함께 들고 있지 않으면 삽입마다 저장본의 SHA-256을 다시 계산한다.
    /// 이벤트 하나가 아니라 장부 규모에 비례하는 경로이므로 한 번만 계산한다.
    private struct Entry: Hashable, Sendable {
        let event: DurableEvent
        let contentDigest: String
    }

    private var entriesByID: [EventID: Entry]

    public init() {
        self.entriesByID = [:]
    }

    /// 여러 이벤트로 collection을 만든다. 중복 ID는 한 번만 남는다.
    ///
    /// 무결성 충돌 하나가 전체를 실패시키는 all-or-nothing 경로다. 오염된
    /// 이벤트만 격리하고 나머지를 유지해야 하는 호출자는 이 초기화 대신
    /// ``insert(_:)``를 이벤트마다 호출해 실패를 개별적으로 다뤄야 한다.
    public init(_ events: some Sequence<DurableEvent>) throws {
        self.entriesByID = [:]
        for event in events {
            _ = try insert(event)
        }
    }

    public var count: Int { entriesByID.count }

    public var isEmpty: Bool { entriesByID.isEmpty }

    public func contains(_ id: EventID) -> Bool { entriesByID[id] != nil }

    public func event(_ id: EventID) -> DurableEvent? { entriesByID[id]?.event }

    /// 이벤트를 멱등하게 넣는다.
    ///
    /// 같은 ID로 다른 내용이 들어오면 정상 중복이 아니라 무결성 충돌이므로
    /// 저장한 내용을 덮어쓰지 않고 거부한다(아키텍처 `03`·`04`). 어느 쪽이
    /// 옳은지 여기서 고르면 `POL-02-R-01`의 "이벤트는 수신 뒤 내용을 제자리에서
    /// 덮어쓰지 않는다"가 깨진다.
    @discardableResult
    public mutating func insert(_ event: DurableEvent) throws -> EventInsertionOutcome {
        let incomingDigest = event.contentDigest
        guard let stored = entriesByID[event.id] else {
            entriesByID[event.id] = Entry(event: event, contentDigest: incomingDigest)
            return .inserted
        }

        guard stored.contentDigest == incomingDigest else {
            throw EventEnvelopeError.identityConflict(
                id: event.id,
                storedDigest: stored.contentDigest,
                incomingDigest: incomingDigest
            )
        }
        return .alreadyPresent
    }

    /// 모든 Peer가 같은 결과를 얻는 전순서로 정렬한 이벤트.
    ///
    /// 논리 순서를 먼저 적용하고 같은 논리 순서는 이벤트 ID로 정렬한다
    /// (`POL-02-R-05`). 사전 dictionary 순회 순서는 실행마다 달라지므로
    /// 정렬 없이 노출하지 않는다.
    public var deterministicallyOrderedEvents: [DurableEvent] {
        entriesByID.values.map(\.event).sorted(by: DurableEvent.deterministicallyOrdered)
    }
}
