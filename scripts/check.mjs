// npm run check: 빌드, 단일 파일, 외부 요청, 자동 플레이 완주(교전→전원 제압→판 종료→재시작), 콘솔 오류, 한글 입력 이동
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, build, launch, openGame, clickStart, makeMouse, makeAutoPilot, sleep } from './lib.mjs';

const W = 1280, H = 720;
const results = [];
function rec(name, ok, detail = '') { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); }

let browser;
async function main() {
  // 1. 빌드
  try {
    fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });
    build();
    const files = fs.readdirSync(path.join(ROOT, 'dist'), { recursive: true }).filter(f => fs.statSync(path.join(ROOT, 'dist', f)).isFile());
    const size = fs.statSync(path.join(ROOT, 'dist', 'index.html')).size;
    rec('빌드: dist/index.html 하나', files.length === 1 && files[0] === 'index.html', `파일 ${files.length}개 [${files.join(', ')}], ${(size / 1024).toFixed(0)} KB`);
  } catch (e) { rec('빌드', false, String(e).slice(0, 300)); return; }

  const L = await launch({ width: W, height: H });
  browser = L.browser;
  console.log(`렌더러: ${L.renderer} (${L.mode}${L.software ? ', 소프트웨어' : ''})`);
  const { page, errors, external } = await openGame(L.context, 'test=1&seed=7');
  rec('로딩 완료', true);

  await clickStart(page);
  rec('시작 화면 → 플레이', true);

  // 2. 한글 입력 상태를 흉내 낸 키 이벤트로 이동 (key='ㅈ', code='KeyW')
  {
    const cdp = await page.context().newCDPSession(page);
    const before = (await page.evaluate(() => window.__bc.state())).player;
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ㅈ', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
    for (let i = 0; i < 8; i++) { await sleep(100); await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ㅈ', code: 'KeyW', windowsVirtualKeyCode: 87, autoRepeat: true }); }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ㅈ', code: 'KeyW', windowsVirtualKeyCode: 87 });
    await sleep(200);
    const after = (await page.evaluate(() => window.__bc.state())).player;
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    rec('한글 입력 상태 키(ㅈ / KeyW)로 이동', moved > 0.4, `${moved.toFixed(2)} m 이동`);
  }

  // 3. 자동 플레이: 시작 → 교전 → 전원 제압 → 판 종료
  const mouse = makeMouse(page, W, H);
  await mouse.center();
  const pilot = makeAutoPilot(page, mouse);
  const t0 = Date.now();
  const LIMIT = 9 * 60 * 1000;
  let s, lastLog = 0, deaths = 0, lastPhase = 'playing';
  while (Date.now() - t0 < LIMIT) {
    s = await pilot.step(Date.now() - t0);
    if (s.phase === 'dead' && lastPhase !== 'dead') deaths++;
    lastPhase = s.phase;
    if (s.phase === 'won') break;
    if (Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      console.log(`  … ${((Date.now() - t0) / 1000).toFixed(0)}s 제압 ${s.kills}/${s.bots.length} 발사 ${s.stats.shotsFired} 명중 ${s.stats.hits} 피격 ${s.stats.playerHits} 사망 ${s.stats.deaths}`);
    }
    await sleep(30);
  }
  await pilot.releaseAll();
  const engaged = s.stats.shotsFired > 0 && s.stats.hits > 0 && s.stats.botShots > 0;
  rec('교전 발생 (플레이어 명중, 봇 사격)', engaged, `플레이어 발사 ${s.stats.shotsFired}, 명중 ${s.stats.hits}, 봇 발사 ${s.stats.botShots}, 플레이어 피격 ${s.stats.playerHits}`);
  rec('봇 전원 제압 → 판 종료', s.phase === 'won', `${((Date.now() - t0) / 1000).toFixed(0)}초, 제압 ${s.kills}/${s.bots.length}, 사망 후 재시작 ${s.stats.deaths}회`);

  // 4. 재시작
  if (s.phase === 'won') {
    await page.waitForSelector('#btn-restart', { state: 'visible', timeout: 15000 });
    await page.click('#btn-restart');
    await page.waitForFunction(() => { const s = window.__bc.state(); return s.phase === 'playing' && s.kills === 0 && s.bots.every(b => b.alive); }, null, { timeout: 15000 }).then(() => rec('판 종료 후 재시작', true), () => rec('판 종료 후 재시작', false));
    await sleep(1500);
  } else rec('판 종료 후 재시작', false, '판이 끝나지 않아 확인 불가');

  rec('콘솔 오류 없음', errors.length === 0, errors.slice(0, 5).join(' | '));
  rec('외부 네트워크 요청 없음', external.length === 0, external.slice(0, 5).join(' | '));
}

main().catch(e => rec('예외', false, String(e.stack || e).slice(0, 500))).finally(async () => {
  if (browser) await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과${failed.length ? ' — 실패: ' + failed.map(f => f.name).join(', ') : ''}`);
  process.exit(failed.length ? 1 : 0);
});
