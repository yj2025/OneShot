// 탄의 가림 살펴보기(2026-11-18): 여러 자리에서 보이는 형상과 탄의 충돌 상자를 견준다. 검사가 아니다
//   node scripts/_bulletprobe.mjs [--nobuild] [--json out.json]
import fs from 'node:fs';
import { build, launch, openGame, clickStart } from './lib.mjs';
if (!process.argv.includes('--nobuild')) build();
const L = await launch({ width: 960, height: 540 });
const g = await openGame(L.context, 'test=1&clock=manual&seed=11');
await clickStart(g.page);
await g.page.evaluate(() => window.__bc.step(10));
// 교전이 벌어지는 자리: 마당, 로비, 사무실, 창고, 복도, 홀. 가슴 높이(1.35 m)에서 네 방향
const SPOTS = [[0, 16], [6, 20], [-12, 12], [16, 6], [0, 8], [-7.5, 3.6], [-7.5, -0.9], [0.5, -2.4], [8, -2.6], [-6, -5.8], [6, -5.8], [2, -8], [-2, -11], [8, 12], [-16, 10.5], [14, 3.5]];
const res = [];
for (const [x, z] of SPOTS) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  const r = await g.page.evaluate((a) => window.__bc.bulletMatch(a), { x, y: 1.35, z, yaw, skip: ['weeds', 'sheet', 'chain', 'tube', 'puddle', 'stain', 'paper', 'cable', '?treeCards', '?treeLitter'] });
  res.push({ x, z, yaw, ...r });
}
const sum = { rays: 0, solid: 0, passN: 0, blockN: 0, pass: {}, block: {} };
for (const r of res) { sum.rays += r.rays; sum.solid += r.solid; sum.passN += r.passN; sum.blockN += r.blockN; for (const k in r.pass) sum.pass[k] = (sum.pass[k] || 0) + r.pass[k]; for (const k in r.block) sum.block[k] = (sum.block[k] || 0) + r.block[k]; }
console.log(`광선 ${sum.rays}, 무언가에 닿음 ${sum.solid}, 뚫림 ${sum.passN} (${(100 * sum.passN / sum.solid).toFixed(2)}%), 막힘 ${sum.blockN} (${(100 * sum.blockN / sum.solid).toFixed(2)}%)`);
console.log('뚫림(보이는 재질):', Object.entries(sum.pass).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => k + ' ' + v).join(', '));
console.log('막힘(충돌 재질):', Object.entries(sum.block).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => k + ' ' + v).join(', '));
for (const r of res) if (r.passN + r.blockN > r.solid * 0.02) console.log(`  자리 ${r.x},${r.z} yaw ${r.yaw.toFixed(2)}: 뚫림 ${r.passN}, 막힘 ${r.blockN} / ${r.solid}`);
const ji = process.argv.indexOf('--json'); if (ji > 0) fs.writeFileSync(process.argv[ji + 1], JSON.stringify(res));
if (g.errors.length) console.log(g.errors.slice(0, 3));
await L.browser.close();
