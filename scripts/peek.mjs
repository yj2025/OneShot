// 개발 중 확인용: 고정 시점 몇 개를 수동 시계로 찍어 out/dev/에 저장한다. 판정자를 부르지 않는 사이의 확인은 이 화면을 직접 본다.
// 사용: node scripts/peek.mjs 0 4 7            → npm run shots와 같은 시점 번호
//       node scripts/peek.mjs vp=-1,-2,0.5,0   → 임의 시점(x,z,yaw,pitch)
//       옵션: --nobuild, --q=low, --frames=156, --tag=이름, --clay(재질 색을 뺀 빛만), --dist=다른 빌드의 html(비교용)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUT, DIST, ensureDir, build, launch, clickStart } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const dist = opt('dist', '');
if (!args.includes('--nobuild') && !dist) build();
const base = pathToFileURL(path.resolve(dist || DIST)).href;
const dir = ensureDir(path.join(OUT, 'dev'));
const L = await launch({ width: 1280, height: 720 });
console.log('렌더러:', L.renderer, '(' + L.mode + ')');
const frames = +opt('frames', 156), tag = opt('tag', 'peek'), q = opt('q', '');
for (const a of args.filter(x => !x.startsWith('--'))) {
  const query = 'test=1&clock=manual&seed=11&' + (a.startsWith('vp=') ? a : 'view=' + a) + (q ? '&quality=' + q : '') + (args.includes('--clay') ? '&clay=1' : '');
  const msgs = [];
  const page = await L.context.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(m.type() + ': ' + m.text().slice(0, 600)); });
  page.on('pageerror', e => msgs.push('pageerror: ' + String(e).slice(0, 600)));
  const t0 = Date.now();
  await page.goto(base + '?' + query);
  await page.waitForFunction(() => window.__bc && window.__bc.ready, null, { timeout: 120000 });
  const loadMs = Date.now() - t0;
  await clickStart(page);
  await page.evaluate((n) => window.__bc.step(n), frames);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const name = tag + '-' + a.replace(/[^0-9a-z.-]+/gi, '_') + '.png';
  await page.screenshot({ path: path.join(dir, name) });
  const bake = await page.evaluate(() => window.__bc.bake ? window.__bc.bake() : null);
  console.log(name, '로딩', loadMs, 'ms, 굽기', bake ? (bake.ok ? Math.round(bake.ms) + ' ms' : '실패: ' + bake.error) : '없음');
  const geo = await page.evaluate(() => window.__bc.geo ? window.__bc.geo() : null);
  if (geo) console.log('    형상 도구 삼각형', geo.wearTris, '상자', geo.boxes, JSON.stringify(Object.entries(geo.byKey || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + Math.round(v / 1000) + 'k')));
  for (const m of [...new Set(msgs)].slice(0, 12)) console.log('   ', m);
  await page.close();
}
await L.browser.close();
