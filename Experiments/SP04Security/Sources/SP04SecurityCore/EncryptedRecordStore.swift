import CryptoKit
import Foundation

/// 로컬에 저장할 수 있는 record 종류(`POL-03-R-04`).
///
/// 채팅이 목록에 **없다**. `POL-03-R-04`는 "채팅 본문은 복제·정합성·보존
/// 정책에 따라 프로세스 메모리에만 유지한다"고 정했으므로, 저장소 API가 채팅을
/// 아예 표현하지 못하게 한다. 런타임 검사로 두면 "여기서는 예외"라는 호출부가
/// 언젠가 생긴다.
public enum StoredRecordKind: String, Hashable, Sendable, CaseIterable {
    case operationalEvent
    case tombstone
    case peerEntry
    case reuseHistory
}

/// 저장소에 넣을 record 하나.
public struct StoredRecord: Hashable, Sendable {
    public let id: String
    public let kind: StoredRecordKind
    public let body: Data

    public init(id: String, kind: StoredRecordKind, body: Data) {
        self.id = id
        self.kind = kind
        self.body = body
    }
}

public enum StoreFailure: Error, Equatable {
    /// 파일이 이 형식이 아니다.
    case unrecognizedFormat
    /// 헤더 뒤 바이트가 잘렸거나 헤더가 선언한 record 수보다 적다.
    case truncated(atRecordIndex: Int)
    /// 알 수 없는 record 종류 tag다. 손상이거나 키가 다르다.
    ///
    /// 임의 기본값으로 접지 않는다. 접으면 다른 종류 record가 운영 이벤트로
    /// 보고되고 호출자가 그것을 정상 복원으로 처리한다.
    case unrecognizedRecordKind(atRecordIndex: Int)
    /// 복호화·무결성 검증 실패. 키가 다르거나 파일이 변조됐다.
    ///
    /// **빈 저장소로 접지 않는다.** 접으면 키를 잃은 상태가 "데이터가 없음"으로
    /// 보이고, 그 위에서 만들어진 새 데이터가 기존 데이터를 조용히 대체한다.
    case decryptionFailed(atRecordIndex: Int)
    case fileAccessFailed
}

/// 암호화된 로컬 저장소(`POL-03-R-04`).
///
/// 파일 형식은 이렇다.
///
/// ```text
/// magic "SP04ENC1"(8) | formatVersion(1) | recordCount(4, BE)
/// 반복: indexTag(32) | kindTag(32) | nonce(12) | length(4, BE) | ciphertext+tag
/// ```
///
/// `recordCount`가 헤더에 있고 **모든 record의 AAD에도 들어간다.** 없으면
/// 마지막 record부터 잘라내는 것이 검출되지 않는다 — 남은 record의 순번이
/// 그대로라 정상 파일로 열린다. 잘려 나간 것이 삭제 표식이면 삭제된 데이터가
/// 조용히 되살아난다.
///
/// **평문 식별자를 파일에 남기지 않는다.** record ID와 종류는 원문 대신 색인
/// 키로 만든 HMAC tag로 들어간다. 원문 ID를 그대로 두면 파일만 복사한 쪽이
/// 방·사용자·이벤트의 **구조**를 그대로 읽는다. 그 자체가 `POL-03-R-04`의
/// "구조화된 운영 이벤트 (…) 를 암호화해 저장한다"에 어긋난다. 결과적으로 파일
/// 사본에서 얻을 수 있는 것은 record 수와 각 record의 길이뿐이다.
///
/// 키는 값으로 받지 않고 ``SecretStore``에서 꺼낸다. 파일 옆에 키를 두는 구현이
/// 실수로 생기지 않게 하기 위해서다.
public struct EncryptedRecordStore: Sendable {
    static let magic = Data("SP04ENC1".utf8)
    static let formatVersion: UInt8 = 1

    private let dataKey: SymmetricKey
    private let indexKey: SymmetricKey

    public init(material: InstallationMaterial) {
        dataKey = SymmetricKey(data: material.storageKey)
        indexKey = SymmetricKey(data: material.storageIndexKey)
    }

    public init(account: String, secretStore: any SecretStore) throws {
        self.init(material: try secretStore.load(account: account))
    }

