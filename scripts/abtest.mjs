// A/B 채점 규칙의 자체 검사: 가상의 키와 판정으로 쌍별 결과, 부호 검정, 글자 집계를 확인한다 (node scripts/abtest.mjs)
// 실제 키(out/keys/)는 읽지 않는다. A/B 도구를 고칠 때마다 영점 확인과 함께 돌린다
import { tail, twoSided, evaluate, MIN_DECIDED, ALPHA } from './ablib.mjs';

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '통과' : '실패'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failed++; };
const flip = (s) => (s === 'A' ? 'B' : 'A');

// 장면 n개짜리 가상 키. 첫째 벌은 새 빌드를 A·B에 번갈아 놓고, 둘째 벌은 맞바꾼다
function fakeKey(n, sets = 2) {
  const p1 = [...Array(n)].map((_, i) => ({ n: i + 1, scene: `s${i + 1}`, newSide: i % 2 ? 'B' : 'A' }));
  if (sets === 1) return { baseline: 'fake', pairs: p1 };
  // 둘째 벌은 순서도 뒤집어 번호가 다르게 한다
  const p2 = p1.slice().reverse().map((p, i) => ({ n: i + 1, scene: p.scene, newSide: flip(p.newSide) }));
  return { baseline: 'fake', sets: [{ tag: 'aaaa', pairs: p1 }, { tag: 'bbbb', pairs: p2 }] };
}
// 판정자 한 명의 답 한 줄. choose(scene, newSide) → 'new' | 'base' | 'tie' | 'A' | 'B'
function answer(pairs, choose) {
  return pairs.map(p => {
    const c = choose(p.scene, p.newSide);
    const letter = c === 'new' ? p.newSide : c === 'base' ? flip(p.newSide) : c === 'tie' ? '구분 안 됨' : c;
    return `${p.n}=${letter}`;
  }).join(', ');
}
const setsOf = (key) => key.sets || [{ tag: '', pairs: key.pairs }];
// 벌마다 판정자 두 명. who[k][j](scene, newSide)
function judge(key, who) {
  const S = setsOf(key), entries = [];
  who.forEach((js, k) => js.forEach(f => entries.push({ set: k, text: answer(S[k].pairs, f) })));
  return evaluate(key, entries);
}

// 1. 부호 검정의 값 (docs/evaluation.md의 표)
check('p(5전 5승) = 0.031', Math.abs(tail(5, 5) - 0.03125) < 1e-9);
check('p(8전 7승) = 0.035', Math.abs(tail(8, 7) - 0.03515625) < 1e-9);
check('p(31전 21승) ≈ 0.035', Math.abs(tail(31, 21) - 0.0354) < 1e-3, tail(31, 21).toFixed(4));
check('4전 4승은 0.05를 넘는다', tail(4, 4) > ALPHA);
check('큰 n에서도 넘치지 않는다', Number.isFinite(twoSided(1683, 1022)) && twoSided(1683, 1022) < 1e-15, twoSided(1683, 1022).toExponential(1));

// 2. 좌우 교차의 결과표 (docs/evaluation.md '쌍의 결과와 통과 기준'). 장면 하나에 한 행
const rows = [
  [['new', 'new'], ['new', 'new'], 'W'],
  [['new', 'tie'], ['new', 'tie'], 'W'],
  [['new', 'new'], ['new', 'base'], 'W'],
  [['new', 'new'], ['tie', 'tie'], 'T'],
  [['new', 'new'], ['base', 'base'], 'T'],
  [['new', 'tie'], ['tie', 'tie'], 'T'],
  [['base', 'base'], ['base', 'tie'], 'L'],
];
{
  const key = fakeKey(rows.length);
  const idx = (scene) => +scene.slice(1) - 1;
  const who = [0, 1].map(k => [0, 1].map(j => (scene) => rows[idx(scene)][k][j]));
  const s = judge(key, who);
  rows.forEach((r, i) => check(`결과표 ${i + 1}행: 첫째 벌 ${r[0].join('·')}, 둘째 벌 ${r[1].join('·')} → ${r[2]}`, s.pairs[i].r === r[2], `나온 값 ${s.pairs[i].r}`));
}

// 3. 글자만 따라가는 판정자: 좌우 교차에서는 승패가 하나도 생기지 않는다. 옛 방식(한 벌 다수결)에서는 갈린 쌍이 된다
{
  const key = fakeKey(20), allB = () => 'B';
  const s = judge(key, [[allB, allB], [allB, allB]]);
  check('글자 B만 고르는 판정자 4명 → 갈린 쌍 0', s.decided === 0, `승 ${s.W}, 패 ${s.L}`);
  check('그때 글자 집계가 쏠림을 잡는다', s.letters.B === 80 && s.letters.p < 1e-6, `p = ${s.letters.p.toExponential(1)}`);
  const old = judge(fakeKey(20, 1), [[allB, allB, allB]]);
  check('같은 판정자 3명, 옛 방식 → 갈린 쌍 20 (옛 방식의 약점 재현)', old.decided === 20, `승 ${old.W}, 패 ${old.L}`);
}

// 4. 진짜 선호 + 글자 쏠림이 섞인 판정자: 진짜 선호만 승으로 남는다
{
  const key = fakeKey(20);
  const f = (scene) => (+scene.slice(1) <= 6 ? 'new' : 'B');
  const s = judge(key, [[f, f], [f, f]]);
  check('6쌍에서 새 빌드를 고르고 나머지는 B → 6승 0패, 통과', s.W === 6 && s.L === 0 && s.verdict === '통과', `승 ${s.W}, 패 ${s.L}, p = ${s.p.toFixed(3)}, ${s.verdict}`);
}

// 5. 판정 불가와 미달
{
  const key = fakeKey(20);
  const four = (scene) => (+scene.slice(1) <= 4 ? 'new' : 'tie');
  const s = judge(key, [[four, four], [four, four]]);
  check(`갈린 쌍 4개(${MIN_DECIDED}개 미만) → 판정 불가`, s.verdict === '판정 불가', `${s.W}–${s.L}, ${s.verdict}`);
  const mixed = (scene) => { const i = +scene.slice(1); return i <= 5 ? 'new' : i <= 9 ? 'base' : 'tie'; };
  const m = judge(key, [[mixed, mixed], [mixed, mixed]]);
  check('5승 4패 → 미달', m.W === 5 && m.L === 4 && m.verdict === '미달', `p = ${m.p.toFixed(3)}`);
}

// 6. 자리 집계: B 자리의 새 빌드만 고르는 판정자는 B 자리 비율이 높게 나온다
{
  const key = fakeKey(20);
  const s = judge(key, [[() => 'B', () => 'tie'], [() => 'tie', () => 'tie']]);
  check('자리 집계가 자리별로 갈린다', s.position.B.N === 10 && s.position.A.O === 10, `A 자리: 새 ${s.position.A.N}·기준 ${s.position.A.O}, B 자리: 새 ${s.position.B.N}·기준 ${s.position.B.O}`);
}

console.log(failed ? `\n실패 ${failed}개` : '\n모두 통과');
process.exit(failed ? 1 : 0);
