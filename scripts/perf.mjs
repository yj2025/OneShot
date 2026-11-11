// npm run perf: 정해진 경로를 32초 돌며 프레임 시간을 재서 out/perf.json에 저장
import fs from 'node:fs';
import path from 'node:path';
import { OUT, ensureDir, build, launch, openGame, clickStart, sleep } from './lib.mjs';

const W = 1920, H = 1080;
const TARGET = { gpu: '중급 노트북 GPU', resolution: '1920x1080', fps: 60, frameMs: 16.7 };
if (!process.argv.includes('--nobuild')) build();
const L = await launch({ width: W, height: H });
console.log(`렌더러: ${L.renderer} (${L.mode})`);
const runs = [];
for (const quality of ['high', 'medium', 'low']) {
  const { page } = await openGame(L.context, `test=1&seed=5&tour=1&quality=${quality}`);
  await clickStart(page);
  await sleep(1500);
  await page.evaluate(() => window.__bc.perfStart());
  await sleep(32000);
  const r = await page.evaluate(() => window.__bc.perfStop());
  const ft = r.frames.slice().sort((a, b) => a - b);
  const q = p => ft[Math.min(ft.length - 1, Math.floor(p * ft.length))];
  const mean = ft.reduce((a, b) => a + b, 0) / ft.length;
  runs.push({ quality, frames: ft.length, seconds: r.seconds, meanMs: +mean.toFixed(2), p95Ms: +q(0.95).toFixed(2), p99Ms: +q(0.99).toFixed(2), worstMs: +ft[ft.length - 1].toFixed(2), meanFps: +(1000 / mean).toFixed(1), renderScale: r.renderScale, canvas: r.canvas, distanceM: +r.distance.toFixed(1) });
  console.log(`  ${quality}: 평균 ${mean.toFixed(2)} ms (${(1000 / mean).toFixed(0)} fps), p95 ${q(0.95).toFixed(2)} ms, 최악 ${ft[ft.length - 1].toFixed(2)} ms, 프레임 ${ft.length}, 이동 ${r.distance.toFixed(0)} m`);
  await page.close();
}
const res = {
  renderer: L.renderer, browserMode: L.mode, software: L.software,
  note: L.software ? '소프트웨어 렌더러에서 잰 값 — 참고용' : '실제 GPU에서 잰 값(vsync 해제). 측정 기기는 데스크톱 GPU이므로 중급 노트북 GPU 목표에 대해서는 추정치다.',
  resolution: `${W}x${H}`, target: TARGET, runs,
  meetsTarget: runs[0].p95Ms <= TARGET.frameMs,
  measuredAt: new Date().toISOString(),
};
ensureDir(OUT);
fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(res, null, 2));
await L.browser.close();
console.log(`out/perf.json 저장. 목표(high, p95 ≤ ${TARGET.frameMs} ms): ${res.meetsTarget ? '충족' : '미달'}`);