    /// record 목록을 파일 바이트로 만든다.
    ///
    /// nonce는 색인 tag와 record 순번에서 유도한다. 난수를 쓰면 같은 입력이
    /// 매번 다른 파일을 만들어 증거를 재현할 수 없고, 순번만 쓰면 두 저장소가
    /// 같은 (키, nonce)를 쓴다.
    public func encode(_ records: [StoredRecord]) throws -> Data {
        var output = Data()
        output.append(Self.magic)
        output.append(Self.formatVersion)
        output.append(contentsOf: withUnsafeBytes(of: UInt32(records.count).bigEndian, Array.init))

        for (index, record) in records.enumerated() {
            let indexTag = tag(for: record.id, domain: SP04Protocol.storeIndexDomain + "/id")
            let kindTag = tag(for: record.kind.rawValue, domain: SP04Protocol.storeIndexDomain + "/kind")
            let nonceBytes = derivedNonce(
                indexTag: indexTag, position: UInt64(index), body: record.body
            )
            let aad = additionalData(
                indexTag: indexTag,
                kindTag: kindTag,
                position: UInt64(index),
                recordCount: UInt64(records.count)
            )
            let sealed = try AES.GCM.seal(
                record.body,
                using: dataKey,
                nonce: try AES.GCM.Nonce(data: nonceBytes),
                authenticating: aad
            )
            let payload = sealed.ciphertext + sealed.tag

            output.append(indexTag)
            output.append(kindTag)
            output.append(nonceBytes)
            output.append(contentsOf: withUnsafeBytes(of: UInt32(payload.count).bigEndian, Array.init))
            output.append(payload)
        }
        return output
    }

    /// 파일 바이트에서 record를 복원한다.
    ///
    /// record ID와 종류는 tag에서 되돌릴 수 없으므로, 호출자가 **후보 목록**을
    /// 주면 tag를 다시 계산해 맞춘다. 이것이 색인 tag의 실제 사용법이다 —
    /// "무엇이 있는지 훑는" 용도가 아니라 "이것이 있는지 확인하는" 용도다.
    public func decode(_ data: Data, candidateIDs: [String]) throws -> [StoredRecord] {
        guard data.count >= Self.magic.count + 5,
              data.prefix(Self.magic.count) == Self.magic else {
            throw StoreFailure.unrecognizedFormat
        }
        guard data[data.startIndex + Self.magic.count] == Self.formatVersion else {
            throw StoreFailure.unrecognizedFormat
        }
        var declaredCount: UInt32 = 0
        for offset in 0..<4 {
            declaredCount = (declaredCount << 8)
                | UInt32(data[data.startIndex + Self.magic.count + 1 + offset])
        }

        var idByTag: [Data: String] = [:]
        for candidate in candidateIDs {
            idByTag[tag(for: candidate, domain: SP04Protocol.storeIndexDomain + "/id")] = candidate
        }
        var kindByTag: [Data: StoredRecordKind] = [:]
        for kind in StoredRecordKind.allCases {
            kindByTag[tag(for: kind.rawValue, domain: SP04Protocol.storeIndexDomain + "/kind")] = kind
        }

        var cursor = data.startIndex + Self.magic.count + 5
        var records: [StoredRecord] = []
        var position: UInt64 = 0

        while cursor < data.endIndex {
            func take(_ count: Int) throws -> Data {
                guard data.endIndex - cursor >= count else {
                    throw StoreFailure.truncated(atRecordIndex: records.count)
                }
                let slice = data.subdata(in: cursor..<(cursor + count))
                cursor += count
                return slice
            }

            let indexTag = try take(32)
            let kindTag = try take(32)
            let nonceBytes = try take(12)
            let lengthBytes = try take(4)
            var length: UInt32 = 0
            for byte in lengthBytes { length = (length << 8) | UInt32(byte) }
            let payload = try take(Int(length))

            guard payload.count > 16 else { throw StoreFailure.truncated(atRecordIndex: records.count) }
            let tagStart = payload.index(payload.endIndex, offsetBy: -16)
            let aad = additionalData(
                indexTag: indexTag,
                kindTag: kindTag,
                position: position,
                recordCount: UInt64(declaredCount)
            )
            guard let nonce = try? AES.GCM.Nonce(data: nonceBytes),
                  let box = try? AES.GCM.SealedBox(
                    nonce: nonce,
                    ciphertext: payload[payload.startIndex..<tagStart],
                    tag: payload[tagStart...]
                  ),
                  let body = try? AES.GCM.open(box, using: dataKey, authenticating: aad) else {
                throw StoreFailure.decryptionFailed(atRecordIndex: records.count)
            }

            guard let kind = kindByTag[kindTag] else {
                throw StoreFailure.unrecognizedRecordKind(atRecordIndex: records.count)
            }
            records.append(
                StoredRecord(
                    id: idByTag[indexTag] ?? Self.unresolvedID(position: position),
                    kind: kind,
                    body: body
                )
            )
            position += 1
        }
        guard records.count == Int(declaredCount) else {
            throw StoreFailure.truncated(atRecordIndex: records.count)
        }
        return records
    }

