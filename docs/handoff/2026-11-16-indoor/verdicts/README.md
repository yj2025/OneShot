# 판정 원문 줄

이 세션의 평가에서 받은 판정이다. 각 파일은 판정자 한 명의 답 한 줄이다. 판정문 전체(근거, 공통 격차)의 요약은 CRITIC_LOG.md에 있다.

| 파일 | 평가 | 기준선 | 결과(쌍별 다수결 또는 중앙값) |
| --- | --- | --- | --- |
| r45-j1~3 | A/B 45 (끝 1) | p-indoor | 45% |
| r46-j1~3 | A/B 46 (끝 1) | p-surface | 48% |
| r47-j1~3 | A/B 47 (끝 2) | p-indoor | 60% |
| r48-j1~3 | A/B 48 (끝 2) | p-surface | 50% |
| r49-j1~3 | A/B 49 (끝 3) | p-indoor | 56% |
| r50-j1~3 | A/B 50 (끝 3) | p-surface | 44% |
| r51-j1~3 | A/B 51 (마감) | p-indoor | 61% |
| r52-j1~3 | A/B 52 (마감) | p-surface | 60% |
| c31-2, c31-3 | critic 31 (시작, 판정 1은 남기지 않았다) | — | 중앙값 3 |
| c32-1~3 | critic 32 | — | 4 |
| c33-1~3 | critic 33 | — | 4 |
| c34-1~3 | critic 34 | — | 4 |
| c35-1~3 | critic 35 (마감) | — | 4 |

- A/B 줄 형식: `1=A, 2=구분 안 됨, ...`. `npm run ab -- score <라운드> "<줄1>" "<줄2>" "<줄3>"`에 그대로 넣는다. 어느 쪽이 새 빌드인지는 out/keys/에만 있고, 채점 도구만 연다.
- critic 줄 형식: 빌드로 판정한 칸 목록. `npm run score -- <라운드> "<줄1>" "<줄2>" "<줄3>"`에 넣는다.
- 판정자에게 넘긴 프롬프트(경로만 넘긴다):
  - ab-judge: `A/B 시트: <레포>\out\ab\round-N-1.png ~ round-N-21.png` / `레퍼런스: <레포>\refs\`
  - critic: `비교 시트: <레포>\out\sheets\round-N-1.png ~ round-N-5.png` / `연속 프레임 묶음: <레포>\out\sheets\round-N-strip-1.png ~ round-N-strip-4.png` / `측정값: <레포>\out\perf.json, <레포>\out\audio.json`
