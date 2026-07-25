# LunchTime 개발 협약

이 문서는 LunchTime의 브랜치, 작업 진행, 커밋, 풀 리퀘스트와 병합 흐름을
연결하는 사람용 정본입니다. 세부 실행 절차는 각 스킬과 템플릿이 담당하며,
서로 충돌하면 이 문서의 전체 흐름과 더 구체적인 실행 계약을 함께 수정합니다.

## 1. 기본 원칙

- 개발 방식은 Trunk-Based Development를 사용합니다.
- `main`은 유일한 trunk이며 언제나 빌드·검증 가능한 상태를 유지합니다.
- `main`은 GitHub의 `Trunk-Based Development` ruleset으로 직접 push,
  삭제와 force push를 막고 PR을 통해서만 갱신합니다.
- `develop`, `release` 같은 장기 통합 브랜치를 만들지 않습니다.
- 하나의 이슈는 독립적으로 병합 가능한 결과 하나를 소유합니다.
- 하나의 이슈는 작업 브랜치 하나, 담당자 하나, 풀 리퀘스트 하나와 연결합니다.
- AI 도구가 달라도 같은 이슈·문서·브랜치·검증 계약을 사용합니다.

## 2. 전체 작업 흐름

새 이슈 작성·감사는 `run-github-work-item`의 on-demand `create` 흐름이며 아래
11단계 밖에서 수행합니다. 요청 유형별 첫 정본 입력, Skill owner와 종료 지점은
[개발 하네스 가이드](docs/development/01_harness_guide.md)를 따릅니다.

1. 이슈와 관련 제품 정본의 맥락, 목표, 완료 조건, 추적 ID, 선행 작업과 변경
   경로를 읽습니다.
2. `run-github-work-item check`로 준비 상태를 확인합니다.
3. 사용할 짧은 수명 브랜치를 정하고 `run-github-work-item start`로 선점합니다.
4. 선점 성공 뒤 `origin/main`에서 독립 작업 트리와 브랜치를 만듭니다.
5. 이슈 `완료 조건`에서 행동 시나리오와 검증 계획을 정리합니다.
6. 실패 테스트에서 시작해 구현하고 관련 회귀 테스트를 통과합니다.
7. `update-product-docs`로 제품 문서 영향을 확인합니다.
8. 작성 컨텍스트와 분리된 읽기 전용 독립 리뷰를 통과합니다.
9. `commit-work-item`으로 의도한 경로만 stage해 원자적으로 커밋합니다.
10. `open-pull-request`로 검증된 본문을 만들고 PR과 필수 CI를 통과합니다.
    PR 생성·갱신만 요청받았다면 여기서 멈춥니다.
11. 완료·병합 요청에서는 같은 Skill의 exact-head finalize로 squash merge한
    뒤 `run-github-work-item complete`로 이슈와 Project를 정리하고, 성공 뒤
    HEAD·local ref OID가 검증한 head와 같은 clean worktree와 local branch만
    old-OID CAS로 정리합니다.

어느 단계든 사전 조건이나 검증이 실패하면 다음 단계로 넘어가지 않습니다.
실패한 명령을 반복 실행하지 않고 실제 상태와 복구 안내를 먼저 확인합니다.
11단계의 목적·입력·완료·중단 조건은
[개발 하네스 가이드](docs/development/01_harness_guide.md)를 따릅니다.

## 3. 브랜치와 작업 트리

### 브랜치 형식

```text
work/issue-<이슈 번호>-<짧은 영문 설명>
```

예시:

```text
work/issue-17-menu-ack
```

- 이슈 번호는 GitHub 이슈 번호를 그대로 사용합니다.
- 설명은 소문자 영문, 숫자와 하이픈만 사용합니다.
- 도구명, 작업자명과 임시 상태를 브랜치명에 넣지 않습니다.
- 브랜치명은 `start` 선점 댓글에 기록한 값과 정확히 같아야 합니다.

### 운영 규칙

- `main`에 직접 커밋하거나 push하지 않습니다.
- `start`가 성공하기 전에 작업 브랜치를 만들지 않습니다.
- 새 브랜치는 최신 `origin/main`을 기준으로 만듭니다.
- 작업자마다 독립 worktree를 사용하고 같은 브랜치를 공유하지 않습니다.
- 브랜치가 여러 독립 결과를 포함하거나 오래 유지되어야 한다면 이슈를 더 작은
  단위로 나눕니다.
- 최초 push 전에는 필요하면 `origin/main` 위로 rebase할 수 있습니다.
- 이미 공개한 브랜치의 이력을 자동으로 다시 쓰거나 force push하지 않습니다.
  필요한 경우 사용자와 영향 범위를 확인한 뒤 `--force-with-lease`만 사용합니다.

## 4. 개발 템플릿

