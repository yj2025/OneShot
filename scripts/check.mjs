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

  // 빛 굽기: 조도 볼륨이 구워졌고, 가려진 곳과 트인 곳이 실제로 다른 값을 갖는지 몇 점에서 읽어 본다.
  // 형상을 고치다가 빛을 가리는 메시 목록이나 격자가 어긋나면 여기서 걸린다.
  {
    const r = await page.evaluate(() => {
      const b = window.__bc.bake(), L = (x, y, z) => window.__bc.light(x, y, z);
      if (!b || !b.ok) return { ok: false, why: b ? b.error : '굽기 결과 없음' };
      return { ok: true, ms: b.ms, underDesk: L(-1.4, 0.9, -1.6), overDesk: L(-1.4, 1.7, -1.6), yard: L(0, 0.3, 12), canopy: L(-14, 0.3, -10.5), room: L(2, 0.9, -0.8) };
    });
    let ok = r.ok, detail = r.ok ? '' : String(r.why).slice(0, 200);
    if (r.ok) {
      const up = (p) => p.amb[3] + p.amb[1];   // 위를 향한 면이 받는 조도
      ok = r.underDesk.vis[1] < 0.2 && r.overDesk.vis[1] > 0.8 && r.yard.sky > 0.6 && r.canopy.sky < 0.3 && r.room.sky < 0.15 && up(r.yard) > 3 * up(r.room);
      detail = `형광등 가시도 책상 밑 ${r.underDesk.vis[1].toFixed(2)} / 책상 위 ${r.overDesk.vis[1].toFixed(2)}, 하늘 가시도 마당 ${r.yard.sky.toFixed(2)} / 차양 밑 ${r.canopy.sky.toFixed(2)} / 사무실 ${r.room.sky.toFixed(2)}, 바닥 조도 마당 ${up(r.yard).toFixed(1)} / 사무실 ${up(r.room).toFixed(1)}`;
    }
    rec('빛 굽기 (가려진 곳과 트인 곳이 구분된다)', ok, detail);
  }

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

  // 2-1. 걷기와 달리기: 우클릭 조준을 한 번 한 뒤에도 Shift+W가 걷기보다 확실히 빠르다.
  // 조준 값이 0으로 완전히 돌아오지 않아 달리기가 1분 넘게 막히던 버그를 잡는다(2026-11-14)
  // 2-2. 점프: Space(event.code)로 뛰어 0.3 m 넘게 떴다가 같은 높이로 내려온다
  {
    const st = () => page.evaluate(() => window.__bc.state().player);
    const peak = async (ms, pick) => { let best = -1e9; const t = Date.now(); while (Date.now() - t < ms) { best = Math.max(best, pick(await st())); await sleep(30); } return best; };
    await page.mouse.down({ button: 'right' }); await sleep(500); await page.mouse.up({ button: 'right' }); await sleep(600);
    await page.keyboard.down('KeyW'); await sleep(500);
    const walk = await peak(500, (p) => p.speed);
    await page.keyboard.down('ShiftLeft'); await sleep(500);
    const run = await peak(500, (p) => p.speed);
    await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW'); await sleep(700);
    rec('걷기와 달리기 구분 (조준을 한 번 한 뒤 Shift+W)', run > walk * 1.6, `걷기 ${walk.toFixed(2)} m/s, 달리기 ${run.toFixed(2)} m/s (${(run / Math.max(walk, 0.01)).toFixed(2)}배)`);

    const y0 = (await st()).y;
    await page.keyboard.down('Space'); await sleep(80); await page.keyboard.up('Space');
    const top = await peak(900, (p) => p.y);
    await sleep(400);
    const end = await st();
    const rise = top - y0;
    rec('Space로 점프하고 착지', rise > 0.3 && Math.abs(end.y - y0) < 0.05 && end.onGround, `최고 ${rise.toFixed(2)} m, 착지 후 높이 차 ${(end.y - y0).toFixed(2)} m`);

    // 2-3. 소총 조준경: 우클릭으로 들여다보면 카메라가 사출동공(반지름 4 mm) 안에 들어오고 조준경 시점이 매 프레임 그려진다. 놓으면 멈춘다
    const sc = () => page.evaluate(() => window.__bc.scope());
    await page.mouse.down({ button: 'right' }); await sleep(900);
    const a = await sc(); await sleep(500); const b = await sc();
    await page.mouse.up({ button: 'right' }); await sleep(700);
    const c = await sc(); await sleep(300); const d = await sc();
    const ok = a.weapon === 'rifle' && a.on && b.on && b.frames - a.frames >= 10 && b.pupilOffset < 0.004 && !c.on && d.frames === c.frames;
    rec('소총 조준경 (우클릭하면 조준경 시점을 그리고 놓으면 멈춘다)', ok, `조준 중 0.5초 동안 ${b.frames - a.frames}번 그림, 사출동공과 카메라의 어긋남 ${(b.pupilOffset * 1000).toFixed(1)} mm, 그리기 호출 ${b.calls}, 놓은 뒤 ${c.on ? '계속 그림' : '멈춤'}`);
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
