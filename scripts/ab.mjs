// npm run ab -- <명령> : 세션을 시작할 때의 빌드(기준선)와 지금 빌드를 같은 장면끼리 짝지어 비교한다 (docs/evaluation.md)
//   save <이름>                              지금 out/shots/를 out/baseline/<이름>/에 기준선으로 복사
//   sheet <이름> [--round N] [--per-page 2]   판정용 A/B 시트 두 벌(좌우 교차)을 out/ab/round-N-<벌>-*.png에, 정답 키를 out/keys/ab-round-N.json에
//         [--zoom x,y,w,h] [--only "15-close,21-reload"]   확대 쌍: 화면 비율로 준 영역만 잘라 키운다. --only는 이름에 그 글자가 든 장면만
//         [--single]                                      옛 방식(한 벌을 판정자 3명이 보고 다수결)
//   score <라운드> <벌> "<판정>" "<판정>" <벌> "<판정>" "<판정>"   판정(예: "1=A, 2=B, 3=구분 안 됨")을 키와 대조해 승패와 부호 검정을 출력
//         [--scenes "vault;turn-sway,strafe"]   이름에 그 글자가 든 장면끼리(쉼표로 묶고 세미콜론으로 나눈다) 승패를 따로 센다
//         [--zero]                              영점 확인(같은 빌드끼리)으로 판정한다
//   rescore [--from N] [--to M]              out/ab/의 지난 채점 기록(판정 원문)을 키와 다시 대조해 새 통계로 표를 만든다
//   report <이름> --out docs/shots/<폴더>      사람이 보는 전후 시트(왼쪽 기준선, 오른쪽 새 빌드)를 JPEG로
//   solo --out docs/shots/<폴더>              지금 out/shots/만 모은 시트를 JPEG로 (전후가 없는 0단계용)
//   diff <이름>                              기준선과 지금 화면의 장면별 픽셀 차이 (키와 무관, 촬영이 얼마나 같은지 확인)
// 채점하기 전에는 어떤 명령도 키 내용을 출력하지 않는다. 채점이 끝난 라운드의 쌍별 결과는 docs/verdicts/에 남긴다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { ROOT, OUT, ensureDir } from './lib.mjs';
import { shuffle, label, still, stripBlock, page, STRIP_NOTE, parseRegion, zoomHeight } from './sheetlib.mjs';

const SHOTS = path.join(OUT, 'shots'), BASE = path.join(OUT, 'baseline'), AB = path.join(OUT, 'ab'), KEYS = path.join(OUT, 'keys');
const VERDICTS = path.join(ROOT, 'docs', 'verdicts');
// 아래 넷 중 뒤의 셋은 제안값이고 사용자가 확정한다 (docs/evaluation.md). 바꾸면 여기만 고친다
const MIN_PAIRS = 15;       // 전체 화면 라운드의 최소 쌍 수
const MIN_DECIDED = 5;      // 갈린 쌍이 이보다 적으면 판정 불가
const ALPHA = 0.05;         // 부호 검정(단측) 통과 기준
const ZERO_LETTER_P = 0.01; // 영점 확인: 글자 집계의 양측 p가 이보다 작으면 글자 쏠림
const FLAGS = new Set(['--zero', '--single', '--dry']); // 값을 받지 않는 선택지
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def; };
const flag = (name) => argv.includes(`--${name}`);
const pos = (() => { const out = []; for (let i = 1; i < argv.length; i++) { if (argv[i].startsWith('--')) { if (!FLAGS.has(argv[i])) i++; continue; } out.push(argv[i]); } return out; })();
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

