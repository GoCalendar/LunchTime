# 작업 이슈 생명주기

## 설정

저장소 작업 흐름 설정을 `.github/work-management.json`에 저장한다.

```json
{
  "repository": "GoCalendar/LunchTime",
  "branch": {
    "base": "main",
    "prefix": "work/"
  },
  "project": {
    "owner": "GoCalendar",
    "number": 1,
    "statusField": "Status",
    "statusOptions": {
      "todo": "Todo",
      "inProgress": "In Progress",
      "done": "Done"
    }
  },
  "labels": {
    "todo": "status:todo",
    "inProgress": "status:in-progress",
    "done": "status:done",
    "blocked": "dependency:blocked"
  },
  "maxInProgress": 2
}
```

저장소, Project 소유자와 번호, 이름과 한도는 설정할 수 있다. 스크립트는 Project ID, `Status` 필드 ID, 선택지 ID와 이슈 항목 ID를 동적으로 찾는다. marker가 없는 기존 이슈와 `create --project`로 생성한 MVP 이슈에서 Project 설정이 없거나 모호하면 `check`, `start`, `complete`가 거부한다. `create` marker가 `project=none`이고 이슈 작성자의 현재 저장소 권한이 write 이상인 일반 이슈만 Project 조회·상태 전이를 생략하되 나머지 이슈·담당자·레이블·의존성 계약은 그대로 적용한다. 신뢰할 수 없는 작성자의 marker는 opt-out으로 인정하지 않는다. GitHub 저장소 권한 끝점은 기존 유효 값인 `admin`, `write`, `read`, `none`을 반환한다. 표식 작성자와 상태 변경 실행자는 `admin` 또는 `write`여야 한다.

`branch.base`는 Trunk-Based Development의 단일 trunk를, `branch.prefix`는
짧은 작업 브랜치의 공통 접두사를 뜻한다. `start`는 브랜치가
`<prefix>issue-<현재 이슈 번호>-<소문자 영문 slug>` 형식인지 확인한다.
예시는 `work/issue-17-menu-ack`이다. 스크립트는 브랜치를 직접 만들지 않는다.

GitHub 기본 의존 관계 조회에는 GitHub REST API 버전 `2026-03-10`을 사용한다. 별도 초기화 도구가 `blocked by` 관계를 만들 때 POST 본문의 `issue_id`에는 이슈 번호가 아니라 선행 이슈의 데이터베이스 ID를 사용해야 한다.

## 개별 생성

`create`는 로컬에서 검증한 본문, 안정적인 idempotency key, 제목, 정확한 열린
milestone 제목과 기존 label을 입력으로 받는다. `--blocked-by`는 GitHub 기본
선행 관계를, MVP 이슈에만 사용하는 `--project`는 설정된 Project `Todo`를
요청한다.

1. body validator, 입력 길이·중복과 공개 저장소 안전 규칙을 확인한다.
2. 활성 `gh` 로그인과 저장소 write 이상 권한, label, milestone, 선행 이슈,
   같은 marker와 같은 제목의 기존 이슈를 모두 읽는다.
3. `--project`가 있으면 Project와 정확한 `Status=Todo` 선택지를 읽는다.
4. `--dry-run`은 실제 쓰기와 같은 조회에서 순서가 있는 계획과 plan token을
   출력하고 mutation을 전혀 실행하지 않는다.
5. 실제 실행은 같은 입력과 `--confirm-plan` token을 요구하고, live plan이
   달라지면 stale token으로 거부한다.
6. 이슈를 담당자 없이 `status:todo`, 요청 label과 milestone로 생성한다.
   기존 동일-key 이슈에서는 요청·파생 label의 정확한 집합을 요구하며, 요청
   밖 label은 종류와 무관하게 충돌로 보고 보존한다.
7. 요청된 Project와 기본 선행 관계를 연결하고, 열린 선행 이슈가 있으면
   `dependency:blocked`를 유지한다.
8. marker가 저장소에 하나인지, 이슈가 열려 있고 담당자 0명인지, 본문·label·
   milestone·의존 관계와 선택적 Project가 정확한지 전체 재조회한다.

