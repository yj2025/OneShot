// npm run score -- <라운드> <빌드로 판정한 칸, 예: A,C,F>
// 정답 키를 직접 열어 대조하고 정답률만 출력한다. 키 내용은 출력하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from './lib.mjs';

const [round, ...rest] = process.argv.slice(2);
if (!round) { console.error('사용법: npm run score -- <라운드> <A,C,...>'); process.exit(2); }
const key = JSON.parse(fs.readFileSync(path.join(OUT, 'keys', `round-${round}.json`), 'utf8'));
const truth = new Set(key.build);
const chosen = new Set(rest.join(',').split(/[ ,]+/).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]$/.test(s)));
let correct = 0;
for (let i = 0; i < key.total; i++) {
  const n = String.fromCharCode(65 + i);
  if (truth.has(n) === chosen.has(n)) correct++;
}
const refs = key.total - truth.size;
console.log(`라운드 ${round}: 식별 정답률 ${(100 * correct / key.total).toFixed(0)}% (${correct}/${key.total}칸)${refs === 0 ? ' — 레퍼런스 없는 시트라 참고값' : ''}`);
