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
  //  CHECK_ONLY=move 이면 여기까지만 돈다(파쿠르를 고칠 때 빠르게 돌려 보는 용도). CHECK_ONLY=surface 이면 (k)만 돈다
  const extraErrors = [], extraExternal = [];
  if (process.env.CHECK_ONLY !== 'surface') {
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
    //  after: 파쿠르가 끝나고 2프레임 뒤(내려선 자리)의 상태. W를 계속 누르고 있으니 끝난 자리에서 더 걸어간다(방벽 뒤 1.2 m에 0.35 m 높이 천 더미가 있다).
    //  넘은 자리를 보려면 이 순간을 본다(2026-11-15: 넘기가 느려져 2.5초 뒤의 자리가 천 더미 위가 되자 (a)가 실패했다. 걸어서 턱에 오른 것은 정상)
    const run = async (x, z, taps, holdLong = false) => {
      await place(x, z, 0); await step(30);
      await P.keyboard.down('KeyW');
      let was = false, endF = -1, after = null;
      for (let f = 0; f < 150; f++) {
        if (f === 4) await P.keyboard.down('Space');
        if (f === (holdLong ? 34 : 7)) await P.keyboard.up('Space');
        if (taps >= 2 && f === 12) await P.keyboard.down('Space');
        if (taps >= 2 && f === 15) await P.keyboard.up('Space');
        await step(1);
        if (endF < 0 || f === endF + 2) { const s = await st(); if (was && !s.parkour && endF < 0) endF = f; if (s.parkour) was = true; if (f === endF + 2) after = { ...s, hit: overlaps(s) }; }
      }
      await P.keyboard.up('KeyW');
      await step(40);
      const p = await st();
      return { ...p, hit: overlaps(p), after };
    };
    const fmt = (p) => `x ${p.x.toFixed(2)}, y ${p.y.toFixed(2)}, z ${p.z.toFixed(2)}, 겹친 상자 ${p.hit}`;
    const a = await run(9.0, 10.5, 2);
    const aa = a.after || a;
    rec('파쿠르 (a) 0.8 m 방벽 넘기', aa.z < 8.2 && Math.abs(aa.y) < 0.06 && aa.hit === 0 && a.hit === 0, `내려선 자리 ${fmt(aa)} / 더 걸은 뒤 ${fmt(a)}`);
    const b = await run(6.5, 4.2, 2);
    rec('파쿠르 (b) 0.7 m 하역장 오르기', b.z < 3.0 && Math.abs(b.y - 0.7) < 0.06 && b.hit === 0, fmt(b));
    const c = await run(2.2, 1.2, 2);
    rec('파쿠르 (c) 바깥에서 1.6 m 창문 넘어 실내로', c.z < -0.5 && Math.abs(c.y - 0.7) < 0.06 && c.hit === 0, fmt(c));
    const d1 = await run(9.0, 10.5, 1), d2 = await run(9.0, 10.5, 1, true);
    rec('파쿠르 (d) Space 한 번은 방벽을 넘지 않는다', d1.z > 9.4 && d2.z > 9.4 && d1.hit === 0 && d2.hit === 0, `짧게 ${fmt(d1)} / 길게 ${fmt(d2)}`);
    const e1 = await run(-4.6, 1.2, 2), e2 = await run(-10.5, 1.2, 2);
    rec('파쿠르 (e) 방범창과 합판으로 막은 창은 넘지 않는다', e1.z > 0 && e2.z > 0 && e1.y < 0.1 && e2.y < 0.1, `방범창 ${fmt(e1)} / 합판 ${fmt(e2)}`);
    // (f) 이동 키 없이 서서 Space 두 번으로 얇은 장애물을 넘을 때 튕겨 나가지 않는다(2026-11-15 사용자 지적. 고치기 전에 실패를 확인했다)
    //  시작부터 끝난 뒤 1초까지 수평 속도 최고 3.0 m/s 이하, 끝난 뒤 1초 동안 미끄러진 거리 0.08 m 이하,
    //  넘었으면 착지 지점(몸 중심)이 장애물의 먼 면에서 0.9 m 안, 카메라가 시작 때보다 max(0.35, 높이 − 0.77) m 넘게 솟지 않는다(올라서면 높이 + 0.35 m).
    //  넘을 수 없는 자리면 하지 않아도 된다(방벽은 넘어야 한다)
    const colTop = (x, z, foot) => { let t = foot; for (const b of boxes) if (x + 0.04 > b.min[0] && x - 0.04 < b.max[0] && z + 0.04 > b.min[2] && z - 0.04 < b.max[2] && b.min[1] <= t + 0.05 && b.max[1] > t) t = b.max[1]; return t; };
    const standVault = async (x, z, yaw, mustGo) => {
      const p0 = await place(x, z, yaw); await step(30);
      const s0 = await st(), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      // 앞쪽 장애물의 가까운 면 d0, 꼭대기, 먼 면 d1(꼭대기 높이가 0.2 m 넘게 떨어지는 곳)
      let d0 = -1, top = 0, d1 = -1;
      for (let d = 0.2; d < 3.5; d += 0.02) {
        const t = colTop(s0.x + fx * d, s0.z + fz * d, s0.y);
        if (d0 < 0) { if (t > s0.y + 0.42) { d0 = d; top = t; } }
        else if (t < top - 0.2) { d1 = d; break; } else top = Math.max(top, t);
      }
      const tr = [];
      let started = -1, ended = -1, kind = null;
      const plant = { n: 0, dy: 0, on: 0, first: null };   // (h) 왼손이 윗면을 짚은 프레임 수, 윗면과의 높이 차 최대, 화면 안 프레임 수, 짚는 첫 프레임이 화면 안인지
      for (let f = 0; f < 200 && (ended < 0 || f < ended + 61); f++) {
        if (f === 4 || f === 12) await P.keyboard.down('Space');
        if (f === 7 || f === 15) await P.keyboard.up('Space');
        await step(1);
        const s = await st(); tr.push(s);
        if (s.parkour && started < 0) { started = f; kind = s.parkour; }
        if (s.handL && s.handL.planted) {
          const vis = Math.abs(s.handL.ndc[0]) <= 1 && Math.abs(s.handL.ndc[1]) <= 1 && s.handL.ndc[2] < 1;
          plant.n++; plant.dy = Math.max(plant.dy, Math.abs(s.handL.y - top)); if (vis) plant.on++; if (plant.first === null) plant.first = vis;
        }
        if (started >= 0 && ended < 0 && !s.parkour) ended = f;
      }
      let vmax = 0, rise = 0;
      for (let f = 1; f < tr.length; f++) vmax = Math.max(vmax, Math.hypot(tr[f].x - tr[f - 1].x, tr[f].z - tr[f - 1].z) * 60);
      for (const s of tr) rise = Math.max(rise, s.eye - s0.eye);
      const h = top - s0.y;
      const res = { kind, vmax, rise, h, d0, d1, ok: true, why: [], plant };
      if (started < 0) { res.ok = !mustGo; if (mustGo) res.why.push('넘지 않음'); return res; }
      if (ended < 0) { res.ok = false; res.why.push('끝나지 않음'); return res; }
      const e = tr[ended], e60 = tr[Math.min(tr.length - 1, ended + 60)];
      res.slide = Math.hypot(e60.x - e.x, e60.z - e.z);
      res.beyond = ((e.x - s0.x) * fx + (e.z - s0.z) * fz) - d1;
      const riseMax = kind === 'climb' ? h + 0.35 : Math.max(0.35, h - 0.77);
      if (vmax > 3.0) res.why.push(`수평 속도 ${vmax.toFixed(2)} m/s`);
      if (res.slide > 0.08) res.why.push(`미끄러짐 ${res.slide.toFixed(2)} m`);
      if (kind !== 'climb' && res.beyond > 0.9) res.why.push(`먼 면 뒤 ${res.beyond.toFixed(2)} m`);
      if (rise > riseMax) res.why.push(`카메라 상승 ${rise.toFixed(2)} m > ${riseMax.toFixed(2)}`);
      res.ok = res.why.length === 0;
      return res;
    };
    const fv = [['방벽', 9.0, 10.6, 0, true], ['실내 금속 통', 1.92, -15.4, -Math.PI / 2, false], ['창 아래 벽', 2.2, 0.9, 0, false]];
    const fres = [];
    for (const [name, x, z, yaw, must] of fv) fres.push([name, await standVault(x, z, yaw, must)]);
    rec('파쿠르 (f) 서서 넘을 때 튕겨 나가지 않는다', fres.every(([, r]) => r.ok),
      fres.map(([n, r]) => `${n} ${r.kind || '안 넘음'}${r.kind ? ` 최고 ${r.vmax.toFixed(2)} m/s, 상승 ${r.rise.toFixed(2)} m(높이 ${r.h.toFixed(2)}), 미끄러짐 ${(r.slide ?? 0).toFixed(2)} m${r.kind !== 'climb' && r.beyond != null ? `, 먼 면 뒤 ${r.beyond.toFixed(2)} m` : ''}` : ''}${r.why.length ? ' ✗ ' + r.why.join(', ') : ''}`).join(' / '));
    // (h) 넘거나 오를 때 왼손이 장애물 윗면을 짚는 것이 화면에 보인다(2026-11-15 사용자 요청 "넘어가는 모션"). 짚은 손바닥은 짚는 내내 윗면에서 5 cm 안이고,
    //  짚는 첫 프레임과 그 뒤 8프레임 이상(0.13초) 화면 안에 있다. 몸이 손 위를 지나가면 손은 가슴 카메라 아래로 빠진다(실제 카메라도 그렇다).
    //  처음에는 짚는 내내 화면 안을 요구했다가 이 때문에 어느 장애물에서도 통과할 수 없는 기준이라 이렇게 정했다
    {
      const done = fres.filter(([, r]) => r.kind);
      const ok = done.length > 0 && done.every(([, r]) => r.plant.n >= 6 && r.plant.dy <= 0.05 && r.plant.first === true && r.plant.on >= 8);
      rec('파쿠르 (h) 넘을 때 왼손이 윗면을 짚는다', ok, done.map(([n, r]) => `${n} ${r.kind}: 짚은 프레임 ${r.plant.n}(화면 안 ${r.plant.on}, 첫 프레임 ${r.plant.first ? '보임' : '안 보임'}), 윗면과 차이 최대 ${(r.plant.dy * 100).toFixed(1)} cm`).join(' / ') || '넘은 곳 없음');
    }
    // (g) 제자리에서 마우스로 1.5 rad/s로 돌 때 총이 화면 위를 크게 미끄러지지 않는다(2026-11-15 사용자 지적)
    //  총구와 권총손잡이(오른손) 두 점의 가로 위치를 본다. 가까운 쪽(손잡이)은 옆으로 밀리면 화면에서 더 크게 움직인다
    //  숨과 떠도는 자세도 총을 천천히 옮긴다. 그래서 같은 시드로 새로 연 두 페이지에서 똑같이 진행하되 한쪽만 마우스를 움직이고,
    //  두 기록의 차이(돌기만의 몫)를 잰다. 돌 때 화면 폭의 6%(투영 좌표 0.12) 안, 멈춘 뒤 반대로 넘치는 폭 2%(0.04) 이하
    {
      const run = async (turn) => {
        const q = await openGame(L.context, 'test=1&clock=manual&seed=11&view=13');
        const Q = q.page; await clickStart(Q);
        const mouse = makeMouse(Q, W, H); await mouse.center();
        await Q.evaluate(([x, z, yaw]) => window.__bc.place(x, z, yaw), [3.2, -0.8, 1.07]);
        await Q.evaluate(() => window.__bc.step(90));
        const out = [];
        for (let f = 0; f < 100; f++) {
          if (turn) { if (f < 20) await mouse.move(12, 0); else if (f < 40) await mouse.move(-12, 0); }
          await Q.evaluate(() => window.__bc.step(1));
          const p = await Q.evaluate(() => window.__bc.state().player);
          out.push([p.gunNdc[0], p.gripNdc[0]]);
        }
        extraErrors.push(...q.errors); extraExternal.push(...q.external);
        await Q.close();
        return out;
      };
      const still = await run(false), turned = await run(true);
      let dev = 0, over = 0;
      for (let f = 0; f < 100; f++) {
        const gx = turned[f][0] - still[f][0], hx = turned[f][1] - still[f][1];
        if (f < 40) dev = Math.max(dev, Math.abs(gx), Math.abs(hx)); else over = Math.max(over, gx, hx);   // 마지막은 왼쪽으로 돌았다: 멈춘 뒤 오른쪽(+)으로 넘치는 폭
      }
      rec('좌우로 돌 때 총이 화면을 크게 미끄러지지 않는다 (1.5 rad/s)', dev <= 0.12 && over <= 0.04, `총구·손잡이 가로 이동 최대 ${(dev * 50).toFixed(1)}% (화면 폭 대비), 멈춘 뒤 넘침 ${(over * 50).toFixed(1)}%`);
    }
    // (i) 자세에 따라 총이 놓이는 자리가 달라진다(뷰모델 구도 세션, 2026-11-15. 15~29라운드 critic의 '모든 장면에서 같은 자리, 같은 각도')
    //  그냥 서 있을 때(낮춰 든 자세), 방아쇠를 당겨 첫 발이 나간 순간(쏘는 자세), 재장전 중(다루는 자세)의 손잡이와 총구 화면 위치를 잰다.
    //  세 자세가 서로 화면 크기의 8%(투영 좌표 0.16) 넘게 다르다(손잡이와 총구 중 큰 쪽. 재장전은 오른손이 손잡이를 쥔 채 총을 돌리므로 총구가 크게 움직인다).
    //  첫 발은 당긴 뒤 0.1~0.35초에 나간다(낮춰 든 총을 드는 시간). 마지막으로 쏜 뒤 6초가 지나면 다시 낮춰 든다(경계 0.05 이하)
    //  봇이 보이지 않는 복도(view 2)에서 잰다. 처음에는 홀(view 3)이었는데 멀리 봇이 보여, 봇을 보면 총을 드는 (j)를 넣으면서 옮겼다
    {
      const q = await openGame(L.context, 'test=1&clock=manual&seed=11&view=2');
      const Q = q.page; await clickStart(Q);
      const mouse = makeMouse(Q, W, H); await mouse.center();
      const st = () => Q.evaluate(() => window.__bc.state().player);
      const stepQ = (k) => Q.evaluate((m) => window.__bc.step(m), k);
      await stepQ(156);
      const idle = await st();
      const b0 = (await stepQ(0)).shotsFired;
      await mouse.down('left');
      let n = 0; for (; n < 40; n++) { const s2 = await stepQ(1); if (s2.shotsFired > b0) break; }
      const fire = await st();
      await mouse.up('left');
      await stepQ(360);
      const back = await st();
      await Q.keyboard.down('KeyR'); await stepQ(2); await Q.keyboard.up('KeyR'); await stepQ(73);
      const rel = await st();
      extraErrors.push(...q.errors); extraExternal.push(...q.external);
      await Q.close();
      const d = (a, b) => Math.max(Math.hypot(a.gripNdc[0] - b.gripNdc[0], a.gripNdc[1] - b.gripNdc[1]), Math.hypot(a.gunNdc[0] - b.gunNdc[0], a.gunNdc[1] - b.gunNdc[1]));
      const dIF = d(idle, fire), dIR = d(idle, rel), dFR = d(fire, rel), t = (n + 1) / 60;
      const ok = dIF > 0.16 && dIR > 0.16 && dFR > 0.16 && t >= 0.1 && t <= 0.35 && back.alert !== undefined && back.alert <= 0.05;
      rec('(i) 자세에 따라 총이 놓이는 자리가 달라진다', ok, `서 있기↔쏘기 ${(dIF * 50).toFixed(1)}%, 서 있기↔재장전 ${(dIR * 50).toFixed(1)}%, 쏘기↔재장전 ${(dFR * 50).toFixed(1)}% (화면 크기 대비, 기준 8%), 첫 발 ${(t * 1000).toFixed(0)} ms 뒤(100~350), 6초 뒤 경계 ${back.alert === undefined ? '없음' : back.alert.toFixed(2)}`);
    }
    // (j) 앞에 봇이 보이면 총을 든다(뷰모델 구도 세션, 2026-11-15). 사람은 위협을 보면 총을 든다.
    //  방 안 3.7 m 앞에 봇이 서 있는 장면(view 7, 봇은 아직 플레이어를 모른다)에서 아무것도 누르지 않고 2초가 지나면 경계 0.85 이상.
    //  봇이 보이지 않는 복도(view 2)에서는 같은 시간 뒤 경계 0.05 이하(봇이 없으면 들지 않는다)
    {
      const alertAfter = async (view) => {
        const q = await openGame(L.context, `test=1&clock=manual&seed=11&view=${view}`);
        const Q = q.page; await clickStart(Q);
        await Q.evaluate(() => window.__bc.step(120));
        const a = await Q.evaluate(() => window.__bc.state().player.alert);
        extraErrors.push(...q.errors); extraExternal.push(...q.external);
        await Q.close();
        return a;
      };
      const seen = await alertAfter(7), none = await alertAfter(2);
      rec('(j) 앞에 봇이 보이면 총을 든다', seen !== undefined && seen >= 0.85 && none !== undefined && none <= 0.05, `봇이 보이는 방 경계 ${seen === undefined ? '없음' : seen.toFixed(2)}(0.85 이상), 봇이 없는 복도 ${none === undefined ? '없음' : none.toFixed(2)}(0.05 이하), 2초 뒤`);
    }
    extraErrors.push(...g.errors); extraExternal.push(...g.external);
    await P.close();
  }
  // (k) 밝은 곳에서 총과 장갑이 장면의 빛을 받는다(총과 장갑 표면 세션, 2026-11-15. 12라운드부터 A/B 41까지 되풀이된 '빛 속에서도 새까만 총과 장갑')
  //  시점 다섯 곳(마당 0, 문간 6, 홀 3, 사무실 4, 복도 2)에서 1.5초 뒤 __bc.vmLight()로 총·손·소매 화소의 실효 반사율을 잰다.
  //  실효 반사율은 같은 자리를 흰 종이(반사율 1, 정반사 없음)로 그렸을 때 대비 카메라로 돌아온 빛의 비율이라, 조명과 노출이 아니라 재질만 본다.
  //  ① 모든 시점에서 중앙값 5% 이상(실제 검은 폴리머·아노다이징·짙은 장갑 천의 하한) ② 모든 시점에서 p90 50% 이하(형광등에 번들거려 하얗게 뜨지 않는다)
  //  ③ 마당에서 위를 향한 면의 p90 10% 이상(흐린 하늘이 윗면에 비친 띠). 고치기 전 빌드(fa7990a의 재질)에서 실패하는 것을 먼저 확인했다
  {
    const rows = [];
    for (const [v, name] of [[0, '마당'], [6, '문간'], [3, '홀'], [4, '사무실'], [2, '복도']]) {
      const q = await openGame(L.context, `test=1&clock=manual&seed=11&view=${v}`);
      const Q = q.page; await clickStart(Q);
      await Q.evaluate(() => window.__bc.step(90));
      const r = await Q.evaluate(() => (window.__bc.vmLight ? window.__bc.vmLight() : null));
      extraErrors.push(...q.errors); extraExternal.push(...q.external);
      await Q.close();
      rows.push({ name, r });
    }
    const pct = (x) => (x * 100).toFixed(1) + '%';
    const okRow = (o) => o.r && o.r.refl.all.n > 200 && o.r.refl.all.p50 >= 0.05 && o.r.refl.all.p90 <= 0.5;
    const yard = rows[0].r, sky = yard && yard.refl.up.n > 50 ? yard.refl.up.p90 : 0;
    rec('(k) 밝은 곳에서 총과 장갑이 장면의 빛을 받는다', rows.every(okRow) && sky >= 0.1,
      rows.map((o) => (o.r ? `${o.name} ${pct(o.r.refl.all.p50)}·p90 ${pct(o.r.refl.all.p90)}` : `${o.name} 잴 수 없음`)).join(', ') + ` (중앙값 5% 이상·p90 50% 이하), 마당 윗면 p90 ${pct(sky)}(10% 이상, 화소 ${yard ? yard.refl.up.n : 0})`);
  }
  if (process.env.CHECK_ONLY === 'move' || process.env.CHECK_ONLY === 'surface') return;

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
