// 총구 화염이 화면을 얼마나 밝히는지 잰다: 같은 시점에서 쏘기 직전 프레임과 첫 발이 나간 프레임을 견준다.
// 사용: node scripts/flash.mjs [--nobuild]  (BC_DIST=다른 빌드.html 로 다른 빌드를 잴 수 있다)
// 출력: out/flash.json, 그리고 out/dev/flash-<장면>.png(왼쪽 직전, 오른쪽 사격 프레임)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { OUT, ensureDir, build, launch, openGame, clickStart, makeMouse } from './lib.mjs';

const W = 1280, H = 720;
if (!process.argv.includes('--nobuild') && !process.env.BC_DIST) build();
const dev = ensureDir(path.join(OUT, 'dev'));
const L = await launch({ width: W, height: H });
console.log(`렌더러: ${L.renderer} (${L.mode})`);
const step = (page, n = 1) => page.evaluate((k) => window.__bc.step(k), n);
const settle = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const luma = async (buf) => { const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true }); const n = info.width * info.height, y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2]; return y; };
const out = { renderer: L.renderer, scenes: {} };
for (const [name, v] of [['corridor', 2], ['yard', 0], ['pistol', 12], ['room', 7]]) {
  const { page } = await openGame(L.context, `test=1&clock=manual&seed=11&view=${v}`);
  await clickStart(page);
  await step(page, 156);
  const mouse = makeMouse(page, W, H); await mouse.center();
  await step(page, 1); await settle(page);
  const a = await page.screenshot({ type: 'png' });
  await mouse.down('left'); await step(page, 1); await settle(page);
  const b = await page.screenshot({ type: 'png' });
  await mouse.up('left');
  await step(page, 1); await settle(page);
  const c = await page.screenshot({ type: 'png' });   // 다음 프레임(1/60초 뒤): 화염이 한 카메라 프레임 안에서 끝나는지 본다
  const [ya, yb, yc] = await Promise.all([luma(a), luma(b), luma(c)]);
  let sa = 0, sb = 0, sc = 0, lit = 0, white = 0, whiteA = 0, maxUp = 0;
  for (let i = 0; i < ya.length; i++) { sa += ya[i]; sb += yb[i]; sc += yc[i]; const d = yb[i] - ya[i]; if (d > 25) lit++; if (d > maxUp) maxUp = d; if (yb[i] >= 250) white++; if (ya[i] >= 250) whiteA++; }
  const n = ya.length;
  const r = { before: +(sa / n).toFixed(1), flash: +(sb / n).toFixed(1), next: +(sc / n).toFixed(1), ratio: +(sb / sa).toFixed(3), litPct: +(lit / n * 100).toFixed(2), whiteAddedPct: +((white - whiteA) / n * 100).toFixed(3), maxUp: Math.round(maxUp) };
  out.scenes[name] = r;
  console.log(`${name}: 평균 밝기 ${r.before} → ${r.flash} (${r.ratio}배), 다음 프레임 ${r.next}. 25 넘게 밝아진 화소 ${r.litPct}%, 새로 날아간 화소 ${r.whiteAddedPct}%, 최대 상승 ${r.maxUp}`);
  const tiles = await Promise.all([a, b].map(x => sharp(x).resize(640, 360).png().toBuffer()));
  await sharp({ create: { width: 1280, height: 360, channels: 3, background: '#000' } }).composite(tiles.map((t, i) => ({ input: t, left: i * 640, top: 0 }))).png().toFile(path.join(dev, `flash-${name}.png`));
  await page.close();
}
fs.writeFileSync(path.join(OUT, 'flash.json'), JSON.stringify(out, null, 2));
await L.browser.close();
