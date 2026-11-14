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

  // 1-1. 점프 높이와 파쿠르. 수동 시계(?clock=manual)라 같은 입력이면 같은 결과가 나온다. 고치기 전에 실패하는 것을 먼저 확인했다(2026-11-14)
  //  점프: 50 ms 누른 점프의 최고 높이가 400 ms 누른 점프의 65% 이하이고, 400 ms 누르면 0.4 m 넘게 뜬다
  //  파쿠르: W를 누른 채 Space를 두 번(0.13초 간격) 누르면 (a) 마당의 0.8 m 방벽을 넘어 반대편 땅에 서고 (b) 0.7 m 하역장 위에 오르고
  //  (c) 바깥에서 1.6 m 높이 창문(비닐이 찢겨 걸린 창)을 넘어 실내 바닥(0.7 m)에 선다. (d) 방벽 앞에서 Space를 한 번만 누르면(길게 눌러도) 넘지 못한다.
  //  (e) 방범창과 합판으로 막은 창은 Space 두 번으로도 넘지 못한다(창살과 합판은 그림만 있고 충돌 상자가 없어서 처음에는 지나갔다).
  //  끝난 자리에서 몸(반경 0.28 m, 발에서 1.2 m까지)이 막는 상자(발보다 0.42 m 넘게 솟은 것)와 겹치지 않는다
  //  CHECK_ONLY=move 이면 여기까지만 돈다(파쿠르를 고칠 때 빠르게 돌려 보는 용도)
  const extraErrors = [], extraExternal = [];
  {
    const g = await openGame(L.context, 'test=1&clock=manual&seed=11&view=13');
    const P = g.page;
    await clickStart(P);
    const step = (n = 1) => P.evaluate((k) => window.__bc.step(k), n);
    const st = () => P.evaluate(() => window.__bc.state().player);
    const place = (x, z, yaw) => P.evaluate(([x, z, yaw]) => window.__bc.place(x, z, yaw), [x, z, yaw]);
    const boxes = await P.evaluate(() => window.__bc.boxes());
    const overlaps = (p) => boxes.filter(b => p.x + 0.28 > b.min[0] && p.x - 0.28 < b.max[0] && p.z + 0.28 > b.min[2] && p.z - 0.28 < b.max[2] && p.y + 1.2 > b.min[1] && p.y + 0.43 < b.max[1]).length;   // 0.42 m 아래 턱은 게임에서도 막지 않는다(밟고 선다)
    // 트인 마당에서 Space를 holdFrames 프레임(60 Hz) 동안 누르고 최고 높이를 잰다
    const jumpPeak = async (holdFrames) => {
      await place(0, 21, 0); await step(40);
      const y0 = (await st()).y; let top = y0;
      await P.keyboard.down('Space');
      for (let i = 0; i < 100; i++) { if (i === holdFrames) await P.keyboard.up('Space'); await step(1); top = Math.max(top, (await st()).y); }
      await step(40);
      return top - y0;
    };
    const tap = await jumpPeak(3), hold = await jumpPeak(24);
    rec('누른 시간에 따른 점프 높이 (50 ms ↔ 400 ms)', tap <= hold * 0.65 && hold > 0.4, `50 ms ${tap.toFixed(2)} m, 400 ms ${hold.toFixed(2)} m (${(tap / Math.max(hold, 1e-3) * 100).toFixed(0)}%)`);
    // W를 누른 채 다가가며 Space를 taps번 누른다(누름 3프레임, 간격 8프레임). holdLong이면 한 번을 30프레임 동안 누른다
    const run = async (x, z, taps, holdLong = false) => {
      await place(x, z, 0); await step(30);
      await P.keyboard.down('KeyW');
      for (let f = 0; f < 150; f++) {
        if (f === 4) await P.keyboard.down('Space');
        if (f === (holdLong ? 34 : 7)) await P.keyboard.up('Space');
        if (taps >= 2 && f === 12) await P.keyboard.down('Space');
        if (taps >= 2 && f === 15) await P.keyboard.up('Space');
        await step(1);
      }
      await P.keyboard.up('KeyW');
      await step(40);
      const p = await st();
      return { ...p, hit: overlaps(p) };
    };
    const fmt = (p) => `x ${p.x.toFixed(2)}, y ${p.y.toFixed(2)}, z ${p.z.toFixed(2)}, 겹친 상자 ${p.hit}`;
    const a = await run(9.0, 10.5, 2);
    rec('파쿠르 (a) 0.8 m 방벽 넘기', a.z < 8.2 && Math.abs(a.y) < 0.06 && a.hit === 0, fmt(a));
    const b = await run(6.5, 4.2, 2);
    rec('파쿠르 (b) 0.7 m 하역장 오르기', b.z < 3.0 && Math.abs(b.y - 0.7) < 0.06 && b.hit === 0, fmt(b));
    const c = await run(2.2, 1.2, 2);
    rec('파쿠르 (c) 바깥에서 1.6 m 창문 넘어 실내로', c.z < -0.5 && Math.abs(c.y - 0.7) < 0.06 && c.hit === 0, fmt(c));
    const d1 = await run(9.0, 10.5, 1), d2 = await run(9.0, 10.5, 1, true);
    rec('파쿠르 (d) Space 한 번은 방벽을 넘지 않는다', d1.z > 9.4 && d2.z > 9.4 && d1.hit === 0 && d2.hit === 0, `짧게 ${fmt(d1)} / 길게 ${fmt(d2)}`);
    const e1 = await run(-4.6, 1.2, 2), e2 = await run(-10.5, 1.2, 2);
    rec('파쿠르 (e) 방범창과 합판으로 막은 창은 넘지 않는다', e1.z > 0 && e2.z > 0 && e1.y < 0.1 && e2.y < 0.1, `방범창 ${fmt(e1)} / 합판 ${fmt(e2)}`);
    extraErrors.push(...g.errors); extraExternal.push(...g.external);
    await P.close();
  }
  if (process.env.CHECK_ONLY === "move") return;

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

  // 2-0. 출발 지점에 선 채로 먼저 확인한다(이동한 뒤에는 회마다 서는 자리가 달라, 낮은 물체 옆이나 벽 앞에 설 수 있다.
  //      벽 앞에서는 총을 내리므로 조준경이 켜지지 않는 것이 맞는 동작이다)
  //      2-2 점프: Space(event.code)로 뛰어 0.3 m 넘게 떴다가 같은 높이로 내려온다. 누른 시간에 따라 높이가 달라지므로(1-1) 끝까지 누른 점프(0.25초)로 본다.
  //          80 ms만 누르던 때는 실제 시간이라 프레임에 따라 0.28~0.34 m가 나와 문턱(0.3 m)에 걸쳤다
  //      2-3 소총 조준경: 우클릭으로 들여다보면 카메라가 사출동공(반지름 4 mm) 안에 들어오고 조준경 시점이 매 프레임 그려진다. 놓으면 멈춘다
  {
    const st = () => page.evaluate(() => window.__bc.state().player);
    const peak = async (ms, pick) => { let best = -1e9; const t = Date.now(); while (Date.now() - t < ms) { best = Math.max(best, pick(await st())); await sleep(30); } return best; };
    const y0 = (await st()).y;
    await page.keyboard.down('Space'); await sleep(250); await page.keyboard.up('Space');
    const top = await peak(900, (p) => p.y);
    await sleep(400);
    const end = await st();
    const rise = top - y0;
    rec('Space로 점프하고 착지', rise > 0.3 && Math.abs(end.y - y0) < 0.05 && end.onGround, `최고 ${rise.toFixed(2)} m, 착지 후 높이 차 ${(end.y - y0).toFixed(2)} m`);

    // 소총 조준경
    const sc = () => page.evaluate(() => window.__bc.scope());
    await page.mouse.down({ button: 'right' }); await sleep(900);
    const a = await sc(); await sleep(500); const b = await sc();
    await page.mouse.up({ button: 'right' }); await sleep(700);
    const c = await sc(); await sleep(300); const d = await sc();
    const ok = a.weapon === 'rifle' && a.on && b.on && b.frames - a.frames >= 10 && b.pupilOffset < 0.004 && !c.on && d.frames === c.frames;
    rec('소총 조준경 (우클릭하면 조준경 시점을 그리고 놓으면 멈춘다)', ok, `조준 중 0.5초 동안 ${b.frames - a.frames}번 그림, 사출동공과 카메라의 어긋남 ${(b.pupilOffset * 1000).toFixed(1)} mm, 그리기 호출 ${b.calls}, 놓은 뒤 ${c.on ? '계속 그림' : '멈춤'}`);
  }

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

  errors.push(...extraErrors); external.push(...extraExternal);
  rec('콘솔 오류 없음', errors.length === 0, errors.slice(0, 5).join(' | '));
  rec('외부 네트워크 요청 없음', external.length === 0, external.slice(0, 5).join(' | '));
}

main().catch(e => rec('예외', false, String(e.stack || e).slice(0, 500))).finally(async () => {
  if (browser) await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과${failed.length ? ' — 실패: ' + failed.map(f => f.name).join(', ') : ''}`);
  process.exit(failed.length ? 1 : 0);
});
