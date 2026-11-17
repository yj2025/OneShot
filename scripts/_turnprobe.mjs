// 걷다가 Shift를 누르고 오른쪽으로 돌며 달리는 1초(shots의 strip-running-turn과 같은 입력) 동안 총구의 화면 자리를 잰다(2단계 ④ '원인 6', 2026-11-17). 살펴보기용이다.
//   node scripts/_turnprobe.mjs     BC_DIST=<html> 로 다른 빌드를 잰다
import { launch, openGame, clickStart } from './lib.mjs';
const W = 1280, H = 720;
const L = await launch({ width: W, height: H });
const g = await openGame(L.context, 'test=1&clock=manual&seed=11&view=2'); const Q = g.page; await clickStart(Q);
const step = (k) => Q.evaluate((n) => window.__bc.step(n), k);
await step(156);
await Q.keyboard.down('KeyW'); await step(30 + 60);
await Q.keyboard.down('ShiftLeft');
await Q.mouse.move(W / 2, H / 2);
await Q.evaluate(() => window.__bc.vmScreen(true));
const rows = [];
let mx = W / 2;
for (let f = 0; f < 60; f++) {
  if (f < 48 && !process.env.NOTURN) { mx += 6; await Q.mouse.move(mx, H / 2); }
  await step(1);
  const r = await Q.evaluate(() => window.__bc.vmScreen());
  rows.push(r);
}
const px = (n) => [n[0] * W / 2, n[1] * H / 2];
for (const k of ['grip', 'wristL']) {
  const p = rows.map((r) => px(r[k]));
  console.log(`${k} (옆,위아래) px 4프레임마다: ` + p.filter((_, i) => i % 4 === 0).map((v) => v.map((x) => x.toFixed(0)).join(',')).join('  '));
  const ys = p.map((v) => v[1]), xs = p.map((v) => v[0]);
  console.log(`  위아래 범위 ${(Math.max(...ys) - Math.min(...ys)).toFixed(0)}, 옆 범위 ${(Math.max(...xs) - Math.min(...xs)).toFixed(0)}, 가장 높은 곳 ${Math.max(...ys).toFixed(0)} (프레임 ${ys.indexOf(Math.max(...ys))})`);
}
await L.browser.close();
