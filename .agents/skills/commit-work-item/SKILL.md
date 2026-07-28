---
name: commit-work-item
description: LunchTime GitHub 작업 이슈의 로컬 변경을 범위·제품 문서 영향·검증 증거와 대조하고 로컬 도구·OS·IDE 잔여물의 Git index 진입을 차단한 뒤 안전한 원자적 Git 커밋으로 만든다. 이슈 구현을 커밋하거나, 커밋 메시지를 작성하거나, 변경을 스테이징해 커밋해 달라는 요청에 사용한다.
---

# 작업 이슈 커밋

이슈 하나의 검증된 결과만 커밋한다. 사용자가 소유한 변경과 로컬 설정을
보존하고, 커밋 뒤에도 원격 저장소에는 쓰지 않는다.

## 필수 계약 읽기

스테이징이나 커밋 전에 [커밋 계약](references/commit-contract.md)을 끝까지
읽는다. 계약의 중단 조건을 우회하지 않는다.

## 1. 작업 단위 확인

1. 저장소 루트에서 `README.md`, `AGENTS.md`, `CONTRIBUTING.md`와 GitHub
   이슈를 읽는다.
2. 이슈의 `LT-NNN`, 목표, 완료 조건, 추적성, 변경 허용·금지 경로, 검증,
   문서 영향을 추출한다. GitHub 이슈 번호로 `LT-NNN`을 추측하지 않는다.
3. `run-github-work-item`이 기록한 선점 정보와 현재 브랜치를 대조한다.
4. `main` 직접 커밋을 거부하고 `CONTRIBUTING.md`와 선점 기록의 브랜치
   계약을 적용한다.
5. 브랜치가 없거나 서로 다르면 이 스킬에서 임의로 만들거나 바꾸지 말고
   중단한다. 장기 `develop` 또는 `release` 브랜치를 대안으로 사용하지 않는다.

## 2. 변경 범위 확정

1. 추적·미추적·이미 스테이징된 변경을 모두 조사한다.
2. 각 변경을 이슈 결과, 사용자 소유 변경, 로컬 개인 설정, 작업 범위 밖
   변경으로 분류한다.
3. 이슈 결과에 필요한 파일만 선택한다. 소유권이나 변경 의도가 불명확하면
   스테이징하지 않고 사용자에게 정확한 경로와 이유를 보고한다.
4. 서로 독립적으로 되돌려야 하는 결과가 섞였으면 커밋 경계를 제안하고
   선택된 원자적 결과 하나만 진행한다.
5. 제품 동작·상태·권한·실패·동기화·보존·보안 또는 앱 아키텍처 변경에는
   `update-product-docs`로 PRD·Policy·Architecture 의미 영향을 독립 리뷰
   전에 확인한다. 정본 갱신이 필요하지만 이슈 경로 계약이 허용하지 않으면
   tooling-only 비적용을 승인하거나 커밋하지 않는다.

## 3. Candidate staging과 독립 리뷰

1. 이슈에 지정된 빠른 행동 테스트를 수행하고 실제 통과한 명령·테스트 수와
   필요한 수동 확인만 기록한다. 바뀔 snapshot에 현재 `AGENTS.md`의 고정
   게이트 전체를 실행하지 않는다.
2. `update-product-docs`의 PRD·Policy·Architecture 의미 영향과 이슈의
   변경 허용·금지 경로 판정을 끝낸다.
3. 스킬 진입 전에 존재하던 index가 비어 있는지 확인한다. 다른 작업의 staged
   변경이 있으면 임의로 해제하거나 덮지 않고 중단한다.
4. 선택한 개별 파일만 `git add -- <path>...`로 stage한다. `git add .`,
   `git add -A`, `git add --all`, 디렉터리·glob 경로와 `git commit -a`를
   사용하지 않는다.
5. unstaged tracked 변경과 예상하지 않은 untracked 입력이 없는지 확인하고
   base OID, 전체 cached diff digest, `git write-tree`의 candidate tree OID와
   filesystem input 상태를 하나의 candidate identity로 고정한다.
6. 전체 cached diff를 다시 읽어 이슈 범위, 비밀·개인 정보, 로컬 절대 경로,
   개인 설정과 우발적 파일을 확인한다.
7. 작성 컨텍스트와 분리된 읽기 전용 검토자가 원본 요구사항, 같은 cached
   diff·candidate tree, 행동 테스트와 의미 영향 결과를 예상 결론 없이
   검토한다. 작성자 자기 검토는 독립 리뷰가 아니며 작성·수정자와 최종
   승인자를 분리한다.
8. 증거에는 P0~P2 발견 사항의 파일 위치·재현 근거와 해소 결과, candidate
   identity, 검토자 수·관점이 있어야 한다. 낮은 위험은 최소 1명,
   계약·validator·workflow 변경은 최소 2명, 고위험 변경은 필요한 전문
   관점별 검토자를 병렬 배치한다.
