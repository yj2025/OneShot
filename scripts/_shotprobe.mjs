// 봇 사격 장면 살펴보기(2단계 ②): 플레이어가 봇 가슴을 겨눠 2프레임과 14프레임에 쏜다. 맞았는지와 봇 상태를 찍는다. 검사가 아니다
//   node scripts/_shotprobe.mjs [--nobuild] '<vp>' '<bots>' [이름]
import sharp from 'sharp';
import { build, launch, openGame, clickStart, makeMouse } from './lib.mjs';
const args = process.argv.slice(2).filter(a => a !== '--nobuild');
if (!process.argv.includes('--nobuild')) build();
const [vp, bots, name = 'shotprobe'] = args;
const L = await launch({ width: 1280, height: 720 });
const g = await openGame(L.context, `test=1&clock=manual&seed=11&vp=${vp}&bots=${bots}`);
await clickStart(g.page);
const mouse = makeMouse(g.page, 1280, 720); await mouse.center();
await g.page.evaluate(() => window.__bc.step(156));
const frames = []; let done = 0, last;
for (let i = 0; i < 8; i++) {
  const target = 1 + Math.round(i * 60 / 8);
  while (done < target) { if (done === 2 || done === 14) await mouse.down('left'); if (done === 4 || done === 16) await mouse.up('left'); last = await g.page.evaluate(() => window.__bc.step(1)); done++; }
  await g.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  frames.push(await sharp(await g.page.screenshot({ type: 'png' })).resize(480, 270).png().toBuffer());
}
const st = await g.page.evaluate(() => window.__bc.state().bots.map(b => b.alive));
console.log('hits', last.playerHits, 'shots', last.shotsFired, 'alive', st.join(','), g.errors.slice(0, 2));
await sharp({ create: { width: 480 * 4, height: 270 * 2, channels: 3, background: '#000' } }).composite(frames.map((t, i) => ({ input: t, left: (i % 4) * 480, top: Math.floor(i / 4) * 270 }))).jpeg({ quality: 80 }).toFile(`${process.env.TEMP}/${name}.jpg`);
await L.browser.close();
