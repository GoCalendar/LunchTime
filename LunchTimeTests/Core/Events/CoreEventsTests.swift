import Foundation
import Testing

@testable import LunchTime

/// 공용 운영 이벤트 envelope 계약을 고정하는 suite.
///
/// 검증 대상은 `POL-02-R-01`의 최소 식별 정보, 불변 encode/decode와 검증 실패
/// 모델, `POL-02-R-05`의 결정적 보조 정렬이다. 도메인별 payload 의미와 충돌
/// 승자 규칙은 이 계약이 소유하지 않으므로 검증하지 않는다.
@Suite("운영 이벤트 envelope 계약")
struct CoreEventsTests {

    // MARK: - 필수 식별 정보

    @Suite("필수 식별 정보")
    struct RequiredIdentity {
        @Test("식별 필드가 비어 있으면 어떤 필드인지 지목하며 거부한다")
        func rejectsBlankIdentityField() throws {
            /// `POL-02-R-01`의 최소 식별 정보 중 문자열 식별자 필드와, 그 필드가
            /// 비었을 때 나와야 하는 오류.
            let builders: [(EventEnvelopeField, (String) throws -> DurableEvent)] = [
                (.eventID, { try EventFixture.makeInitial(id: EventID($0)) }),
                (.daySession, { try EventFixture.makeInitial(daySession: DaySessionID($0)) }),
                (.room, { try EventFixture.makeInitial(room: RoomID($0)) }),
                (.authorUser, {
                    try EventFixture.makeInitial(
                        author: EventAuthor(user: UserID($0), device: EventFixture.device)
                    )
                }),
                (.authorDevice, {
                    try EventFixture.makeInitial(
                        author: EventAuthor(user: EventFixture.user, device: DeviceID($0))
                    )
                }),
                (.entityKind, {
                    try EventFixture.makeInitial(
                        target: EventTarget(kind: EntityKind($0), id: EventFixture.entity)
                    )
                }),
                (.entityID, {
                    try EventFixture.makeInitial(
                        target: EventTarget(kind: EventFixture.entityKind, id: EntityID($0))
                    )
                }),
                (.eventType, { try EventFixture.makeInitial(type: EventType($0)) }),
            ]

            for (field, build) in builders {
                for blank in ["", "   "] {
                    #expect(throws: EventEnvelopeError.missingIdentity(field: field)) {
                        _ = try build(blank)
                    }
                }
            }
        }

        @Test("Room 없는 일일 세션 scope 이벤트는 허용한다")
        func allowsDaySessionScopedEvent() throws {
            let event = try EventFixture.makeInitial(room: nil)

            #expect(event.room == nil)
        }

