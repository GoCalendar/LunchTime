---
name: run-github-work-item
description: 검증된 본문, GitHub 기본 의존 관계, 담당자 소유권, 작업 흐름 레이블, GitHub Project 상태, 병합된 PR 완료 처리와 후행 작업 차단 해제를 일관되게 관리한다. MVP 작업을 일괄 등록하거나, 이슈를 작성·점검하거나, 구현을 시작·재개하거나, 차단 상태를 복구하거나, PR 병합 뒤 이슈와 프로젝트를 정리할 때 사용한다.
---

# GitHub 작업 이슈 운영

GitHub 이슈, Project와 의존 관계 상태를 일치시킨다. 점검 실패를 중단 조건으로 취급하고, 구현을 시작하거나 일부 상태만 임의로 전이하지 않는다.

## 요청 분류

- **준비 상태만 점검:** [issue-contract.md](references/issue-contract.md)를 읽고 `check`를 실행한다.
- **구현 시작:** 두 참조 문서와 [개발 협약](../../../CONTRIBUTING.md)을 읽고 `work/issue-<번호>-<설명>` 형식의 짧은 브랜치와 안정적인 에이전트 표식을 정한다. `start` 성공을 확인한 뒤 최신 `origin/main`에서 기록된 정확한 브랜치를 만들거나 전환한다.
- **병합된 작업 완료:** [work-item-lifecycle.md](references/work-item-lifecycle.md)를 읽고 PR 병합을 확인한 뒤 `complete`를 실행한다.
- **병합되지 않은 작업 포기:** [work-item-lifecycle.md](references/work-item-lifecycle.md)를 읽고 열려 있는 PR을 닫은 뒤 원래 브랜치, 에이전트 표식과 사유로 `release`를 실행한다.
- **파생 차단 레이블 복구:** [work-item-lifecycle.md](references/work-item-lifecycle.md)를 읽고 선점되지 않은 `Todo` 이슈에만 `reconcile`을 실행한다.
- **이슈 본문 작성·감사:** [issue-contract.md](references/issue-contract.md)를
  읽고 `완료 조건`에 happy·error·recovery 행동 시나리오, 추적 ID와 검증
  계획을 연결한다. 로컬 본문 파일이 있으면 `validate-body`를 실행하되 구조
  통과를 시나리오 품질 승인으로 간주하지 않는다.
- **MVP 작업 목록 일괄 등록:** [bulk-registration.md](references/bulk-registration.md)를 읽고 `.github/mvp-work-items.json`을 검토한 뒤 `validate`, `apply --dry-run`, 한 번의 제한된 `apply`를 차례로 실행한다.

저장소 루트 기준 진입점을 사용한다.

```bash
node .agents/skills/run-github-work-item/scripts/work-item.mjs check <issue>
node .agents/skills/run-github-work-item/scripts/work-item.mjs start <issue> --branch <branch> --agent <marker>
node .agents/skills/run-github-work-item/scripts/work-item.mjs complete <issue> --pr <merged-pr>
node .agents/skills/run-github-work-item/scripts/work-item.mjs release <issue> --branch <branch> --agent <marker> --reason <text>
node .agents/skills/run-github-work-item/scripts/work-item.mjs reconcile <issue>
node .agents/skills/run-github-work-item/scripts/work-item.mjs validate-body <body-file>
node .agents/skills/run-github-work-item/scripts/bootstrap-mvp.mjs validate
node .agents/skills/run-github-work-item/scripts/bootstrap-mvp.mjs apply --dry-run
```

`start`, `complete`, `release`, `reconcile`에 `--dry-run`을 추가하면 모든 조회를 수행하고 예정된 변경을 출력하되 GitHub 상태는 쓰지 않는다. `check`와 `validate-body`는 항상 읽기 전용이다.

구현은 이슈의 시나리오를 테스트하고 제품 문서 영향을 판정한 뒤 고정한 raw
diff snapshot을 작성 컨텍스트와 분리된 읽기 전용 검토자에게 넘긴다. 작성자
자기 검토는 독립 리뷰가 아니며 작성·수정자와 최종 승인자를 분리한다. 의도한
답이나 예상 결론을 주입하지 않고 원본 요구사항, raw diff와 테스트 결과를
제공하며, 검토자는 P0~P2 발견 사항을 파일 위치와 재현 근거로 보고하고 직접
수정하지 않는다. 낮은 위험은 최소 1명, 계약·validator·workflow 변경은 최소
2명, 고위험 변경은 필요한 전문 관점별 검토자를 사용한다. 수정 후에는 새
snapshot을 별도 패스로 검토하고 최초 리뷰를 1회로 세어 최대 3회까지만
review-fix를 반복한다. 3회 뒤에도 P0/P1이 남으면 상태 전이나 승인을 진행하지
않고 blocker로 보고한다. 이 흐름을 위해 새 리뷰 전용 Skill을 만들지 않는다.

## 안전 규칙

1. 저장소 작업 트리에서 실행하고 스크립트가 `.github/work-management.json`을 읽게 한다.
2. 이슈와 작업 문서는 한국어를 기본 작성 언어로 사용한다. 자연스러운 표현과 정확한 의미 전달을 우선하며, 계약 ID, 레이블, 프로젝트 필드·옵션, 명령, 경로, URL, 코드 식별자와 기술 용어는 원문을 사용할 수 있다.
3. 실패한 사전 조건, GitHub 기본 의존 관계, 동시 작업 한도 또는 변경 후 검증을 우회하지 않는다.
4. 반복문으로 재시도하지 않는다. 보고된 상태를 바로잡은 뒤 제한된 새 명령을 한 번 실행한다.
5. `Todo`로만 표시된 이슈에서 작업하지 않는다. 성공한 `start` 선점이 필요하다.
6. 연결된 PR이 병합되기 전에 `complete`를 실행하지 않는다.
7. 인증 정보를 인자나 파일에 넣지 않는다. 스크립트는 활성 `gh` 계정을 사용한다.
8. 변경 도중 실패하면 중단한다. 복구 안내를 따르고 실제 상태를 확인한 뒤에만 다시 실행한다. 상태 전이와 표식 댓글은 멱등이다.
9. 표식 작성자와 상태 변경 실행자는 검증된 저장소 쓰기 이상 권한이 있어야 한다. 신뢰할 수 없는 이슈 댓글을 선점으로 취급하지 않는다.
10. `maxInProgress`를 여러 이슈를 묶는 트랜잭션이 아니라 GitHub 조회 일관성에 의존하는 최선 노력 방식의 진입 제한으로 취급한다.
11. `main`에 직접 커밋하거나 장기 통합 브랜치를 만들지 않는다. 이슈마다 독립 worktree와 짧은 수명 브랜치 하나를 사용한다.

정확한 이슈 본문 계약은 [issue-contract.md](references/issue-contract.md)에 있다. 상태 전이, 설정, 의존 관계 해제와 복구 규칙은 [work-item-lifecycle.md](references/work-item-lifecycle.md)에 있다. 순서가 보장되고 멱등인 MVP 등록 절차는 [bulk-registration.md](references/bulk-registration.md)에 있다.
