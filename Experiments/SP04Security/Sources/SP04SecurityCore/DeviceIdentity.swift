import CryptoKit
import Foundation

/// 안정적인 기기 ID(`POL-03-R-02`).
///
/// 값을 임의로 정하지 않고 **정적 서명 공개키에서 유도**한다. 임의 문자열이면
/// 아무 Peer나 남의 기기 ID를 주장할 수 있고, `POL-03-R-02`가 요구하는
/// "공개키·사용자 ID·기기 ID의 연결"이 로컬 목록의 기억에만 의존하게 된다.
/// 유도값이면 그 주장을 검증할 수 있다 — 기기 ID는 공개키의 함수이므로,
/// 서명을 만들 수 있는 쪽만 그 ID를 정당하게 쓴다.
public struct DeviceID: Hashable, Sendable, CustomStringConvertible {
    public let rawValue: String

    /// 정적 서명 공개키에서 유도한다.
    ///
    /// 절단 폭은 32 hex = 128비트다. 처음에는 16 hex(64비트)였는데, 그러면
    /// 충돌 저항이 32비트에 불과해 아무나 두 개의 같은 기기 ID를 만들 수 있고
    /// 특정 피해자를 겨냥한 2차 원상도 64비트로 떨어진다. ``PeerDirectory``가
    /// 이 값을 키로 쓰므로 충돌은 곧 신원 혼선이다. 비용이 0에 가까우므로
    /// 이벤트 ID와 같은 128비트로 맞춘다.
    public init(signingPublicKey: Data) {
        var writer = CanonicalWriter(domain: SP04Protocol.deviceIDDomain)
        writer.append(signingPublicKey)
        rawValue = "D-" + writer.digest.fullHex.prefix(SP04Protocol.identifierHexLength)
    }

    /// 검증 없이 값만 감싸는 경로. 위조 시나리오가 "주장된 ID"를 만들 때 쓴다.
    public init(claimed rawValue: String) {
        self.rawValue = rawValue
    }

    public var description: String { rawValue }
}

/// 닉네임과 분리된 불투명 사용자 ID(`POL-03-R-02`).
///
/// MVP는 사용자 ID 하나를 설치·기기 하나에 연결하므로 이 값도 **기기 서명
/// 공개키에서** 유도한다. 결합하지 않으면 같은 사용자 ID를 주장하는 두 번째
/// 기기가 생기고,
/// [SP-02](../../../docs/technical/spikes/PRD-01-SP-02-replication-conflicts.md)의
/// 불변식 25가 막으려던 사칭 경로가 열린다.
///
/// 처음에는 설치별 salt를 섞어 유도했다. 그러면 **다른 Peer가 검증할 수 없다** —
/// salt는 그 기기만 알고, 검증자는 주장된 사용자 ID를 받아 적는 것 외에 할 수
/// 있는 것이 없다. 그 상태에서는 아무 Peer나 남의 사용자 ID를 자기 이벤트에
/// 실을 수 있고, `POL-03-R-02`가 사용자 ID를 "참여, 메뉴 소유권, 하루 한 Room과
/// 충돌 판정의 권한 주체"로 정했으므로 그것이 곧 권한 사칭이다.
///
/// 그래서 salt를 빼고 도메인 분리만 남겼다. MVP에서 사용자 ID와 기기 ID는 같은
/// 키의 두 표현이며 독립적인 정보를 담지 않는다. 여러 기기를 한 사용자로 묶는
/// 확장은 별도 결정이 필요하고, 그때 검증 방법도 함께 정해야 한다.
public struct UserID: Hashable, Sendable, CustomStringConvertible {
    public let rawValue: String

    public init(signingPublicKey: Data) {
        var writer = CanonicalWriter(domain: SP04Protocol.userIDDomain)
        writer.append(signingPublicKey)
        rawValue = "U-" + writer.digest.fullHex.prefix(SP04Protocol.identifierHexLength)
    }

    public init(claimed rawValue: String) {
        self.rawValue = rawValue
    }

    public var description: String { rawValue }
}

/// 다른 Peer에게 보이는 기기 신원.
///
/// 개인키가 없는 절반이며, 이 값만으로 서명 검증과 키 합의를 할 수 있다.
public struct PeerIdentity: Hashable, Sendable {
    public let deviceID: DeviceID
    public let userID: UserID
    /// Ed25519 정적 서명 공개키.
    public let signingPublicKey: Data
    /// 사용자가 정한 표시값. 권한·소유권 판정에 쓰지 않는다(`POL-03-R-02`).
    public let nickname: String?

    public init(deviceID: DeviceID, userID: UserID, signingPublicKey: Data, nickname: String?) {
        self.deviceID = deviceID
        self.userID = userID
        self.signingPublicKey = signingPublicKey
        self.nickname = nickname
    }