        @Test("리비전 번호가 1 미만이면 거부한다", arguments: [0, -1])
        func rejectsNonPositiveRevision(value: Int) {
            #expect(throws: EventEnvelopeError.invalidRevision(value: value)) {
                _ = try EventFixture.makeInitial(revision: EventRevision(value))
            }
        }

        @Test("최초 리비전이 선행 이벤트를 지목하면 거부한다")
        func rejectsInitialRevisionWithPredecessor() {
            #expect(
                throws: EventEnvelopeError.revisionPredecessorMismatch(revision: 1, supersedesCount: 1)
            ) {
                _ = try EventFixture.makeInitial(revision: .initial, supersedes: [EventID("evt-0000")])
            }
        }

        @Test("후속 리비전이 선행 이벤트를 지목하지 않으면 거부한다")
        func rejectsLaterRevisionWithoutPredecessor() {
            #expect(
                throws: EventEnvelopeError.revisionPredecessorMismatch(revision: 2, supersedesCount: 0)
            ) {
                _ = try EventFixture.makeInitial(revision: EventRevision(2), supersedes: [])
            }
        }

        @Test("자기 자신을 대체한다고 선언하면 거부한다")
        func rejectsSelfSupersedingEvent() {
            #expect(throws: EventEnvelopeError.selfSupersedingEvent(id: EventID("evt-0002"))) {
                _ = try EventFixture.makeInitial(
                    id: EventID("evt-0002"),
                    revision: EventRevision(2),
                    supersedes: [EventID("evt-0002")]
                )
            }
        }

        @Test("같은 선행 이벤트를 두 번 지목하면 거부한다")
        func rejectsDuplicatePredecessor() {
            #expect(throws: EventEnvelopeError.duplicateSupersededEvent(id: EventID("evt-0001"))) {
                _ = try EventFixture.makeInitial(
                    id: EventID("evt-0003"),
                    revision: EventRevision(2),
                    supersedes: [EventID("evt-0001"), EventID("evt-0001")]
                )
            }
        }

        /// 상한이 없으면 원격 Peer가 보낸 `Int.max` 리비전을 decode한 뒤 그
        /// 대상을 수정할 때 정수 오버플로가 프로세스를 종료시킨다.
        @Test("리비전이 상한을 넘으면 거부한다")
        func rejectsRevisionAboveMaximum() {
            #expect(throws: EventEnvelopeError.invalidRevision(value: Int.max)) {
                _ = try EventFixture.makeInitial(
                    revision: EventRevision(Int.max),
                    supersedes: [EventID("evt-0000")]
                )
            }
        }

        /// 상한 리비전 이벤트의 후속 생성은 crash가 아니라 명시적 오류여야 한다.
        @Test("상한 리비전 이벤트의 다음 리비전은 오류로 거부된다")
        func rejectsSuccessorBeyondMaximumRevision() throws {
            let event = try EventFixture.makeInitial(
                revision: .maximum,
                supersedes: [EventID("evt-0000")]
            )

            #expect(throws: EventEnvelopeError.invalidRevision(value: Int.max)) {
                _ = try event.makingRevision(
                    id: EventID("evt-0002"),
                    logicalOrder: LogicalOrder(42),
                    occurredAt: EventTimestamp(epochMilliseconds: 1_784_000_000_000),
                    author: event.author,
                    payload: EventPayload(data: Data("next".utf8))
                )
            }
        }
    }

    // MARK: - 식별자 정규화

    @Suite("식별자 정규화")
    struct Normalization {
        /// `==`는 유니코드 정규 동등성을, digest는 UTF-8 원본을 쓴다. 정규화가
        /// 없으면 같은 이벤트가 서로 다른 digest를 갖고, 저장·전송 계층이
        /// 문자열을 정규화하는 순간 정상 envelope가 영구 거부된다.
        @Test("정규 동등한 식별자는 같은 이벤트이자 같은 digest다")
        func foldsCanonicallyEquivalentIdentifiers() throws {
            let precomposed = EntityID("김치")
            let decomposed = EntityID("김치".decomposedStringWithCanonicalMapping)
            #expect(precomposed.rawValue.utf8.count != decomposed.rawValue.utf8.count)

            let fromPrecomposed = try EventFixture.makeInitial(
                target: EventTarget(kind: EventFixture.entityKind, id: precomposed)
            )
            let fromDecomposed = try EventFixture.makeInitial(
                target: EventTarget(kind: EventFixture.entityKind, id: decomposed)
            )

            #expect(fromPrecomposed == fromDecomposed)
            #expect(fromPrecomposed.contentDigest == fromDecomposed.contentDigest)
            #expect(fromPrecomposed.envelopeDigest == fromDecomposed.envelopeDigest)
        }

        @Test("전송 중 정규화된 envelope도 거부하지 않는다")
        func acceptsNormalizedEnvelopeFromWire() throws {
            let event = try EventFixture.makeInitial(
                target: EventTarget(kind: EventFixture.entityKind, id: EntityID("김치"))
            )
            let encoded = try EventEnvelopeCodec.encode(event)
            let normalizedInTransit = try #require(
                String(decoding: encoded, as: UTF8.self)
                    .decomposedStringWithCanonicalMapping
                    .data(using: .utf8)
            )

            let restored = try EventEnvelopeCodec.decode(normalizedInTransit)

            #expect(restored == event)
        }

        @Test("양끝 공백이 다른 식별자는 같은 값으로 접힌다")
        func trimsSurroundingWhitespace() throws {
            let padded = try EventFixture.makeInitial(daySession: DaySessionID(" 2026-07-29 "))
            let plain = try EventFixture.makeInitial(daySession: DaySessionID("2026-07-29"))

            #expect(padded.daySession == plain.daySession)
            #expect(padded == plain)
        }
    }

    // MARK: - encode·decode 보존

    @Suite("encode·decode 보존")
    struct RoundTrip {
        @Test("encode 후 decode해도 식별·리비전·작성자·논리 순서가 그대로다")
        func preservesIdentityAcrossRoundTrip() throws {
            let original = try EventFixture.makeSerializationSample()

            let restored = try EventEnvelopeCodec.decode(EventEnvelopeCodec.encode(original))

            #expect(restored.id == original.id)
            #expect(restored.revision == original.revision)
            #expect(restored.supersedes == original.supersedes)
            #expect(restored.author == original.author)
            #expect(restored.logicalOrder == original.logicalOrder)
            #expect(restored.occurredAt == original.occurredAt)
            #expect(restored == original)
        }

        @Test("Room 없는 이벤트도 round-trip에서 scope가 보존된다")
        func preservesDaySessionScope() throws {
            let original = try EventFixture.makeInitial(room: nil)

            let restored = try EventEnvelopeCodec.decode(EventEnvelopeCodec.encode(original))

            #expect(restored.room == nil)
            #expect(restored == original)
        }

        @Test("선행 이벤트 목록의 입력 순서가 달라도 같은 이벤트로 접힌다")
        func normalizesPredecessorOrder() throws {
            let ascending = try EventFixture.makeInitial(
                id: EventID("evt-0004"),
                revision: EventRevision(2),
                supersedes: [EventID("evt-0001"), EventID("evt-0002")]
            )
            let descending = try EventFixture.makeInitial(
                id: EventID("evt-0004"),
                revision: EventRevision(2),
                supersedes: [EventID("evt-0002"), EventID("evt-0001")]
            )

            #expect(ascending == descending)
            #expect(ascending.contentDigest == descending.contentDigest)
        }

        /// 목록 필드 안쪽에 원소별 길이가 없으면 `["a,b"]`와 `["a", "b"]`가 같은
        /// 표현으로 접혀, 선행 리비전 구조가 바뀐 envelope가 무결성 검사를
        /// 통과하고 `EventCollection`도 정상 중복으로 받아들인다.
        @Test("구분자를 포함한 선행 이벤트 ID가 다른 집합을 흉내 내지 못한다")
        func separatorInPredecessorCannotForgeList() throws {
            let single = try EventFixture.makeInitial(
                revision: EventRevision(2),
                supersedes: [EventID("a,b")]
            )
            let pair = try EventFixture.makeInitial(
                revision: EventRevision(2),
                supersedes: [EventID("a"), EventID("b")]
            )

            #expect(single != pair)
            #expect(single.contentDigest != pair.contentDigest)

            var collection = EventCollection()
            try collection.insert(single)
            #expect(throws: EventEnvelopeError.self) {
                try collection.insert(pair)
            }
        }

        @Test("삭제 표식도 고정 fixture와 바이트 단위로 호환된다")
        func matchesTombstoneSerializationFixture() throws {
            let tombstone = try EventFixture.makeTombstoneSample()

            let encoded = try EventEnvelopeCodec.encode(tombstone)

            #expect(String(decoding: encoded, as: UTF8.self) == EventFixture.serializedTombstoneSample)
            let decoded = try EventEnvelopeCodec.decode(Data(EventFixture.serializedTombstoneSample.utf8))
            #expect(decoded == tombstone)
            #expect(decoded.form == .tombstone)
        }

        @Test("고정 fixture와 바이트 단위로 호환된다")
        func matchesSerializationFixture() throws {
            let event = try EventFixture.makeSerializationSample()

            let encoded = try EventEnvelopeCodec.encode(event)

            #expect(
                String(decoding: encoded, as: UTF8.self) == EventFixture.serializedSample,
                "직렬화 형식이 바뀌면 이미 전파된 이벤트를 다른 Peer가 같은 이벤트로 인식하지 못한다."
            )
            let decoded = try EventEnvelopeCodec.decode(Data(EventFixture.serializedSample.utf8))
            #expect(decoded == event)
        }

        @Test("필수 필드가 빠진 직렬화 입력은 어떤 필드인지 지목하며 거부한다")
        func rejectsDecodingWithMissingField() throws {
            let removable: [(String, EventEnvelopeField)] = [
                ("envelopeVersion", .envelopeVersion),
                ("eventID", .eventID),
                ("daySession", .daySession),
                ("authorUser", .authorUser),
                ("authorDevice", .authorDevice),
                ("entityKind", .entityKind),
                ("entityID", .entityID),
                ("eventType", .eventType),
                ("form", .form),
                ("revision", .revision),
                ("logicalOrder", .logicalOrder),
                ("occurredAt", .occurredAt),
                ("envelopeDigest", .envelopeDigest),
            ]

            for (key, field) in removable {
                let broken = try EventFixture.serializedSample(removing: key)

                #expect(throws: EventEnvelopeError.missingIdentity(field: field)) {
                    _ = try EventEnvelopeCodec.decode(broken)
                }
            }
        }

        /// 기본값으로 복원되는 필드는 누락 오류가 아니라 무결성 불일치로 걸러야
        /// 한다. Room scope를 잃은 이벤트가 조용히 통과하면 다인 방의 누락 방지
        /// 표면(`PRD-01-AC-02`)이 직접 무너진다.
        @Test("기본값으로 복원되는 필드가 유실되면 거부한다")
        func rejectsLostOptionalField() throws {
            // `supersedes`는 무결성 비교에 닿기 전에 리비전 구조 불변식이 먼저
            // 잡는다. 더 이른 거부이므로 그대로 고정한다.
            let expected: [String: EventEnvelopeError] = [
                "room": .integrityMismatch(
                    id: EventID("evt-0002"),
                    expected: "",
                    actual: ""
                ),
                "payload": .integrityMismatch(
                    id: EventID("evt-0002"),
                    expected: "",
                    actual: ""
                ),
                "supersedes": .revisionPredecessorMismatch(revision: 2, supersedesCount: 0),
            ]

            for (key, expectation) in expected {
                let broken = try EventFixture.serializedSample(removing: key)

                do {
                    _ = try EventEnvelopeCodec.decode(broken)
                    Issue.record("\(key) 유실이 projection 이전에 걸러지지 않았다.")
                } catch let error as EventEnvelopeError {
                    switch (error, expectation) {
                    case (.integrityMismatch(let id, let lhs, let rhs), .integrityMismatch):
                        #expect(id == EventID("evt-0002"))
                        #expect(lhs != rhs)
                    case (.revisionPredecessorMismatch, .revisionPredecessorMismatch):
                        #expect(error == expectation)
                    default:
                        Issue.record("\(key) 유실이 \(expectation)이 아니라 \(error)로 거부됐다.")
                    }
                }
            }
        }

        /// `eventID`는 멱등 적용 키다. 이 값의 손상이 탐지되지 않으면 같은 논리
        /// 변경이 두 번 append되고 Peer마다 projection이 갈린다.
        @Test("내용이 훼손된 직렬화 입력은 무결성 불일치로 거부한다")
        func rejectsTamperedEnvelope() throws {
            let tampered: [(String, Any)] = [
                ("logicalOrder", 9_999),
                ("eventID", "evt-9999"),
                ("revision", 7),
                ("supersedes", ["evt-0009"]),
                ("occurredAt", 1_784_000_000_001),
                ("payload", "dGFtcGVyZWQ="),
            ]

            for (key, value) in tampered {
                let broken = try EventFixture.serializedSample(replacing: key, with: value)

                do {
                    _ = try EventEnvelopeCodec.decode(broken)
                    Issue.record("\(key) 훼손이 projection 이전에 걸러지지 않았다.")
                } catch let error as EventEnvelopeError {
                    guard case .integrityMismatch(_, let expected, let actual) = error else {
                        Issue.record("\(key) 훼손이 무결성 불일치가 아니라 \(error)로 거부됐다.")
                        continue
                    }
                    #expect(expected != actual)
                }
            }
        }

        @Test("필드 값의 형태가 다르면 envelope 오류 모델로 거부한다")
        func rejectsWrongFieldType() throws {
            let wrongTypes: [(String, Any, EventEnvelopeField)] = [
                ("revision", "2", .revision),
                ("logicalOrder", "42", .logicalOrder),
                ("occurredAt", "1784000000000", .occurredAt),
                ("room", 5, .room),
                ("supersedes", "evt-0001", .supersedes),
                ("eventID", 7, .eventID),
            ]

            for (key, value, field) in wrongTypes {
                let broken = try EventFixture.serializedSample(replacing: key, with: value)

                #expect(throws: EventEnvelopeError.unsupportedFieldValue(field: field)) {
                    _ = try EventEnvelopeCodec.decode(broken)
                }
            }
        }

        @Test("모르는 envelope version은 거부한다")
        func rejectsUnsupportedEnvelopeVersion() throws {
            let future = try EventFixture.serializedSample(replacing: "envelopeVersion", with: 99)

            #expect(throws: EventEnvelopeError.unsupportedEnvelopeVersion(value: 99)) {
                _ = try EventEnvelopeCodec.decode(future)
            }
        }

        @Test("모르는 form 값은 거부한다")
        func rejectsUnknownForm() throws {
            let unknown = try EventFixture.serializedSample(replacing: "form", with: "merge")

            #expect(throws: EventEnvelopeError.unsupportedFieldValue(field: .form)) {
                _ = try EventEnvelopeCodec.decode(unknown)
            }
        }
    }

    // MARK: - 불변성과 수정·삭제 표현

    @Suite("불변성과 수정·삭제 표현")
    struct Immutability {
        @Test("수정은 원본을 두고 새 리비전 이벤트로 표현한다")
        func revisionCreatesSeparateEvent() throws {
            let original = try EventFixture.makeInitial()
            let pristine = try EventFixture.makeInitial()

            let revised = try original.makingRevision(
                id: EventID("evt-0002"),
                logicalOrder: LogicalOrder(42),
                occurredAt: EventTimestamp(epochMilliseconds: 1_784_000_000_000),
                author: original.author,
                payload: EventPayload(data: Data("revised-payload".utf8))
            )

            #expect(original == pristine, "원본 이벤트가 제자리에서 바뀌었다.")
            #expect(revised.id != original.id)
            #expect(revised.revision == original.revision.next)
            #expect(revised.supersedes == [original.id])
            #expect(revised.target == original.target)
            #expect(revised.form == .revision)
            #expect(revised.contentDigest != original.contentDigest)

            // 값 타입의 `let` 비교만으로는 어떤 구현이든 통과한다. 수정이 원본을
            // 대체하지 않고 별도 이벤트로 남는지는 두 이벤트가 장부에 함께
            // 살아남는지로만 관측된다.
            var collection = EventCollection()
            try collection.insert(original)
            try collection.insert(revised)
            #expect(collection.count == 2)
            #expect(collection.event(original.id) == original)
        }

        @Test("삭제는 원본을 두고 삭제 표식 이벤트로 표현한다")
        func tombstoneCreatesSeparateEvent() throws {
            let original = try EventFixture.makeInitial()
            let pristine = try EventFixture.makeInitial()

            let tombstone = try original.makingTombstone(
                id: EventID("evt-0003"),
                logicalOrder: LogicalOrder(43),
                occurredAt: EventTimestamp(epochMilliseconds: 1_784_000_100_000),
                author: original.author
            )

            #expect(original == pristine, "원본 이벤트가 제자리에서 바뀌었다.")
            #expect(original.form == .revision)
            #expect(tombstone.form == .tombstone)
            #expect(tombstone.supersedes == [original.id])
            #expect(tombstone.target == original.target)
            #expect(tombstone.payload == .empty)

            var collection = EventCollection()
            try collection.insert(original)
            try collection.insert(tombstone)
            #expect(collection.count == 2)
            #expect(collection.event(original.id) == original)
        }

        @Test("후속 이벤트도 같은 검증을 통과해야 만들어진다")
        func successorIsValidated() throws {
            let original = try EventFixture.makeInitial()

            #expect(throws: EventEnvelopeError.missingIdentity(field: .eventID)) {
                _ = try original.makingTombstone(
                    id: EventID(""),
                    logicalOrder: LogicalOrder(43),
                    occurredAt: EventTimestamp(epochMilliseconds: 1_784_000_100_000),
                    author: original.author
                )
            }
        }
    }

    // MARK: - 이벤트 집합

    @Suite("이벤트 집합")
    struct Collection {
        @Test("같은 ID를 두 번 넣어도 한 번만 존재한다")
        func deduplicatesByEventID() throws {
            let event = try EventFixture.makeInitial()
            var collection = EventCollection()

            let first = try collection.insert(event)
            let second = try collection.insert(event)

            #expect(first == .inserted)
            #expect(second == .alreadyPresent)
            #expect(collection.count == 1)
            #expect(collection.deterministicallyOrderedEvents == [event])
        }

        @Test("같은 ID로 다른 내용이 오면 저장한 내용을 지키고 거부한다")
        func rejectsIdentityConflict() throws {
            let stored = try EventFixture.makeInitial()
            let impostor = try EventFixture.makeInitial(
                payload: EventPayload(data: Data("different-payload".utf8))
            )
            var collection = EventCollection()
            try collection.insert(stored)

            #expect(
                throws: EventEnvelopeError.identityConflict(
                    id: stored.id,
                    storedDigest: stored.contentDigest,
                    incomingDigest: impostor.contentDigest
                )
            ) {
                try collection.insert(impostor)
            }
            #expect(collection.count == 1)
            #expect(collection.event(stored.id) == stored)
        }

        @Test("넣은 순서가 달라도 같은 결정적 순서를 얻는다")
        func ordersDeterministically() throws {
            let events = try [
                EventFixture.makeInitial(id: EventID("evt-c"), logicalOrder: LogicalOrder(2)),
                EventFixture.makeInitial(id: EventID("evt-a"), logicalOrder: LogicalOrder(2)),
                EventFixture.makeInitial(id: EventID("evt-b"), logicalOrder: LogicalOrder(1)),
            ]

            let forward = try EventCollection(events)
            let reversed = try EventCollection(events.reversed())

            let expected = try [
                EventFixture.makeInitial(id: EventID("evt-b"), logicalOrder: LogicalOrder(1)),
                EventFixture.makeInitial(id: EventID("evt-a"), logicalOrder: LogicalOrder(2)),
                EventFixture.makeInitial(id: EventID("evt-c"), logicalOrder: LogicalOrder(2)),
            ]
            #expect(forward.deterministicallyOrderedEvents == expected)
            #expect(reversed.deterministicallyOrderedEvents == expected)
        }

        @Test("중복 ID가 섞인 입력으로 만들어도 한 번만 존재한다")
        func initializerDeduplicates() throws {
            let event = try EventFixture.makeInitial()

            let collection = try EventCollection([event, event])

            #expect(collection.count == 1)
            #expect(collection.contains(event.id))
        }
    }

    // MARK: - 진단 자료 경계

    @Suite("진단 자료 경계")
    struct Diagnostics {
        /// `POL-02-R-07`이 진단 어휘를 이벤트 ID·상태 코드·소요 시간·익명 기기
        /// 식별자로 닫아 놨다. 키 없는 SHA-256은 나머지 필드를 아는 상대에게
        /// payload 내용에 대한 대입 가능한 commitment이므로 문자열에 싣지 않는다.
        @Test("오류 문자열이 digest를 노출하지 않는다")
        func omitsDigestFromDescription() throws {
            let stored = try EventFixture.makeInitial()
            let impostor = try EventFixture.makeInitial(
                payload: EventPayload(data: Data("different-payload".utf8))
            )

            let conflict = EventEnvelopeError.identityConflict(
                id: stored.id,
                storedDigest: stored.contentDigest,
                incomingDigest: impostor.contentDigest
            )
            let mismatch = EventEnvelopeError.integrityMismatch(
                id: stored.id,
                expected: stored.envelopeDigest,
                actual: impostor.envelopeDigest
            )

            for text in [conflict.description, mismatch.description] {
                #expect(text.contains(stored.id.rawValue))
                #expect(!text.contains(stored.contentDigest))
                #expect(!text.contains(stored.envelopeDigest))
                #expect(!text.contains(impostor.contentDigest))
                #expect(!text.contains(impostor.envelopeDigest))
            }
        }
    }

    // MARK: - 발생 시각 경계

    @Suite("발생 시각 경계")
    struct TimestampBoundary {
        /// `occurredAt`은 검증되지 않은 원격 입력이다. `Date` 왕복이 trap하면
        /// 정렬·표시 계층이 원격 값 하나로 죽는다.
        @Test("표현할 수 없는 시각은 crash가 아니라 nil이다")
        func returnsNilForUnrepresentableDate() {
            #expect(EventTimestamp(Date(timeIntervalSince1970: .nan)) == nil)
            #expect(EventTimestamp(Date(timeIntervalSince1970: .infinity)) == nil)
            #expect(EventTimestamp(Date(timeIntervalSince1970: -.infinity)) == nil)
            #expect(EventTimestamp(Date(timeIntervalSince1970: 1e18)) == nil)
        }

        @Test("표현 가능한 시각은 밀리초로 내려 왕복한다")
        func roundTripsRepresentableDate() throws {
            let timestamp = try #require(EventTimestamp(Date(timeIntervalSince1970: 1_784_000_000.75)))

            #expect(timestamp.epochMilliseconds == 1_784_000_000_750)
            #expect(EventTimestamp(timestamp.date) == timestamp)
            #expect(EventTimestamp(Date.distantFuture) != nil)
            #expect(EventTimestamp(Date.distantPast) != nil)
        }

        @Test("극단 밀리초 값을 가진 이벤트도 Date 왕복에서 죽지 않는다")
        func survivesExtremeEpochMilliseconds() throws {
            for milliseconds in [Int64.max, Int64.min, 0] {
                let event = try EventFixture.makeInitial(
                    occurredAt: EventTimestamp(epochMilliseconds: milliseconds)
                )

                let restored = try EventEnvelopeCodec.decode(EventEnvelopeCodec.encode(event))

                #expect(restored.occurredAt.epochMilliseconds == milliseconds)
                // `.date`는 검증 없이 나가므로 되돌리기가 실패로 표현되는지까지 본다.
                _ = EventTimestamp(restored.occurredAt.date)
            }
        }
    }
}

