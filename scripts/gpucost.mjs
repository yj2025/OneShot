// 개발 중 확인용: 두 빌드의 프레임 시간을 GPU가 병목이 되는 큰 화면(3840×2160)에서 번갈아 잰다.
// 1080p에서는 이 기기의 GPU가 남아 CPU 쪽 시간만 보이므로, 화소당 셰이더 비용이 늘었는지는 이렇게 본다.
// 사용: node scripts/gpucost.mjs <기준 빌드 html> [지금 빌드 html]   (기본: dist/index.html)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIST, launch, clickStart, sleep } from './lib.mjs';

const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (files.length < 2) files.push(DIST);
const W = 3840, H = 2160, SEC = 14;
const L = await launch({ width: W, height: H });
console.log(`렌더러: ${L.renderer} (${L.mode}), ${W}x${H}, 품질 high, ${SEC}초씩 번갈아 두 번`);
const res = files.map(() => []);
for (let round = 0; round < 2; round++) for (let i = 0; i < files.length; i++) {
  const page = await L.context.newPage();
  await page.goto(pathToFileURL(path.resolve(files[i])).href + '?test=1&seed=5&tour=1&quality=high');
  await page.waitForFunction(() => window.__bc && window.__bc.ready, null, { timeout: 120000 });
  await clickStart(page);
  await sleep(1500);
  await page.evaluate(() => window.__bc.perfStart());
  await sleep(SEC * 1000);
  const r = await page.evaluate(() => window.__bc.perfStop());
  const ft = r.frames.slice().sort((a, b) => a - b);
  const mean = ft.reduce((a, b) => a + b, 0) / ft.length;
  res[i].push({ mean, p95: ft[Math.floor(ft.length * 0.95)] });
  await page.close();
}
files.forEach((f, i) => console.log(`  ${path.relative(process.cwd(), path.resolve(f)).padEnd(34)} 평균 ${res[i].map(r => r.mean.toFixed(2)).join(' / ')} ms, p95 ${res[i].map(r => r.p95.toFixed(2)).join(' / ')} ms`));
await L.browser.close();
