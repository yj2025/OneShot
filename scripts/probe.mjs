// 개발 중 확인용: 조도 볼륨을 몇 점에서 읽어 출력한다. 사용: node scripts/probe.mjs "x,y,z" "x,y,z" ...
import { build, launch, openGame } from './lib.mjs';
const args = process.argv.slice(2);
if (!args.includes('--nobuild')) build();
const L = await launch({ width: 640, height: 360 });
const warns = [];
const { page } = await openGame(L.context, 'test=1&clock=manual&seed=11');
page.on('console', m => warns.push(m.text()));
for (const a of args.filter(x => !x.startsWith('--'))) {
  const [x, y, z] = a.split(',').map(Number);
  const r = await page.evaluate(([x, y, z]) => window.__bc.light(x, y, z), [x, y, z]);
  console.log(a.padEnd(20), JSON.stringify(r));
}
console.log('bake', JSON.stringify(await page.evaluate(() => window.__bc.bake())));
await L.browser.close();
