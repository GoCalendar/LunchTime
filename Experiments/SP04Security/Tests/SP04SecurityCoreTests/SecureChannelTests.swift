import CryptoKit
import Foundation
import Testing

@testable import SP04SecurityCore

/// 인증된 암호화 채널 계약(`POL-03-R-03`).
@Suite("SP-04 보안 채널")
struct SecureChannelTests {
    private func makeChannel() -> (sender: ChannelSender, receiver: ChannelReceiver) {
        let key = SymmetricKey(data: DeterministicEntropy(seed: 3).bytes(32))
        return (
            ChannelSender(key: key, direction: .initiatorToResponder),
            ChannelReceiver(key: key, expectedDirection: .initiatorToResponder)
        )
    }

    @Test("봉인한 frame은 같은 키로만 열린다")
    func sealAndOpen() throws {
        var channel = makeChannel()
        let plaintext = Data("SP04-PLAIN".utf8)
        let frame = try channel.sender.seal(plaintext)

        #expect(!frame.ciphertext.contains(plaintext))
        guard case let .success(opened) = channel.receiver.open(frame) else {
            Issue.record("정상 frame이 열리지 않았다")
            return
        }
        #expect(opened == plaintext)
    }

    @Test("다른 키로는 열리지 않는다")
    func rejectsWrongKey() throws {
        var channel = makeChannel()
        let frame = try channel.sender.seal(Data("SP04-PLAIN".utf8))
        var stranger = ChannelReceiver(
            key: SymmetricKey(data: DeterministicEntropy(seed: 99).bytes(32)),
            expectedDirection: .initiatorToResponder
        )
        #expect(stranger.open(frame) == .failure(.authenticationFailed))
    }

    @Test("암호문 한 비트가 바뀌면 거부한다")
    func rejectsTamperedCiphertext() throws {
        var channel = makeChannel()
        let frame = try channel.sender.seal(Data("SP04-PLAIN".utf8))
        let tampered = ChannelFrame(
            version: frame.version,
            direction: frame.direction,
            sequence: frame.sequence,
            ciphertext: Tamper.flipBit(frame.ciphertext, atByte: 0)
        )
        #expect(channel.receiver.open(tampered) == .failure(.authenticationFailed))
    }

    @Test("헤더의 순서 번호를 바꾸면 거부한다")
    func headerIsAuthenticated() throws {
        var channel = makeChannel()
        let frame = try channel.sender.seal(Data("SP04-PLAIN".utf8))
        let renumbered = ChannelFrame(
            version: frame.version,
            direction: frame.direction,
            sequence: frame.sequence + 5,
            ciphertext: frame.ciphertext
        )
        #expect(channel.receiver.open(renumbered) == .failure(.authenticationFailed))
    }

    @Test("헤더 필드는 AAD에도 독립적으로 묶여 있다")
    func headerFieldsAreBoundInAdditionalData() {
        // 위 `headerIsAuthenticated`가 관측하는 거부는 실제로는 **nonce 유도**가
        // 만든다. 순서 번호가 nonce에 들어가므로 번호를 바꾸면 복호화 키 스트림
        // 자체가 달라진다. 그래서 AAD에서 순서 번호를 빼도 그 시험은 통과한다.
        //
        // AAD 결속은 두 번째 방어선이다. nonce 유도 방식을 바꾸는 순간(예: 난수
        // nonce로 전환) 첫 방어선이 사라지므로, 결속 자체를 여기서 직접 고정한다.
        let base = ChannelSender.additionalData(direction: .initiatorToResponder, sequence: 7)
        #expect(base != ChannelSender.additionalData(direction: .initiatorToResponder, sequence: 8))
        #expect(base != ChannelSender.additionalData(direction: .responderToInitiator, sequence: 7))
        #expect(PlaintextScanner.contains(haystack: base, needle: Data([0, 0, 0, 0, 0, 0, 0, 7])))
    }

