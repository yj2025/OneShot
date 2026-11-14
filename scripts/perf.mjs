// npm run perf: 정해진 경로를 32초 돌며 프레임 시간을 재서 out/perf.json에 저장
// 이어서 소총 조준경을 들여다본 채 같은 경로를 24초 더 돌며, 조준경 시점 렌더링을 2초마다 켜고 끈다.
// 켠 구간과 끈 구간의 차이가 조준경 렌더링 하나의 비용이다(장면과 자세가 같은 상태에서 잰다)
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
  // 조준경: 우클릭을 누른 채 켠 구간과 끈 구간을 번갈아 잰다
  const stat = (a) => { const t = a.slice().sort((x, y) => x - y); const m = t.reduce((x, y) => x + y, 0) / t.length; return { n: t.length, mean: m, p95: t[Math.min(t.length - 1, Math.floor(0.95 * t.length))] }; };
  await page.mouse.move(W / 2, H / 2); await page.mouse.down({ button: 'right' }); await sleep(900);
  const blk = { on: [], off: [] }; let rendered = 0, onTotal = 0, calls = 0, tris = 0;
  for (let i = 0; i < 12; i++) {
    const skip = i % 2 === 1;
    await page.evaluate((b) => window.__bc.scopeSkip(b), skip);
    await sleep(250);
    const f0 = (await page.evaluate(() => window.__bc.scope())).frames;
    await page.evaluate(() => window.__bc.perfStart());
    await sleep(1750);
    const rr = await page.evaluate(() => window.__bc.perfStop());
    const sc = await page.evaluate(() => window.__bc.scope());
    (skip ? blk.off : blk.on).push(...rr.frames);
    if (!skip) { rendered += sc.frames - f0; onTotal += rr.frames.length + 2; calls = Math.max(calls, sc.calls); tris = Math.max(tris, sc.tris); }
  }
  await page.evaluate(() => window.__bc.scopeSkip(false));
  await page.mouse.up({ button: 'right' });
  const so = stat(blk.on), sf = stat(blk.off);
  const scope = { onMeanMs: +so.mean.toFixed(2), onP95Ms: +so.p95.toFixed(2), offMeanMs: +sf.mean.toFixed(2), offP95Ms: +sf.p95.toFixed(2), costMs: +(so.mean - sf.mean).toFixed(2), renderedShare: +(rendered / Math.max(1, onTotal)).toFixed(2), maxCalls: calls, maxTris: tris };
  console.log(`    조준경: 켬 평균 ${so.mean.toFixed(2)} ms (p95 ${so.p95.toFixed(2)}), 끔 평균 ${sf.mean.toFixed(2)} ms (p95 ${sf.p95.toFixed(2)}), 차이 ${(so.mean - sf.mean).toFixed(2)} ms, 켠 구간에서 실제로 그린 비율 ${(scope.renderedShare * 100).toFixed(0)}%, 그리기 호출 최대 ${calls}, 삼각형 최대 ${tris}`);
  runs.push({ quality, frames: ft.length, seconds: r.seconds, meanMs: +mean.toFixed(2), p95Ms: +q(0.95).toFixed(2), p99Ms: +q(0.99).toFixed(2), worstMs: +ft[ft.length - 1].toFixed(2), meanFps: +(1000 / mean).toFixed(1), renderScale: r.renderScale, canvas: r.canvas, distanceM: +r.distance.toFixed(1), scope });
  console.log(`  ${quality}: 평균 ${mean.toFixed(2)} ms (${(1000 / mean).toFixed(0)} fps), p95 ${q(0.95).toFixed(2)} ms, 최악 ${ft[ft.length - 1].toFixed(2)} ms, 프레임 ${ft.length}, 이동 ${r.distance.toFixed(0)} m`);
  await page.close();
}
const res = {
  renderer: L.renderer, browserMode: L.mode, software: L.software,
  note: L.software ? '소프트웨어 렌더러에서 잰 값 — 참고용' : '실제 GPU에서 잰 값(vsync 해제). 측정 기기는 데스크톱 GPU이므로 중급 노트북 GPU 목표에 대해서는 추정치다.',
  resolution: `${W}x${H}`, target: TARGET, runs,
  meetsTarget: runs[0].p95Ms <= TARGET.frameMs && runs[0].scope.onP95Ms <= TARGET.frameMs,
  measuredAt: new Date().toISOString(),
};
ensureDir(OUT);
fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(res, null, 2));
await L.browser.close();
console.log(`out/perf.json 저장. 목표(high, p95 ≤ ${TARGET.frameMs} ms): ${res.meetsTarget ? '충족' : '미달'}`);