작업의 입력은 [MVP 작업 이슈 양식](.github/ISSUE_TEMPLATE/work-item.yml),
실행 계획은 아래 템플릿, 리뷰 인계는
[풀 리퀘스트 템플릿](.github/PULL_REQUEST_TEMPLATE.md)을 사용합니다.
세 템플릿은 같은 이슈와 추적 ID를 공유하지만 내용을 서로 복제하지 않습니다.

구현을 시작하기 전에 다음 항목을 짧게 정리합니다. 이 내용은 대화 이력에만
의존하지 말고 이슈와 정본 문서에서 다시 확인할 수 있어야 합니다.

```text
작업 이슈:
사용자에게 남길 결과:
관련 PRD·정책 ID:
선행 작업:
변경 허용 경로:
변경 금지 경로:
예상 변경 영역:
행동 시나리오(happy·error·recovery):
검증 명령과 증거:
독립 리뷰 관점·인원:
제품 문서 영향:
병렬 작업 충돌 가능성:
```

구현 중 제품 결정이 새로 필요해지면 코드에 임의의 기본값을 넣지 않습니다.
결정 기록과 PRD·정책을 먼저 갱신하거나 작업을 중단하고 결정을 요청합니다.
이미 승인된 결정에 필요한 새 ID라면 구현 이슈가 planned ID, namespace
번호가 일치하는 구체적 `NN_*.md` 정본 파일·인덱스·구현·테스트 경로를
명시적으로 소유할 때 별도 문서 이슈 없이 같은 branch와 PR에서 정의할 수
있습니다. README나 재귀 glob만으로는 정의 파일 소유가 되지 않습니다. Ready
전에는 exact head Git tree에서 새 ID의 실제 정의와 validator,
구현·테스트·PR의 양방향 추적을 확인합니다.

## 5. 테스트와 독립 리뷰

행동 시나리오는 이슈의 `완료 조건`이 소유합니다. 구현 전에 PRD·Policy에서
관찰 가능한 조건·행동·결과와 추적 ID를 도출하고, 모든 단위 테스트에 Gherkin을
강제하지 않으며 결정적인 단위·구성요소·통합·계약 테스트를 선택합니다. 상세
축과 흐름은 [BDD/ATDD 테스트 표준](docs/development/02_testing_standard.md)을
따릅니다.

독립 리뷰는 작성 컨텍스트와 분리된 읽기 전용 reviewer에게 원본 요구사항, raw
diff와 실제 테스트 결과를 제공해 수행합니다. 기대 답을 주입하지 않고
작성·수정자와 승인 역할을 분리합니다. P0~P2에는 `file:line`과 재현 근거를
남기고, 수정 뒤 새 snapshot을 별도 pass로 확인합니다.

- 단순 문서·국소 변경은 최소 1명, 계약·validator·workflow 변경은 최소 2명,
  분산 통신·정합성·보안은 전문 관점별 reviewer를 사용합니다.
- 최초 검토를 포함해 최대 3 pass만 수행하며, 세 번째에도 P0/P1이 남으면
  무한 반복하지 않고 blocker로 보고합니다.
- PR `검증` 표에는 `독립 리뷰` 행을 정확히 하나 두고 관점·결과·근거를
  기록합니다. Ready PR에서는 이 행이 통과해야 합니다.
- 현재 계약에는 기존 네 Skill이면 충분하며 새 리뷰 전용 Skill을 추가하지
  않습니다.

## 6. 커밋 컨벤션

커밋의 상세 정본은
[`commit-work-item` 계약](.agents/skills/commit-work-item/references/commit-contract.md)입니다.

- 하나의 커밋에는 하나의 설명 가능한 목적만 담습니다.
- `git add .`, `git add -A` 대신 검토한 경로를 명시적으로 stage합니다.
- 사용자 소유 파일, 로컬 설정, 인증 정보와 작업 범위 밖 변경을 포함하지
  않습니다.
- 제목은 다음 형식을 기본으로 사용합니다.

  ```text
  <type>: LT-NNN - 결과 중심 요약
  ```

- 관리 키가 없는 이슈는 `LT-NNN` 대신 `#<이슈 번호>`를 사용합니다.
- 제목과 본문은 한국어를 기본으로 하되 코드 식별자와 기술 용어는 원문을
  사용할 수 있습니다.
- 커밋은 push하지 않습니다. 원격 게시와 풀 리퀘스트 생성은
  `open-pull-request` 단계에서 수행합니다.

## 7. 풀 리퀘스트 컨벤션

본문의 상세 정본은
[`open-pull-request` 계약](.agents/skills/open-pull-request/references/pr-body-contract.md)과
[풀 리퀘스트 템플릿](.github/PULL_REQUEST_TEMPLATE.md)입니다.

