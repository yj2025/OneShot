// 검사 (m)과 같은 절차: seed 7로 열고 __bc.geoCheck()로 컬링 없이 다시 그린 전후의 GPU 지오메트리 수를 잰다. 사용: node geocheck.mjs <html>
import { pathToFileURL } from 'node:url';
import { launch } from '../../../../scripts/lib.mjs';
const html = process.argv[2];
const L = await launch({ width: 1280, height: 720 });
const page = await L.context.newPage();
await page.goto(pathToFileURL(html).href + '?test=1&seed=7');
await page.waitForFunction(() => window.__bc && window.__bc.ready, null, { timeout: 120000 });
console.log(html.split('/').pop(), JSON.stringify(await page.evaluate(() => window.__bc.geoCheck())));
await L.browser.close();