    /// 주장한 기기·사용자 ID가 실제로 그 공개키에서 유도됐는지 확인한다.
    ///
    /// 이 검사가 없으면 유도의 의미가 없다. 아무도 검증하지 않는 유도값은 임의
    /// 문자열과 같다.
    public var identifiersMatchKey: Bool {
        DeviceID(signingPublicKey: signingPublicKey) == deviceID
            && UserID(signingPublicKey: signingPublicKey) == userID
    }
}

/// 이 기기의 신원과 개인키.
///
/// 개인키는 값으로 들고 다니지 않고 ``SecretStore``에서 꺼낸 소재로 그때그때
/// 복원한다. `POL-03-R-04`가 "암호화 키는 데이터 파일과 분리해 Keychain에서
/// 관리한다"고 요구하므로, 모델도 키 소재의 출처를 한 곳으로 강제한다.
public struct DeviceIdentity: Sendable {
    public let signingKey: Curve25519.Signing.PrivateKey
    public let userID: UserID
    public let nickname: String?

    public var deviceID: DeviceID { DeviceID(signingPublicKey: Data(signingKey.publicKey.rawRepresentation)) }

    public var peerIdentity: PeerIdentity {
        PeerIdentity(
            deviceID: deviceID,
            userID: userID,
            signingPublicKey: Data(signingKey.publicKey.rawRepresentation),
            nickname: nickname
        )
    }

    public init(signingKey: Curve25519.Signing.PrivateKey, userID: UserID, nickname: String?) {
        self.signingKey = signingKey
        self.userID = userID
        self.nickname = nickname
    }

    /// 최초 실행에서 신원을 만든다(`POL-03-R-02`).
    ///
    /// 재설치는 새 키를 만들므로 기기 ID와 사용자 ID가 모두 바뀌고 **항상 새
    /// 사용자**가 된다. 이것은 부작용이 아니라 `POL-03-R-02`가 명시한 결과다.
    public static func createInstallation(
        entropy: any EntropySource,
        nickname: String?
    ) throws -> (identity: DeviceIdentity, material: InstallationMaterial) {
        let material = InstallationMaterial(
            signingSeed: entropy.bytes(32),
            storageKey: entropy.bytes(32),
            storageIndexKey: entropy.bytes(32)
        )
        return (try restore(from: material, nickname: nickname), material)
    }

    /// 저장된 소재에서 신원을 복원한다.
    public static func restore(
        from material: InstallationMaterial,
        nickname: String?
    ) throws -> DeviceIdentity {
        let signingKey = try Curve25519.Signing.PrivateKey(rawRepresentation: material.signingSeed)
        let userID = UserID(signingPublicKey: Data(signingKey.publicKey.rawRepresentation))
        return DeviceIdentity(signingKey: signingKey, userID: userID, nickname: nickname)
    }

    /// 닉네임만 바꾼 신원.
    ///
    /// `POL-03-R-02`는 "닉네임을 변경하면 표시 연결만 새 값으로 전파하고
    /// 사용자 ID, 참여, 메뉴, 권한과 히스토리 소유권은 그대로 유지한다"고
    /// 요구한다. 키와 ID를 건드리지 않는 것으로 그 계약을 타입에서 지킨다.
    public func renamed(to newNickname: String?) -> DeviceIdentity {
        DeviceIdentity(signingKey: signingKey, userID: userID, nickname: newNickname)
    }
}

/// Keychain에 들어가는 설치별 비밀 소재 전부.
///
/// 하나로 묶는 이유는 "무엇이 Keychain 경계 안에 있어야 하는가"를 한 곳에서
/// 셀 수 있게 하기 위해서다. 흩어져 있으면 새 키가 추가될 때 파일 옆에 남는
/// 항목이 생긴다.
public struct InstallationMaterial: Hashable, Sendable {
    /// Ed25519 정적 서명 개인키 소재. 기기 ID와 사용자 ID가 여기서 나온다.
    public let signingSeed: Data
    /// 로컬 저장 암호화 키(DEK).
    public let storageKey: Data
    /// 저장소 색인 키. record ID를 파일에 평문으로 남기지 않기 위해 쓴다.
    public let storageIndexKey: Data

    public init(signingSeed: Data, storageKey: Data, storageIndexKey: Data) {
        self.signingSeed = signingSeed
        self.storageKey = storageKey
        self.storageIndexKey = storageIndexKey
    }
}

