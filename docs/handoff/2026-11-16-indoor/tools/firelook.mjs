import { fileURLToPath } from 'node:url';
// 사격 순간 뷰모델이 화염에서 받는 빛: 화염 전 프레임과 첫 발 프레임의 뷰모델 밝기(선형 HDR 중앙값)를 견준다
// 사용: node firelook.mjs [html 경로] [view]
import { launch, clickStart, makeMouse } from '../../../../scripts/lib.mjs';
import { pathToFileURL } from 'node:url';
const html = process.argv[2] || fileURLToPath(new URL('../../../../dist/index.html', import.meta.url));
const view = +(process.argv[3] || 7);
const L = await launch({ width: 1280, height: 720 });
const page = await L.context.newPage();
await page.goto(pathToFileURL(html).href + `?test=1&clock=manual&seed=11&view=${view}`);
await page.waitForFunction(() => window.__bc && window.__bc.ready, null, { timeout: 120000 });
await clickStart(page);
const step = (n) => page.evaluate((k) => window.__bc.step(k), n);
await step(90);
const mouse = makeMouse(page, 1280, 720); await mouse.center();
await step(1);
const groups = { all: null, gun: 'polymer,steel,scopeBody,tan,worn', sleeve: 'sleeve', glove: 'glove' };
const meas = async () => { const o = {}; for (const [k, only] of Object.entries(groups)) { const r = await page.evaluate((x) => window.__bc.vmLight(x ? { only: x } : {}), only); o[k] = r.vm.n ? r.vm.p50 : null; o.scene = r.scene.p50; } return o; };
const before = (await step(0))?.shotsFired ?? 0;
await mouse.down('left');
let prev = null, fired = null;
for (let i = 0; i < 36; i++) { prev = await meas(); const s = await step(1); if (s.shotsFired > before) { fired = await meas(); break; } }
const f = (x) => (x == null ? '-' : x.toFixed(3));
console.log(html.split('/').pop(), 'view', view);
for (const k of [...Object.keys(groups), 'scene']) console.log(`  ${k.padEnd(7)} 전 ${f(prev[k])}  화염 ${f(fired && fired[k])}  배율 ${fired && prev[k] ? (fired[k] / prev[k]).toFixed(2) : '-'}`);
await L.browser.close();
