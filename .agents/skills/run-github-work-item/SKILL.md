---
name: run-github-work-item
description: 검증된 본문으로 개별 GitHub 이슈를 생성하고, 기본 의존 관계, 담당자 소유권, 작업 흐름 레이블, 선택적 GitHub Project 상태, 병합 뒤 완료와 후행 작업 차단 해제를 관리한다. 이슈를 작성·생성·점검하거나 구현을 시작·재개·완료할 때 사용한다.
---

# GitHub 작업 이슈 운영

이 Skill은 이슈 본문과 GitHub 생명주기만 소유합니다. 구현, 테스트 범위,
review와 commit 절차를 복제하지 않고 각 owner에게 인계합니다.

## 요청별 읽기

현재 요청에 필요한 참조만 읽습니다.

| 요청 | 읽을 참조 |
|---|---|
| 본문 작성·감사, `validate-body`, `check` | [issue-contract.md](references/issue-contract.md) |
| `start` | issue contract와 [CONTRIBUTING.md](../../../CONTRIBUTING.md)의 branch 절 |
| `complete`, `release`, `reconcile` | [work-item-lifecycle.md](references/work-item-lifecycle.md) |
| 개별 `create` | issue contract와 work-item lifecycle |
| MVP 일괄 등록 | [bulk-registration.md](references/bulk-registration.md) |

다른 참조를 선제적으로 읽지 않습니다. `docs/product-definition/**`은 역사
archive이며 이슈 작성·점검·구현 시작의 기본 입력이 아닙니다.

## 진입점

저장소 루트에서 실행합니다.

```bash
node .agents/skills/run-github-work-item/scripts/work-item.mjs check <issue>
node .agents/skills/run-github-work-item/scripts/work-item.mjs start <issue> --branch <branch> --agent <marker>
node .agents/skills/run-github-work-item/scripts/work-item.mjs complete <issue> --pr <merged-pr> --head <finalized-head> --repo <owner/repo>
node .agents/skills/run-github-work-item/scripts/work-item.mjs release <issue> --branch <branch> --agent <marker> --reason <text>
node .agents/skills/run-github-work-item/scripts/work-item.mjs reconcile <issue>
node .agents/skills/run-github-work-item/scripts/work-item.mjs validate-body <body-file> [--label <actual-label>...]
node .agents/skills/run-github-work-item/scripts/work-item.mjs create --idempotency-key <key> --title <title> --body <body-file> --milestone <title> --label <label> --dry-run
node .agents/skills/run-github-work-item/scripts/work-item.mjs create --idempotency-key <key> --title <title> --body <body-file> --milestone <title> --label <label> --confirm-plan <dry-run-token>
node .agents/skills/run-github-work-item/scripts/bootstrap-mvp.mjs validate
node .agents/skills/run-github-work-item/scripts/bootstrap-mvp.mjs apply --dry-run
```

`create`, `start`, `complete`, `release`, `reconcile`의 `--dry-run`은 조회와 계획만
수행합니다. `create` 실제 쓰기는 같은 입력의 직전 dry-run token을
요구합니다. `check`와 `validate-body`는 읽기 전용입니다.

## 이슈 작성과 검증

- 이슈는 독립적으로 병합 가능한 결과 하나를 소유합니다.
- 이슈 본문을 작업 컨텍스트 manifest로 작성합니다. 목표·완료 조건, 정확한
  PRD·Policy 파일과 ID, 좁은 허용·금지 경로, 관련 test case·suite·target과
  문서 영향을 기록합니다.
- 디렉터리 전체, 문서 인덱스 전체 또는 역사 archive를 구현 컨텍스트로
  요구하지 않습니다.
- `완료 조건`은 관련 있는 happy·error·recovery 행동과 검증 계획을
  연결합니다. 적용되지 않는 축을 형식적으로 채우지 않습니다.
- 제품 동작을 바꾸지 않는 `type:chore`만 issue contract의 tooling-only
  비적용 형식을 사용할 수 있습니다.
- 구조 validator 통과를 제품 타당성 승인으로 간주하지 않습니다.

로컬 본문은 실제 type label을 함께 전달해 검증합니다.

```bash
node .agents/skills/run-github-work-item/scripts/work-item.mjs \
  validate-body <body-file> --label type:chore
```

## 구현 시작 인계

1. `check`가 열린 `Todo`, 담당자 없음, 종료된 선행 관계와 해당되는 Project
   상태·동시 작업 한도를 확인해야 합니다.
2. 구현 직전에 `work/issue-<번호>-<설명>` branch와 안정적인 agent marker로
   `start`를 한 번 실행합니다.
3. 사후 조회에서 담당자, `status:in-progress`, 선점 marker·branch와 해당되는
   Project 상태가 모두 일치해야 구현할 수 있습니다.
4. 성공한 이슈 manifest만 구현 세션에 인계합니다. 그 뒤 컨텍스트 선택,
   관련 테스트와 review는 [AGENTS.md](../../../AGENTS.md)가 소유합니다.

`start`가 실패하면 branch를 만들거나 코드를 수정하지 않습니다. 상태를
바로잡고 현재 GitHub 상태를 확인한 새 명령으로만 재개합니다.

## 생성·상태 전이 안전

- `create`는 담당자를 입력하지 않으며 생성 뒤 담당자 0명을 재조회합니다.
- `status:todo`와 열린 기본 선행 이슈에 따른 `dependency:blocked`는 도구가
  파생합니다. type·area label만 명시적으로 전달합니다.
- MVP 이슈만 `--project`로 Project를 opt-in합니다. 검증된
  `project=none` marker가 있는 일반 이슈는 label 생명주기를 사용합니다.
- idempotency marker, 제목, milestone, label 집합이나 의존 관계가 충돌하면
  기존 이슈를 덮거나 자동 정리하지 않습니다.
- 일부 쓰기 뒤 실패하면 이슈를 삭제하거나 같은 요청을 자동 반복하지
  않습니다. 현재 상태를 재조회하고 새 dry-run으로 남은 단계만 계획합니다.
- Project 최대 `In Progress` 수는 best-effort admission guard입니다. 최종
  검증이 초과를 발견하면 구현을 시작하지 않습니다.
- 비밀, 내부 네트워크 식별자, 인증 정보와 개인 데이터를 공개 이슈에 넣지
  않습니다.

## 완료 안전

`complete`는 연결된 PR이 병합됐고, REST PR의 `base.repo.full_name`과
`head.repo.full_name`이 모두 작업 저장소와 같은 same-repository PR일 때만
실행합니다. fork, 저장소 신원 누락, branch·head 불일치 또는 불명확한 병합
응답은 완료 근거가 아닙니다.

병합 확인 뒤 이 Skill이 이슈 label·Project 상태·종료와 후행 의존성 전이를
소유합니다. 원격 branch와 로컬 worktree 정리는 `open-pull-request`가
소유합니다. 자동 retry 없이 마지막 성공 상태부터 재개합니다.
