// 걷기·달리기 동안 총의 화면 움직임을 잰다(2단계 ④ '원인 4', 2026-11-17). 검사가 아니라 살펴보기용이다.
// 검사 (o) ①은 0.5초 떨어진 두 프레임의 차라 걸음 주기(0.45~0.55초)와 겹쳐 진폭을 작게 잰다. 여기서는 1.5초(90프레임)의 표준편차와 범위를 본다.
// 수동 시계, 시드 11. 시점(VIEW, 기본 2 = 복도)에서 2.6초 선 뒤 W(SPRINT=1이면 Shift도)를 누르고 0.5초 지나서 잰다. 화소는 1280×720 기준.
//   node scripts/_walkprobe.mjs            걷기
//   SPRINT=1 node scripts/_walkprobe.mjs   달리기
//   KEY=KeyD node scripts/_walkprobe.mjs  옆걸음(기본 KeyW)
//   BC_DIST=<html> 로 다른 빌드를 잰다(lib.mjs)
import { launch, openGame, clickStart } from './lib.mjs';
const W = 1280, H = 720;
const L = await launch({ width: W, height: H });
const view = +(process.env.VIEW || 2), sprint = !!process.env.SPRINT;
const g = await openGame(L.context, `test=1&clock=manual&seed=11&view=${view}`); const Q = g.page; await clickStart(Q);
const step = (k) => Q.evaluate((n) => window.__bc.step(n), k);
await step(156);
await Q.keyboard.down(process.env.KEY || 'KeyW'); if (sprint) await Q.keyboard.down('ShiftLeft'); await step(30);
await Q.evaluate(() => window.__bc.vmScreen(true));
const fr = [];
for (let f = 0; f < 90; f++) { await step(1); fr.push(await Q.evaluate(() => window.__bc.vmScreen())); }
const px = (n) => [n[0] * W / 2, n[1] * H / 2];
const vals = (k, i) => fr.map((r) => px(r[k])[i]);
const range = (k, i) => { const v = vals(k, i); return (Math.max(...v) - Math.min(...v)).toFixed(1); };
const sd = (k, i) => { const v = vals(k, i), m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length).toFixed(1); };
console.log(`${sprint ? '달리기' : '걷기'} (시점 ${view}, 1.5초, px)`);
console.log(`  표준편차  총구 옆 ${sd('muzzle', 0)} 위아래 ${sd('muzzle', 1)} | 받침손 옆 ${sd('wristL', 0)} 위아래 ${sd('wristL', 1)} | 배경 옆 ${sd('bg', 0)} 위아래 ${sd('bg', 1)}`);
console.log(`  범위      총구 옆 ${range('muzzle', 0)} 위아래 ${range('muzzle', 1)} | 받침손 옆 ${range('wristL', 0)} 위아래 ${range('wristL', 1)} | 배경 옆 ${range('bg', 0)} 위아래 ${range('bg', 1)}`);
console.log('  총구 위아래(4프레임마다):', fr.filter((_, i) => i % 4 === 0).map((r) => px(r.muzzle)[1].toFixed(0)).join(' '));
await L.browser.close();
