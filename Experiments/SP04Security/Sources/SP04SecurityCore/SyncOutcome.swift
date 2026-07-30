import Foundation

/// 동기화 시도 하나의 결과(`PRD-01-FR-12`, `PRD-01-AC-08`).
///
/// > 인증·무결성 또는 복호화에 실패한 데이터는 적용하거나 성공 동기화로
/// > 표시하지 않고 `확인 필요`와 안내를 제공합니다.
///
/// 이 타입의 목적은 **`applied`로 가는 경로를 하나로 좁히는 것**이다. 실패를
/// `Bool`이나 optional로 표현하면 "실패했지만 계속 진행"이 표현 가능해지고,
/// 그 상태가 화면에서 성공으로 보인다.
public enum SyncOutcome: Equatable, Sendable {
    /// 검증을 모두 통과해 적용됐다.
    case applied(eventID: String)
    /// 적용하지 않았다. 사용자에게 `확인 필요`로 보인다.
    case needsReview(reason: NeedsReviewReason)

    public var isApplied: Bool {
        if case .applied = self { return true }
        return false
    }

    /// `확인 필요`의 이유.
    ///
    /// 화면 문구를 이 값에서 만든다. 이유를 하나로 뭉개면 `PRD-01-FR-12`가
    /// 요구한 "안내"를 실패 종류에 맞게 줄 수 없다.
    public enum NeedsReviewReason: String, Equatable, Sendable, CaseIterable {
        /// 지원 네트워크 밖 Peer다.
        case peerOutOfSupportedScope
        /// 핸드셰이크 인증에 실패했다.
        case peerAuthenticationFailed
        /// 채널 frame 인증·복호화에 실패했다.
        case transportAuthenticationFailed
        /// 재전송된 frame이다.
        case replayRejected
        /// 이벤트 서명·작성자 결합 검증에 실패했다.
        case eventOriginRejected
        /// 로컬 저장 복호화에 실패했다.
        case localStorageUnreadable
    }
}

extension SyncOutcome {
    /// 핸드셰이크 실패를 결과로 접는다.
    ///
    /// `switch`가 모든 case를 나열하므로 새 실패 종류를 추가하면 여기서
    /// 컴파일이 멈춘다. 기본 case를 두면 새 실패가 조용히 성공 쪽으로 새거나
    /// 잘못된 안내를 받는다.
    public init(handshakeFailure: HandshakeFailure) {
        switch handshakeFailure {
        case .outOfSupportedScope:
            self = .needsReview(reason: .peerOutOfSupportedScope)
        case .signatureInvalid, .identifiersNotDerivedFromKey, .malformedKey,
             .pinnedKeyMismatch, .peerIdentityNotExpected, .reflectedOwnIdentity,
             .unexpectedMessage:
            self = .needsReview(reason: .peerAuthenticationFailed)
        }
    }

    public init(channelFailure: ChannelFailure) {
        switch channelFailure {
        case .replayDetected:
            self = .needsReview(reason: .replayRejected)
        case .authenticationFailed, .directionMismatch, .malformedFrame,
             .unsupportedVersion, .sequenceExhausted:
            self = .needsReview(reason: .transportAuthenticationFailed)
        }
    }

    public init(envelopeRejection: EnvelopeRejection) {
        switch envelopeRejection {
        case .signatureInvalid, .eventIDNotBoundToAuthor, .authorNotDerivedFromKey,
             .malformedKey, .relayedByUnexpectedPeer:
            self = .needsReview(reason: .eventOriginRejected)
        }
    }

    public init(storeFailure: StoreFailure) {
        switch storeFailure {
        case .decryptionFailed, .unrecognizedFormat, .truncated,
             .unrecognizedRecordKind, .fileAccessFailed:
            self = .needsReview(reason: .localStorageUnreadable)
        }
    }
}