    /// 후보 목록에 없어 ID를 되돌리지 못한 record의 표시값.
    ///
    /// 실패로 처리하지 않는 이유는 이것이 정상 상태이기 때문이다. 색인 tag는
    /// 되돌릴 수 없도록 만든 값이므로 "모르는 record가 있다"는 그 설계의 결과다.
    static func unresolvedID(position: UInt64) -> String { "unresolved-\(position)" }

    private func tag(for value: String, domain: String) -> Data {
        var writer = CanonicalWriter(domain: domain)
        writer.append(value)
        return Data(HMAC<SHA256>.authenticationCode(for: writer.data, using: indexKey))
    }

    /// nonce는 색인 tag·순번과 **내용 digest**에서 유도한다.
    ///
    /// 내용을 빼면 nonce가 `(record.id, 순번)`만의 함수가 된다. 그러면 같은
    /// record를 내용만 바꿔 다시 저장할 때 — 닉네임 변경, revision 상승, 항목
    /// 추가처럼 **정상 동작**에서 — 같은 키·같은 nonce로 다른 평문이 봉인된다.
    /// 파일 두 벌만 있으면 평문 XOR이 복원되고, GCM에서는 인증 부분키까지 새어
    /// 임의 record 위조가 가능해진다.
    ///
    /// 내용이 같으면 nonce도 같은데, 그것은 같은 평문의 결정적 암호화이므로
    /// 안전하고 바이트 재현성도 유지한다.
    private func derivedNonce(indexTag: Data, position: UInt64, body: Data) -> Data {
        var writer = CanonicalWriter(domain: SP04Protocol.storeDomain + "/nonce")
        writer.append(indexTag)
        writer.append(position)
        writer.append(Data(SHA256.hash(data: body)))
        return Data(HMAC<SHA256>.authenticationCode(for: writer.data, using: indexKey)).prefix(12)
    }

    private func additionalData(
        indexTag: Data,
        kindTag: Data,
        position: UInt64,
        recordCount: UInt64
    ) -> Data {
        var writer = CanonicalWriter(domain: SP04Protocol.storeDomain + "/aad")
        writer.append(UInt64(Self.formatVersion))
        writer.append(recordCount)
        writer.append(indexTag)
        writer.append(kindTag)
        writer.append(position)
        return writer.data
    }
}

/// 저장소 파일을 실제 디스크에 쓰고 읽는 얇은 경계.
///
/// 파일 탈취 시나리오가 "파일만 복사한다"를 실제 파일 복사로 수행하기 위해
/// 둔다. 메모리 안에서만 시험하면 "파일에는 무엇이 남는가"를 답하지 못한다.
public struct StoreFile: Sendable {
    public let url: URL

    public init(url: URL) { self.url = url }

    public func write(_ data: Data) throws {
        do {
            try data.write(to: url, options: [.atomic])
        } catch {
            throw StoreFailure.fileAccessFailed
        }
    }

    public func read() throws -> Data {
        guard let data = try? Data(contentsOf: url) else { throw StoreFailure.fileAccessFailed }
        return data
    }

    /// 파일만 다른 위치로 복사한다. 키는 따라가지 않는다.
    public func copyBytes(to destination: URL) throws -> Data {
        let bytes = try read()
        do {
            try bytes.write(to: destination, options: [.atomic])
        } catch {
            throw StoreFailure.fileAccessFailed
        }
        return bytes
    }
}
