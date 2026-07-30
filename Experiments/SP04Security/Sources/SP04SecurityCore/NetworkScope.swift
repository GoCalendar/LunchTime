import CryptoKit
import Foundation

/// 지원 네트워크 자동 신뢰 경계(`POL-03-R-01`).
///
/// 이 모델은 **admission이 무엇을 증명하는가**를 분리해서 다룬다. 이것이 이
/// 스파이크의 핵심 질문 하나다 — 지원 네트워크 판정이 "관측된 사실"인지
/// "증명 가능한 자격"인지에 따라 자동 신뢰의 의미가 완전히 달라진다.
public enum NetworkAdmissionMode: String, Sendable, CaseIterable {
    /// SSID·인터페이스 관측만으로 판정한다.
    ///
    /// 관측값은 **공개 정보**다. SSID는 방송되고 인터페이스 주소는 같은 링크의
    /// 누구나 본다. 그래서 이 모드에서 admission tag는 아무것도 증명하지 못한다.
    /// 실제 경계는 "그 네트워크에 붙을 수 있는가"이며, 그것은 회사 Wi-Fi
    /// 비밀번호를 아는 사람 전부다.
    case observedNetworkAttributes

    /// 배포된 공유 비밀에서 유도한 tag로 판정한다.
    ///
    /// tag가 비밀이면 핸드셰이크가 실제 admission 자격 검사가 된다. 대신 그
    /// 비밀을 배포·회전하는 경로가 필요하고, 유출되면 네트워크 밖에서도
    /// 통과한다. 여전히 **개인 신원 인증은 아니다** — 조직 구성원 자격을
    /// 증명할 뿐이고, 그 자격을 가진 내부 공격자는 그대로 통과한다.
    ///
    /// > 이 모드가 실제로 자격 검사가 되려면 tag 값이 **wire에 나가지 않아야**
    /// > 한다. 첫 구현은 tag를 hello·accept·발견 beacon에 평문으로 실었는데,
    /// > 그러면 값 자체가 bearer token이 되어 한 번 관측한 쪽이 그대로
    /// > 재사용한다. HKDF 유도는 원문 복원만 막을 뿐 재사용을 막지 못한다.
    /// > 지금은 tag를 **MAC 키로만** 쓰고 wire에는 증명값만 보낸다
    /// > (``NetworkAdmissionTag/proof(over:)``).
    case deployedSharedSecret
}

/// 핸드셰이크가 주고받는 네트워크 admission 표식.
///
/// 두 모드 모두 같은 자리에 들어가지만 의미가 다르다. 값이 같아야 핸드셰이크가
/// 진행된다는 점은 같고, **그 사실이 무엇을 뜻하는가**만 모드가 정한다.
public struct NetworkAdmissionTag: Hashable, Sendable {
    public let mode: NetworkAdmissionMode
    public let value: Data

    public init(mode: NetworkAdmissionMode, value: Data) {
        self.mode = mode
        self.value = value
    }

    /// 이 tag를 키로 메시지 본문에 대한 증명값을 만든다.
    ///
    /// wire에는 이 값만 나간다. 상대는 자기 tag로 같은 값을 계산해 대조하므로,
    /// tag를 모르는 쪽은 **자기 메시지에 대한 증명을 만들 수 없다.** 남의 증명을
    /// 그대로 재사용할 수도 없다 — 증명이 그 메시지의 키·nonce·식별자를 덮기
    /// 때문이다.
    ///
    /// > 관측 모드에서는 tag가 공개 정보에서 유도되므로 이 증명이 **아무것도
    /// > 증명하지 않는다.** 같은 링크의 누구나 같은 값을 계산할 수 있다. 그것이
    /// > 관측 모드의 정의이며, 형태를 두 모드에서 같게 두는 이유는 상위 계층이
    /// > 모드에 따라 다른 코드 경로를 타지 않게 하기 위해서다.
    public func proof(over body: Data) -> Data {
        var writer = CanonicalWriter(domain: SP04Protocol.admissionProofDomain)
        writer.append(mode.rawValue)
        writer.append(body)
        return Data(
            HMAC<SHA256>.authenticationCode(for: writer.data, using: SymmetricKey(data: value))
        )
    }

