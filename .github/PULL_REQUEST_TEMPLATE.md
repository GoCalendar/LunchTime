<!-- lunchtime-pr:v2 -->
<!--
이 템플릿은 사람과 AI가 대화 이력 없이 변경을 재구성하기 위한 계약입니다.
H2, marker와 필드 이름을 바꾸지 마세요. Ready 전에는 placeholder를 실제
내용으로 교체하세요. Draft의 실패·미실행은 사실대로 남기고, Ready 전에는
관련 검증과 미확정 결정을 해소하세요. 독립 리뷰는 저위험 근거로 생략하거나
한 번만 수행하고 finding을 메인 세션에서 모두 닫습니다.
-->

## 연결된 이슈

<!-- pr:issues:start -->
Closes #<issue-number>
<!-- pr:issues:end -->

## 변경 요약

<!-- pr:summary:start -->
- 문제·목표: <변경 전 문제와 이 PR의 관찰 가능한 완료 결과>
- 결과:
  - <실제 변경 결과 1>
- 결정·트레이드오프: <중요한 선택·대안·감수한 비용 또는 "해당 없음 — 근거">
- 위험·복구: <회귀 가능성·제약·되돌리는 방법>
- 리뷰 시작점: `<저장소 상대 경로>` — <먼저 확인할 핵심>
- 제외·후속 작업: <의도적으로 제외한 범위와 후속 이슈 또는 "해당 없음 — 근거">
<!-- pr:summary:end -->

## 추적성

<!-- pr:traceability:start -->
| 구분 | ID 또는 근거 |
| --- | --- |
| 요구사항 | `<PRD-NN-FR-NN 또는 "해당 없음 — 근거">` |
| 수용 기준 | `<PRD-NN-AC-NN 또는 "해당 없음 — 근거">` |
| 정책 규칙 | `<POL-NN-R-NN 또는 "해당 없음 — 근거">` |
| 기술 스파이크 | `<PRD-NN-SP-NN 또는 "해당 없음 — 근거">` |
<!-- pr:traceability:end -->

## 검증

<!-- pr:verification:start -->
| 대상 | 명령·확인 | 결과 | 증거 |
| --- | --- | --- | --- |
| 독립 리뷰 | 변경 위험을 판단해 생략하거나 원본 요구사항·diff·관련 테스트를 한 번 검토 | <통과·생략·실패·미실행> | <생략: low-risk=구체적 근거 / 통과: round=1; reviewers=N; findings=N; main-closure=N/N; scope-expansion=none> |
| <검증 대상> | `<재실행 가능한 명령 또는 수동 확인>` | <통과·실패·미실행> | <테스트 수·관찰 결과·CI URL> |
<!-- pr:verification:end -->

## 문서 영향

<!-- pr:docs-impact:start -->
- 판정: <변경·변경 없음·결정 필요>
- 대상 파일·ID: <저장소 상대 경로와 PRD·Policy·Architecture 파일·ID>
- 근거: <갱신 내용, 변경 불필요 이유 또는 필요한 결정>
<!-- pr:docs-impact:end -->
