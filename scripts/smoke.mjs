// 개발용 빠른 확인: node scripts/smoke.mjs [view] [ms]
import path from 'node:path';
import { OUT, ensureDir, launch, openGame, clickStart, sleep } from './lib.mjs';
const view = process.argv[2] ?? '0';
const wait = +(process.argv[3] ?? 2500);
const L = await launch({ width: 1280, height: 720 });
console.log('renderer', L.renderer, L.mode);
const t0 = Date.now();
const { page, errors } = await openGame(L.context, `test=1&seed=11${view === 'none' ? '' : '&view=' + view}`);
console.log('load ms', Date.now() - t0);
await clickStart(page);
await sleep(wait);
ensureDir(path.join(OUT, 'dev'));
await page.screenshot({ path: path.join(OUT, 'dev', `smoke-${view}.png`) });
console.log(JSON.stringify(await page.evaluate(() => { const s = window.__bc.state(); return { phase: s.phase, player: s.player, bots: s.bots }; })));
console.log('errors', errors.slice(0, 8));
await L.browser.close();
