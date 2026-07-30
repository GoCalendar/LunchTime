import CryptoKit
import Foundation

/// 발견 단계에서 방송하는 최소 정보(`POL-03-R-03`).
///
/// > Peer 발견 패킷은 내용을 최소화하고 사용자 이름, Room 제목, 가게, 메뉴,
/// > 채팅과 입력 링크를 포함하지 않는다.
///
/// 이 타입에는 그 필드를 **담을 자리가 없다.** 검사로 막으면 "여기서만
/// 예외"라는 호출부가 생기지만, 표현 자체가 없으면 넣으려는 순간 컴파일되지
/// 않는다.
///
/// 닉네임도 없다. `POL-03-R-03`이 "사용자 이름"을 금지하고, 닉네임은 사람이
/// 고른 값이라 그 자체로 식별 가능하다. 연결 화면이 닉네임을 보여주는 것은
/// (`PRD-01-AC-08`) 발견 패킷이 아니라 **핸드셰이크 뒤 채널**에서 받은 값으로
/// 해야 한다.
public struct DiscoveryBeacon: Hashable, Sendable {
    public let protocolVersion: UInt64
    /// 공개키에서 유도한 기기 ID. 사람 이름이 아니다.
    public let deviceID: String
    /// 정적 서명 공개키. 핸드셰이크 전에 상대를 고정할 수 있게 한다.
    public let signingPublicKey: Data

    public init(
        protocolVersion: UInt64 = SP04Protocol.version,
        deviceID: String,
        signingPublicKey: Data
    ) {
        self.protocolVersion = protocolVersion
        self.deviceID = deviceID
        self.signingPublicKey = signingPublicKey
    }

    /// 발견 단계 방송을 만든다.
    ///
    /// **admission 표식을 싣지 않는다.** 첫 구현은 실었는데, 배포 비밀 모드에서는
    /// 그 값이 곧 자격이므로 방송하는 순간 누구나 주워서 재사용할 수 있었다.
    /// 지원 네트워크 판정은 핸드셰이크의 증명으로만 한다.
    ///
    /// **닉네임을 정하기 전에는 방송하지 않는다(`nil`).** `POL-03-R-02`와
    /// `PRD-01-AC-08`이 "첫 실행에서 닉네임을 정하기 전에는 네트워크에 Peer로
    /// 노출되지 않는다"를 요구한다. 값을 만들 수 있게 두면 호출부 하나가
    /// 그 계약을 어긴다.
    public static func advertise(identity: DeviceIdentity, scope: NetworkScope) -> DiscoveryBeacon? {
        guard let nickname = identity.nickname, !nickname.isEmpty else { return nil }
        return DiscoveryBeacon(
            protocolVersion: scope.protocolVersion,
            deviceID: identity.deviceID.rawValue,
            signingPublicKey: Data(identity.signingKey.publicKey.rawRepresentation)
        )
    }

    /// 방송되는 실제 바이트.
    public var wireBytes: Data {
        var writer = CanonicalWriter(domain: SP04Protocol.beaconDomain)
        writer.append(protocolVersion)
        writer.append(deviceID)
        writer.append(signingPublicKey)
        return writer.data
    }
}