const isStill = (f) => /^\d\d-.*\.png$/.test(f), isStrip = (f) => /^strip-.*\.png$/.test(f);
const scenesIn = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter(f => isStill(f) || isStrip(f)).sort() : []);
function baseDir(name) {
  if (!name || !/^[\w.-]+$/.test(name)) die('기준선 이름이 필요하다 (영문·숫자·-·_).', 2);
  return path.join(BASE, name);
}
function pairScenes(name) {
  const bd = baseDir(name);
  if (!fs.existsSync(bd)) die(`기준선 '${name}'이 없다. 먼저 npm run ab -- save ${name}`);
  const base = scenesIn(bd), cur = scenesIn(SHOTS);
  const scenes = cur.filter(f => base.includes(f));
  const onlyBase = base.filter(f => !cur.includes(f)), onlyCur = cur.filter(f => !base.includes(f));
  if (onlyBase.length || onlyCur.length) console.log(`  짝이 없는 장면 — 기준선에만: ${onlyBase.join(', ') || '없음'} / 지금 빌드에만: ${onlyCur.join(', ') || '없음'}`);
  return { bd, scenes };
}

// ---------------- 통계 ----------------
// P(X ≥ k), X ~ 이항(n, 0.5)
function tail(n, k) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let lp = -n * Math.LN2, sum = 0; // log P(X = i), 큰 n에서도 넘치지 않게 로그로 센다
  for (let i = 0; i <= n; i++) { if (i >= k) sum += Math.exp(lp); lp += Math.log((n - i) / (i + 1)); }
  return Math.min(1, sum);
}
const twoSided = (n, k) => (n ? Math.min(1, 2 * tail(n, Math.max(k, n - k))) : 1);
const fp = (p) => (p < 0.001 ? p.toExponential(1) : p.toFixed(3));
const pct = (x) => (Number.isFinite(x) ? `${Math.round(100 * x)}%` : '-');
const flip = (s) => (s === 'A' ? 'B' : 'A');

function parseVerdict(text, n, name) {
  const m = new Map();
  for (const x of String(text).matchAll(/(\d+)\s*[=:]\s*([^,;\n]+)/g)) { const v = x[2].trim().toUpperCase(); m.set(+x[1], /^A(?![A-Z])/.test(v) ? 'A' : /^B(?![A-Z])/.test(v) ? 'B' : 'T'); }
  const missing = [...Array(n)].map((_, i) => i + 1).filter(i => !m.has(i));
  if (missing.length) throw new Error(`${name}에 빠진 쌍이 있다: ${missing.join(', ')} (쌍은 1~${n})`);
  return m;
}
// 옛 키는 벌이 하나다({pairs}), 새 키는 벌이 둘이다({sets: [{tag, pairs}]})
const keySets = (key) => key.sets || [{ tag: '', pairs: key.pairs }];

// 쌍별 결과와 통계. entries: [{ set: 벌 번호, text: 판정 원문 }]
function evaluate(key, entries) {
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
const posN = (t) => t.N + t.O + t.T;
const posRate = (t) => (posN(t) ? t.N / posN(t) : NaN);
const posText = (s) => `새 빌드가 A 자리였던 판정 ${posN(s.position.A)}개: 새 빌드 ${s.position.A.N}, 기준선 ${s.position.A.O}, 구분 안 됨 ${s.position.A.T} (새 빌드 ${pct(posRate(s.position.A))}) / B 자리였던 판정 ${posN(s.position.B)}개: 새 빌드 ${s.position.B.N}, 기준선 ${s.position.B.O}, 구분 안 됨 ${s.position.B.T} (새 빌드 ${pct(posRate(s.position.B))})`;

// 채점이 끝난 라운드의 판정 원문과 쌍별 결과를 커밋되는 곳에 남긴다 (out/은 커밋되지 않는다)
function saveVerdicts(round, key, entries, s) {
  ensureDir(VERDICTS);
  const sets = keySets(key);
  fs.writeFileSync(path.join(VERDICTS, `ab-round-${round}.json`), JSON.stringify({
    round: +round, baseline: key.baseline, crossover: s.cross, zoom: key.zoom || null, only: key.only || null,
    judgments: entries.map(e => ({ set: sets[e.set].tag || null, text: e.text })),
    summary: { W: s.W, L: s.L, T: s.T, p: +s.p.toFixed(4), verdict: s.verdict, letters: { A: s.letters.A, B: s.letters.B, p: +s.letters.p.toFixed(5) }, position: s.position, conflicts: s.conflicts, oldRatio: +s.oldRatio.toFixed(3) },
    pairs: s.pairs.map(p => ({ scene: p.scene, result: p.r, newVotes: p.N, baseVotes: p.O, ties: p.T, sets: p.nums })),
  }, null, 1) + '\n');
}

// ---------------- save ----------------
if (cmd === 'save') {
  const dst = baseDir(pos[0]);
  const src = scenesIn(SHOTS);
  if (!src.length) die('out/shots/가 비어 있다. 먼저 npm run shots');
  fs.rmSync(dst, { recursive: true, force: true }); ensureDir(dst);
  for (const f of [...src, 'meta.json']) if (fs.existsSync(path.join(SHOTS, f))) fs.copyFileSync(path.join(SHOTS, f), path.join(dst, f));
  let commit = '';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); if (execSync('git status --porcelain -- src index.html', { cwd: ROOT }).toString().trim()) commit += '+수정'; } catch (e) {}
  fs.writeFileSync(path.join(dst, 'baseline.json'), JSON.stringify({ name: pos[0], savedAt: new Date().toISOString(), commit, stills: src.filter(isStill).length, strips: src.filter(isStrip).length }, null, 2));
  console.log(`기준선 '${pos[0]}' 저장: ${rel(dst)}/ (정지 화면 ${src.filter(isStill).length}장, 연속 프레임 ${src.filter(isStrip).length}묶음, 커밋 ${commit || '알 수 없음'})`);
}

