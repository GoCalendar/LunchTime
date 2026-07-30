import CryptoKit
import Foundation

/// 이 모델이 난수를 얻는 경로.
///
/// 실험은 두 가지를 동시에 만족해야 한다.
///
/// - 캡처한 wire 바이트와 파일 바이트를 **다시 만들 수 있어야** 한다. 증거로
///   남긴 판정을 리뷰어가 같은 입력에서 재현하지 못하면 근거가 되지 못한다.
/// - 그런데도 검증 대상은 **실제 암호 연산**이어야 한다. 판정을 흉내내면
///   "무엇이 막혔는가"가 증거가 되지 못한다.
///
/// 그래서 CryptoKit 연산은 그대로 쓰되, 키·nonce·challenge의 바이트만 seed에서
/// 유도한다.
///
/// > 중요: 이것은 **모델 전용 장치**다. 제품 구현이 같은 방식을 쓰면 seed를 아는
/// > 공격자가 모든 세션 키를 재현한다. 실제 앱은 `SystemEntropy`만 쓴다.
/// > `sp04-probe --system-entropy`가 같은 시나리오를 시스템 CSPRNG에서 실행해
/// > 판정이 seed와 무관함을 확인한다.
public protocol EntropySource: AnyObject, Sendable {
    /// `count` 바이트를 만든다.
    func bytes(_ count: Int) -> Data
    /// 사람이 읽을 출처 표시. 보고서와 JSON 출력에 그대로 들어간다.
    var label: String { get }
}

extension EntropySource {
    /// 32바이트 대칭 키 소재.
    func symmetricKey() -> SymmetricKey { SymmetricKey(data: bytes(32)) }
}

/// 시스템 CSPRNG. 제품 구현이 써야 하는 유일한 경로다.
public final class SystemEntropy: EntropySource, @unchecked Sendable {
    public init() {}

    public let label = "system"

    public func bytes(_ count: Int) -> Data {
        var buffer = Data(count: count)
        // SecRandomCopyBytes 실패는 시스템 CSPRNG 고장이며 복구 대상이 아니다.
        // 실패를 조용히 약한 난수로 대체하면 그 순간부터 모든 결론이 무효다.
        let status = buffer.withUnsafeMutableBytes { raw -> Int32 in
            guard let base = raw.baseAddress else { return errSecParam }
            return SecRandomCopyBytes(kSecRandomDefault, count, base)
        }
        precondition(status == errSecSuccess, "시스템 난수 생성에 실패했습니다: \(status)")
        return buffer
    }
}

/// seed에서 유도하는 결정적 바이트 열.
///
/// SHA-256 counter 모드다. 상태는 `seed`와 단조 증가 counter뿐이므로 같은
/// seed·같은 호출 순서면 항상 같은 바이트가 나온다.
///
/// 호출 **순서**가 값을 정하므로, 시나리오가 키를 만드는 순서를 바꾸면 이후
/// 모든 바이트가 달라진다. 그래서 각 시나리오는 자기 전용 인스턴스를 받는다.
public final class DeterministicEntropy: EntropySource, @unchecked Sendable {
    private let seed: UInt64
    private var counter: UInt64 = 0
    // counter가 가변 상태이므로 잠금 없이 `@unchecked Sendable`을 선언할 수 없다.
    // 지금 시나리오는 단일 스레드지만, 병렬 실행을 넣는 순간 counter 경쟁이
    // 결정성을 조용히 깨뜨린다 — 그러면 "같은 seed면 같은 바이트"라는 이
    // 타입의 존재 이유가 사라진다.
    private let lock = NSLock()

    public init(seed: UInt64) {
        self.seed = seed
    }

    public var label: String { "deterministic(seed=\(seed))" }

    public func bytes(_ count: Int) -> Data {
        precondition(count >= 0, "음수 길이를 요청할 수 없습니다.")
        lock.lock()
        defer { lock.unlock() }
        var output = Data()
        output.reserveCapacity(count)
        while output.count < count {
            var block = Data()
            block.append(contentsOf: withUnsafeBytes(of: seed.bigEndian, Array.init))
            block.append(contentsOf: withUnsafeBytes(of: counter.bigEndian, Array.init))
            counter &+= 1
            output.append(contentsOf: Data(SHA256.hash(data: block)))
        }
        return output.prefix(count)
    }
}
