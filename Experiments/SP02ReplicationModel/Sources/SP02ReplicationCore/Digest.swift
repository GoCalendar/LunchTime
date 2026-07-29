import CryptoKit
import Foundation

/// 결정적 digest 계산.
///
/// projection hash는 "같은 이벤트 집합이 같은 결과로 수렴했다"를 증명하는
/// 유일한 기계 증거다. `Hasher` 같은 실행마다 seed가 바뀌는 해시를 쓰면 두 번의
/// 실행 결과를 비교할 수 없으므로 SHA-256을 고정해서 쓴다.
enum Digest {
    static func hex(of text: String) -> String {
        SHA256.hash(data: Data(text.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}