// ---------------- sheet ----------------
else if (cmd === 'sheet') {
  const { bd, scenes: paired } = pairScenes(pos[0]);
  const zoom = opt('zoom') ? (() => { try { return parseRegion(opt('zoom')); } catch (e) { die(e.message, 2); } })() : null;
  const only = opt('only') ? opt('only').split(',').map(s => s.trim()).filter(Boolean) : null;
  const scenes = only ? paired.filter(f => only.some(s => f.includes(s))) : paired;
  const min = zoom ? MIN_DECIDED : MIN_PAIRS;
  if (scenes.length < min) die(`쌍이 ${scenes.length}개다. ${zoom ? '확대 쌍은' : '전체 화면 라운드는'} ${min}개 아래로 판정하지 않는다 (docs/evaluation.md).`);
  ensureDir(AB); ensureDir(KEYS);
  // 라운드 번호는 파일 이름에서만 센다 (키 내용은 읽지 않는다)
  const used = [...fs.readdirSync(AB).map(f => /^round-(\d+)[-.]/.exec(f)), ...fs.readdirSync(KEYS).map(f => /^ab-round-(\d+)\./.exec(f))].filter(Boolean).map(m => +m[1]);
  const round = opt('round') ? +opt('round') : Math.max(0, ...used) + 1;
  for (const f of fs.readdirSync(AB)) if (new RegExp(`^round-${round}-`).test(f)) fs.rmSync(path.join(AB, f));
  const perPage = Math.max(1, +opt('per-page', 2));
  const nSets = flag('single') ? 1 : 2;
  // 첫째 벌: 자리는 무작위, 새 빌드가 A에 놓이는 쌍과 B에 놓이는 쌍의 수는 맞춘다. 둘째 벌: 같은 장면에서 A와 B를 맞바꾼다(좌우 교차)
  const n = scenes.length, nA = Math.floor(n / 2) + (n % 2 ? crypto.randomInt(2) : 0);
  const side1 = new Map(shuffle(scenes.slice()).map((sc, i) => [sc, i < nA ? 'A' : 'B']));
  // 벌 이름은 무작위 글자다. 이름이나 순서로 어느 벌인지, 어느 쪽이 새 빌드인지 드러나지 않는다
  const tags = []; while (tags.length < nSets) { const t = crypto.randomBytes(2).toString('hex'); if (!tags.includes(t)) tags.push(t); }
  const M = 12, GAP = 16, LAB = 30;
  const IW = 656, FW = 320;
  let IH = 369, FH = 180;
  if (zoom) {
    const ms = await sharp(path.join(SHOTS, scenes.find(isStill) || scenes[0])).metadata();
    IH = zoomHeight(zoom, IW, ms.width, ms.height);
    const st = scenes.find(isStrip);
    if (st) { const mt = await sharp(path.join(SHOTS, st)).metadata(); FH = zoomHeight(zoom, FW, Math.floor(mt.width / 8), mt.height); }
  }
  const sets = [];
  for (let k = 0; k < nSets; k++) {
    const tag = tags[k], files = [];
    // 벌마다 순서를 새로 섞는다. 정지 화면이 먼저, 연속 프레임이 뒤다
    const order = [...shuffle(scenes.filter(isStill)), ...shuffle(scenes.filter(isStrip))];
    const pairs = order.map((scene, i) => ({ n: i + 1, scene, newSide: k === 0 ? side1.get(scene) : flip(side1.get(scene)) }));
    const prefix = nSets > 1 ? `round-${round}-${tag}-` : `round-${round}-`;
    // 정지 화면: 한 장에 perPage쌍, 왼쪽 A · 오른쪽 B
    const stillPairs = pairs.filter(p => isStill(p.scene));
    for (let s = 0; s < stillPairs.length; s += perPage) {
      const part = stillPairs.slice(s, s + perPage), comps = [];
      for (let j = 0; j < part.length; j++) {
        const p = part[j], y = M + j * (LAB + IH + M);
        const fa = path.join(p.newSide === 'A' ? SHOTS : bd, p.scene), fb = path.join(p.newSide === 'B' ? SHOTS : bd, p.scene);
        comps.push({ input: label(IW, LAB, `#${p.n}  A`), left: M, top: y }, { input: label(IW, LAB, `#${p.n}  B`), left: M + IW + GAP, top: y });
        comps.push({ input: await still(fa, IW, IH, zoom), left: M, top: y + LAB }, { input: await still(fb, IW, IH, zoom), left: M + IW + GAP, top: y + LAB });
      }
      const file = path.join(AB, `${prefix}${files.length + 1}.png`);
      await page(M * 2 + IW * 2 + GAP, M + part.length * (LAB + IH + M), comps, file);
      files.push(file);
    }
    // 연속 프레임: 한 장에 한 쌍, 위 A · 아래 B
    for (const p of pairs.filter(q => isStrip(q.scene))) {
      const a = await stripBlock(path.join(p.newSide === 'A' ? SHOTS : bd, p.scene), FW, FH, 4, zoom), b = await stripBlock(path.join(p.newSide === 'B' ? SHOTS : bd, p.scene), FW, FH, 4, zoom);
      const comps = [
        { input: label(a.w, LAB, `#${p.n}  A   (${STRIP_NOTE})`), left: M, top: M }, { input: a.buf, left: M, top: M + LAB },
        { input: label(b.w, LAB, `#${p.n}  B   (${STRIP_NOTE})`), left: M, top: M * 2 + LAB + a.h }, { input: b.buf, left: M, top: M * 2 + LAB * 2 + a.h },
      ];
      const file = path.join(AB, `${prefix}${files.length + 1}.png`);
      await page(M * 2 + a.w, M * 3 + LAB * 2 + a.h + b.h, comps, file);
      files.push(file);
    }
    sets.push({ tag, pairs, files });
  }
  const key = { round, baseline: pos[0], createdAt: new Date().toISOString(), crossover: nSets > 1, zoom, only, sets: sets.map(s => ({ tag: s.tag, pairs: s.pairs })) };
  if (nSets === 1) { key.pairs = key.sets[0].pairs; delete key.sets; }
  fs.writeFileSync(path.join(KEYS, `ab-round-${round}.json`), JSON.stringify(key));
  const nStill = scenes.filter(isStill).length;
  console.log(`A/B 라운드 ${round}: 기준선 '${pos[0]}' 대 지금 out/shots/, 쌍 ${n}개 (정지 화면 ${nStill}, 연속 프레임 ${n - nStill})${zoom ? `, 확대 영역 ${opt('zoom')}` : ''}, ${nSets > 1 ? `좌우 교차 ${nSets}벌 (벌마다 판정자 2명)` : '한 벌 (옛 방식)'}`);
  for (const s of sets) {
    console.log(nSets > 1 ? `  벌 ${s.tag}: 시트 ${s.files.length}장` : `  시트 ${s.files.length}장`);
    for (const f of s.files) console.log(`    ${rel(f)}`);
  }
}