GitHub 이슈·Project·의존 관계 쓰기는 하나의 트랜잭션이 아니다. 일부 단계가
실패하면 이후 쓰기를 중단하고 완료 단계와 복구 안내를 남긴다. 생성 이슈를
자동 삭제하거나 사람이 바꾼 제목·본문·관리 상태를 덮지 않는다. 원인을 바로잡은
뒤 같은 key의 새 dry-run에서 남은 단계만 확인하고 새 명령을 한 번 실행한다.
저장소 전체 scan의 관련 없는 malformed marker는 개별 생성 전체를 중단시키지
않지만, 선택된 동일 key 이슈의 marker·작성자 권한 충돌은 fail-closed한다.
선행 이슈가 mutation window에 닫혀 `dependency:blocked`만 stale이 됐다면 새
dry-run은 이 도구 소유 파생 label 제거를 명시적으로 계획한다. 실제 제거
직전에 기본 의존 관계를 다시 읽어 열린 blocker가 0개일 때만 제거하고, 사람이
추가한 다른 label이나 native `blocked by` 관계는 보존한다.

## 준비 상태 점검

`check`는 읽기 전용이다. 선점 가능한 이슈는 다음 조건을 모두 충족해야 한다.

- 이슈가 열려 있다.
- `status:*` 레이블은 설정된 `Todo` 레이블 하나뿐이다.
- 담당자가 없다.
- GitHub 기본 `blocked by` 관계의 모든 선행 이슈가 닫혀 있다.
- Project 관리 이슈는 설정된 Project 항목이 존재하고 상태가 `Todo`다.
- Project 관리 이슈는 Project의 `In Progress` 항목 수가 `maxInProgress`보다
  작다. 이 검사는 원자적인 전역 동시성 보장이 아니라 최선 노력 방식의 진입
  제한이다. 서로 다른 이슈의 시작이 경합할 수 있으며 쓰기 뒤 검증이 실패하면
  사람이 상태를 복구해야 한다.

GitHub 기본 의존 관계나 Project 상태를 읽을 수 없으면 안전하게 실패한다.

## 시작

`start`는 제한된 절차를 한 번 수행한다.

1. 브랜치명이 현재 이슈 번호와 설정된 Trunk-Based Development 규칙에 맞는지 확인하고 준비 상태를 다시 점검한다.
2. 활성 `gh` 로그인을 확인하고 저장소, 이슈, 브랜치, 에이전트와 로그인으로 안정적인 선점 토큰을 만든다.
3. 정확한 구조의 선점 댓글을 게시한다. 활성 댓글 중 GitHub 댓글 ID가 가장 낮은 선점이 승리한다.
4. 이슈와 승리한 선점을 다시 읽고 활성 로그인만 조건부로 담당자에 지정한다.
5. 관련 없는 레이블을 보존하면서 레이블 추가·제거 끝점으로 `Todo`를 `In Progress`로 전이한다.
6. Project 관리 이슈만 Project `Status`를 `In Progress`로 설정한다.
7. 이슈, 의존 관계, 선택적 Project 상태와 정확한 승리 선점을 다시 읽는다.

완전히 검증된 전이만 구현 시작을 승인한다. 스크립트는 로컬 브랜치를 만들지 않는다.

GitHub 이슈는 댓글, 담당자, 레이블과 Project를 아우르는 비교 후 교환 트랜잭션을 제공하지 않는다. 순서가 있고 쓰기 권한이 확인된 선점 댓글이 이 도구가 사용할 수 있는 직렬화 지점이다. 이후 모든 단계는 토큰을 다시 확인하며 소유권이 바뀌면 안전하게 실패한다. GitHub 조회가 일관된 댓글 이력을 반환한다는 조건에서 같은 이슈의 패배한 실행이 성공을 반환하지 않게 하지만 데이터베이스 수준의 원자적 잠금은 아니다. 해제 표식은 새 선점 세대를 만들므로 명시적으로 해제한 뒤 같은 브랜치와 에이전트가 새로 선점할 수 있다.

## 완료

병합된 PR을 `--pr`로, finalize가 검증한 정확한 40자리 PR head를 `--head`로
명시한다. `complete`는 두 값이 병합된 PR의 현재 값과 일치할 때만 현재 로그인이
소유한 활성 이슈를 허용하고 실패한 정리를 재개할 수 있도록 이미 완료된 상태도
허용한다.

