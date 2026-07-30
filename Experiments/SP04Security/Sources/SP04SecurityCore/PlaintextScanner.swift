import Foundation

/// 시나리오가 평문 노출을 확인하려고 심는 값.
///
/// 값은 모두 **합성 문자열**이다. 실제 가게·메뉴·닉네임을 쓰면 저장소에 개인
/// 데이터가 들어가고, `AGENTS.md`의 "비밀, 내부 네트워크 식별자, 개인 데이터를
/// 추적 파일에 기록하지 않는다"에 어긋난다.
///
/// 출력에는 ``label``만 나간다. ``value``를 출력하면 판정 결과 JSON 자체가
/// 평문 노출이 된다.
public struct PlantedSecret: Hashable, Sendable {
    public let label: String
    public let value: String

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

/// 캡처한 바이트에서 심은 평문을 찾는다.
///
/// 이 검사가 이 스파이크의 `평문이 보이지 않는다`를 **선언이 아니라 관측**으로
/// 만든다. [SP-02](../../../docs/technical/spikes/PRD-01-SP-02-replication-conflicts.md)의
/// 불변식 23이 같은 이유로 "익명화 표시는 선언이 아니라 검사 결과여야 한다"고
/// 적었다.
public enum PlaintextScanner {
    /// 노출된 값의 라벨 목록. 비어 있으면 노출이 없다.
    public static func exposedLabels(in haystack: Data, secrets: [PlantedSecret]) -> [String] {
        secrets
            .filter { contains(haystack: haystack, needle: Data($0.value.utf8)) }
            .map(\.label)
            .sorted()
    }

    public static func exposedLabels(in text: String, secrets: [PlantedSecret]) -> [String] {
        exposedLabels(in: Data(text.utf8), secrets: secrets)
    }

    /// UTF-8 바이트 열에서 부분 열을 찾는다.
    ///
    /// 문자열 변환을 거치지 않는 이유는 캡처한 바이트가 유효한 UTF-8이 아니기
    /// 때문이다. 변환하면 손상된 바이트가 대체 문자로 바뀌면서 실제로 남아 있는
    /// 평문 조각을 놓친다.
    static func contains(haystack: Data, needle: Data) -> Bool {
        guard !needle.isEmpty, haystack.count >= needle.count else { return false }
        let haystackBytes = [UInt8](haystack)
        let needleBytes = [UInt8](needle)
        let limit = haystackBytes.count - needleBytes.count
        var start = 0
        while start <= limit {
            var offset = 0
            while offset < needleBytes.count, haystackBytes[start + offset] == needleBytes[offset] {
                offset += 1
            }
            if offset == needleBytes.count { return true }
            start += 1
        }
        return false
    }
}

/// 진단 기록의 어휘 제한(`POL-02-R-07`, `POL-03-R-04`).
///
/// > 메뉴, 입력 링크, 참여자 닉네임과 히스토리 평문을 앱 로그, 크래시 메타데이터,
/// > Spotlight 인덱스, 알림 본문 미리보기나 임시 파일에 기록하지 않는다.
///
/// 그래서 이 타입은 자유 문자열 필드를 갖지 않는다. 실패를 기록하려면 코드와
/// 익명 식별자로만 표현해야 한다.
public struct DiagnosticRecord: Hashable, Sendable {
    /// 관련 이벤트 ID. 이벤트 ID는 유도된 불투명 값이다.
    public let eventID: String?
    /// 상태 코드. 열거값의 raw 문자열만 쓴다.
    public let statusCode: String
    /// 소요 시간(밀리초).
    public let durationMilliseconds: UInt64?
    /// 익명화된 기기 식별자. 공개키에서 유도한 기기 ID를 그대로 쓴다.
    public let anonymizedDeviceID: String?

    public init(
        eventID: String?,
        statusCode: String,
        durationMilliseconds: UInt64?,
        anonymizedDeviceID: String?
    ) {
        self.eventID = eventID
        self.statusCode = statusCode
        self.durationMilliseconds = durationMilliseconds
        self.anonymizedDeviceID = anonymizedDeviceID
    }

    /// 로그에 실제로 남는 한 줄.
    public var logLine: String {
        var parts = ["status=\(statusCode)"]
        if let eventID { parts.append("event=\(eventID)") }
        if let anonymizedDeviceID { parts.append("device=\(anonymizedDeviceID)") }
        if let durationMilliseconds { parts.append("ms=\(durationMilliseconds)") }
        return parts.joined(separator: " ")
    }

    /// 실패 결과 하나를 진단으로 접는다.
    public static func from(
        outcome: SyncOutcome,
        eventID: String?,
        deviceID: DeviceID?,
        durationMilliseconds: UInt64?
    ) -> DiagnosticRecord {
        let status: String
        switch outcome {
        case .applied:
            status = "applied"
        case let .needsReview(reason):
            status = "needs-review:\(reason.rawValue)"
        }
        return DiagnosticRecord(
            eventID: eventID,
            statusCode: status,
            durationMilliseconds: durationMilliseconds,
            anonymizedDeviceID: deviceID?.rawValue
        )
    }
}