// ---------------- score ----------------
else if (cmd === 'score') {
  const round = pos[0], rest = pos.slice(1);
  if (!round || !rest.length) die('사용법: npm run ab -- score <라운드> <벌> "1=A, 2=B, 3=구분 안 됨, ..." "<판정>" <벌> "<판정>" "<판정>"  (한 벌짜리 옛 라운드는 벌 없이 판정만)', 2);
  const keyFile = path.join(KEYS, `ab-round-${round}.json`);
  if (!fs.existsSync(keyFile)) die(`A/B 라운드 ${round}의 키가 없다.`);
  const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  const sets = keySets(key), multi = sets.length > 1;
  const entries = [];
  let cur = multi ? -1 : 0;
  for (const a of rest) {
    const t = sets.findIndex(s => s.tag && s.tag === a.trim());
    if (t >= 0) { cur = t; continue; }
    if (cur < 0) die(`판정 앞에 벌 이름(${sets.map(s => s.tag).join(', ')})을 적는다.`, 2);
    entries.push({ set: cur, text: a });
  }
  let s;
  try { s = evaluate(key, entries); } catch (e) { die(e.message, 2); }
  const n = s.pairs.length;
  const perSet = sets.map((st, i) => entries.filter(e => e.set === i).length);
  console.log(`A/B 라운드 ${round} (기준선 '${key.baseline}', 쌍 ${n}개${key.zoom ? ', 확대 쌍' : ''}, 판정 ${entries.length}개${multi ? ` — 벌마다 ${perSet.join('·')}명, 좌우 교차` : ' — 한 벌, 다수결'})`);
  s.judges.forEach((j, i) => console.log(`  판정 ${i + 1}${multi ? ` (벌 ${j.tag})` : ''}: 새 빌드 ${j.N}, 기준선 ${j.O}, 구분 안 됨 ${j.T} · 고른 글자 A ${j.A}, B ${j.B}`));
  console.log(`  쌍별 결과: 새 빌드 승 ${s.W}, 기준선 승 ${s.L}, 구분 안 됨 ${s.T} (갈린 쌍 ${s.decided})`);
  if (flag('zero')) {
    const bad = s.zero.decidedBiased || s.zero.letterBiased;
    console.log(`  영점 확인: 갈린 쌍 ${s.decided} (기준 ${MIN_DECIDED}개 미만) · 글자 집계 양측 p = ${fp(s.letters.p)} (기준 ${ZERO_LETTER_P} 이상) → ${bad ? `치우침 (${[s.zero.decidedBiased && '갈린 쌍이 많다', s.zero.letterBiased && '글자 쏠림'].filter(Boolean).join(', ')})` : '통과'}`);
  } else {
    console.log(`  부호 검정(단측): p = ${fp(s.p)} → ${s.verdict}${s.verdict === '판정 불가' ? ` (갈린 쌍이 ${MIN_DECIDED}개 미만. 확대 쌍으로 다시 판정한다)` : ` (기준 p ≤ ${ALPHA}, 갈린 쌍 ${MIN_DECIDED}개 이상)`}`);
  }
  console.log(`  글자 집계: A ${s.letters.A}번, B ${s.letters.B}번 (B ${pct(s.letters.B / (s.letters.A + s.letters.B))}), 양측 이항 검정 p = ${fp(s.letters.p)}`);
  console.log(`  자리 집계: ${posText(s)}`);
  console.log(`  방향이 갈린 쌍(새 빌드 표와 기준선 표가 함께 나온 쌍): ${s.conflicts}`);
  const lost = s.pairs.filter(p => p.r === 'L');
  console.log(`  기준선이 이긴 쌍: ${lost.length ? lost.map(p => `${p.scene.replace(/\.png$/, '')} (${p.nums.map(q => (q.tag ? `${q.tag} #${q.n}` : `#${q.n}`)).join(', ')})`).join('; ') : '없음'}`);
  const groups = [];
  for (const grp of String(opt('scenes') || '').split(';').map(x => x.trim()).filter(Boolean)) {
    const subs = grp.split(',').map(x => x.trim()).filter(Boolean);
    const ps = s.pairs.filter(p => subs.some(x => p.scene.includes(x)));
    const g = { scenes: subs, pairs: ps.length, W: ps.filter(p => p.r === 'W').length, L: ps.filter(p => p.r === 'L').length, T: ps.filter(p => p.r === 'T').length };
    console.log(`  장면 [${subs.join(', ')}] ${g.pairs}쌍: 새 빌드 승 ${g.W}, 기준선 승 ${g.L}, 구분 안 됨 ${g.T}${g.L > g.W ? '  ← 기준선 승이 더 많다. 고치거나 두는 이유를 PROGRESS.md에 적는다' : ''}`);
    groups.push(g);
  }
  console.log(`  옛 방식 비율(구분 안 됨 = 반, 과거 기록과 견주는 용도): ${pct(s.oldRatio)}`);
  ensureDir(AB);
  fs.writeFileSync(path.join(AB, `round-${round}-result.json`), JSON.stringify({
    round: +round, baseline: key.baseline, pairs: n, crossover: s.cross, zoom: key.zoom || null, zero: flag('zero'),
    judgments: entries.map(e => (multi ? { set: sets[e.set].tag, text: e.text } : e.text)),
    perJudge: s.judges.map(j => ({ set: j.tag || null, N: j.N, O: j.O, T: j.T, A: j.A, B: j.B })),
    result: { W: s.W, L: s.L, T: s.T, decided: s.decided, p: +s.p.toFixed(4), verdict: s.verdict },
    letters: s.letters, position: s.position, conflicts: s.conflicts, groups,
    majority: { ratio: +s.oldRatio.toFixed(3), N: s.W, O: s.L, T: s.T },
    scoredAt: new Date().toISOString(),
  }, null, 2));
  saveVerdicts(round, key, entries, s);
  console.log(`  판정 원문과 쌍별 결과: ${rel(path.join(VERDICTS, `ab-round-${round}.json`))} (커밋한다)`);
}