    /// 관측 속성에서 만든다. 비밀이 아니다.
    public static func observed(networkName: String) -> NetworkAdmissionTag {
        var writer = CanonicalWriter(domain: "LunchTime/SP04/Admission/observed/v1")
        writer.append(networkName)
        return NetworkAdmissionTag(mode: .observedNetworkAttributes, value: writer.digest)
    }

    /// 배포된 공유 비밀에서 만든다.
    ///
    /// HKDF 유도는 원문 비밀의 **복원**만 막는다. 유도값 자체가 자격이므로,
    /// 이 값을 wire에 실으면 관측한 쪽이 그대로 재사용한다. 그래서 이 값은
    /// wire에 나가지 않고 ``proof(over:)``의 키로만 쓴다.
    public static func deployed(sharedSecret: Data, networkName: String) -> NetworkAdmissionTag {
        let derived = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: sharedSecret),
            salt: Data(networkName.precomposedStringWithCanonicalMapping.utf8),
            info: Data("LunchTime/SP04/Admission/deployed/v1".utf8),
            outputByteCount: 32
        )
        return NetworkAdmissionTag(
            mode: .deployedSharedSecret,
            value: derived.withUnsafeBytes { Data($0) }
        )
    }
}

/// admission 판정 결과.
public enum NetworkAdmissionDecision: Equatable, Sendable {
    /// 지원 네트워크 안. 자동 신뢰 대상이다(`POL-03-R-01`).
    case inSupportedScope
    /// 지원 범위 밖. 운영 데이터를 보내지 않는다.
    case outOfSupportedScope(reason: OutOfScopeReason)

    public enum OutOfScopeReason: String, Equatable, Sendable {
        /// admission 증명이 이 기기의 tag로 재계산한 값과 다르다.
        case admissionProofInvalid
        case admissionModeMismatch
        case unsupportedProtocolVersion
    }

    public var admits: Bool {
        if case .inSupportedScope = self { return true }
        return false
    }
}

/// 이 기기가 보는 지원 네트워크 상태.
public struct NetworkScope: Sendable {
    public let localTag: NetworkAdmissionTag
    public let protocolVersion: UInt64

    public init(localTag: NetworkAdmissionTag, protocolVersion: UInt64 = SP04Protocol.version) {
        self.localTag = localTag
        self.protocolVersion = protocolVersion
    }

    /// 상대가 제시한 증명으로 admission을 판정한다.
    ///
    /// `body`는 그 메시지의 정규 바이트다. 증명이 본문을 덮으므로 다른 메시지의
    /// 증명을 옮겨 붙일 수 없다.
    ///
    /// 비교는 constant-time으로 한다. 조기 반환 비교를 쓰면 증명값이 한
    /// 바이트씩 새어 나간다.
    ///
    /// > Swift·LLVM은 어떤 constant-time 보장도 하지 않는다. 이 함수는 조기
    /// > 반환을 없앤 것이지 상수 시간을 증명한 것이 아니다.
    ///
    /// 실패해도 **응답을 만들지 않으므로** 상대에게는 어떤 사유도 돌아가지
    /// 않는다. 아래 세분화된 사유는 로컬 진단 전용이다.
    public func admit(
        peerProof: Data,
        over body: Data,
        peerMode: NetworkAdmissionMode,
        peerProtocolVersion: UInt64
    ) -> NetworkAdmissionDecision {
        guard peerProtocolVersion == protocolVersion else {
            return .outOfSupportedScope(reason: .unsupportedProtocolVersion)
        }
        guard peerMode == localTag.mode else {
            return .outOfSupportedScope(reason: .admissionModeMismatch)
        }
        guard ConstantTime.equal(peerProof, localTag.proof(over: body)) else {
            return .outOfSupportedScope(reason: .admissionProofInvalid)
        }
        return .inSupportedScope
    }
}

public enum ConstantTime {
    /// 길이가 같은 두 바이트 열을 조기 반환 없이 비교한다.
    ///
    /// 길이 자체는 숨기지 않는다. 이 모델에서 비교 대상은 모두 고정 길이
    /// digest이므로 길이가 비밀을 담지 않는다.
    public static func equal(_ lhs: Data, _ rhs: Data) -> Bool {
        guard lhs.count == rhs.count else { return false }
        var difference: UInt8 = 0
        for (left, right) in zip(lhs, rhs) {
            difference |= left ^ right
        }
        return difference == 0
    }
}
