// 실내 세션: 판정자가 본 두 현상을 잰다. ① 뷰모델 밝기 ÷ 둘레 고리 밝기 ② 채널별 실효 반사율(소매의 색)
// 사용: node look.mjs "2,3,4,6,7" ['{"only":"sleeve","sheen":0}' | -] [steps]
import { launch, openGame, clickStart } from '../../../../scripts/lib.mjs';
const views = (process.argv[2] || '2,3,4,6,7').split(',').map(Number);
const mats = process.argv[3] && process.argv[3] !== '-' ? JSON.parse(process.argv[3]) : null;
const steps = +(process.argv[4] || 90);
const groups = { all: null, gun: 'polymer,steel,scopeBody,tan,worn', glove: 'glove', sleeve: 'sleeve' };
const L = await launch({ width: 1280, height: 720 });
const f = (x, d = 2) => (x == null ? '-' : x.toFixed(d));
for (const v of views) {
  const q = await openGame(L.context, `test=1&clock=manual&seed=11&view=${v}`);
  const P = q.page; await clickStart(P);
  await P.evaluate((n) => window.__bc.step(n), steps);
  if (mats) { await P.evaluate((m) => window.__bc.vmMat(m), mats); await P.evaluate(() => window.__bc.step(1)); }
  let line = `view ${v}:`;
  for (const [k, only] of Object.entries(groups)) {
    const r = await P.evaluate((o) => window.__bc.vmLight(o ? { only: o } : {}), only);
    if (!r.vm.n) { line += ` | ${k} -`; continue; }
    const [R, G, B] = r.rgb, mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    line += ` | ${k} 밝기/둘레 ${f(r.vm.p50 / r.ring.p50)} p90/둘레 ${f(r.vm.p90 / r.ring.p50)} 반사 ${f(r.refl.all.p50 * 100, 1)}% 채도 ${f(1 - mn / mx)} B/G ${f(B / G)}`;
    if (k === 'all') line += ` [둘레 n ${r.ring.n} 장면 p50 ${f(r.scene.p50, 3)} 둘레 p50 ${f(r.ring.p50, 3)}]`;
  }
  console.log(line);
  await P.close();
}
await L.browser.close();
