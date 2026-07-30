import CryptoKit
import Foundation

/// 비밀 소재 저장 경계(`POL-03-R-02`, `POL-03-R-04`).
///
/// "개인키와 로컬 데이터 암호화 키는 macOS Keychain에 저장하고 내보내기 가능한
/// 설정 파일이나 소스 코드에 넣지 않는다"는 규칙을 타입으로 강제한다.
/// ``EncryptedRecordStore``는 키를 직접 받지 않고 이 protocol로만 얻으므로,
/// 파일 옆에 키를 두는 구현을 넣으려면 이 경계를 명시적으로 바꿔야 한다.
public protocol SecretStore: AnyObject {
    func store(_ material: InstallationMaterial, account: String) throws
    func load(account: String) throws -> InstallationMaterial
    func delete(account: String) throws
    var backing: SecretStoreBacking { get }
}

/// 저장 구현 종류. 출력에 그대로 들어가 "무엇으로 검증했는가"를 남긴다.
public enum SecretStoreBacking: String, Sendable {
    /// 프로세스 메모리. 결정적 시나리오 전용이며 Keychain 경계를 검증하지 않는다.
    case inMemory
    /// 실제 macOS data protection Keychain.
    case keychain
}

public enum SecretStoreError: Error, Equatable {
    case notFound(account: String)
    /// 실제 Keychain API가 낸 OSStatus. 값을 그대로 남겨야 환경 문제와 계약
    /// 위반을 구분할 수 있다.
    case keychainFailure(operation: String, status: Int32)
    case malformedMaterial(account: String)
}

/// 결정적 시나리오용 메모리 저장소.
///
/// **Keychain 경계를 검증하지 않는다.** 이 저장소로 통과한 시나리오는
/// "키가 데이터 파일과 분리돼 있다"는 구조만 확인하며, 잠금·접근 제어·
/// 다른 앱의 읽기 가능 여부는 확인하지 않는다.
public final class InMemorySecretStore: SecretStore, @unchecked Sendable {
    private var items: [String: InstallationMaterial] = [:]
    private let lock = NSLock()

    public init() {}

    public let backing = SecretStoreBacking.inMemory

    public func store(_ material: InstallationMaterial, account: String) throws {
        lock.lock()
        defer { lock.unlock() }
        items[account] = material
    }

    public func load(account: String) throws -> InstallationMaterial {
        lock.lock()
        defer { lock.unlock() }
        guard let material = items[account] else { throw SecretStoreError.notFound(account: account) }
        return material
    }

    public func delete(account: String) throws {
        lock.lock()
        defer { lock.unlock() }
        items[account] = nil
    }
}

/// 실제 macOS Keychain 저장소.
///
/// `kSecUseDataProtectionKeychain`을 켜서 file-based legacy keychain이 아니라
/// data protection keychain을 쓴다. 접근성은
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`다.
///
/// - `ThisDeviceOnly`: iCloud Keychain 동기화와 백업 복원 대상에서 제외한다.
///   `POL-03-R-02`가 "MVP는 사용자 ID 하나를 설치·기기 하나에 연결"한다고
///   정했으므로, 키가 다른 기기로 따라가면 그 계약이 무너진다.
/// - `AfterFirstUnlock`: 앱이 로그인 이후 백그라운드에서도 동기화해야 하므로
///   `WhenUnlocked`보다 넓다. 잠긴 화면에서의 열람 위험은 `POL-03-R-06`이
///   이미 경계 밖으로 선언한 "잠금 해제된 Mac"과 같은 범주다.
///
/// > 이 구현은 **code signing과 keychain-access-group 자격이 있는 프로세스**를
/// > 전제한다. 서명되지 않은 SwiftPM 실행 파일에서는 실패할 수 있으며, 그
/// > 실패 자체가 이 스파이크의 관측 대상이다(``KeychainEnvironmentProbe``).
public final class KeychainSecretStore: SecretStore, @unchecked Sendable {
    private let service: String

    public init(service: String) {
        self.service = service
    }

    public let backing = SecretStoreBacking.keychain

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseDataProtectionKeychain as String: true
        ]
    }

    public func store(_ material: InstallationMaterial, account: String) throws {
        try? delete(account: account)
        var query = baseQuery(account: account)
        query[kSecValueData as String] = Self.encode(material)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw SecretStoreError.keychainFailure(operation: "SecItemAdd", status: status)
        }
    }

    public func load(account: String) throws -> InstallationMaterial {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { throw SecretStoreError.notFound(account: account) }
        guard status == errSecSuccess, let data = result as? Data else {
            throw SecretStoreError.keychainFailure(operation: "SecItemCopyMatching", status: status)
        }
        guard let material = Self.decode(data) else {
            throw SecretStoreError.malformedMaterial(account: account)
        }
        return material
    }

    public func delete(account: String) throws {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SecretStoreError.keychainFailure(operation: "SecItemDelete", status: status)
        }
    }

    /// 세 소재를 고정 길이로 이어 붙인다.
    ///
    /// JSON을 쓰지 않는 이유는 키 소재가 base64 문자열로 한 번 더 복사되면서
    /// 해제 시점이 불분명한 임시 버퍼가 늘어나기 때문이다.
    static func encode(_ material: InstallationMaterial) -> Data {
        var data = Data()
        data.append(material.signingSeed)
        data.append(material.storageKey)
        data.append(material.storageIndexKey)
        return data
    }

    static func decode(_ data: Data) -> InstallationMaterial? {
        guard data.count == 96 else { return nil }
        let bytes = Data(data)
        return InstallationMaterial(
            signingSeed: bytes.subdata(in: 0..<32),
            storageKey: bytes.subdata(in: 32..<64),
            storageIndexKey: bytes.subdata(in: 64..<96)
        )
    }
}