/// envelope 계약 테스트가 공유하는 결정적 fixture.
///
/// 모든 값은 익명 라벨이다. `POL-02-R-07`이 진단 자료의 범위를 이벤트 ID·상태
/// 코드·익명 기기 식별자로 제한하므로 테스트 자료도 같은 경계를 지킨다.
/// 시각도 고정 상수만 사용한다. 실제 시계를 읽으면 고정 fixture 비교가 실행
/// 시각에 따라 달라져 회귀 검증 목적 자체가 무너진다.
enum EventFixture {
    static let user = UserID("user-a")
    static let device = DeviceID("device-a1")
    static let entityKind = EntityKind("menu")
    static let entity = EntityID("menu-user-a")

    /// 최초 리비전 이벤트. 인자로 준 값만 바꾼다.
    static func makeInitial(
        id: EventID = EventID("evt-0001"),
        daySession: DaySessionID = DaySessionID("2026-07-29"),
        room: RoomID? = RoomID("room-01"),
        author: EventAuthor = EventAuthor(user: user, device: device),
        target: EventTarget = EventTarget(kind: entityKind, id: entity),
        type: EventType = EventType("menu.revision"),
        form: EventForm = .revision,
        revision: EventRevision = .initial,
        supersedes: [EventID] = [],
        logicalOrder: LogicalOrder = LogicalOrder(41),
        occurredAt: EventTimestamp = EventTimestamp(epochMilliseconds: 1_783_999_000_000),
        payload: EventPayload = EventPayload(data: Data("initial-payload".utf8))
    ) throws -> DurableEvent {
        try DurableEvent(
            id: id,
            daySession: daySession,
            room: room,
            author: author,
            target: target,
            type: type,
            form: form,
            revision: revision,
            supersedes: supersedes,
            logicalOrder: logicalOrder,
            occurredAt: occurredAt,
            payload: payload
        )
    }

