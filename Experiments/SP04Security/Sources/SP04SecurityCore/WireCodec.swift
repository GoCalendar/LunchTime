import Foundation

/// 길이 접두어 바이트 열을 되읽는다.
///
/// ``CanonicalWriter``가 쓴 것을 그대로 되돌린다. 두 방향을 한 파일에 두어야
/// 형식이 갈라지지 않는다.
public struct CanonicalReader {
    private let data: Data
    private var cursor: Data.Index

    public init(_ data: Data) {
        self.data = data
        self.cursor = data.startIndex
    }

    public enum ReadError: Error, Equatable {
        case truncated
        case domainMismatch
        case invalidUTF8
        case trailingBytes
    }

    public init(_ data: Data, domain: String) throws {
        self.init(data)
        let readDomain = try string()
        guard readDomain == domain.precomposedStringWithCanonicalMapping else {
            throw ReadError.domainMismatch
        }
    }

    public mutating func bytes() throws -> Data {
        guard data.endIndex - cursor >= 8 else { throw ReadError.truncated }
        var length: UInt64 = 0
        for offset in 0..<8 { length = (length << 8) | UInt64(data[cursor + offset]) }
        cursor += 8
        guard UInt64(data.endIndex - cursor) >= length else { throw ReadError.truncated }
        let slice = data.subdata(in: cursor..<(cursor + Int(length)))
        cursor += Int(length)
        return slice
    }

    public mutating func string() throws -> String {
        guard let value = String(data: try bytes(), encoding: .utf8) else { throw ReadError.invalidUTF8 }
        return value
    }

    public mutating func uint64() throws -> UInt64 {
        let raw = try bytes()
        guard raw.count == 8 else { throw ReadError.truncated }
        var value: UInt64 = 0
        for byte in raw { value = (value << 8) | UInt64(byte) }
        return value
    }

    public mutating func optionalString() throws -> String? {
        let marker = try bytes()
        guard marker.count == 1 else { throw ReadError.truncated }
        return marker[marker.startIndex] == 0 ? nil : try string()
    }

    public func requireExhausted() throws {
        guard cursor == data.endIndex else { throw ReadError.trailingBytes }
    }
}

/// 핸드셰이크 메시지와 봉투의 wire 표현.
///
/// 이 형식이 곧 캡처 대상이다. 구조체를 메모리에서 바로 넘기면 "무엇이
/// 전송되는가"라는 질문에 답할 수 없다.
public enum WireCodec {
    static let helloTag: UInt64 = 1
    static let acceptTag: UInt64 = 2
    static let confirmTag: UInt64 = 3
    static let envelopeTag: UInt64 = 4

    public enum DecodeError: Error, Equatable {
        case unknownMessage
        case malformed
    }

    public static func encode(_ hello: HandshakeMessage.Hello) -> Data {
        var writer = CanonicalWriter(domain: SP04Protocol.label + "/wire")
        writer.append(helloTag)
        writer.append(hello.protocolVersion)
        writer.append(hello.admissionMode.rawValue)
        writer.append(hello.admissionProof)
        writer.append(hello.staticSigningPublicKey)
        writer.append(hello.ephemeralPublicKey)
        writer.append(hello.nonce)
        writer.append(hello.claimedDeviceID)
        writer.append(hello.claimedUserID)
        return writer.data
    }

    public static func encode(_ accept: HandshakeMessage.Accept) -> Data {
        var writer = CanonicalWriter(domain: SP04Protocol.label + "/wire")
        writer.append(acceptTag)
        writer.append(accept.protocolVersion)
        writer.append(accept.admissionMode.rawValue)
        writer.append(accept.admissionProof)
        writer.append(accept.staticSigningPublicKey)
        writer.append(accept.ephemeralPublicKey)
        writer.append(accept.nonce)
        writer.append(accept.claimedDeviceID)
        writer.append(accept.claimedUserID)
        writer.append(accept.signature)
        return writer.data
    }

    public static func encode(_ confirm: HandshakeMessage.Confirm) -> Data {
        var writer = CanonicalWriter(domain: SP04Protocol.label + "/wire")
        writer.append(confirmTag)
        writer.append(confirm.signature)
        return writer.data
    }

