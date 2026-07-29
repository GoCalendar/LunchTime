---
name: commit-work-item
description: LunchTime GitHub 작업 이슈의 변경을 범위, 관련 테스트, 제품 문서 영향과 한 번의 독립 review 결과에 대조하고 로컬·OS·IDE 잔여물을 index에서 차단한 뒤 안전한 원자적 Git commit으로 만든다. 이슈 구현을 stage·commit하거나 commit 메시지를 작성할 때 사용한다.
---

# 작업 이슈 Commit

이슈 하나의 검증된 결과만 commit합니다. 사용자 변경과 로컬 설정을 보존하며
원격 저장소에는 쓰지 않습니다.

## 필수 참조

Stage 또는 commit 전에 [커밋 계약](references/commit-contract.md)을 끝까지
읽습니다. 그 밖에는 현재 이슈와 이슈가 지정한 exact context만 읽습니다.
`README.md`, `AGENTS.md`, `CONTRIBUTING.md` 전체와
`docs/product-definition/**`은 기본 입력이 아닙니다.

## 1. 작업 단위 확인

1. 현재 branch, status, staged·unstaged·untracked 경로를 확인합니다.
2. `run-github-work-item start`의 선점 branch와 현재 branch를 대조합니다.
3. 이슈의 목표, 완료 조건, 추적성, 허용·금지 경로, 검증과 문서 영향을
   추출합니다.
4. 현재 branch가 `main`이거나 선점 기록과 다르면 중단합니다. 이 Skill이
   branch를 만들거나 바꾸지 않습니다.
5. 이슈 결과, 사용자 변경, 로컬 파일과 다른 이슈 변경을 구분합니다.

GitHub 이슈 번호로 `LT-NNN`을 추측하지 않습니다.

## 2. Commit 전 결과 확인

- 변경한 행동에 대해
  `direct case/suite → affected target → subsystem → global` 순서로 선택한
  관련 테스트가 통과해야 합니다. 전체 테스트는 영향 범위를 한정할 수 없거나
  release 검증을 명시한 경우에만 필요합니다.
- 이슈가 지정한 PRD·Policy·Architecture의 의미 영향이 확인돼야 합니다.
  필요한 정본이 범위 밖이면 현재 commit에 무단 포함하지 않고 blocker 또는
  후속 이슈로 분리합니다.
- [AGENTS.md](../../../AGENTS.md#독립-리뷰)의 위험도에 따른 review round가
  완료돼야 합니다. 낮은 위험은 reviewer 0명, 일반은 1명, 높은 위험은 같은
  round 최대 2명입니다.
- Reviewer finding은 메인 세션이 타당성을 판단해 수정하고, finding별 diff와
  직접 관련 테스트로 해소를 확인합니다. Reviewer를 다시 호출하거나 delta
  review chain을 만들지 않습니다.
- Review 뒤 범위·요구사항·아키텍처·신뢰 경계 확대가 필요하면 현재 commit을
  진행하지 않고 blocker 또는 후속 이슈로 분리합니다.

## 3. 안전한 staging

1. Skill 진입 전에 index가 비어 있는지 확인합니다. 기존 staged 변경이 있으면
   reset·unstage·stash하지 않고 중단합니다.
2. 검토한 개별 파일 목록을 확정합니다.
3. `git add -- <file>...`로 각 파일을 명시적으로 stage합니다.
4. 전체 cached diff를 읽어 이슈 범위, 비밀·개인 정보, 로컬 절대 경로, 개인
   설정과 우발적 binary를 확인합니다.
5. `validate-commit-paths.mjs --index`와 `git diff --cached --check`를
   실행합니다.
6. `git write-tree`로 최종 candidate tree를 기록합니다.

`git add .`, `git add -A`, `git add --all`, directory·glob staging과
`git commit -a`를 사용하지 않습니다. 같은 파일에 사용자 변경이 섞여
안전하게 분리할 수 없으면 stage하지 않습니다.

제품 문서, work item, PR body validator는 해당 artifact를 바꾼 경우나 해당
수명주기 단계에서만 실행합니다. 모든 commit에 공통 D0 묶음, heavy regression
group 또는 evidence JSON을 만들지 않습니다.

## 4. 메시지, 신원과 hook

작업 키가 있으면 첫 형식, 없으면 두 번째 형식을 사용합니다.

```text
<type>: LT-NNN - <관찰 가능한 결과>
<type>: #<이슈 번호> - <관찰 가능한 결과>
```

- 제목과 본문은 한국어를 기본으로 하되 ID, 경로, 명령과 기술 용어는 원문을
  사용할 수 있습니다.
- 필요하면 본문에 핵심 변경, 추적성, 실제 테스트 선택과 문서 영향을
  간결하게 적습니다.
- `Co-Authored-By`를 넣지 않습니다.
- 메시지 파일을 `validate-commit-message.mjs --file <file>`로 검증합니다.
- Git이 저장소에서 해석한 local author·committer 설정을 사용합니다. 값을
  덮어쓰거나 추적 파일·보고서에 노출하지 않습니다.
- 일반 `git commit`을 사용하고 활성 hook을 `--no-verify`로 우회하지
  않습니다.

## 5. Commit 후 확인

1. commit hash, 제목·본문과 포함 경로를 다시 읽습니다.
2. `HEAD^{tree}`가 stage 직전 기록한 candidate tree와 같은지 확인합니다.
3. author·committer가 사전 확인한 로컬 설정과 일치하는지 값을 출력하지 않고
   확인합니다.
4. 남은 staged·unstaged·untracked 상태를 확인하고 사용자 변경을 그대로
   둡니다.
5. 불일치나 hook 실패를 자동 amend·reset·retry하지 않습니다.

이 Skill은 push하지 않습니다. PR 단계에는 commit hash, 포함·제외 경로,
관련 테스트 선택·결과, 문서 영향, review round와 finding closure,
candidate/commit tree 일치만 인계합니다. `open-pull-request`가 push와
same-repository PR 경계를 검증합니다.

## 결과 보고

```text
커밋
- 이슈·branch:
- commit:
- 포함·제외 경로:
- 관련 테스트: 선택 범위·이유·명령·결과
- 제품 문서 영향:
- review: 위험도·reviewer 수·finding closure
- staging 안전: path·공백 검사
- tree: candidate와 commit 일치 여부
- 신원·hook: 값이 아닌 일치·결과
- 남은 변경:
- push: 실행하지 않음
```
