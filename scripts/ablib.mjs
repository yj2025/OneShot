// A/B 채점의 통계: 쌍별 결과(좌우 교차 또는 다수결), 부호 검정, 글자·자리 집계 (docs/evaluation.md)
// scripts/ab.mjs와 scripts/abtest.mjs가 쓴다. 키 파일은 여기서 읽지 않는다
// 아래 넷 중 뒤의 셋은 제안값이고 사용자가 확정한다. 바꾸면 여기만 고친다
export const MIN_PAIRS = 15;       // 전체 화면 라운드의 최소 쌍 수
export const MIN_DECIDED = 5;      // 갈린 쌍이 이보다 적으면 판정 불가
export const ALPHA = 0.05;         // 부호 검정(단측) 통과 기준
export const ZERO_LETTER_P = 0.01; // 영점 확인: 글자 집계의 양측 p가 이보다 작으면 글자 쏠림

// P(X ≥ k), X ~ 이항(n, 0.5)
export function tail(n, k) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let lp = -n * Math.LN2, sum = 0; // log P(X = i), 큰 n에서도 넘치지 않게 로그로 센다
  for (let i = 0; i <= n; i++) { if (i >= k) sum += Math.exp(lp); lp += Math.log((n - i) / (i + 1)); }
  return Math.min(1, sum);
}
export const twoSided = (n, k) => (n ? Math.min(1, 2 * tail(n, Math.max(k, n - k))) : 1);
export const fp = (p) => (p < 0.001 ? p.toExponential(1) : p.toFixed(3));
export const pct = (x) => (Number.isFinite(x) ? `${Math.round(100 * x)}%` : '-');
export const flip = (s) => (s === 'A' ? 'B' : 'A');

export function parseVerdict(text, n, name) {
  const m = new Map();
  for (const x of String(text).matchAll(/(\d+)\s*[=:]\s*([^,;\n]+)/g)) { const v = x[2].trim().toUpperCase(); m.set(+x[1], /^A(?![A-Z])/.test(v) ? 'A' : /^B(?![A-Z])/.test(v) ? 'B' : 'T'); }
  const missing = [...Array(n)].map((_, i) => i + 1).filter(i => !m.has(i));
  if (missing.length) throw new Error(`${name}에 빠진 쌍이 있다: ${missing.join(', ')} (쌍은 1~${n})`);
  return m;
}
// 옛 키는 벌이 하나다({pairs}), 새 키는 벌이 둘이다({sets: [{tag, pairs}]})
export const keySets = (key) => key.sets || [{ tag: '', pairs: key.pairs }];

// 쌍별 결과와 통계. entries: [{ set: 벌 번호, text: 판정 원문 }]
export function evaluate(key, entries) {
  const sets = keySets(key);
  const judges = entries.map((e, i) => {
    const set = sets[e.set], m = parseVerdict(e.text, set.pairs.length, `판정 ${i + 1}`);
    const votes = new Map(), t = { N: 0, O: 0, T: 0, A: 0, B: 0 };
    for (const p of set.pairs) {
      const c = m.get(p.n), v = c === 'T' ? 'T' : c === p.newSide ? 'N' : 'O';
      votes.set(p.scene, { v, letter: c, newSide: p.newSide });
      t[v]++; if (c !== 'T') t[c]++;
    }
    return { set: e.set, tag: set.tag, votes, ...t };
  });
  const cross = new Set(entries.map(e => e.set)).size > 1;
  const position = { A: { N: 0, O: 0, T: 0 }, B: { N: 0, O: 0, T: 0 } };
  const majLetter = { A: 0, B: 0 };
  const pairs = sets[0].pairs.map(({ scene }) => {
    const vs = judges.map(j => ({ set: j.set, ...j.votes.get(scene) }));
    for (const x of vs) position[x.newSide][x.v]++;
    const N = vs.filter(x => x.v === 'N').length, O = vs.filter(x => x.v === 'O').length;
    let r = 'T';
    if (cross) {
      // 새 빌드 표가 기준선 표보다 2표 이상 많고, 판정을 받은 벌마다 그쪽 표가 1표 이상 있어야 이긴다
      const used = [...new Set(vs.map(x => x.set))];
      const every = (w) => used.every(s => vs.some(x => x.set === s && x.v === w));
      if (N - O >= 2 && every('N')) r = 'W'; else if (O - N >= 2 && every('O')) r = 'L';
    } else {
      const need = Math.floor(vs.length / 2) + 1;
      if (N >= need) r = 'W'; else if (O >= need) r = 'L';
      if (r !== 'T') majLetter[r === 'W' ? vs[0].newSide : flip(vs[0].newSide)]++;
    }
    const nums = sets.map(s => { const q = s.pairs.find(p => p.scene === scene); return { tag: s.tag || null, n: q.n, newSide: q.newSide }; });
    return { scene, r, N, O, T: vs.length - N - O, conflict: N > 0 && O > 0, nums };
  });
  const W = pairs.filter(p => p.r === 'W').length, L = pairs.filter(p => p.r === 'L').length, T = pairs.length - W - L;
  const decided = W + L, p = decided ? tail(decided, W) : 1;
  const verdict = decided < MIN_DECIDED ? '판정 불가' : p <= ALPHA ? '통과' : '미달';
  const A = judges.reduce((s, j) => s + j.A, 0), B = judges.reduce((s, j) => s + j.B, 0);
  const letters = { A, B, p: twoSided(A + B, B) };
  return {
    cross, judges, pairs, W, L, T, decided, p, verdict, letters, position, majLetter,
    conflicts: pairs.filter(x => x.conflict).length,
    oldRatio: (W + 0.5 * T) / pairs.length,
    zero: { decidedBiased: decided >= MIN_DECIDED, letterBiased: letters.p < ZERO_LETTER_P },
  };
}
