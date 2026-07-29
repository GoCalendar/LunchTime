# LunchTime BDD/ATDD 테스트 표준

이 문서는 이슈의 완료 조건을 빠르고 결정적인 테스트로 바꾸고, 변경 영향에
필요한 범위만 실행하는 기준입니다. 제품 기능의 회귀 책임은 테스트 코드가
소유하며 reviewer나 별도 하네스 gate가 같은 기능을 중복 검증하지 않습니다.

## 테스트 범위 선택

항상 다음 순서에서 가장 좁고 충분한 범위를 선택합니다.

| 단계 | 선택 기준 | 예 |
|---|---|---|
| 1. direct case 또는 suite | 변경 행동을 독립 실행할 수 있음 | 특정 XCTest case, 특정 Node test file |
| 2. affected target | 직접 case 분리가 불가능하거나 한 target의 여러 경계가 함께 바뀜 | `LunchTimeTests`, 특정 package target |
| 3. affected subsystem | 여러 target이 공유하는 interface·저장·통신 경계가 바뀜 | 동기화 subsystem, 하네스 owner validator 묶음 |
| 4. global | 영향 범위를 신뢰성 있게 한정할 수 없음 또는 release 검증을 명시함 | 전체 앱 test, 전체 저장소 계약 test |

“안전해 보이므로 전체 실행”은 global 선택 근거가 아닙니다. 다음 중 하나일
때만 한 단계 넓힙니다.

- 직접 실행한 test가 변경 경계를 충분히 포함하지 않습니다.
- 공용 protocol, schema, build manifest, dependency, toolchain처럼 여러
  consumer가 함께 영향을 받습니다.
- 변경 경로와 test target의 대응을 확인할 수 없습니다.
- 관련 test 실패가 더 넓은 상호작용을 드러냅니다.
- 사용자가 release 또는 전체 회귀 검증을 명시했습니다.

문서만 변경하면 앱 테스트를 실행하지 않습니다. 하네스 문서·Skill 변경은
해당 owner의 validator 또는 계약 test만 선택합니다. validator 구현이 바뀌면
그 validator의 직접 test suite를 실행하고, 공유 parser·classifier가 바뀌어
consumer를 한정할 수 없을 때만 subsystem 또는 global로 넓힙니다.

## 선택 절차

1. 이슈 완료 조건과 diff에서 바뀐 관찰 가능한 행동을 적습니다.
2. 그 행동을 직접 검증하는 기존 test 이름·파일·target을 찾습니다.
3. 누락된 happy·error·recovery 결과가 있으면 가장 낮은 계층에 test를
   추가합니다.
4. 선택한 case·suite가 변경의 모든 consumer를 포함하는지 확인합니다.
5. 부족할 때만 위 사다리의 다음 단계로 넓힙니다.
6. 선택한 범위, 확대 또는 생략 이유, 명령과 실제 결과를 이슈 또는 PR에
   간결하게 기록합니다.

로컬 구현과 CI는 같은 선택 근거를 사용합니다. CI라는 이유만으로 global
test를 기본 실행하지 않습니다.

## 행동 시나리오

- 사용자·업무 행동은 `Given / When / Then` 또는 `조건 / 행동 / 결과`로
  표현합니다.
- private method보다 외부에서 관찰할 상태, 출력, 차단과 복구를 검증합니다.
- 모든 기능에 모든 시나리오 축을 기계적으로 복제하지 않습니다. 관련
  PRD·Policy와 실제 위험에 맞는 축만 선택합니다.
- 모든 단위 테스트에 Gherkin 형식을 강제하지 않습니다. 작은 단위 테스트는
  이름과 arrange/act/assert 구조로 같은 의도를 명확히 표현해도 됩니다.
- 테스트 이름이나 주석에는 실제 검증하는 PRD·Policy ID만 연결합니다.

필요할 수 있는 시나리오 축은 다음과 같습니다.