- 하나의 풀 리퀘스트는 하나의 이슈와 하나의 결과를 닫습니다.
- base는 `main`이며 본문에 `Closes #<이슈 번호>`를 포함합니다.
- 제목은 커밋 제목 형식을 그대로 사용합니다. squash merge 뒤 이 제목이
  `main`의 커밋 제목이 됩니다.
- 이슈나 PRD 전체를 복사하지 않고 이번 변경을 이해하는 데 필요한 맥락과
  결정만 요약하고 정본을 링크합니다.
- 본문은 버전 marker와 `연결된 이슈`, `변경 요약`, `추적성`, `검증`,
  `문서 영향`의 고정된 다섯 구역을 유지합니다.
- 검증은 자기 선언 체크박스가 아니라 대상, 명령·확인, 실제 결과와 증거로
  기록합니다.
- `독립 리뷰` 검증 행은 정확히 하나 두며 Ready에는 통과한 증거만 허용합니다.
- 미완료 작업을 숨기지 않습니다. 완료 조건이 남아 있으면 Draft로 열고 남은
  조건을 명시합니다.
- 인증 정보, 내부 네트워크 식별자, 개인 데이터와 로컬 절대 경로를 본문에
  넣지 않습니다.

## 8. 병합과 정리

- PR 생성·갱신만 요청받았으면 병합하지 않습니다. 완료·병합 또는 end-to-end
  요청에만 `open-pull-request`의 finalize 계약을 사용합니다.
- base `main`인 Ready PR의 정확한 현재 head가 독립 리뷰 snapshot과 일치하고,
  필수 CI가 통과하며 미해결 review thread가 0개이고 제목·본문·종료 참조가
  재검증된 경우에만 병합합니다. required check는 같은 PR head의
  `statusCheckRollup` run에, thread 응답은 같은 repo·PR·base·head·
  `updatedAt`에 귀속되어야 합니다.
- GitHub의 필수 `validate` 상태 검사는 최신 `main`을 기준으로 통과해야
  합니다. base가 앞서가면 변경을 다시 검증한 뒤에만 병합합니다.
- 필수 승인 수는 1인 운영을 막지 않도록 0으로 두지만, 생성된 리뷰 대화는
  모두 해결해야 합니다.
- `main`에는 squash merge만 사용해 이슈당 하나의 결과가 남게 합니다.
- squash 제목은 풀 리퀘스트 제목의 커밋 컨벤션을 유지합니다.
- 검증한 exact head에 대해 squash merge를 한 번만 실행하고, 응답 실패나
  불명확 상태에서는 재시도하기 전에 PR·원격 branch 상태를 재조회합니다.
- 이미 `MERGED`인 PR에서 재개할 때는 `mergedAt`·merge commit·exact
  head/branch·review-head·Ready 본문·종료 참조를 recovery mode로 검증하고,
  merge commit의 단일 parent가 PR base이고 tree가 exact head와 같으며 제목·
  actor·`origin/main` first-parent 포함이 일치하는 squash topology도
  검증합니다. 병합 전용 CI·review thread 입력은 다시 판정하지 않습니다. exact head를
  입력한 `complete --dry-run`으로 선점·담당자·PR 연결을 확인한 뒤 merge를
  반복하지 않은 채 원격 ref 확인부터 이어갑니다. GitHub auto-close로 이슈가
  `completed` 종료된 상태는 다시 열지 않습니다. issue worktree가 이미 없으면
  clean `main` worktree에서 재개할 수 있습니다.
- 병합된 원격 브랜치는 현재 remote OID가 검증한 head와 같은 경우에만
  lease/CAS로 삭제하고 ref 부재를 재조회합니다. branch가 이동·재생성됐으면
  삭제하지 않습니다. 그 뒤에만 이슈를 `Done`으로 만들고 후행 이슈의 차단
  상태를 갱신합니다.
- `complete` 성공 뒤 정확한 대상 worktree와 local branch가 clean이고 둘의
  OID가 검증한 head와 같으며 tracked·untracked·ignored 경로가 모두 없는
  경우에만 worktree를 제거하고, 검증한 old OID의
  `git -C <main-worktree> update-ref -d` CAS로 local branch를 정리합니다.
  제거할 worktree를 cwd로 사용하지 않으며 `.omc` 같은 ignored 상태,
  dirty·사용자 소유 변경, OID
  불일치나 불명확한 대상은 삭제하지 않습니다.

## 9. 예외

긴급 수정도 별도 이슈, 짧은 브랜치와 풀 리퀘스트를 사용합니다. 보안 사고처럼
공개 이슈나 본문에 맥락을 남길 수 없는 경우에는 민감정보를 제거한 최소 참조만
남기고 별도 승인된 비공개 채널을 사용합니다. 예외가 반복되면 일회성 우회 대신
이 협약과 하네스를 갱신합니다.
