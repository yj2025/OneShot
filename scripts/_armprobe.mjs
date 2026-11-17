// 팔 살펴보기(2단계 ④ 마무리, 2026-11-17): 자세별로 어깨~손목 거리, 팔뚝 축~렌즈 거리, 두 마디 팔 무게, 팔꿈치를 적고 화면을 한 장에 모은다. 검사가 아니다
//   node scripts/_armprobe.mjs [출력.jpg]   BC_DIST=<html> 로 다른 빌드
import sharp from 'sharp';
import { launch, openGame, clickStart } from './lib.mjs';
const W = 1280, H = 720;
const L = await launch({ width: W, height: H });
const CASES = [
  ['소총 낮춤 마당', 0, 'rifle', 0], ['소총 낮춤 복도', 2, 'rifle', 0], ['소총 쏘기 방', 7, 'rifle', 1], ['소총 쏘기 마당', 0, 'rifle', 1],
  ['권총 낮춤', 12, 'pistol', 0], ['권총 쏘기', 12, 'pistol', 1], ['권총 쏘기 방', 7, 'pistol', 1], ['소총 쏘기 홀', 3, 'rifle', 1],
];
const tiles = [];
for (const [name, view, wpn, alert] of CASES) {
  const g = await openGame(L.context, `test=1&clock=manual&seed=11&view=${view}`); const P = g.page; await clickStart(P);
  const step = (k) => P.evaluate((n) => window.__bc.step(n), k);
  await P.evaluate((a) => window.__bc.vmTune({ alert: a, carry: 0 }), alert);
  await step(60);
  if (wpn === 'pistol') { const cur = (await P.evaluate(() => window.__bc.state())).player.weapon; if (cur !== 'pistol') { await P.keyboard.down('Digit2'); await step(2); await P.keyboard.up('Digit2'); } }
  await step(120);
  const a = await P.evaluate(() => window.__bc.vmArms());
  const f = (s) => `${s} 닿음 ${a[s].reach} 렌즈 ${a[s].near} ik ${a[s].ik} 손목 ${a[s].w.join(',')} 팔꿈치 ${a[s].e.join(',')}`;
  console.log(`${name}\n  R ${f('R')}\n  L ${f('L')}`);
  await P.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  tiles.push(await sharp(await P.screenshot({ type: 'png' })).resize(640, 360).toBuffer());
  await P.close();
}
await L.browser.close();
const out = process.argv[2] || 'out/armprobe.jpg';
await sharp({ create: { width: 1280, height: 360 * Math.ceil(tiles.length / 2), channels: 3, background: '#000' } })
  .composite(tiles.map((b, i) => ({ input: b, left: (i % 2) * 640, top: Math.floor(i / 2) * 360 }))).jpeg({ quality: 78 }).toFile(out);
console.log('저장', out);
