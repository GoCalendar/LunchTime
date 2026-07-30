import CryptoKit
import Foundation
import Testing

@testable import SP04SecurityCore

/// 기기·사용자 신원 계약(`POL-03-R-02`).
@Suite("SP-04 신원과 키 수명")
struct IdentityLifecycleTests {
    @Test("기기 ID와 사용자 ID는 서명 공개키에서 유도된다")
    func identifiersAreDerived() throws {
        let created = try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: 1), nickname: nil
        )
        let publicKey = Data(created.identity.signingKey.publicKey.rawRepresentation)
        #expect(created.identity.deviceID == DeviceID(signingPublicKey: publicKey))
        #expect(created.identity.userID == UserID(signingPublicKey: publicKey))
        #expect(created.identity.peerIdentity.identifiersMatchKey)
    }

    @Test("기기 ID와 사용자 ID는 도메인 분리로 서로 다른 값이 된다")
    func identifiersAreDistinct() throws {
        let created = try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: 2), nickname: nil
        )
        #expect(created.identity.deviceID.rawValue != created.identity.userID.rawValue)
    }

    @Test("저장된 소재로 복원하면 같은 신원이 나온다")
    func restoreKeepsIdentity() throws {
        let created = try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: 3), nickname: "이름"
        )
        let restored = try DeviceIdentity.restore(from: created.material, nickname: "다른이름")
        #expect(restored.deviceID == created.identity.deviceID)
        #expect(restored.userID == created.identity.userID)
    }

    @Test("소재 없는 재설치는 새 사용자다")
    func reinstallIsNewUser() throws {
        let first = try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: 4), nickname: nil
        )
        let second = try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: 5), nickname: nil
        )
        #expect(first.identity.userID != second.identity.userID)
        #expect(first.identity.deviceID != second.identity.deviceID)
    }

    @Test("닉네임 변경은 신원과 소유권을 바꾸지 않는다")
    func renameKeepsAuthority() throws {
        let created = try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: 6), nickname: "처음"
        )
        let renamed = created.identity.renamed(to: "나중")
        #expect(renamed.deviceID == created.identity.deviceID)
        #expect(renamed.userID == created.identity.userID)

        let event = OperationalEvent(
            eventID: "",
            daySession: "S1",
            room: "R1",
            authorUser: created.identity.userID.rawValue,
            authorDevice: created.identity.deviceID.rawValue,
            eventType: "menuRevision",
            revision: 1,
            logicalOrder: 10,
            payload: Data("SP04".utf8)
        )
        let before = try SignedEnvelope.sign(event, with: created.identity)
        let after = try SignedEnvelope.sign(event, with: renamed)
        // 닉네임은 서명 대상에 들어가지 않는다. 같은 이벤트는 같은 ID여야 한다.
        #expect(before.event.eventID == after.event.eventID)
    }

    @Test("전이 record는 옛 키의 서명일 때만 유효하다")
    func keyTransitionRequiresOldKey() throws {
        let previous = try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: 7), nickname: nil
        ).identity
        let next = try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: 8), nickname: nil
        ).identity
        let impostor = try DeviceIdentity.createInstallation(
            entropy: DeterministicEntropy(seed: 9), nickname: nil
        ).identity

        let issued = try KeyTransition.issue(from: previous, to: next, generation: 1)
        #expect(issued.isValid)
        // 세대 검사가 없으면 전이 record가 영구 재사용 가능한 값이 된다.
        #expect(issued.supersedes(current: 0))
        #expect(!issued.supersedes(current: 1))
        #expect(!issued.supersedes(current: 5))

        // 제3자가 남의 신원을 자기 키로 넘길 수 없다.
        let forged = KeyTransition(
            previousSigningPublicKey: Data(previous.signingKey.publicKey.rawRepresentation),
            nextSigningPublicKey: Data(next.signingKey.publicKey.rawRepresentation),
            generation: 1,
            signature: try impostor.signingKey.signature(
                for: KeyTransition.signedBytes(
                    previous: Data(previous.signingKey.publicKey.rawRepresentation),
                    next: Data(next.signingKey.publicKey.rawRepresentation),
                    generation: 1
                )
            )
        )
        #expect(!forged.isValid)

        // 세대만 바꿔치기해도 서명이 깨진다.
        let renumbered = KeyTransition(
            previousSigningPublicKey: issued.previousSigningPublicKey,
            nextSigningPublicKey: issued.nextSigningPublicKey,
            generation: 99,
            signature: issued.signature
        )
        #expect(!renumbered.isValid)
    }
}

/// 키 보관 후보 비교표(`POL-03-R-02`).
@Suite("SP-04 키 보관 후보")
struct KeyCustodyCatalogTests {
    @Test("후보 ID는 중복되지 않는다")
    func optionIDsAreUnique() {
        let ids = KeyCustodyCatalog.options.map(\.id)
        #expect(Set(ids).count == ids.count)
    }

    @Test("권고안은 목록 안에 정확히 하나 있다")
    func recommendationExists() {
        #expect(KeyCustodyCatalog.recommended.id == KeyCustodyCatalog.recommendedOptionID)
        #expect(
            KeyCustodyCatalog.options.filter { $0.id == KeyCustodyCatalog.recommendedOptionID }
                .count == 1
        )
    }

    @Test("모든 후보가 수명·보관·회전·재설치·대가를 채운다")
    func everyOptionIsComplete() {
        for option in KeyCustodyCatalog.options {
            #expect(!option.lifetime.isEmpty, "\(option.id) 수명 미기재")
            #expect(!option.custodyBoundary.isEmpty, "\(option.id) 보관 경계 미기재")
            #expect(!option.rotation.isEmpty, "\(option.id) 회전 미기재")
            #expect(!option.reinstall.isEmpty, "\(option.id) 재설치 미기재")
            #expect(!option.cost.isEmpty, "\(option.id) 대가 미기재")
        }
    }
}