| 축 | 확인할 질문 |
|---|---|
| 정상과 입력 경계 | 유효·최소·최대·마감 전후 결과가 계약과 같은가? |
| 권한과 소유권 | 허용된 주체만 읽기·쓰기·상태 전이를 하는가? |
| 중복·순서·동시성 | 중복, 역순과 동시에 유효한 변경의 결과가 결정적인가? |
| 단절·timeout·복구 | 제한 안에 복구하고 한도 뒤 실패를 숨기지 않는가? |
| 저장·보존 | 재실행·만료·삭제 뒤 데이터 계약을 지키는가? |
| 보안·신뢰 | 검증 실패나 경계 밖 데이터를 적용하지 않는가? |

## 구현 흐름

1. 이번 변경에 필요한 행동 시나리오와 직접 test를 고릅니다.
2. 실패가 올바른 이유인지 확인합니다.
3. 허용 범위 안의 최소 구현으로 통과시킵니다.
4. 리팩터링 뒤 같은 관련 test를 다시 실행합니다.
5. 일반 review round에서 테스트 공백도 함께 검토합니다.
6. finding 수정 뒤 해당 finding과 직접 관련된 test만 다시 실행합니다.
7. CI에서 같은 affected target을 exact PR head에 대해 실행합니다.

Reviewer finding을 고친 뒤 reviewer에게 테스트를 다시 판단시키지 않습니다.
메인 세션이 finding, 수정 diff와 실제 관련 test 결과를 연결해 closure를
확인합니다. 수정에 더 넓은 범위가 필요하면 현재 이슈를 확장하지 않고
blocker 또는 후속 이슈로 분리합니다.

## 결정적 테스트

| 피할 방식 | 사용할 방식 |
|---|---|
| 임의 `sleep` | 주입 가능한 fake clock·scheduler |
| 실제 네트워크의 우연한 timing | 전달·단절·순서를 제어하는 fake transport |
| 매번 다른 무작위 입력 | 고정 seed 또는 의미 있는 fixture |
| 종료 조건 없는 polling·retry | 횟수와 시간 상한 |
| 실행 순서·전역 공유 상태 의존 | test별 상태 생성과 정리 |
| 통과할 때까지 rerun | 원인을 수정한 새 실행 |

환경 전용 실패로 판단해도 같은 명령을 자동 반복하지 않습니다. 원인과 입력
동일성을 확인한 뒤 필요한 경우 한 번의 새 실행만 증거로 남깁니다.

## 테스트 계층

가장 낮고 빠른 계층에서 실패 원인을 좁히되 경계 간 결과가 필요하면 한 단계
올립니다.

| 계층 | 책임 |
|---|---|
| 단위 | reducer, 권한, 경계, 순수 변환 |
| 구성요소 | 저장소, 조정자, 화면 모델 한 경계의 입출력 |
| 결정적 통합 | fake clock·transport·저장소를 묶은 상호작용과 복구 |
| validator·계약 | 문서·이슈·commit·PR interface |
| E2E | 안정된 핵심 사용자 흐름의 제한된 release 신뢰 |

E2E는 MVP의 기본 gate가 아닙니다. UI와 interface가 안정되고 실행 시간·
flakiness·유지 비용을 평가할 별도 이슈에서 도입합니다. E2E가 없다는 이유로
관찰 가능한 행동 test를 생략하지 않습니다.

## 검증 기록

테스트 증거에는 다음만 남깁니다.

- 검증한 행동 또는 finding
- 선택한 case·suite·target
- 그 범위가 충분한 이유와 생략·확대 근거
- 실행 명령, 종료 결과와 test 수
- 실패가 있었다면 원인과 수정 결과

tree digest, 회귀군 ledger나 반복 review chain은 요구하지 않습니다. commit과
PR head 일치, staging과 same-repository 안전은 각 Git Skill이 별도로
확인합니다.
