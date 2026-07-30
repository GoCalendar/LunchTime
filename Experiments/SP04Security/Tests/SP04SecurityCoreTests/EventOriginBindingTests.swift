import CryptoKit
import Foundation
import Testing

@testable import SP04SecurityCore

/// 이벤트 원작성자 결합(`POL-02-R-01`, `POL-03-R-02`).
///
/// [SP-02](../../../../docs/technical/spikes/PRD-01-SP-02-replication-conflicts.md)의
/// 한계 1은 "결정적 수렴은 이벤트 ID가 정직하게 발급된다는 전제 위에서만
/// 성립한다"고 남겼다. 이 suite가 그 전제를 고정한다.
@Suite("SP-04 이벤트 원작성자 결합")
struct EventOriginBindingTests {
    private func makeIdentity(seed: UInt64) throws -> DeviceIdentity {
        try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: seed), nickname: nil
        ).identity
    }

    private func baseEvent(author: DeviceIdentity, payload: String = "SP04-BODY") -> OperationalEvent {
        OperationalEvent(
            eventID: "",
            daySession: "S1",
            room: "R1",
            authorUser: author.userID.rawValue,
            authorDevice: author.deviceID.rawValue,
            eventType: "menuRevision",
            revision: 1,
            logicalOrder: 10,
            payload: Data(payload.utf8)
        )
    }

    @Test("서명한 이벤트는 검증을 통과하고 ID가 유도값으로 확정된다")
    func signedEventVerifies() throws {
        let author = try makeIdentity(seed: 1)
        let envelope = try SignedEnvelope.sign(baseEvent(author: author), with: author)

        #expect(
            envelope.event.eventID
                == EventIDDerivation.derive(
                    authorSigningPublicKey: envelope.authorSigningPublicKey,
                    event: envelope.event
                )
        )
        #expect((try? EnvelopeVerifier.verify(envelope).get()) != nil)
    }

    @Test("같은 ID에 다른 내용을 실을 수 없다")
    func sameIDDifferentPayloadIsRejected() throws {
        let author = try makeIdentity(seed: 2)
        let original = try SignedEnvelope.sign(baseEvent(author: author), with: author)
        let modified = SignedEnvelope(
            event: original.event.replacingPayload(Data("SP04-OTHER".utf8)),
            authorSigningPublicKey: original.authorSigningPublicKey,
            signature: original.signature
        )
        #expect(EnvelopeVerifier.verify(modified) == .failure(.eventIDNotBoundToAuthor))
    }

    @Test("작성자가 다시 발급하면 통과하지만 ID가 달라진다")
    func reissuingChangesTheID() throws {
        let author = try makeIdentity(seed: 3)
        let original = try SignedEnvelope.sign(baseEvent(author: author), with: author)
        let reissued = try SignedEnvelope.sign(
            original.event.replacingPayload(Data("SP04-OTHER".utf8)), with: author
        )
        #expect(reissued.event.eventID != original.event.eventID)
        #expect((try? EnvelopeVerifier.verify(reissued).get()) != nil)
    }

    @Test("다른 작성자는 같은 내용을 써도 같은 ID를 만들 수 없다")
    func eventIDIsBoundToAuthorKey() throws {
        let author = try makeIdentity(seed: 4)
        let attacker = try makeIdentity(seed: 5)
        let event = baseEvent(author: author)
        #expect(
            EventIDDerivation.derive(
                authorSigningPublicKey: Data(author.signingKey.publicKey.rawRepresentation),
                event: event
            ) != EventIDDerivation.derive(
                authorSigningPublicKey: Data(attacker.signingKey.publicKey.rawRepresentation),
                event: event
            )
        )
    }

    @Test("남의 기기 ID를 실은 이벤트는 거부한다")
    func rejectsForgedAuthorDevice() throws {
        let victim = try makeIdentity(seed: 6)
        let attacker = try makeIdentity(seed: 7)
        let forged = try SignedEnvelope.sign(baseEvent(author: victim), with: attacker)
        #expect(EnvelopeVerifier.verify(forged) == .failure(.authorNotDerivedFromKey))
    }

    @Test("기기 ID는 정직하고 사용자 ID만 남의 것이어도 거부한다")
    func rejectsForgedAuthorUser() throws {
        let victim = try makeIdentity(seed: 8)
        let attacker = try makeIdentity(seed: 9)
        let honest = try SignedEnvelope.sign(baseEvent(author: attacker), with: attacker)
        let swapped = SignedEnvelope(
            event: OperationalEvent(
                eventID: honest.event.eventID,
                daySession: honest.event.daySession,
                room: honest.event.room,
                authorUser: victim.userID.rawValue,
                authorDevice: honest.event.authorDevice,
                eventType: honest.event.eventType,
                revision: honest.event.revision,
                logicalOrder: honest.event.logicalOrder,
                payload: honest.event.payload
            ),
            authorSigningPublicKey: honest.authorSigningPublicKey,
            signature: honest.signature
        )
        // ID가 내용 digest를 덮으므로 결합 검사가 먼저 걸린다. 어느 쪽이든
        // 거부이며, 통과하는 경로가 없다는 것이 계약이다.
        #expect(EnvelopeVerifier.verify(swapped) == .failure(.eventIDNotBoundToAuthor))
    }

    @Test("다른 이벤트의 서명을 옮겨 붙일 수 없다")
    func rejectsTransplantedSignature() throws {
        let author = try makeIdentity(seed: 10)
        let first = try SignedEnvelope.sign(baseEvent(author: author, payload: "A"), with: author)
        let second = try SignedEnvelope.sign(baseEvent(author: author, payload: "B"), with: author)
        let spliced = SignedEnvelope(
            event: second.event,
            authorSigningPublicKey: second.authorSigningPublicKey,
            signature: first.signature
        )
        #expect(EnvelopeVerifier.verify(spliced) == .failure(.signatureInvalid))
    }

    @Test("공개키 형식이 아니면 거부한다")
    func rejectsMalformedKey() throws {
        let author = try makeIdentity(seed: 11)
        let envelope = try SignedEnvelope.sign(baseEvent(author: author), with: author)
        let broken = SignedEnvelope(
            event: envelope.event,
            authorSigningPublicKey: Data([0x01, 0x02]),
            signature: envelope.signature
        )
        #expect(EnvelopeVerifier.verify(broken) == .failure(.malformedKey))
    }

    @Test("대리 전파를 막으면 남의 이벤트를 넘겨받지 않는다")
    func optionalRelayRestriction() throws {
        let author = try makeIdentity(seed: 12)
        let relay = try makeIdentity(seed: 13)
        let envelope = try SignedEnvelope.sign(baseEvent(author: author), with: author)

        #expect(
            EnvelopeVerifier.verify(envelope, expectedAuthorDevice: relay.deviceID)
                == .failure(.relayedByUnexpectedPeer)
        )
        // 기본값은 대리 전파 허용이다. MVP 복제가 남의 이벤트를 날라야 한다.
        #expect((try? EnvelopeVerifier.verify(envelope).get()) != nil)
    }

    @Test("정규 인코딩은 필드 경계를 바이트에 담는다")
    func canonicalEncodingIsUnambiguous() {
        var joined = CanonicalWriter(domain: "T")
        joined.append("AB")
        joined.append("C")
        var split = CanonicalWriter(domain: "T")
        split.append("A")
        split.append("BC")
        // 길이 접두어가 없으면 두 값이 같은 바이트가 되고, 한 필드 경계에서
        // 만든 서명이 다른 경계에서도 유효해진다.
        #expect(joined.data != split.data)
    }

    @Test("도메인 라벨이 다르면 같은 내용도 다른 바이트가 된다")
    func domainSeparationChangesBytes() {
        var first = CanonicalWriter(domain: SP04Protocol.eventDomain)
        first.append("X")
        var second = CanonicalWriter(domain: SP04Protocol.handshakeDomain)
        second.append("X")
        #expect(first.data != second.data)
    }
}