    @Test("방향이 다른 frame은 복호화 전에 거부한다")
    func rejectsWrongDirection() throws {
        var channel = makeChannel()
        let frame = try channel.sender.seal(Data("SP04-PLAIN".utf8))
        var reversed = ChannelReceiver(
            key: channel.sender.key, expectedDirection: .responderToInitiator
        )
        #expect(reversed.open(frame) == .failure(.directionMismatch))
    }

    @Test("같은 frame을 다시 받으면 재전송으로 거부한다")
    func rejectsReplay() throws {
        var channel = makeChannel()
        let frame = try channel.sender.seal(Data("SP04-PLAIN".utf8))
        #expect(channel.receiver.open(frame).isSuccess)
        #expect(channel.receiver.open(frame) == .failure(.replayDetected))
    }

    @Test("늦게 도착한 정상 frame은 창 안에서 받아들인다")
    func acceptsOutOfOrderWithinWindow() throws {
        var channel = makeChannel()
        var frames: [ChannelFrame] = []
        for index in 0..<5 {
            frames.append(try channel.sender.seal(Data("SP04-\(index)".utf8)))
        }
        // 4 → 0 → 2 순으로 받는다. 창이 없으면 0과 2가 재전송으로 오인된다.
        #expect(channel.receiver.open(frames[4]).isSuccess)
        #expect(channel.receiver.open(frames[0]).isSuccess)
        #expect(channel.receiver.open(frames[2]).isSuccess)
        #expect(channel.receiver.open(frames[2]) == .failure(.replayDetected))
    }

    @Test("창 밖의 옛 번호는 거부한다")
    func rejectsBeyondWindow() {
        var window = ReplayWindow()
        window.commit(0)
        window.commit(ReplayWindow.size + 10)
        #expect(!window.accepts(0))
        #expect(!window.accepts(5))
        #expect(window.accepts(ReplayWindow.size + 11))
    }

    @Test("검증에 실패한 번호는 창을 태우지 않는다")
    func failedFrameDoesNotBurnSequence() throws {
        var channel = makeChannel()
        let frame = try channel.sender.seal(Data("SP04-PLAIN".utf8))
        let forged = ChannelFrame(
            version: frame.version,
            direction: frame.direction,
            sequence: frame.sequence,
            ciphertext: Tamper.flipLastBit(frame.ciphertext)
        )
        // 위조 frame 하나로 정상 frame의 번호를 미리 소진시킬 수 있으면,
        // 공격자가 frame 하나로 특정 이벤트를 영구 차단한다.
        #expect(channel.receiver.open(forged) == .failure(.authenticationFailed))
        #expect(channel.receiver.open(frame).isSuccess)
    }

    @Test("순서 번호마다 nonce가 다르다")
    func nonceIsUniquePerSequence() {
        var seen = Set<Data>()
        for sequence in 0..<1_000 {
            #expect(seen.insert(ChannelSender.nonceBytes(sequence: UInt64(sequence))).inserted)
        }
    }

    @Test("세션을 복사해도 순서 번호가 갈라지지 않는다")
    func senderStateIsNotCopied() throws {
        // 송신 상태가 값 타입이면 세션 복사만으로 같은 (키, nonce)가 두 번 쓰인다.
        let channel = makeChannel()
        let sender = channel.sender
        let copy = sender
        let first = try sender.seal(Data("A".utf8))
        let second = try copy.seal(Data("B".utf8))
        #expect(first.sequence != second.sequence)
    }

    @Test("frame 바이트는 왕복에서 그대로 복원된다")
    func frameRoundTripsThroughBytes() throws {
        var channel = makeChannel()
        let frame = try channel.sender.seal(Data("SP04-PLAIN".utf8))
        let decoded = try #require(ChannelFrame.decode(frame.wireBytes))
        #expect(decoded == frame)
    }

    @Test("frame 형식이 아니면 형식 오류로 거부한다")
    func rejectsMalformedBytes() {
        var channel = makeChannel()
        #expect(channel.receiver.openWireBytes(Data([1, 2, 3])) == .failure(.malformedFrame))
    }
}

extension Result where Success == Data, Failure == ChannelFailure {
    var isSuccess: Bool {
        if case .success = self { return true }
        return false
    }
}
