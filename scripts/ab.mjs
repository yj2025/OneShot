// npm run ab -- <명령> : 세션을 시작할 때의 빌드(기준선)와 지금 빌드를 같은 장면끼리 짝지어 비교한다 (docs/evaluation.md)
//   save <이름>                              지금 out/shots/를 out/baseline/<이름>/에 기준선으로 복사
//   sheet <이름> [--round N] [--per-page 2]   판정용 A/B 시트를 out/ab/round-N-*.png에, 정답 키를 out/keys/ab-round-N.json에
//   score <라운드> "<판정>" ["<판정>" ...]      판정(예: "1=A, 2=B, 3=구분 안 됨")을 키와 대조해 새 빌드 선호 비율만 출력
//   report <이름> --out docs/shots/<폴더>      사람이 보는 전후 시트(왼쪽 기준선, 오른쪽 새 빌드)를 JPEG로
//   solo --out docs/shots/<폴더>              지금 out/shots/만 모은 시트를 JPEG로 (전후가 없는 0단계용)
//   diff <이름>                              기준선과 지금 화면의 장면별 픽셀 차이 (키와 무관, 촬영이 얼마나 같은지 확인)
// 키 내용은 어떤 명령도 출력하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { ROOT, OUT, ensureDir } from './lib.mjs';
import { shuffle, label, still, stripBlock, page, STRIP_NOTE } from './sheetlib.mjs';

const SHOTS = path.join(OUT, 'shots'), BASE = path.join(OUT, 'baseline'), AB = path.join(OUT, 'ab'), KEYS = path.join(OUT, 'keys');
const MIN_PAIRS = 15;
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def; };
const pos = (() => { const out = []; for (let i = 1; i < argv.length; i++) { if (argv[i].startsWith('--')) { i++; continue; } out.push(argv[i]); } return out; })();
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
  const { bd, scenes } = pairScenes(pos[0]);
  if (scenes.length < MIN_PAIRS) die(`쌍이 ${scenes.length}개다. ${MIN_PAIRS}개 아래로는 판정하지 않는다 (docs/evaluation.md).`);
  ensureDir(AB); ensureDir(KEYS);
  // 라운드 번호는 파일 이름에서만 센다 (키 내용은 읽지 않는다)
  const used = [...fs.readdirSync(AB).map(f => /^round-(\d+)[-.]/.exec(f)), ...fs.readdirSync(KEYS).map(f => /^ab-round-(\d+)\./.exec(f))].filter(Boolean).map(m => +m[1]);
  const round = opt('round') ? +opt('round') : Math.max(0, ...used) + 1;
  for (const f of fs.readdirSync(AB)) if (new RegExp(`^round-${round}-`).test(f)) fs.rmSync(path.join(AB, f));
  const perPage = Math.max(1, +opt('per-page', 2));
  // 순서도 자리도 무작위. 새 빌드가 A에 놓이는 쌍과 B에 놓이는 쌍의 수는 맞춘다(자리 치우침이 한쪽 빌드에 쌓이지 않게)
  const order = [...shuffle(scenes.filter(isStill)), ...shuffle(scenes.filter(isStrip))];
  const n = order.length, nA = Math.floor(n / 2) + (n % 2 ? crypto.randomInt(2) : 0);
  const sides = shuffle(order.map((_, i) => (i < nA ? 'A' : 'B')));
  const pairs = order.map((scene, i) => ({ n: i + 1, scene, newSide: sides[i] }));
  const files = [];
  const M = 12, GAP = 16, LAB = 30;
  // 정지 화면: 한 장에 perPage쌍, 왼쪽 A · 오른쪽 B
  const IW = 656, IH = 369;
  const stillPairs = pairs.filter(p => isStill(p.scene));
  for (let s = 0; s < stillPairs.length; s += perPage) {
    const part = stillPairs.slice(s, s + perPage), comps = [];
    for (let k = 0; k < part.length; k++) {
      const p = part[k], y = M + k * (LAB + IH + M);
      const fa = path.join(p.newSide === 'A' ? SHOTS : bd, p.scene), fb = path.join(p.newSide === 'B' ? SHOTS : bd, p.scene);
      comps.push({ input: label(IW, LAB, `#${p.n}  A`), left: M, top: y }, { input: label(IW, LAB, `#${p.n}  B`), left: M + IW + GAP, top: y });
      comps.push({ input: await still(fa, IW, IH), left: M, top: y + LAB }, { input: await still(fb, IW, IH), left: M + IW + GAP, top: y + LAB });
    }
    const file = path.join(AB, `round-${round}-${files.length + 1}.png`);
    await page(M * 2 + IW * 2 + GAP, M + part.length * (LAB + IH + M), comps, file);
    files.push(file);
  }
  // 연속 프레임: 한 장에 한 쌍, 위 A · 아래 B
  const FW = 320, FH = 180;
  for (const p of pairs.filter(q => isStrip(q.scene))) {
    const a = await stripBlock(path.join(p.newSide === 'A' ? SHOTS : bd, p.scene), FW, FH), b = await stripBlock(path.join(p.newSide === 'B' ? SHOTS : bd, p.scene), FW, FH);
    const comps = [
      { input: label(a.w, LAB, `#${p.n}  A   (${STRIP_NOTE})`), left: M, top: M }, { input: a.buf, left: M, top: M + LAB },
      { input: label(b.w, LAB, `#${p.n}  B   (${STRIP_NOTE})`), left: M, top: M * 2 + LAB + a.h }, { input: b.buf, left: M, top: M * 2 + LAB * 2 + a.h },
    ];
    const file = path.join(AB, `round-${round}-${files.length + 1}.png`);
    await page(M * 2 + a.w, M * 3 + LAB * 2 + a.h + b.h, comps, file);
    files.push(file);
  }
  fs.writeFileSync(path.join(KEYS, `ab-round-${round}.json`), JSON.stringify({ round, baseline: pos[0], createdAt: new Date().toISOString(), pairs }));
  console.log(`A/B 라운드 ${round}: 기준선 '${pos[0]}' 대 지금 out/shots/, 쌍 ${n}개 (정지 화면 ${stillPairs.length}, 연속 프레임 ${n - stillPairs.length}), 시트 ${files.length}장`);
  for (const f of files) console.log(`  ${rel(f)}`);
}

