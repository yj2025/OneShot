// 판정 원문 줄에서 A/B 통계를 다시 센다. 정답 키(out/keys/)는 열지 않는다.
// 사용(레포 루트에서):
//   node docs/handoff/2026-11-17-review/tools/abstats.mjs docs/handoff/2026-11-16-indoor/verdicts
//   node docs/handoff/2026-11-17-review/tools/abstats.mjs <폴더> --scores r45=45,r46=48
// 입력:
//   <폴더>/rNN-jM.txt   판정자 한 명의 답 한 줄. 형식은 "1=A, 2=구분 안 됨, 3=B, ..."
//   <폴더>/README.md    표에 라운드별 점수(%)가 있으면 읽어서 승패를 역산한다. --scores 로 덮어쓴다.
// 역산은 점수 = (새 빌드 승 + 0.5 × 나머지 쌍) ÷ 전체 쌍 이라는 가정에서 나온다. 키로 확인한 값이 아니다.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir || !fs.existsSync(dir)) {
  console.error('사용: node abstats.mjs <판정 원문 폴더> [--scores r45=45,r46=48]');
  process.exit(2);
}

// P(X >= k), X ~ 이항(n, 0.5)
function tail(n, k) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let c = 1, sum = 0; // c = C(n, i)
  for (let i = 0; i <= n; i++) {
    if (i >= k) sum += c;
    c = (c * (n - i)) / (i + 1);
  }
  return sum / 2 ** n;
}
const twoSided = (n, k) => Math.min(1, 2 * tail(n, Math.max(k, n - k)));
const pct = (x) => `${Math.round(x * 100)}%`;
const fp = (p) => (p < 0.001 ? p.toExponential(1) : p.toFixed(3));

function parse(file) {
  const text = fs.readFileSync(file, 'utf8');
  const votes = new Map();
  for (const m of text.matchAll(/(\d+)\s*=\s*(A|B|구분 안 됨)/g)) votes.set(+m[1], m[2] === 'A' || m[2] === 'B' ? m[2] : 'X');
  return votes;
}

// 라운드별로 판정 파일을 모은다
const rounds = new Map();
for (const name of fs.readdirSync(dir).sort()) {
  const m = name.match(/^r(\d+)-j(\d+)\.txt$/);
  if (!m) continue;
  const key = `r${m[1]}`;
  if (!rounds.has(key)) rounds.set(key, []);
  rounds.get(key).push(parse(path.join(dir, name)));
}
if (!rounds.size) { console.error(`${dir} 에 rNN-jM.txt 파일이 없습니다.`); process.exit(1); }

// 점수: README.md 표 → --scores 순으로 읽는다
const scores = new Map(), baselines = new Map();
const readme = path.join(dir, 'README.md');
if (fs.existsSync(readme)) {
  for (const line of fs.readFileSync(readme, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\|\s*r(\d+)-j[^|]*\|[^|]*\|\s*([^|]*?)\s*\|\s*(\d+)\s*%/);
    if (m) { scores.set(`r${m[1]}`, +m[3]); baselines.set(`r${m[1]}`, m[2]); }
  }
}
const sArg = args.find((a) => a.startsWith('--scores'));
if (sArg) {
  const list = sArg.includes('=') && sArg.indexOf('=') === 8 ? sArg.slice(9) : args[args.indexOf(sArg) + 1] || '';
  for (const part of list.split(',')) { const [k, v] = part.split('='); if (k && v) scores.set(k.trim(), +v); }
}

let totA = 0, totB = 0, majA = 0, majB = 0;
const rows = [];
for (const [key, judges] of rounds) {
  const n = Math.max(...judges.map((j) => Math.max(...j.keys())));
  let tie = 0, none = 0, dec = 0, decB = 0, conflict = 0;
  for (let i = 1; i <= n; i++) {
    const v = judges.map((j) => j.get(i) ?? 'X');
    const a = v.filter((x) => x === 'A').length, b = v.filter((x) => x === 'B').length, x = v.length - a - b;
    totA += a; totB += b;
    if (a && b) conflict++;
    const half = v.length / 2;
    if (a > half || b > half) { dec++; if (b > half) { decB++; majB++; } else majA++; }
    else if (x > half) tie++;
    else none++;
  }
  // 점수에서 승패 역산
  let wl = '-', p = '-', max = pct((dec + 0.5 * (n - dec)) / n);
  if (scores.has(key)) {
    const s = scores.get(key), fits = [];
    for (let w = 0; w <= dec; w++) if (Math.round(((w + 0.5 * (n - dec)) / n) * 100) === s) fits.push(w);
    if (fits.length === 1) { wl = `${fits[0]}–${dec - fits[0]}`; p = fp(tail(dec, fits[0])); }
    else wl = fits.length ? `여러 해: 승 ${fits.join(', ')}` : '맞는 해 없음';
  }
  rows.push([key, baselines.get(key) || '-', judges.length, n, tie, none, dec, decB, conflict, scores.has(key) ? `${scores.get(key)}%` : '-', wl, max, p]);
}

console.log('## 라운드별 (판정 원문에서 센 값. 승–패와 p는 점수에서 역산)\n');
console.log('| 라운드 | 기준선 | 판정자 | 쌍 | 구분 안 됨 | 다수결 없음 | 갈린 쌍 | 그중 B | 방향이 갈린 쌍 | 기록된 점수 | 승–패 | 전승이면 | 부호 검정 p |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
console.log('\n- 구분 안 됨: 판정자 과반이 구분 안 됨. 갈린 쌍: 과반이 같은 글자. 다수결 없음: 어느 쪽도 과반이 아님.');
console.log('- 방향이 갈린 쌍: 한 쌍에서 A를 고른 판정자와 B를 고른 판정자가 함께 있다.');
console.log('- 전승이면: 갈린 쌍을 새 빌드가 모두 이겼을 때 옛 방식(구분 안 됨 = 반)으로 나오는 점수.');
console.log('- 부호 검정 p: 두 빌드에 차이가 없을 때 갈린 쌍에서 이만큼 이상 이길 확률(단측).');

console.log('\n## 글자 쏠림\n');
console.log(`- 판정 낱개: A ${totA}번, B ${totB}번 (B ${pct(totB / (totA + totB))})`);
console.log(`- 갈린 쌍의 다수 글자: A ${majA}쌍, B ${majB}쌍 (B ${pct(majB / (majA + majB))}), 양측 이항 검정 p = ${fp(twoSided(majA + majB, majB))}`);
console.log('- A와 B의 배정이 무작위라면 어느 빌드가 낫든 두 글자가 비슷하게 나와야 한다.');

console.log('\n## 부호 검정으로 통과하려면 (p ≤ 0.05)\n');
console.log('| 갈린 쌍 | 새 빌드가 이겨야 하는 쌍 | 그때의 p |');
console.log('| --- | --- | --- |');
for (const n of [5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 31]) {
  let w = n; while (w > 0 && tail(n, w - 1) <= 0.05) w--;
  console.log(`| ${n} | ${w} | ${fp(tail(n, w))} |`);
}
