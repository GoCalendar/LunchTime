import CryptoKit
import Foundation

/// 서명·AAD·transcript가 공유하는 정규 바이트 인코딩.
///
/// 서명이 덮는 바이트가 **한 가지 방법으로만** 만들어지지 않으면, 서로 다른
/// 필드 조합이 같은 바이트로 접히는 순간 서명이 다른 의미로 재사용된다.
/// 예를 들어 `"AB" + "C"`와 `"A" + "BC"`가 같은 바이트가 되면, 한 필드
/// 경계에서 서명한 값이 다른 경계에서도 유효하다.
///
/// 그래서 모든 필드는 **길이 접두어**와 함께 들어간다. 길이가 앞에 있으면
/// 필드 경계가 바이트 열 자체에 담기므로 이 혼동이 구조적으로 불가능하다.
public struct CanonicalWriter: Sendable {
    private var buffer = Data()

    public init() {}

    /// 도메인 분리 라벨. 같은 키로 다른 목적의 바이트에 서명하는 것을 막는다.
    public init(domain: String) {
        self.init()
        append(domain)
    }

    public mutating func append(_ value: Data) {
        // 길이는 8바이트 big-endian 고정이다. 가변 길이 인코딩을 쓰면 그 자체가
        // 다시 모호해질 수 있다.
        buffer.append(contentsOf: withUnsafeBytes(of: UInt64(value.count).bigEndian, Array.init))
        buffer.append(value)
    }

    public mutating func append(_ value: String) {
        // 유니코드 정규 동등성 때문에 `==`로 같은 두 문자열이 서로 다른 UTF-8
        // 바이트를 가질 수 있다. envelope 계약(`EventIdentifiers`)과 같은 이유로
        // NFC로 고정한다.
        append(Data(value.precomposedStringWithCanonicalMapping.utf8))
    }

    public mutating func append(_ value: UInt64) {
        append(Data(withUnsafeBytes(of: value.bigEndian, Array.init)))
    }

    public mutating func append(_ value: UInt8) {
        append(Data([value]))
    }

    /// 선택 필드. 존재 여부 자체를 바이트에 담아 `nil`과 빈 값을 구분한다.
    public mutating func appendOptional(_ value: String?) {
        if let value {
            append(UInt8(1))
            append(value)
        } else {
            append(UInt8(0))
        }
    }

    public var data: Data { buffer }

    /// 지금까지 쓴 바이트의 SHA-256.
    public var digest: Data { Data(SHA256.hash(data: buffer)) }
}

extension Data {
    /// 진단·출력용 짧은 16진 표현.
    ///
    /// 전체 값을 쓰지 않는 이유는 [POL-02-R-07]이 진단 어휘를 제한하기
    /// 때문이다. 사람이 두 실행을 대조할 수 있는 최소 길이만 남긴다.
    public func shortHexDigest(length: Int = 12) -> String {
        Data(SHA256.hash(data: self)).map { String(format: "%02x", $0) }.joined().prefix(length).description
    }

    var fullHex: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
