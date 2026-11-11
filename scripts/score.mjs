// npm run score -- <라운드> "<빌드로 판정한 칸, 예: A,C,F>" ["<판정 2>" "<판정 3>"]
// 인자 하나가 판정 한 벌이다. 빌드로 판정한 칸이 없으면 "-"를 넣는다.
// 정답 키를 직접 열어 대조하고 정답률과 합계만 출력한다. 어느 칸이 빌드인지는 출력하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from './lib.mjs';

const [round, ...sets] = process.argv.slice(2);
if (!round || !sets.length) { console.error('사용법: npm run score -- <라운드> "A,C,F" ["판정 2" "판정 3"]'); process.exit(2); }
const key = JSON.parse(fs.readFileSync(path.join(OUT, 'keys', `round-${round}.json`), 'utf8'));
const truth = new Set(key.build);
const all = [...Array(key.total)].map((_, i) => String.fromCharCode(65 + i));
const nBuild = truth.size, nRef = key.total - nBuild;
console.log(`라운드 ${round}: ${key.total}칸 (빌드 ${nBuild}, 레퍼런스 ${nRef})${nRef === 0 ? ' — 레퍼런스 없는 시트라 참고값' : ''}`);
const rates = sets.map((s, i) => {
  const chosen = new Set(s.split(/[\s,]+/).map(x => x.trim().toUpperCase()).filter(x => /^[A-Z]$/.test(x)));
  const hit = all.filter(n => truth.has(n) && chosen.has(n)).length;      // 빌드를 빌드로
  const wrong = all.filter(n => !truth.has(n) && chosen.has(n)).length;   // 레퍼런스를 빌드로
  const correct = hit + (nRef - wrong);
  console.log(`  판정 ${i + 1}: 식별 정답률 ${(100 * correct / key.total).toFixed(0)}% (${correct}/${key.total}칸) · 빌드 ${nBuild}칸 중 ${hit}칸을 빌드로 판정, 레퍼런스 ${nRef}칸 중 ${wrong}칸을 빌드로 오판`);
  return correct / key.total;
});
const sorted = [...rates].sort((a, b) => a - b);
const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
if (sets.length > 1) console.log(`  정답률 중앙값 ${(100 * median).toFixed(0)}% (판정 ${sets.length}벌)`);
