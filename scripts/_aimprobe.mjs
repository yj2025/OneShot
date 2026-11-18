// 총구 방향이 봇 가슴을 지나도록 시점(yaw, pitch)을 맞춘다(2단계 ②, 사격 장면용). 검사가 아니다
//   node scripts/_aimprobe.mjs '<x,z,yaw,pitch>' '<bots>' <봇 번호>
import { build, launch, openGame, clickStart } from './lib.mjs';
let [vp, bots, bi] = process.argv.slice(2);
const L = await launch({ width: 1280, height: 720 });
let [x, z, yaw, pitch] = vp.split(',').map(Number);
for (let it = 0; it < 4; it++) {
  const g = await openGame(L.context, `test=1&clock=manual&seed=11&vp=${x},${z},${yaw.toFixed(4)},${pitch.toFixed(4)}&bots=${bots}`);
  await clickStart(g.page);
  const r = await g.page.evaluate((bi) => { window.__bc.step(156); return { a: window.__bc.vmAim(), b: window.__bc.botJ(+bi) }; }, bi);
  await g.page.close();
  const J = r.b.J, c = [J[1][0] * 0.7 + J[0][0] * 0.3, J[1][1] * 0.7 + J[0][1] * 0.3, J[1][2] * 0.7 + J[0][2] * 0.3];
  const v = [c[0] - r.a.m[0], c[1] - r.a.m[1], c[2] - r.a.m[2]];
  const ty = Math.atan2(-v[0], -v[2]), tp = Math.atan2(v[1], Math.hypot(v[0], v[2]));
  const dy = Math.atan2(-r.a.d[0], -r.a.d[2]), dp = Math.atan2(r.a.d[1], Math.hypot(r.a.d[0], r.a.d[2]));
  let ey = ty - dy; while (ey > Math.PI) ey -= 2 * Math.PI; while (ey < -Math.PI) ey += 2 * Math.PI;
  console.log(it, 'vp', x, z, yaw.toFixed(4), pitch.toFixed(4), 'err yaw', ey.toFixed(4), 'pitch', (tp - dp).toFixed(4));
  const k = +(process.env.K || 1); yaw += ey * k; pitch += (tp - dp) * k;
}
await L.browser.close();
