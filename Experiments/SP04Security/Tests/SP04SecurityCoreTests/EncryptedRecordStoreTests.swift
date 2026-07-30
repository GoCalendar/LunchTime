import CryptoKit
import Foundation
import Testing

@testable import SP04SecurityCore

/// 로컬 저장 암호화 계약(`POL-03-R-04`).
@Suite("SP-04 로컬 저장 암호화")
struct EncryptedRecordStoreTests {
    private func makeMaterial(seed: UInt64) -> InstallationMaterial {
        let entropy = DeterministicEntropy(seed: seed)
        return InstallationMaterial(
            signingSeed: entropy.bytes(32),
            storageKey: entropy.bytes(32),
            storageIndexKey: entropy.bytes(32)
        )
    }

    private let records = [
        StoredRecord(id: "R1-menu", kind: .operationalEvent, body: Data("SP04-MENU-BODY".utf8)),
        StoredRecord(id: "R1-peer", kind: .peerEntry, body: Data("SP04-PEER-BODY".utf8))
    ]

    @Test("같은 키로 만든 저장소만 record를 복원한다")
    func roundTrip() throws {
        let store = EncryptedRecordStore(material: makeMaterial(seed: 1))
        let bytes = try store.encode(records)
        let decoded = try store.decode(bytes, candidateIDs: records.map(\.id))
        #expect(decoded == records)
    }