    /// 고정 직렬화 fixture가 사용하는 두 번째 리비전 이벤트.
    static func makeSerializationSample() throws -> DurableEvent {
        try makeInitial(
            id: EventID("evt-0002"),
            revision: EventRevision(2),
            supersedes: [EventID("evt-0001")],
            logicalOrder: LogicalOrder(42),
            occurredAt: EventTimestamp(epochMilliseconds: 1_784_000_000_000),
            payload: EventPayload(data: Data("fixture-payload".utf8))
        )
    }

    /// 고정 직렬화 fixture가 사용하는 삭제 표식 이벤트.
    ///
    /// `form`은 보존·비부활 계층이 payload를 열지 않고 삭제 표식을 알아보는
    /// 유일한 키이므로(`POL-02-R-05`) 두 form 모두 직렬화 경로를 지나야 한다.
    static func makeTombstoneSample() throws -> DurableEvent {
        try makeSerializationSample().makingTombstone(
            id: EventID("evt-0003"),
            logicalOrder: LogicalOrder(43),
            occurredAt: EventTimestamp(epochMilliseconds: 1_784_000_100_000),
            author: EventAuthor(user: user, device: device)
        )
    }

    /// 고정 직렬화 fixture.
    ///
    /// 이 바이트가 바뀌면 이미 저장·전파된 이벤트를 다른 Peer가 같은 이벤트로
    /// 인식하지 못한다. 형식을 의도적으로 바꿀 때는 `envelopeVersion`을 올리고
    /// 이 fixture를 새 version의 기준으로 갱신한다.
    static let serializedSample = """
        {"authorDevice":"device-a1","authorUser":"user-a",\
        "daySession":"2026-07-29","entityID":"menu-user-a","entityKind":"menu",\
        "envelopeDigest":"8915244b42d645df90006ee93de55b24d69dc539ef7deefb845a2a9de8437596",\
        "envelopeVersion":1,"eventID":"evt-0002","eventType":"menu.revision",\
        "form":"revision","logicalOrder":42,"occurredAt":1784000000000,\
        "payload":"Zml4dHVyZS1wYXlsb2Fk","revision":2,"room":"room-01",\
        "supersedes":["evt-0001"]}
        """