/// 키 회전 전이 record.
///
/// `POL-03-R-02`는 "기기 키 교환·회전과 지원 네트워크 판정 방식은 출시 전 보안
/// 스파이크에서 확정한다"고만 정했고, 회전 뒤 **기존 소유권이 이어지는지**는
/// 정하지 않았다.
///
/// 문제는 이렇다. 기기 ID와 사용자 ID가 모두 서명 키에서 유도되므로, 키를
/// 회전하면 두 ID가 함께 바뀐다. 다른 Peer가 보기에 그것은 **새 설치와
/// 구분되지 않는다.** `POL-03-R-02`의 "기기 교체·재설치로 기존 식별 정보를
/// 잃으면 새 사용자로 취급한다"를 그대로 적용하면 회전은 곧 새 사용자다.
///
/// 이 record는 그 선택지를 열어 둔다. 옛 키가 새 공개키에 서명하면, 검증자는
/// "이 새 신원은 저 옛 신원이 스스로 넘긴 것"을 확인할 수 있다. **다만 이것을
/// 받아들일지는 제품 결정이다** — 받아들이면 옛 키를 훔친 공격자가 신원을 통째로
/// 이전할 수 있고, 받아들이지 않으면 회전이 곧 데이터 소유권 상실이다.
public struct KeyTransition: Hashable, Sendable {
    public let previousSigningPublicKey: Data
    public let nextSigningPublicKey: Data
    /// 단조 증가 세대 번호. 서명 대상에 들어간다.
    ///
    /// 없으면 전이 record가 **영구 재사용 가능한 값**이 된다. K1→K2→K3로 회전한
    /// 뒤 보관해 둔 K1→K2를 다시 제시하면, 전이를 수용하기로 한 검증자가
    /// 소유권을 이미 폐기된 K2로 되돌린다. 검증자는 현재 세대보다 큰 전이만
    /// 받아들여야 한다(``supersedes(current:)``).
    public let generation: UInt64
    /// 옛 키가 새 키에 남긴 서명.
    public let signature: Data

    public init(
        previousSigningPublicKey: Data,
        nextSigningPublicKey: Data,
        generation: UInt64,
        signature: Data
    ) {
        self.previousSigningPublicKey = previousSigningPublicKey
        self.nextSigningPublicKey = nextSigningPublicKey
        self.generation = generation
        self.signature = signature
    }

    static func signedBytes(previous: Data, next: Data, generation: UInt64) -> Data {
        var writer = CanonicalWriter(domain: "LunchTime/SP04/KeyTransition/v1")
        writer.append(previous)
        writer.append(next)
        writer.append(generation)
        return writer.data
    }

    /// 옛 신원이 새 신원으로의 전이를 서명한다.
    public static func issue(
        from previous: DeviceIdentity,
        to next: DeviceIdentity,
        generation: UInt64
    ) throws -> KeyTransition {
        let previousKey = Data(previous.signingKey.publicKey.rawRepresentation)
        let nextKey = Data(next.signingKey.publicKey.rawRepresentation)
        return KeyTransition(
            previousSigningPublicKey: previousKey,
            nextSigningPublicKey: nextKey,
            generation: generation,
            signature: try previous.signingKey.signature(
                for: signedBytes(previous: previousKey, next: nextKey, generation: generation)
            )
        )
    }

    public var isValid: Bool {
        guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: previousSigningPublicKey) else {
            return false
        }
        return key.isValidSignature(
            signature,
            for: Self.signedBytes(
                previous: previousSigningPublicKey,
                next: nextSigningPublicKey,
                generation: generation
            )
        )
    }

    /// 이 전이가 현재 세대를 이어받는가.
    ///
    /// 서명이 유효한 것만으로는 부족하다. 세대 검사를 빼면 재생·롤백이 그대로
    /// 통한다.
    public func supersedes(current generation: UInt64) -> Bool {
        isValid && self.generation > generation
    }
}

/// 이 모델이 쓰는 프로토콜 상수.
///
/// 도메인 분리 라벨을 한 곳에 모은다. 흩어지면 같은 키가 다른 목적의 바이트에
/// 서명하는 것을 막는 경계가 조용히 사라진다.
public enum SP04Protocol {
    public static let version: UInt64 = 1
    public static let label = "LunchTime/SP04"

    /// 유도 식별자의 16진 절단 길이(32 hex = 128비트).
    ///
    /// 기기 ID·사용자 ID·이벤트 ID가 같은 값을 쓴다. 서로 다른 폭을 쓰면
    /// "왜 이쪽만 좁은가"에 답할 수 없고, 좁은 쪽이 조용히 약한 고리가 된다.
    public static let identifierHexLength = 32

    public static let deviceIDDomain = "LunchTime/SP04/DeviceID/v1"
    public static let userIDDomain = "LunchTime/SP04/UserID/v1"
    public static let handshakeDomain = "LunchTime/SP04/Handshake/v1"
    public static let eventDomain = "LunchTime/SP04/Event/v1"
    public static let eventIDDomain = "LunchTime/SP04/EventID/v1"
    public static let frameDomain = "LunchTime/SP04/Frame/v1"
    public static let storeDomain = "LunchTime/SP04/Store/v1"
    public static let storeIndexDomain = "LunchTime/SP04/StoreIndex/v1"
    public static let beaconDomain = "LunchTime/SP04/Beacon/v1"
    public static let admissionProofDomain = "LunchTime/SP04/AdmissionProof/v1"
}