9. 같은 snapshot의 발견 사항을 모두 합쳐 한 번에 수정한다. 수정이 있었다면
   필요한 행동 테스트와 의미 영향 판정을 갱신하고 다시 명시적으로 stage한 새
   candidate를 별도 리뷰한다. review-fix 사이에는 저장소 고정 게이트 전체를
   실행하지 않는다. 최초 리뷰를 1회로 세어 최대 3회이며, 3회 뒤에도 P0/P1이
   남으면 blocker로 보고한다. 새 리뷰 전용 Skill을 만들지 않는다.

## 4. 최종 게이트와 snapshot 결속

1. 더 이상 계획된 수정이 없고 최종 독립 리뷰·의미 영향 증거가 현재
   candidate identity와 일치할 때만 이슈 검증과 현재 `AGENTS.md` 고정
   게이트의 중복 제거된 합집합을 한 번 실행한다.
2. 서로 독립된 읽기 전용·격리 명령만 같은 candidate에서 병렬 실행한다. 같은
   index·working tree·외부 상태·공유 cache·자원을 쓰는 명령은 순차 실행하고
   모든 결과를 join한 뒤 한 번에 판정한다.
3. 게이트 전후 candidate tree와 filesystem input 상태가 같고 unstaged tracked
   변경과 예상하지 않은 untracked 입력이 없는지 확인한다.
4. 다음 결정적 gate로 전체 Git index에서 `.omc`, OS 메타데이터와 명백한
   편집기·IDE 개인 상태를 검사한다.

   ```bash
   node .agents/skills/commit-work-item/scripts/validate-commit-paths.mjs --index
   ```

   실패하면 커밋하거나 파일을 자동 삭제·unstage하지 말고 정확한 경로와 이유를
   보고한다. `.gitignore`는 일반 staging과 상태 노이즈를 줄일 뿐 이 gate를
   대체하지 않는다.
5. 커밋할 패치 자체에 `git diff --cached --check`를 실행한다.
6. tracked content를 수정하면 행동·의미 영향·리뷰·게이트 증거를 모두
   무효화하고 3절의 필요한 빠른 행동 테스트부터 새 candidate를 다시 만든다.
   tree·input이 같은 환경 전용 실패만 원인과 동일성 근거를 기록한 새 명령으로
   한 번 실행하며 자동 반복하지 않는다.
7. candidate와 input이 같아도 의미 영향·독립 리뷰 증거가 불완전하면 3절의
   의미 영향 판정과 새 독립 리뷰부터 복구한 뒤 최종 게이트로 진행한다.
8. 최종 gate 증거만 불완전하고 candidate와 input이 같으면 같은 clean
   snapshot에서 고정 게이트 전체를 새로 실행한다.
9. candidate tree나 input이 다르면 모든 로컬 증거 재사용을 거부하고 3절의
   필요한 빠른 행동 테스트부터 새 candidate를 다시 만든다.

## 5. 메시지와 신원 확인

1. 작업 키가 있으면 `<type>: LT-NNN - <결과>`, 없으면
   `<type>: #<이슈 번호> - <결과>` 형식으로 작성한다.
2. 제목과 본문은 한국어를 기본으로 하되 ID, 경로, 명령, 코드 식별자와
   기술 용어는 필요한 원문을 사용한다.
3. 제목만으로 맥락이 충분하지 않으면 본문에 핵심 변경, 추적성, 검증과 제품
   문서 영향을 간결하게 남긴다.
4. `Co-Authored-By` 트레일러를 넣지 않는다.
5. 작성자와 커미터는 Git이 현재 저장소에서 해석한 로컬 설정을 그대로
   사용한다. 신원 값은 보고서나 tracked 파일에 노출하지 않고 일치 여부만
   보고한다.
6. 활성 Git hook이 정상 실행되게 커밋하며 `--no-verify`를 사용하지 않는다.
7. 커밋 전에 메시지 파일을
   `scripts/validate-commit-message.mjs --file <file>`로 검증한다.

## 6. 커밋 후 검증과 보고

1. 생성된 커밋의 해시, 제목, 본문과 포함 경로 metadata를 다시 읽고 메시지
   validator로 재검증한다.
2. `HEAD^{tree}`가 검토·검증한 candidate tree와 정확히 같은지 확인한다.
   같으면 candidate에서 통과한 commit path gate 증거를 재사용하고 이 gate와
   다른 로컬 고정 게이트를 반복하지 않는다.
3. 사전 확인한 로컬 신원, 이슈 범위와 메시지 계약이 모두 일치하는지
   확인한다.
4. `git status --short --branch`로 남은 변경을 확인한다. 남은 사용자 변경을
   수정하거나 추가 스테이징하지 않는다.
5. 실패한 hook이나 커밋을 자동으로 재시도하거나 자동으로 amend하지 않는다.
6. 이슈, 브랜치, 커밋 해시, 포함·제외 경로, base·cached diff·candidate·commit
   tree 결속, 검증 filesystem과 결과, 의미 영향, 독립 리뷰의 검토자
   수·관점·P0~P2 결과, hook 결과와 남은 변경을 보고한다.
7. `git push`를 실행하지 않았음을 명시한다. 같은 tree의 로컬 증거를
   재실행 없이 푸시와 PR 작성의 `open-pull-request` 작업으로 넘긴다.
