import CryptoKit
import Foundation

/// 기기 키 보관 후보와 그 결과.
///
/// `POL-03-R-02`는 "기기 키 교환·회전과 지원 네트워크 판정 방식은 출시 전 보안
/// 스파이크에서 확정한다"고 정했다. 이 표가 그 비교의 정본이며, 실제로 관측한
/// 환경 결과(``KeyCustodyEnvironmentReport``)와 함께 읽어야 한다.
///
/// 값을 코드에 두는 이유는 문서와 시험이 갈라지지 않게 하기 위해서다. 후보를
/// 추가하면 회귀 테스트가 곧바로 "권고안이 정확히 하나인가"를 다시 확인한다.
public struct KeyCustodyOption: Hashable, Sendable, Identifiable {
    public enum Curve: String, Sendable {
        /// Curve25519(Ed25519 서명 + X25519 키 합의).
        case curve25519
        /// NIST P-256(ECDSA 서명 + ECDH 키 합의).
        case p256
    }

    /// 개인키가 프로세스 메모리로 나올 수 있는가.
    public enum Extractability: String, Sendable {
        /// 잠금 해제된 상태에서 앱이 raw 개인키를 읽을 수 있다.
        case extractableByOwningApp
        /// 하드웨어 밖으로 나오지 않는다. 연산만 위임한다.
        case nonExtractable
    }

    public let id: String
    public let curve: Curve
    public let extractability: Extractability
    /// 키 수명의 상한을 정하는 것.
    public let lifetime: String
    /// Keychain·Secure Enclave 경계에서 실제로 요구하는 것.
    public let custodyBoundary: String
    /// 회전 절차.
    public let rotation: String
    /// 재설치·기기 교체에서 일어나는 일.
    public let reinstall: String
    /// 이 후보를 고르면 감수해야 하는 것.
    public let cost: String
    /// 구현 전제. 하나라도 성립하지 않으면 이 후보는 선택지가 아니다.
    public let requires: [String]

    public init(
        id: String,
        curve: Curve,
        extractability: Extractability,
        lifetime: String,
        custodyBoundary: String,
        rotation: String,
        reinstall: String,
        cost: String,
        requires: [String]
    ) {
        self.id = id
        self.curve = curve
        self.extractability = extractability
        self.lifetime = lifetime
        self.custodyBoundary = custodyBoundary
        self.rotation = rotation
        self.reinstall = reinstall
        self.cost = cost
        self.requires = requires
    }
}

public enum KeyCustodyCatalog {
    /// 권고안. `sp04-probe`와 회귀 테스트가 이 값을 함께 확인한다.
    public static let recommendedOptionID = "B-curve25519-keychain"

    public static let options: [KeyCustodyOption] = [
        KeyCustodyOption(
            id: "A-secure-enclave-p256",
            curve: .p256,
            extractability: .nonExtractable,
            lifetime: "기기 수명. 키가 Secure Enclave 밖으로 나오지 않으므로 백업·이전이 없다",
            custodyBoundary: "SecureEnclave.P256.*.PrivateKey. Keychain에는 dataRepresentation(래핑된 blob)만 둔다",
            rotation: "새 SE 키를 만들고 이전 키로 전이 서명을 남긴다. 이전 키는 즉시 폐기",
            reinstall: "SE 키 자체는 남길 수 있으나 앱이 blob을 잃으면 복구 불가 → 새 사용자",
            cost: "Ed25519·X25519를 쓸 수 없다. 서명은 ECDSA-P256, 합의는 ECDH-P256으로 고정된다. Intel Mac과 SE 없는 환경에서 전면 실패한다",
            requires: [
                "SecureEnclave.isAvailable == true",
                "Apple Silicon 또는 T2 이상",
                "code signing + keychain-access-group 자격"
            ]
        ),
        KeyCustodyOption(
            id: "B-curve25519-keychain",
            curve: .curve25519,
            extractability: .extractableByOwningApp,
            lifetime: "기기 수명. 사용자가 앱 데이터를 지우거나 회전할 때까지",
            custodyBoundary: "kSecClassGenericPassword + kSecUseDataProtectionKeychain + kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly",
            rotation: "새 Curve25519 키를 만들고 이전 키로 서명한 전이 record를 전파한다. 기기 ID가 바뀌므로 Peer 목록이 새 항목으로 인식한다",
            reinstall: "Keychain 항목이 앱과 함께 지워지면 새 키 → 기기 ID·사용자 ID가 모두 바뀌고 POL-03-R-02대로 새 사용자",
            cost: "잠금 해제된 상태에서 같은 자격의 프로세스는 raw 개인키를 읽을 수 있다. 이 위험은 POL-03-R-06의 '잠금 해제된 Mac' 경계와 같다",
            requires: [
                "code signing + keychain-access-group 자격",
                "iCloud Keychain 동기화 제외(ThisDeviceOnly)"
            ]
        ),
        KeyCustodyOption(
            id: "C-hybrid-se-wrapped-storage-key",
            curve: .curve25519,
            extractability: .extractableByOwningApp,
            lifetime: "신원 키는 B와 같고, 로컬 저장 키(DEK)만 SE 키로 감싼다",
            custodyBoundary: "신원 키는 Keychain, DEK는 SE ECDH로 유도한 KEK로 봉인해 파일 옆에 둔다",
            rotation: "DEK 회전은 재봉인만으로 끝나고 신원 키 회전과 분리된다",
            reinstall: "SE 키를 잃으면 저장 데이터 복호화 불가 → 로컬 데이터 전부 소실. 보존 계약상 허용되지만 사용자에게 보여야 한다",
            cost: "경계가 둘로 늘고 실패 모드가 곱해진다. Keychain은 되는데 SE가 안 되는 환경에서 부분 실패한다",
            requires: [
                "SecureEnclave.isAvailable == true",
                "code signing + keychain-access-group 자격"
            ]
        ),
        KeyCustodyOption(
            id: "D-file-with-passphrase",
            curve: .curve25519,
            extractability: .extractableByOwningApp,
            lifetime: "파일 수명",
            custodyBoundary: "없음 — 앱 지원 디렉터리의 파일",
            rotation: "파일 교체",
            reinstall: "파일이 남으면 신원이 유지된다",
            cost: "POL-03-R-04의 '암호화 키는 데이터 파일과 분리해 Keychain에서 관리한다'를 직접 위반한다. 비교 대상으로만 남긴다",
            requires: []
        )
    ]