제한되고 멱등인 절차를 한 번 수행한다.

1. PR에 `merged_at`이 있고 REST 응답의 `base.repo.full_name`과
   `head.repo.full_name`이 모두 설정된 작업 저장소와 같으며, 설정된 trunk를
   base로 기록된 승리 작업 브랜치와 입력한 exact head를 사용하고 본문에 종료
   참조가 있는지 확인한다. fork·cross-repository PR과 repository identity
   누락은 `complete`로 복구하지 않는다.
2. GitHub 기본 `closingIssuesReferences`가 다음 page 없이 설정된 저장소의 이
   이슈 하나만 포함하는지 확인한다. 본문의 종료 참조만으로는 충분하지 않다.
3. 작업 흐름 레이블을 `Done`으로 바꾼다.
4. Project 관리 이슈만 Project `Status`를 `Done`으로 설정한다.
5. 이슈를 완료 사유로 닫는다.
6. PR을 포함한 완료 표식 댓글을 하나 추가한다.
7. GitHub 기본 `blocking` 관계의 열려 있는 후행 이슈를 모두 읽는다.
8. 각 후행 이슈의 `blocked by` 이슈를 다시 읽는다. 열린 선행 이슈가 없을 때만 `dependency:blocked`를 제거하고 멱등인 의존 관계 갱신 댓글을 하나 추가한다.
9. 완료된 이슈와 선택적 Project 상태를 다시 읽는다.

후행 이슈는 `Todo`를 유지한다. 실제로 모든 선행 작업이 끝났을 때만 완료 절차가 파생 차단 레이블을 제거한다.

## 선점 해제

PR이 생기기 전에 소유한 선점을 안전하게 포기하려면 `release`를 사용한다. `start`에서 사용한 같은 브랜치와 에이전트 표식에 사유를 더해 전달한다.

1. 활성 로그인이 정확한 승리 선점을 소유하는지 확인한다.
2. 기록된 브랜치에 열려 있거나 병합된 PR이 있으면 해제를 거부한다.
3. 관련 없는 레이블을 바꾸지 않고 `In Progress`를 `Todo`로 되돌린다.
4. 유일한 담당자를 제거하고 Project 관리 이슈만 `Status`를 `Todo`로 설정한다.
5. 현재 선점 세대의 이전 선점을 모두 무효화하는 정확한 해제 표식을 추가한다.
6. `Todo`, 담당자 없음, 선택적 Project와 표식 상태를 다시 읽고 검증한다.

시간 제한, 임대 만료 또는 자동 재선점은 없다. 포기한 작업이 조용히 재할당되지 않도록 사람이나 소유 에이전트가 이 명시적이고 제한된 전이를 실행해야 한다.

## 파생 차단 레이블 조정

`reconcile`은 파생된 `dependency:blocked` 레이블만 복구한다. 쓰기 권한이 있는 활성 로그인이 필요하며, 열려 있고 담당자와 선점이 없는 `Todo` 이슈만 허용한다. Project 관리 이슈는 설정된 `Status=Todo`도 요구하고 일반 이슈는 Project를 조회하지 않는다. GitHub 기본 `blocked by` 이슈를 한 번 읽고 열려 있는 이슈가 하나 이상이면 레이블을 추가하며 하나도 없으면 제거한다. 그 뒤 다시 읽어 결과를 검증한다. `--dry-run`은 조회를 수행하고 예정된 레이블 변경을 출력하지만 쓰지는 않는다.

## 실패와 복구

자동 재시도는 없다. 명령 하나에서 각 GitHub 조회와 쓰기를 한 번만 시도하고 페이지 조회 수를 제한한다. 일부 단계가 실패하면 다음 순서를 따른다.

1. 이후 모든 상태 변경을 중단한다.
2. 출력된 완료 단계 목록과 복구 안내를 읽는다.
3. 실제 이슈, Project, PR과 의존 관계 상태를 확인한다.
4. 외부 상태의 불일치를 바로잡는다.
5. 같은 명령을 다시 실행한다. 레이블, 담당자, Project 상태, 종료와 표식 댓글이 이미 정확하면 건너뛴다.

새 Project를 설정하거나 레이블 이름을 바꿀 때는 실제 전이 전에 `--dry-run`을 사용한다.
