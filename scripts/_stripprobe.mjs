// 봇 연속 프레임 살펴보기(2단계 ②): scripts/botscenes.mjs의 BOT_STRIPS를 찍어 한 장에 모은다(줄마다 한 묶음, 1초 8장). 검사가 아니다
//   node scripts/_stripprobe.mjs <출력.jpg> [--nobuild] [--only 이름,...]   BC_DIST=<html> 로 다른 빌드
import sharp from 'sharp';
import { build, launch, openGame, clickStart, makeMouse } from './lib.mjs';
import { BOT_STRIPS } from './botscenes.mjs';
const out = process.argv[2];
if (!process.argv.includes('--nobuild')) build();
const ci = process.argv.indexOf('--crop'), crop = ci > 0 ? process.argv[ci + 1].split(',').map(Number) : null;   // x,y,w,h (1280×720 화소)
const oi = process.argv.indexOf('--only'), only = oi > 0 ? process.argv[oi + 1].split(',') : null;
const L = await launch({ width: 1280, height: 720 });
const rows = [];
const si = process.argv.indexOf('--scenes'), LIST = si > 0 ? JSON.parse(process.argv[si + 1]) : BOT_STRIPS;
for (const s of LIST) {
  if (only && !only.includes(s.name)) continue;
  const g = await openGame(L.context, `test=1&clock=manual&seed=11&vp=${s.vp}&bots=${s.bots}${s.novm ? "&novm=1" : ""}`);
  await clickStart(g.page);
  await g.page.evaluate((k) => window.__bc.step(k), s.frames || 156);
  const mouse = makeMouse(g.page, 1280, 720); await mouse.center();
  let done = 0; const fr = [];
  for (let i = 0; i < 8; i++) {
    const target = 1 + Math.round(i * 60 / 8);
    while (done < target) { if (s.fire?.includes(done)) await mouse.down('left'); if (s.fire?.includes(done - 2)) await mouse.up('left'); await g.page.evaluate(() => window.__bc.step(1)); done++; }
    await g.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    { let im = sharp(await g.page.screenshot({ type: 'png' })); if (crop) im = sharp(await im.extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] }).png().toBuffer()); fr.push(await im.resize(400, 225, { fit: 'fill' }).png().toBuffer()); }
  }
  if (g.errors.length) console.log(s.name, g.errors.slice(0, 3));
  rows.push(fr); await g.page.close();
}
await sharp({ create: { width: 400 * 8, height: 225 * rows.length, channels: 3, background: '#000' } })
  .composite(rows.flatMap((fr, r) => fr.map((t, i) => ({ input: t, left: i * 400, top: r * 225 })))).jpeg({ quality: 82 }).toFile(out);
console.log(out, rows.length);
await L.browser.close();
