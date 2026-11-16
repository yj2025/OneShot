측정 정비 2차 세션의 지시문입니다. 평가 도구를 고치는 세션이라 게임 화면은 바꾸지 않습니다. 결과를 보고 숫자를 정해야 하므로 옆에서 지켜보고, `/goal`은 걸지 않습니다.

보내기 전에 확인합니다.
- `git push`를 했습니다.
- user-edits.md 4절의 검사 (l)을 정했고, 아래 블록 8번의 대괄호에 적었습니다.
- critic.md를 고치기로 했다면 먼저 고쳤습니다(user-edits.md 3절). 서브에이전트 파일은 세션을 시작할 때 읽힙니다.
- Claude Code를 레포 루트의 메인 체크아웃에서 시작했습니다.

아래 블록을 붙여 넣습니다.

```
이번 세션은 평가 도구를 다시 고치는 세션이다(측정 정비 2차). 게임 화면은 바꾸지 않는다. 근거와 바꿀 규칙은 docs/handoff/2026-11-17-review/에 있다. README.md와 evaluation-changes.md를 먼저 읽어.

1. PROGRESS.md에 세션 시작 시각과 '측정 정비 2차'를 적는다.
2. 리뷰의 수치를 확인한다. node docs/handoff/2026-11-17-review/tools/abstats.mjs docs/handoff/2026-11-16-indoor/verdicts 의 출력이 README.md 3.2절, 3.3절과 같은지 본다.
3. 채점 도구에 글자 집계와 자리 집계를 먼저 넣는다(evaluation-changes.md 3절). 정답 키가 남아 있는 라운드를 다시 세어, 판정이 글자 B로 쏠린다는 리뷰의 추정이 맞는지 확인한다. 리뷰는 키를 보지 못하고 점수에서 역산했다. 확인되지 않으면 좌우 교차(2절)는 넣지 말고 나머지를 진행하고, 그 결과를 보고에 적는다.
4. scripts/ab.mjs를 evaluation-changes.md의 1~5절대로 고친다. 좌우 교차 시트 두 벌, 판정자 4명의 표로 정하는 쌍별 결과, 부호 검정, 채점 출력 항목, 확대 쌍이다.
5. 영점 확인을 다시 한다(evaluation-changes.md 4절). 같은 빌드를 두 번 찍어 좌우 교차로 판정하고 결과를 CRITIC_LOG.md에 적는다. 기준을 넘으면 원인을 찾아 고친다.
6. 판정 원문과 정답 키가 남아 있는 지난 라운드를 새 통계로 다시 채점해 CRITIC_LOG.md에 표로 남긴다(evaluation-changes.md 7절).
7. docs/evaluation.md, CLAUDE.md의 평가 절, prompts/11-session.md를 evaluation-changes.md 8절대로 고친다. critic의 답에 '기준별 점수' 줄이 있으면 CRITIC_LOG.md의 기록 형식에 기준별 중앙값을 더한다. ROADMAP.md, SPEC.md, .claude/ 아래 파일은 내가 고친다.
8. 검사 (l): [정한 내용을 적는다. 예: 기준을 실효 반사율로 다시 쓴다. 고치기 전 빌드에서 실패하고 지금 빌드에서 통과하는 것을 확인한다]
9. docs/handoff/README.md의 '먼저 읽을 것'과 '이 폴더'에 2026-11-17-review를 한 줄씩 더하고, 3절 표에 이 세션을 더한다.

끝나면 npm run check 출력, 3번의 확인 결과, 영점 확인 결과, 다시 채점한 표를 대화에 보여 줘. 다시 채점한 표에서 결론이 바뀐 세션이 있으면 따로 짚어 줘. evaluation-changes.md의 대괄호 값([5], [0.05], [0.01])이 적절한지 네 의견도 PROGRESS.md에 제안으로 적고 대화에 알려 줘.
```

끝나면 다시 채점한 표와 Claude의 의견을 보고 ROADMAP.md를 고칩니다. 고칠 문구는 user-edits.md 1절에 있습니다.