/// 표현 계약(`POL-03-R-06`).
@Suite("SP-04 금지 표현과 방어하지 않는 위협")
struct SecurityClaimTests {
    @Test("금지 표현을 화면 문구에서 찾아낸다")
    func detectsProhibitedPhrases() {
        for claim in SecurityClaimPolicy.prohibited {
            for phrase in claim.phrases {
                let text = "이 화면은 \(phrase)를 제공합니다."
                #expect(
                    SecurityClaimPolicy.violations(in: text).contains(claim),
                    "\(claim.id)의 `\(phrase)`를 잡지 못했다"
                )
            }
        }
    }

    @Test("대문자와 자모 결합 표기에도 걸린다")
    func detectionIsNormalized() {
        #expect(!SecurityClaimPolicy.violations(in: "END-TO-END 암호화").isEmpty)
        #expect(
            !SecurityClaimPolicy.violations(
                in: "완전 삭제".decomposedStringWithCanonicalMapping
            ).isEmpty
        )
    }

    @Test("권장 문구는 금지 표현을 건드리지 않는다")
    func approvedPhrasingIsClean() {
        for phrase in SecurityClaimPolicy.approvedPhrasing {
            #expect(
                SecurityClaimPolicy.violations(in: phrase).isEmpty,
                "권장 문구가 금지 표현에 걸렸다: \(phrase)"
            )
        }
    }

    @Test("방어하지 않는 위협 목록은 중복 없이 근거를 갖는다")
    func undefendedListIsComplete() {
        let ids = SecurityClaimPolicy.undefended.map(\.id)
        #expect(Set(ids).count == ids.count)
        for threat in SecurityClaimPolicy.undefended {
            #expect(!threat.summary.isEmpty)
            #expect(threat.policyReference.hasPrefix("POL-"))
        }
        // `demonstrated`는 실제 시나리오가 재현한 것만 붙일 수 있다.
        #expect(SecurityClaimPolicy.undefended.contains { $0.coverage == .demonstrated })
        #expect(SecurityClaimPolicy.undefended.contains { $0.coverage == .outOfModelScope })
    }
}

/// 실패가 성공으로 표시되지 않는다(`PRD-01-FR-12`, `PRD-01-AC-08`).
@Suite("SP-04 실패 결과 매핑")
struct SyncOutcomeTests {
    @Test("모든 채널 실패는 확인 필요다")
    func channelFailuresNeedReview() {
        for failure in ChannelFailure.allCases {
            #expect(!SyncOutcome(channelFailure: failure).isApplied)
        }
    }

    @Test("모든 봉투 거부는 확인 필요다")
    func envelopeRejectionsNeedReview() {
        for rejection in EnvelopeRejection.allCases {
            #expect(SyncOutcome(envelopeRejection: rejection) == .needsReview(reason: .eventOriginRejected))
        }
    }

    @Test("모든 핸드셰이크 실패는 확인 필요다")
    func handshakeFailuresNeedReview() {
        let failures: [HandshakeFailure] = [
            .outOfSupportedScope(reason: .admissionProofInvalid),
            .outOfSupportedScope(reason: .admissionModeMismatch),
            .outOfSupportedScope(reason: .unsupportedProtocolVersion),
            .reflectedOwnIdentity,
            .signatureInvalid(role: .initiator),
            .signatureInvalid(role: .responder),
            .identifiersNotDerivedFromKey(role: .initiator),
            .identifiersNotDerivedFromKey(role: .responder),
            .malformedKey(role: .initiator),
            .malformedKey(role: .responder),
            .pinnedKeyMismatch(deviceID: "D-0"),
            .peerIdentityNotExpected(expected: "D-0", actual: "D-1"),
            .unexpectedMessage
        ]
        for failure in failures {
            #expect(!SyncOutcome(handshakeFailure: failure).isApplied)
        }
        // 범위 밖 Peer는 인증 실패와 다른 안내를 받아야 한다.
        #expect(
            SyncOutcome(handshakeFailure: .outOfSupportedScope(reason: .admissionProofInvalid))
                == .needsReview(reason: .peerOutOfSupportedScope)
        )
    }

    @Test("저장 실패는 빈 저장소가 아니라 확인 필요다")
    func storeFailuresNeedReview() {
        let failures: [StoreFailure] = [
            .unrecognizedFormat,
            .truncated(atRecordIndex: 0),
            .decryptionFailed(atRecordIndex: 3),
            .unrecognizedRecordKind(atRecordIndex: 1),
            .fileAccessFailed
        ]
        for failure in failures {
            #expect(
                SyncOutcome(storeFailure: failure) == .needsReview(reason: .localStorageUnreadable)
            )
        }
    }

    @Test("진단 기록에는 상태 코드와 익명 식별자만 남는다")
    func diagnosticsStayWithinVocabulary() {
        let record = DiagnosticRecord.from(
            outcome: SyncOutcome(channelFailure: .authenticationFailed),
            eventID: "E-abc",
            deviceID: DeviceID(claimed: "D-abc"),
            durationMilliseconds: 7
        )
        #expect(record.logLine == "status=needs-review:transportAuthenticationFailed event=E-abc device=D-abc ms=7")
        #expect(
            PlaintextScanner
                .exposedLabels(in: record.logLine, secrets: ScenarioFixture.secrets)
                .isEmpty
        )
    }
}