    public static func option(id: String) -> KeyCustodyOption? {
        options.first { $0.id == id }
    }

    public static var recommended: KeyCustodyOption {
        // 권고안이 목록에서 사라지면 이 도구는 결론 없이 통과해서는 안 된다.
        guard let option = option(id: recommendedOptionID) else {
            preconditionFailure("권고 후보 \(recommendedOptionID)가 목록에 없습니다.")
        }
        return option
    }
}

/// 실제 환경에서 관측한 키 보관 가능 여부.
///
/// **추정하지 않는다.** 각 항목은 실제 API를 호출한 결과이며, 실패는 실패대로
/// 남긴다. 서명되지 않은 SwiftPM 실행 파일에서 Keychain 쓰기가 막히는 것은
/// 환경 잡음이 아니라 "앱이 어떤 자격으로 서명돼야 하는가"라는 결론의 입력이다.
public struct KeyCustodyEnvironmentReport: Sendable {
    public struct Observation: Sendable {
        public let name: String
        public let succeeded: Bool
        /// 실패 시 OSStatus 또는 오류 종류. 원문 메시지는 넣지 않는다.
        public let status: String?

        public init(name: String, succeeded: Bool, status: String?) {
            self.name = name
            self.succeeded = succeeded
            self.status = status
        }
    }

    public let secureEnclaveAvailable: Bool
    public let observations: [Observation]

    public init(secureEnclaveAvailable: Bool, observations: [Observation]) {
        self.secureEnclaveAvailable = secureEnclaveAvailable
        self.observations = observations
    }
}

public enum KeychainEnvironmentProbe {
    /// 실제 Keychain·Secure Enclave 동작을 한 번씩 시도한다.
    ///
    /// 만든 항목은 즉시 지운다. 남기면 다음 실행이 이전 실행의 상태를 본다.
    public static func run(service: String = "com.lunchtime.sp04.probe") -> KeyCustodyEnvironmentReport {
        var observations: [KeyCustodyEnvironmentReport.Observation] = []

        let seAvailable = SecureEnclave.isAvailable
        observations.append(
            .init(name: "SecureEnclave.isAvailable", succeeded: seAvailable, status: nil)
        )

        // 후보 A·C의 전제. 실패하면 두 후보 모두 선택지에서 빠진다.
        do {
            let key = try SecureEnclave.P256.Signing.PrivateKey()
            let signature = try key.signature(for: Data("sp04".utf8))
            let verified = key.publicKey.isValidSignature(signature, for: Data("sp04".utf8))
            observations.append(
                .init(name: "SecureEnclave.P256 서명 생성·검증", succeeded: verified, status: nil)
            )
        } catch {
            observations.append(
                .init(
                    name: "SecureEnclave.P256 서명 생성·검증",
                    succeeded: false,
                    status: describe(error)
                )
            )
        }

        // 후보 B의 전제.
        let store = KeychainSecretStore(service: service)
        let entropy = DeterministicEntropy(seed: 0)
        let material = InstallationMaterial(
            signingSeed: entropy.bytes(32),
            storageKey: entropy.bytes(32),
            storageIndexKey: entropy.bytes(32)
        )
        let account = "sp04-probe-roundtrip"
        do {
            try store.store(material, account: account)
            let loaded = try store.load(account: account)
            try store.delete(account: account)
            observations.append(
                .init(
                    name: "data protection Keychain 왕복(ThisDeviceOnly)",
                    succeeded: loaded == material,
                    status: nil
                )
            )
        } catch {
            // 실패해도 남은 항목이 있으면 지운다.
            try? store.delete(account: account)
            observations.append(
                .init(
                    name: "data protection Keychain 왕복(ThisDeviceOnly)",
                    succeeded: false,
                    status: describe(error)
                )
            )
        }

        return KeyCustodyEnvironmentReport(
            secureEnclaveAvailable: seAvailable,
            observations: observations
        )
    }

    /// 오류를 진단 어휘로 접는다.
    ///
    /// `POL-02-R-07`이 진단에 "이벤트 ID, 상태 코드, 소요 시간과 익명화된 기기
    /// 식별자만" 허용하므로 `localizedDescription`을 그대로 쓰지 않는다. 그
    /// 문자열에는 Keychain 항목 이름과 경로가 들어갈 수 있다.
    static func describe(_ error: any Error) -> String {
        if let secretStoreError = error as? SecretStoreError {
            switch secretStoreError {
            case let .keychainFailure(operation, status):
                return "\(operation)=OSStatus \(status)"
            case .notFound:
                // account 이름을 넣지 않는다. 이 함수가 진단 접기의 정본이므로
                // 여기서 어휘 제한이 깨지면 모든 진단 경로가 함께 깨진다.
                return "notFound"
            case .malformedMaterial:
                return "malformedMaterial"
            }
        }
        let nsError = error as NSError
        return "\(nsError.domain)=\(nsError.code)"
    }
}