    @Test("파일 바이트에 평문 내용과 record ID가 남지 않는다")
    func fileHasNoPlaintext() throws {
        let store = EncryptedRecordStore(material: makeMaterial(seed: 2))
        let bytes = try store.encode(records)
        for record in records {
            #expect(!PlaintextScanner.contains(haystack: bytes, needle: record.body))
            // ID가 평문으로 남으면 파일만 복사한 쪽이 구조를 그대로 읽는다.
            #expect(!PlaintextScanner.contains(haystack: bytes, needle: Data(record.id.utf8)))
            #expect(
                !PlaintextScanner.contains(haystack: bytes, needle: Data(record.kind.rawValue.utf8))
            )
        }
    }

    @Test("다른 키로 열면 빈 저장소가 아니라 복호화 실패로 끝난다")
    func wrongKeyFailsLoudly() throws {
        let bytes = try EncryptedRecordStore(material: makeMaterial(seed: 3)).encode(records)
        let thief = EncryptedRecordStore(material: makeMaterial(seed: 4))
        #expect(throws: StoreFailure.decryptionFailed(atRecordIndex: 0)) {
            _ = try thief.decode(bytes, candidateIDs: self.records.map(\.id))
        }
    }

    @Test("파일 한 비트가 바뀌면 복호화가 실패한다")
    func tamperedFileFails() throws {
        let store = EncryptedRecordStore(material: makeMaterial(seed: 5))
        let bytes = try store.encode(records)
        // 헤더 뒤 첫 record의 색인 tag를 건드린다. AAD에 묶여 있으므로 실패한다.
        let tampered = Tamper.flipBit(bytes, atByte: 10)
        #expect(throws: StoreFailure.self) {
            _ = try store.decode(tampered, candidateIDs: self.records.map(\.id))
        }
    }

    @Test("형식이 다른 파일은 형식 오류로 거부한다")
    func unrecognizedFormat() throws {
        let store = EncryptedRecordStore(material: makeMaterial(seed: 6))
        #expect(throws: StoreFailure.unrecognizedFormat) {
            _ = try store.decode(Data("not a store".utf8), candidateIDs: [])
        }
    }

    @Test("잘린 파일은 잘렸다고 보고한다")
    func truncatedFile() throws {
        let store = EncryptedRecordStore(material: makeMaterial(seed: 7))
        let bytes = try store.encode(records)
        #expect(throws: StoreFailure.self) {
            _ = try store.decode(bytes.prefix(bytes.count - 8), candidateIDs: self.records.map(\.id))
        }
    }

    @Test("후보 ID를 주지 않으면 내용은 복원되지만 ID는 되돌아오지 않는다")
    func indexTagIsNotReversible() throws {
        let store = EncryptedRecordStore(material: makeMaterial(seed: 8))
        let bytes = try store.encode(records)
        let decoded = try store.decode(bytes, candidateIDs: [])
        #expect(decoded.count == records.count)
        #expect(decoded.map(\.body) == records.map(\.body))
        #expect(decoded.allSatisfy { $0.id.hasPrefix("unresolved-") })
    }

    @Test("같은 내용도 저장소마다 다른 바이트가 된다")
    func nonceIsScopedToInstallation() throws {
        let first = try EncryptedRecordStore(material: makeMaterial(seed: 9)).encode(records)
        let second = try EncryptedRecordStore(material: makeMaterial(seed: 10)).encode(records)
        #expect(first != second)
    }

    @Test("같은 record를 내용만 바꿔 다시 저장하면 nonce가 달라진다")
    func reencodeDoesNotReuseNonce() throws {
        let store = EncryptedRecordStore(material: makeMaterial(seed: 20))
        func file(_ body: String) throws -> Data {
            try store.encode([StoredRecord(id: "R1", kind: .operationalEvent, body: Data(body.utf8))])
        }
        // 닉네임 변경·revision 상승처럼 정상 동작에서 같은 record의 내용만 바뀐다.
        // nonce가 (id, 순번)만의 함수면 여기서 (키, nonce)가 재사용된다.
        let first = try file("SP04-BODY-AAAA")
        let second = try file("SP04-BODY-BBBB")
        let nonceStart = 13 + 64
        #expect(
            first.subdata(in: nonceStart..<(nonceStart + 12))
                != second.subdata(in: nonceStart..<(nonceStart + 12))
        )
        // 같은 내용이면 같은 바이트여야 증거를 재현할 수 있다.
        #expect(try file("SP04-BODY-AAAA") == first)
    }

    @Test("마지막 record를 잘라내면 조용히 사라지지 않는다")
    func detectsTailTruncation() throws {
        let store = EncryptedRecordStore(material: makeMaterial(seed: 21))
        let three = records + [StoredRecord(id: "R1-tomb", kind: .tombstone, body: Data("X".utf8))]
        let full = try store.encode(three)
        let shorter = try store.encode(records)
        let tail = full.count - shorter.count
        #expect(throws: StoreFailure.self) {
            _ = try store.decode(full.prefix(full.count - tail), candidateIDs: three.map(\.id))
        }
    }

    @Test("알 수 없는 종류 tag를 임의 기본값으로 접지 않는다")
    func unknownKindFailsLoudly() throws {
        let store = EncryptedRecordStore(material: makeMaterial(seed: 22))
        var bytes = [UInt8](try store.encode(records))
        // 첫 record의 kind tag(헤더 13 + indexTag 32 뒤 32바이트)를 뭉갠다.
        for offset in (13 + 32)..<(13 + 64) { bytes[offset] ^= 0xFF }
        #expect(throws: StoreFailure.self) {
            _ = try store.decode(Data(bytes), candidateIDs: self.records.map(\.id))
        }
    }

    @Test("채팅은 저장 가능한 종류에 없다")
    func chatIsNotStorable() {
        // `POL-03-R-04`는 채팅 본문을 프로세스 메모리에만 두라고 요구한다.
        // 표현 자체를 없애면 "여기서만 예외"라는 호출부가 생기지 않는다.
        #expect(!StoredRecordKind.allCases.contains { $0.rawValue.lowercased().contains("chat") })
    }

    @Test("키는 데이터 파일과 분리된 저장소에서만 나온다")
    func keyComesFromSecretStore() throws {
        let material = makeMaterial(seed: 11)
        let secretStore = InMemorySecretStore()
        try secretStore.store(material, account: "owner")

        let store = try EncryptedRecordStore(account: "owner", secretStore: secretStore)
        let bytes = try store.encode(records)

        try secretStore.delete(account: "owner")
        #expect(throws: SecretStoreError.notFound(account: "owner")) {
            _ = try EncryptedRecordStore(account: "owner", secretStore: secretStore)
        }
        // 파일은 그대로 남아 있지만 키가 없으면 아무것도 아니다.
        #expect(!bytes.isEmpty)
    }

    @Test("Keychain 직렬화는 소재 길이를 그대로 왕복한다")
    func keychainEncodingRoundTrips() {
        let material = makeMaterial(seed: 12)
        let encoded = KeychainSecretStore.encode(material)
        #expect(encoded.count == 96)
        #expect(KeychainSecretStore.decode(encoded) == material)
        #expect(KeychainSecretStore.decode(encoded.prefix(95)) == nil)
    }
}
