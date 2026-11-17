// 봇 살펴보기(2단계 ①, 2026-11-17): 봇 장면 후보를 찍어 한 장에 모은다. 검사가 아니다
//   node scripts/_botprobe.mjs <출력.jpg> [--nobuild] [--only 이름,...]   BC_DIST=<html> 로 다른 빌드
// 장면 목록은 scripts/botscenes.mjs(npm run shots와 같은 목록)
import path from 'node:path';
import sharp from 'sharp';
import { build, launch, openGame, clickStart } from './lib.mjs';
import { BOT_SHOTS } from './botscenes.mjs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'botprobe.jpg';
if (!process.argv.includes('--nobuild')) build();
const oi = process.argv.indexOf('--only'), only = oi > 0 ? process.argv[oi + 1].split(',') : null;
const L = await launch({ width: 1280, height: 720 });
const tiles = [];
const si = process.argv.indexOf('--scenes'), LIST = si > 0 ? JSON.parse(process.argv[si + 1]) : BOT_SHOTS;
const full = process.argv.includes('--full');
for (const s of LIST) {
  if (only && !only.includes(s.name)) continue;
  const g = await openGame(L.context, `test=1&clock=manual&seed=11&vp=${s.vp}&bots=${s.bots}${s.novm ? '&novm=1' : ''}`);
  await clickStart(g.page);
  await g.page.evaluate((k) => window.__bc.step(k), s.frames || 156);
  await g.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  tiles.push(await sharp(await g.page.screenshot({ type: 'png' })).resize(full ? 1280 : 640, full ? 720 : 360).png().toBuffer());
  if (g.errors.length) console.log(s.name, g.errors.slice(0, 3));
  await g.page.close();
}
const TW = full ? 1280 : 640, TH = full ? 720 : 360, cols = full ? 1 : 2, rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: TW * cols, height: TH * rows, channels: 3, background: '#000' } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * TW, top: Math.floor(i / cols) * TH }))).jpeg({ quality: 85 }).toFile(out);
console.log(out, tiles.length);
await L.browser.close();