    public static func encode(_ envelope: SignedEnvelope) -> Data {
        var writer = CanonicalWriter(domain: SP04Protocol.label + "/wire")
        writer.append(envelopeTag)
        writer.append(envelope.event.eventID)
        writer.append(envelope.event.daySession)
        writer.appendOptional(envelope.event.room)
        writer.append(envelope.event.authorUser)
        writer.append(envelope.event.authorDevice)
        writer.append(envelope.event.eventType)
        writer.append(envelope.event.revision)
        writer.append(envelope.event.logicalOrder)
        writer.append(envelope.event.payload)
        writer.append(envelope.authorSigningPublicKey)
        writer.append(envelope.signature)
        return writer.data
    }

    public static func decodeHello(_ data: Data) throws -> HandshakeMessage.Hello {
        var reader = try CanonicalReader(data, domain: SP04Protocol.label + "/wire")
        guard try reader.uint64() == helloTag else { throw DecodeError.unknownMessage }
        let protocolVersion = try reader.uint64()
        guard let mode = NetworkAdmissionMode(rawValue: try reader.string()) else {
            throw DecodeError.malformed
        }
        let hello = HandshakeMessage.Hello(
            protocolVersion: protocolVersion,
            admissionMode: mode,
            admissionProof: try reader.bytes(),
            staticSigningPublicKey: try reader.bytes(),
            ephemeralPublicKey: try reader.bytes(),
            nonce: try reader.bytes(),
            claimedDeviceID: try reader.string(),
            claimedUserID: try reader.string()
        )
        try reader.requireExhausted()
        return hello
    }

    public static func decodeAccept(_ data: Data) throws -> HandshakeMessage.Accept {
        var reader = try CanonicalReader(data, domain: SP04Protocol.label + "/wire")
        guard try reader.uint64() == acceptTag else { throw DecodeError.unknownMessage }
        let protocolVersion = try reader.uint64()
        guard let mode = NetworkAdmissionMode(rawValue: try reader.string()) else {
            throw DecodeError.malformed
        }
        let accept = HandshakeMessage.Accept(
            protocolVersion: protocolVersion,
            admissionMode: mode,
            admissionProof: try reader.bytes(),
            staticSigningPublicKey: try reader.bytes(),
            ephemeralPublicKey: try reader.bytes(),
            nonce: try reader.bytes(),
            claimedDeviceID: try reader.string(),
            claimedUserID: try reader.string(),
            signature: try reader.bytes()
        )
        try reader.requireExhausted()
        return accept
    }

    public static func decodeConfirm(_ data: Data) throws -> HandshakeMessage.Confirm {
        var reader = try CanonicalReader(data, domain: SP04Protocol.label + "/wire")
        guard try reader.uint64() == confirmTag else { throw DecodeError.unknownMessage }
        let confirm = HandshakeMessage.Confirm(signature: try reader.bytes())
        try reader.requireExhausted()
        return confirm
    }

    public static func decodeEnvelope(_ data: Data) throws -> SignedEnvelope {
        var reader = try CanonicalReader(data, domain: SP04Protocol.label + "/wire")
        guard try reader.uint64() == envelopeTag else { throw DecodeError.unknownMessage }
        let event = OperationalEvent(
            eventID: try reader.string(),
            daySession: try reader.string(),
            room: try reader.optionalString(),
            authorUser: try reader.string(),
            authorDevice: try reader.string(),
            eventType: try reader.string(),
            revision: try reader.uint64(),
            logicalOrder: try reader.uint64(),
            payload: try reader.bytes()
        )
        let envelope = SignedEnvelope(
            event: event,
            authorSigningPublicKey: try reader.bytes(),
            signature: try reader.bytes()
        )
        // 메시지 뒤에 붙은 임의 바이트를 무시하면 "한 메시지 = 한 바이트 열"이
        // 성립하지 않는다. 서명은 필드에서 재계산하므로 직접 위조 경로는
        // 아니지만, 상위 계층이 raw 바이트로 dedup·캐시하면 그 지점이 뚫린다.
        try reader.requireExhausted()
        return envelope
    }
}