    /// 삭제 표식의 고정 직렬화 fixture.
    static let serializedTombstoneSample = """
        {"authorDevice":"device-a1","authorUser":"user-a",\
        "daySession":"2026-07-29","entityID":"menu-user-a","entityKind":"menu",\
        "envelopeDigest":"5e4cc5fec9da1f2422e2c6ab72ee0e59b3b503923c2ffaa0f8de4b94f96113c9",\
        "envelopeVersion":1,"eventID":"evt-0003","eventType":"menu.revision",\
        "form":"tombstone","logicalOrder":43,"occurredAt":1784000100000,\
        "payload":"","revision":3,"room":"room-01",\
        "supersedes":["evt-0002"]}
        """

    /// 고정 fixture에서 key 하나를 지운 직렬화 입력.
    static func serializedSample(removing key: String) throws -> Data {
        var object = try sampleObject()
        object.removeValue(forKey: key)
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    /// 고정 fixture에서 key 하나의 값을 바꾼 직렬화 입력.
    static func serializedSample(replacing key: String, with value: Any) throws -> Data {
        var object = try sampleObject()
        object[key] = value
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    private static func sampleObject() throws -> [String: Any] {
        let parsed = try JSONSerialization.jsonObject(with: Data(serializedSample.utf8))
        guard let object = parsed as? [String: Any] else {
            throw FixtureError.malformedSample
        }
        return object
    }

    enum FixtureError: Error {
        case malformedSample
    }
}