// ---------------- rescore ----------------
else if (cmd === 'rescore') {
  const from = +opt('from', 1), to = +opt('to', 1e9);
  const files = fs.readdirSync(AB).map(f => /^round-(\d+)-result\.json$/.exec(f)).filter(Boolean).map(m => +m[1]).filter(r => r >= from && r <= to).sort((a, b) => a - b);
  console.log('| 라운드 | 기준선 | 판정 | 쌍 | 승 | 패 | 구분 안 됨 | 부호 검정 p | 판정 | 고른 글자 A·B | 글자 p | 새 빌드가 A일 때 새 빌드 | 새 빌드가 B일 때 새 빌드 | 방향 갈린 쌍 | 옛 방식 | 기록된 비율 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const tot = { A: 0, B: 0, majA: 0, majB: 0, pos: { A: { N: 0, O: 0, T: 0 }, B: { N: 0, O: 0, T: 0 } }, rounds: 0 };
  for (const r of files) {
    const res = JSON.parse(fs.readFileSync(path.join(AB, `round-${r}-result.json`), 'utf8'));
    const keyFile = path.join(KEYS, `ab-round-${r}.json`);
    if (!fs.existsSync(keyFile) || !Array.isArray(res.judgments) || !res.judgments.length) { console.log(`| ${r} | ${res.baseline || '-'} | 다시 채점할 수 없음 (${!fs.existsSync(keyFile) ? '키 없음' : '판정 원문 없음'}) |`); continue; }
    const key = JSON.parse(fs.readFileSync(keyFile, 'utf8')), sets = keySets(key);
    const entries = res.judgments.map(j => (typeof j === 'string' ? { set: 0, text: j } : { set: Math.max(0, sets.findIndex(s => s.tag === j.set)), text: j.text }));
    let s;
    try { s = evaluate(key, entries); } catch (e) { console.log(`| ${r} | ${key.baseline} | 다시 채점할 수 없음 (${e.message}) |`); continue; }
    const recorded = res.majority && Number.isFinite(res.majority.ratio) ? pct(res.majority.ratio) : '-';
    console.log(`| ${r} | ${key.baseline} | ${entries.length}${s.cross ? ' (교차)' : ''} | ${s.pairs.length} | ${s.W} | ${s.L} | ${s.T} | ${fp(s.p)} | ${s.verdict} | ${s.letters.A}·${s.letters.B} | ${fp(s.letters.p)} | ${pct(posRate(s.position.A))} | ${pct(posRate(s.position.B))} | ${s.conflicts} | ${pct(s.oldRatio)} | ${recorded} |`);
    tot.A += s.letters.A; tot.B += s.letters.B; tot.majA += s.majLetter.A; tot.majB += s.majLetter.B; tot.rounds++;
    for (const side of ['A', 'B']) for (const v of ['N', 'O', 'T']) tot.pos[side][v] += s.position[side][v];
    if (!flag('dry')) saveVerdicts(r, key, entries, s);
  }
  const all = { position: tot.pos };
  console.log(`\n${tot.rounds}라운드 합계`);
  console.log(`- 고른 글자: A ${tot.A}번, B ${tot.B}번 (B ${pct(tot.B / (tot.A + tot.B))}), 양측 이항 검정 p = ${fp(twoSided(tot.A + tot.B, tot.B))}`);
  console.log(`- 다수결로 갈린 쌍의 글자: A ${tot.majA}쌍, B ${tot.majB}쌍 (B ${pct(tot.majB / (tot.majA + tot.majB))}), 양측 p = ${fp(twoSided(tot.majA + tot.majB, tot.majB))}`);
  console.log(`- 자리 집계: ${posText(all)}`);
  const pa = tot.pos.A, pb = tot.pos.B;
  const dec = (t) => t.N + t.O;
  console.log(`- 표가 나온 판정만: 새 빌드가 A일 때 새 빌드 ${pct(pa.N / dec(pa))} (${pa.N}/${dec(pa)}), B일 때 ${pct(pb.N / dec(pb))} (${pb.N}/${dec(pb)})`);
  console.log(`쌍별 결과와 판정 원문: ${rel(VERDICTS)}/ab-round-N.json${flag('dry') ? ' (--dry: 쓰지 않음)' : ''}`);
}

// ---------------- report / solo ----------------
else if (cmd === 'report' || cmd === 'solo') {
  const outArg = opt('out');
  if (!outArg) die(`사용법: npm run ab -- ${cmd}${cmd === 'report' ? ' <이름>' : ''} --out docs/shots/<폴더>`, 2);
  const outDir = ensureDir(path.resolve(ROOT, outArg));
  const M = 10, LAB = 28, files = [];
  if (cmd === 'report') {
    const { bd, scenes } = pairScenes(pos[0]);
    const IW = 800, IH = 450, PER = 3;
    const stills = scenes.filter(isStill);
    for (let s = 0; s < stills.length; s += PER) {
      const part = stills.slice(s, s + PER), comps = [];
      for (let k = 0; k < part.length; k++) {
        const y = M + k * (LAB + IH + M), name = part[k].replace(/\.png$/, '');
        comps.push({ input: label(IW, LAB, `${name} — 기준선`, 18), left: M, top: y }, { input: label(IW, LAB, `${name} — 새 빌드`, 18), left: M * 2 + IW, top: y });
        comps.push({ input: await still(path.join(bd, part[k]), IW, IH), left: M, top: y + LAB }, { input: await still(path.join(SHOTS, part[k]), IW, IH), left: M * 2 + IW, top: y + LAB });
      }
      const file = path.join(outDir, `before-after-${files.length + 1}.jpg`);
      await page(M * 3 + IW * 2, M + part.length * (LAB + IH + M), comps, file, true);
      files.push(file);
    }
    const FW = 400, FH = 225;
    for (const sc of scenes.filter(isStrip)) {
      const a = await stripBlock(path.join(bd, sc), FW, FH), b = await stripBlock(path.join(SHOTS, sc), FW, FH), name = sc.replace(/\.png$/, '');
      const comps = [
        { input: label(a.w, LAB, `${name} — 기준선 (1초 8장, 왼쪽에서 오른쪽, 다음 줄)`, 18), left: M, top: M }, { input: a.buf, left: M, top: M + LAB },
        { input: label(b.w, LAB, `${name} — 새 빌드`, 18), left: M, top: M * 2 + LAB + a.h }, { input: b.buf, left: M, top: M * 2 + LAB * 2 + a.h },
      ];
      const file = path.join(outDir, `before-after-${files.length + 1}.jpg`);
      await page(M * 2 + a.w, M * 3 + LAB * 2 + a.h + b.h, comps, file, true);
      files.push(file);
    }
  } else {
    const scenes = scenesIn(SHOTS);
    if (!scenes.length) die('out/shots/가 비어 있다. 먼저 npm run shots');
    const IW = 640, IH = 360, COLS = 3, stills = scenes.filter(isStill), rows = Math.ceil(stills.length / COLS), comps = [];
    for (let i = 0; i < stills.length; i++) {
      const x = M + (i % COLS) * (IW + M), y = M + Math.floor(i / COLS) * (LAB + IH + M);
      comps.push({ input: label(IW, LAB, stills[i].replace(/\.png$/, ''), 18), left: x, top: y }, { input: await still(path.join(SHOTS, stills[i]), IW, IH), left: x, top: y + LAB });
    }
    let file = path.join(outDir, 'build-stills.jpg');
    await page(M + COLS * (IW + M), M + rows * (LAB + IH + M), comps, file, true); files.push(file);
    const FW = 480, FH = 270, strips = scenes.filter(isStrip), sc = [];
    let y = M, w = 0;
    for (const s of strips) {
      const b = await stripBlock(path.join(SHOTS, s), FW, FH); w = b.w;
      sc.push({ input: label(b.w, LAB, `${s.replace(/\.png$/, '')} (1초 8장, 왼쪽에서 오른쪽, 다음 줄)`, 18), left: M, top: y }, { input: b.buf, left: M, top: y + LAB });
      y += LAB + b.h + M;
    }
    if (strips.length) { file = path.join(outDir, 'build-strips.jpg'); await page(M * 2 + w, y, sc, file, true); files.push(file); }
  }
  console.log(`${cmd === 'report' ? '전후 시트' : '빌드 화면 시트'} ${files.length}장:`);
  for (const f of files) console.log(`  ${rel(f)} (${Math.round(fs.statSync(f).size / 1024)} KB)`);
}

// ---------------- diff ----------------
else if (cmd === 'diff') {
  const { bd, scenes } = pairScenes(pos[0]);
  let worst = 0;
  console.log(`기준선 '${pos[0]}' 대 지금 out/shots/ — 채널 평균 절대 차이(0~255)와 8 넘게 다른 화소 비율`);
  for (const sc of scenes) {
    const [a, b] = await Promise.all([bd, SHOTS].map(d => sharp(path.join(d, sc)).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
    if (a.info.width !== b.info.width || a.info.height !== b.info.height) { console.log(`  ${sc}: 크기가 다르다`); continue; }
    let sum = 0, big = 0;
    for (let i = 0; i < a.data.length; i += 3) { const d = (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])) / 3; sum += d; if (d > 8) big++; }
    const px = a.data.length / 3, mean = sum / px; worst = Math.max(worst, mean);
    console.log(`  ${sc.padEnd(32)} 평균 ${mean.toFixed(2)}  ·  ${(100 * big / px).toFixed(1)}%`);
  }
  console.log(`가장 크게 다른 장면의 평균 차이: ${worst.toFixed(2)}`);
}

else die('사용법: npm run ab -- save|sheet|score|rescore|report|solo|diff ... (scripts/ab.mjs 머리말 참고)', 2);
