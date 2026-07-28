import Testing

@testable import SP01ProbeCore

/// 실험 옵션 계약.
///
/// 이 스파이크의 `작업 범위`는 "실제 네트워크 식별자 또는 사내 구성값의 저장소 기록"을
/// 제외한다. 익명 라벨 검사가 그 경계를 실행 시점에 강제하는 유일한 장치이므로
/// 여기서 결정적으로 고정한다.
@Suite("SP-01 실험 옵션")
struct ProbeOptionsTests {
    private func parse(_ arguments: [String]) throws -> ProbeOptions {
        // 첫 인자는 실행 파일 경로 자리다.
        try ProbeOptions.parse(["sp01-probe"] + arguments)
    }

    /// 상대 라벨을 기본으로 채워 넣는다. `--peer`는 필수이므로 다른 계약을 검증하는
    /// 호출부가 매번 지정하지 않아도 되게 한다.
    private func parseWithPeer(_ arguments: [String], peer: String = "B") throws -> ProbeOptions {
        try parse(arguments + ["--peer", peer])
    }

    @Test("익명 라벨만 허용한다", arguments: ["A", "B", "A1", "AB12CD34"])
    func acceptsAnonymousLabel(_ label: String) throws {
        let options = try parseWithPeer(["--label", label], peer: label == "B" ? "A" : "B")
        #expect(options.label == label)
    }

    @Test(
        "사내 식별자로 보이는 라벨을 거부한다",
        arguments: [
            "wifi-name-example",
            "peer-name",
            "MacBook Pro",
            "192.0.2.10",
            "a",
            "TOOLONGLABEL",
            ""
        ]
    )
    func rejectsIdentifiableLabel(_ label: String) {
        #expect(throws: ProbeOptions.ParseError.self) {
            _ = try parseWithPeer(["--label", label])
        }
    }

    @Test("상대 라벨이 없으면 실패한다")
    func requiresPeer() {
        // 상대를 고정하지 않으면 세 대 이상일 때 어느 상대를 측정했는지 확정할 수 없다.
        do {
            _ = try parse(["--label", "A"])
            Issue.record("`--peer` 없이 통과해서는 안 된다")
        } catch let error as ProbeOptions.ParseError {
            guard case .missingPeer = error else {
                Issue.record("다른 오류가 발생했다: \(error)")
                return
            }
        } catch {
            Issue.record("예상하지 않은 오류 타입: \(error)")
        }
    }

    @Test("상대 라벨도 익명 형식만 허용한다", arguments: ["peer-name", "192.0.2.10", "TOOLONGLABEL", ""])
    func rejectsIdentifiablePeer(_ peer: String) {
        do {
            _ = try parse(["--label", "A", "--peer", peer])
            Issue.record("비익명 상대 라벨이 통과해서는 안 된다")
        } catch let error as ProbeOptions.ParseError {
            guard case .peerNotAnonymous = error else {
                Issue.record("다른 오류가 발생했다: \(error)")
                return
            }
        } catch {
            Issue.record("예상하지 않은 오류 타입: \(error)")
        }
    }

    @Test("상대 라벨이 자기 라벨과 같으면 거부한다")
    func rejectsPeerEqualToLabel() {
        // 양쪽이 같은 라벨이면 서로를 자기 자신으로 보고 걸러내 조용히 측정 못함이 된다.
        do {
            _ = try parse(["--label", "A", "--peer", "A"])
            Issue.record("같은 라벨이 통과해서는 안 된다")
        } catch let error as ProbeOptions.ParseError {
            guard case .peerEqualsLabel = error else {
                Issue.record("다른 오류가 발생했다: \(error)")
                return
            }
        } catch {
            Issue.record("예상하지 않은 오류 타입: \(error)")
        }
    }

    @Test("라벨이 없으면 실패한다")
    func requiresLabel() {
        #expect(throws: ProbeOptions.ParseError.self) {
            _ = try parse(["--rounds", "3"])
        }
    }

    @Test("기본값은 유한한 측정을 만든다")
    func defaultsAreBounded() throws {
        let options = try parseWithPeer(["--label", "A"])
        #expect(options.rounds == 5)
        #expect(options.peer == "B")
        #expect(options.roundTimeout == 15)
        #expect(options.rendezvous == 60)
        #expect(options.linger == 20)
        #expect(options.rounds <= ProbeOptions.maxRounds)
        #expect(options.roundTimeout <= ProbeOptions.maxRoundTimeout)
        #expect(options.rendezvous <= ProbeOptions.maxRendezvous)
    }

    @Test(
        "상한을 넘는 값을 거부해 무한 측정을 막는다",
        arguments: [
            ["--rounds", "0"],
            ["--rounds", "51"],
            ["--round-timeout", "0"],
            ["--round-timeout", "121"],
            ["--rendezvous", "0"],
            ["--rendezvous", "301"],
            ["--linger", "-1"],
            ["--linger", "301"],
            ["--cooldown", "61"]
        ]
    )
    func rejectsOutOfRange(_ pair: [String]) {
        do {
            _ = try parseWithPeer(["--label", "A"] + pair)
            Issue.record("범위를 벗어난 값이 통과해서는 안 된다")
        } catch let error as ProbeOptions.ParseError {
            // 구체 case를 확인한다. `ParseError.self`만 보면 `missingPeer` 같은 다른 이유로
            // 초록이 되어도 알 수 없다.
            guard case .outOfRange = error else {
                Issue.record("범위 오류가 아닌 다른 오류가 발생했다: \(error)")
                return
            }
        } catch {
            Issue.record("예상하지 않은 오류 타입: \(error)")
        }
    }

    @Test("숫자가 아닌 값을 거부한다")
    func rejectsNonNumeric() {
        do {
            _ = try parseWithPeer(["--label", "A", "--rounds", "다섯"])
            Issue.record("숫자가 아닌 값이 통과해서는 안 된다")
        } catch let error as ProbeOptions.ParseError {
            guard case .notANumber = error else {
                Issue.record("숫자 오류가 아닌 다른 오류가 발생했다: \(error)")
                return
            }
        } catch {
            Issue.record("예상하지 않은 오류 타입: \(error)")
        }
    }

    @Test("값이 빠진 인자를 거부한다")
    func rejectsMissingValue() {
        #expect(throws: ProbeOptions.ParseError.self) {
            _ = try parse(["--label"])
        }
    }

    @Test("알 수 없는 인자를 거부한다")
    func rejectsUnknownArgument() {
        #expect(throws: ProbeOptions.ParseError.self) {
            _ = try parseWithPeer(["--label", "A", "--ssid", "value"])
        }
    }

    @Test("도움말 요청은 별도 오류로 구분한다")
    func reportsHelpSeparately() {
        do {
            _ = try parse(["--help"])
            Issue.record("도움말 요청은 오류로 신호해야 한다")
        } catch let error as ProbeOptions.ParseError {
            guard case .helpRequested = error else {
                Issue.record("도움말이 아닌 다른 오류가 발생했다: \(error)")
                return
            }
        } catch {
            Issue.record("예상하지 않은 오류 타입: \(error)")
        }
    }
}