// ---------------- score ----------------
else if (cmd === 'score') {
  const round = pos[0], sets = pos.slice(1);
  if (!round || !sets.length) die('사용법: npm run ab -- score <라운드> "1=A, 2=B, 3=구분 안 됨, ..." ["판정 2" "판정 3"]', 2);
  const keyFile = path.join(KEYS, `ab-round-${round}.json`);
  if (!fs.existsSync(keyFile)) die(`A/B 라운드 ${round}의 키가 없다.`);
  const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  const n = key.pairs.length;
  const parse = (s, idx) => {
    const m = new Map();
    for (const x of s.matchAll(/(\d+)\s*[=:]\s*([^,;\n]+)/g)) { const v = x[2].trim().toUpperCase(); m.set(+x[1], /^A(?![A-Z])/.test(v) ? 'A' : /^B(?![A-Z])/.test(v) ? 'B' : 'T'); }
    const missing = [...Array(n)].map((_, i) => i + 1).filter(i => !m.has(i));
    if (missing.length) die(`판정 ${idx + 1}에 빠진 쌍이 있다: ${missing.join(', ')} (쌍은 1~${n})`, 2);
    return m;
  };
  const judged = sets.map(parse);
  const pct = (x) => `${(100 * x).toFixed(0)}%`;
  // 쌍마다: 새 빌드를 골랐으면 N, 기준선이면 O, 구분 안 됨이면 T
  const votes = judged.map(m => key.pairs.map(p => { const c = m.get(p.n); return c === 'T' ? 'T' : c === p.newSide ? 'N' : 'O'; }));
  const tally = (v) => ({ N: v.filter(x => x === 'N').length, O: v.filter(x => x === 'O').length, T: v.filter(x => x === 'T').length });
  const ratio = (t) => (t.N + 0.5 * t.T) / (t.N + t.O + t.T);
  console.log(`A/B 라운드 ${round} (기준선 '${key.baseline}', 쌍 ${n}개, 판정 ${sets.length}벌) — '구분 안 됨'은 반으로 센다`);
  const perJudge = votes.map((v, i) => {
    const t = tally(v), a = [...judged[i].values()];
    console.log(`  판정 ${i + 1}: 새 빌드 선호 ${pct(ratio(t))} (새 빌드 ${t.N}, 기준선 ${t.O}, 구분 안 됨 ${t.T}) · 고른 자리 A ${a.filter(x => x === 'A').length}, B ${a.filter(x => x === 'B').length}`);
    return { ratio: +ratio(t).toFixed(3), ...t };
  });
  const all = tally(votes.flat());
  console.log(`  합친 비율: ${pct(ratio(all))} (판정 ${votes.flat().length}개 중 새 빌드 ${all.N}, 기준선 ${all.O}, 구분 안 됨 ${all.T})`);
  // 쌍별 다수결: 판정의 과반이 고른 답. 과반이 없으면 구분 안 됨
  const maj = key.pairs.map((_, i) => { const t = tally(votes.map(v => v[i])); const need = Math.floor(sets.length / 2) + 1; return t.N >= need ? 'N' : t.O >= need ? 'O' : 'T'; });
  const mt = tally(maj);
  console.log(`  쌍별 다수결: 새 빌드 선호 ${pct(ratio(mt))} (새 빌드 ${mt.N}쌍, 기준선 ${mt.O}쌍, 구분 안 됨·갈림 ${mt.T}쌍)`);
  console.log(`  한쪽 쏠림(영점 확인용): ${n}쌍 중 최대 ${Math.max(mt.N, mt.O)}쌍`);
  ensureDir(AB);
  fs.writeFileSync(path.join(AB, `round-${round}-result.json`), JSON.stringify({ round: +round, baseline: key.baseline, pairs: n, judgments: sets, perJudge, pooled: { ratio: +ratio(all).toFixed(3), ...all }, majority: { ratio: +ratio(mt).toFixed(3), ...mt }, scoredAt: new Date().toISOString() }, null, 2));
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

else die('사용법: npm run ab -- save|sheet|score|report|solo|diff ... (scripts/ab.mjs 머리말 참고)', 2);
