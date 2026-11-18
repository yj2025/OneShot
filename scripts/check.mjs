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
  //  CHECK_ONLY=move 이면 여기까지만 돈다(파쿠르를 고칠 때 빠르게 돌려 보는 용도). CHECK_ONLY=surface 이면 (k)와 (l)만 돈다(BC_DIST로 고치기 전 빌드를 열어 실패를 확인할 때도 쓴다)
  const extraErrors = [], extraExternal = [];

  // (n) 연사 때 총의 화면 움직임이 되풀이되지 않는다, (o) 걷고 뛸 때 총과 몸이 움직인다(2단계 ④, 2026-11-17).
  //  18라운드부터 판정자들이 '연사 묶음의 1과 5, 2와 6 … 프레임이 거의 똑같다', '걷거나 넘어질 때 총이 화면 같은 자리에 붙어 있다'고 적었다.
  //  __bc.vmScreen()이 총구, 받침손 손목, 월드에 고정한 배경 점의 화면 위치(투영 좌표)를 준다. 1280×720 화소로 바꿔 잰다.
  //  '총의 화면 위치 차'는 총구와 받침손 손목 가운데 많이 움직인 쪽이다. 고치기 전 빌드에서 실패하는 것을 먼저 확인했다(PROGRESS.md 2단계 ④)
  //  (n) 시점 7에서 첫 발을 쏘고 0.7초 쉰 뒤 방아쇠를 1초(60프레임) 누른다(연속 프레임 'firing-burst'와 같은 절차)
  //   ① 0.5초(30프레임) 떨어진 두 프레임의 총 화면 위치 차의 중앙값 27 px 이상(판정자가 보는 띠 한 칸 480 px에서 10 px)
  //   ② 이웃한 두 발의 화면 궤적(발사 뒤 5프레임 동안 총구·받침손·배경의 변위, 발사 직전 프레임 기준) 상관의 중앙값 0.6 이하
  //  (o) ① 복도(시점 2)를 0.5초 걸은 뒤 1초 동안 0.5초 떨어진 두 프레임의 총 화면 위치 차 중앙값 8 px 이상(띠 한 칸에서 3 px, 판정자가 '고정'이라 쓴 크기)
  //   ② 같은 1초 동안 배경 점이 움직인 범위 12 px 이상(몸통이 걸음마다 ±0.8° 돌고 기우는 크기)
  //   ③ 마당에서 Space를 0.25초 누른 점프부터 착지 뒤 0.5초까지 총의 화면 위치가 서 있을 때보다 27 px 넘게 움직인다
  //  CHECK_ONLY=motion 이면 이 검사만 돈다
  async function motionChecks() {
    const pxOf = (n) => [n[0] * W / 2, n[1] * H / 2];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
    const gunMove = (a, b) => Math.max(dist(pxOf(a.muzzle), pxOf(b.muzzle)), dist(pxOf(a.wristL), pxOf(b.wristL)));
    const corr = (a, b) => {
      const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
      let sab = 0, saa = 0, sbb = 0;
      for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
      return sab / Math.sqrt(saa * sbb + 1e-12);
    };
    const open = async (view) => { const g = await openGame(L.context, `test=1&clock=manual&seed=11&view=${view}`); await clickStart(g.page); return g; };
    const close = async (g) => { extraErrors.push(...g.errors); extraExternal.push(...g.external); await g.page.close(); };
    const stepQ = (Q, n) => Q.evaluate((k) => window.__bc.step(k), n);
    const record = async (Q, n, per) => {
      const out = [];
      for (let f = 0; f < n; f++) { if (per) await per(f); await stepQ(Q, 1); out.push(await Q.evaluate(() => window.__bc.vmScreen())); }
      return out;
    };
    {
      const g = await open(7), Q = g.page;
      await stepQ(Q, 156);
      const mouse = makeMouse(Q, W, H); await mouse.center();
      await stepQ(Q, 1);
      const b0 = (await stepQ(Q, 0)).shotsFired;
      await mouse.down('left');
      for (let i = 0; i < 36; i++) { const s = await stepQ(Q, 1); if (s.shotsFired > b0) break; }
      await mouse.up('left'); await stepQ(Q, 42);
      await Q.evaluate(() => window.__bc.vmScreen(true));
      await mouse.down('left');
      const fr = await record(Q, 60);
      await mouse.up('left');
      await close(g);
      const apart = [];
      for (let f = 0; f + 30 < fr.length; f++) apart.push(gunMove(fr[f], fr[f + 30]));
      const shotF = [];
      for (let f = 1; f < fr.length; f++) if (fr[f].shots > fr[f - 1].shots) shotF.push(f);
      const traj = shotF.filter((f) => f + 4 < fr.length).map((f) => {
        const v = [];
        for (let j = 0; j < 5; j++) for (const k of ['muzzle', 'wristL', 'bg']) { const a = pxOf(fr[f + j][k]), b = pxOf(fr[f - 1][k]); v.push(a[0] - b[0], a[1] - b[1]); }
        return v;
      });
      const cs = [];
      for (let i = 0; i + 1 < traj.length; i++) cs.push(corr(traj[i], traj[i + 1]));
      const A = med(apart), C = med(cs);
      rec('(n) 연사 때 총의 화면 움직임이 되풀이되지 않는다', A >= 27 && C <= 0.6 && shotF.length >= 8,
        `① 0.5초 떨어진 프레임의 총 위치 차 중앙값 ${A.toFixed(1)} px(27 이상) ② 이웃한 두 발의 궤적 상관 중앙값 ${C.toFixed(2)}(0.6 이하, ${cs.length}쌍), 1초 동안 ${shotF.length}발`);
    }
    let walkApart = NaN, bgRange = NaN, jumpMove = NaN;
    {
      const g = await open(2), Q = g.page;
      await stepQ(Q, 156);
      await Q.keyboard.down('KeyW'); await stepQ(Q, 30);
      await Q.evaluate(() => window.__bc.vmScreen(true));
      const fr = await record(Q, 60);
      await Q.keyboard.up('KeyW');
      await close(g);
      const apart = [];
      for (let f = 0; f + 30 < fr.length; f++) apart.push(gunMove(fr[f], fr[f + 30]));
      walkApart = med(apart);
      const bg = fr.map((r) => pxOf(r.bg));
      bgRange = Math.max(...[0, 1].map((k) => Math.max(...bg.map((v) => v[k])) - Math.min(...bg.map((v) => v[k]))));
    }
    {
      const g = await open(13), Q = g.page;
      await Q.evaluate(() => { window.__bc.place(0, 21, 0); window.__bc.step(90); });
      const s0 = await Q.evaluate(() => window.__bc.vmScreen(true));
      await Q.keyboard.down('Space');
      const fr = await record(Q, 70, async (f) => { if (f === 15) await Q.keyboard.up('Space'); });
      await close(g);
      jumpMove = Math.max(...fr.map((r) => gunMove(s0, r)));
    }
    rec('(o) 걷고 뛸 때 총과 몸이 움직인다', walkApart >= 8 && bgRange >= 12 && jumpMove > 27,
      `① 걷는 1초 동안 0.5초 떨어진 프레임의 총 위치 차 중앙값 ${walkApart.toFixed(1)} px(8 이상) ② 배경 점의 움직임 범위 ${bgRange.toFixed(1)} px(12 이상) ③ 점프와 착지 동안 총이 서 있을 때보다 움직인 최대 ${jumpMove.toFixed(1)} px(27 초과)`);
  }
  // (p) 팔이 사람 팔의 치수로 이어진다(2단계 ④ 마무리, 2026-11-17).
  //  2단계 ③부터 판정자들이 '어깨로 이어지지 않는 원통 끝의 작은 덩어리 손', '두 손이 화면 아래를 바위처럼 덮는다'고 적었다(A/B 54·55·57, critic 38~43).
  //  어깨에서 닿지 않는 손(소총 받침손, 렌즈 앞을 지나는 권총 팔)은 팔꿈치 없이 손목에서 0.38~0.5 m짜리 원통 하나로 그려졌고, 권총은 두 손이 렌즈 0.34 m 앞에 모였다.
  //  __bc.vmArms()의 drawn이 실제로 그린 어깨, 팔꿈치, 손목(카메라 기준, m)이다. 소총 낮춤·쏘기, 권총 낮춤·쏘기의 여덟 장면, 두 팔 모두에서
  //   ① 그린 팔뚝(팔꿈치~손목)이 0.27 ± 0.02 m, 위팔(어깨~팔꿈치)이 0.31 ± 0.03 m이고 위팔이 그려진다
  //   ② 팔꿈치가 렌즈 높이보다 아래이고 손목보다 3 cm 넘게 높지 않다(팔이 화면 위쪽을 덮지 않는다)
  //   ③ 권총 쏘기 자세에서 두 손목이 렌즈에서 0.42 m 넘게 앞에 있다(팔을 뻗어 든다)
  //  CHECK_ONLY=arms 이면 이 검사만 돈다
  async function armChecks() {
    const CASES = [['소총 낮춤 마당', 0, 'rifle', 0], ['소총 낮춤 복도', 2, 'rifle', 0], ['소총 쏘기 방', 7, 'rifle', 1], ['소총 쏘기 마당', 0, 'rifle', 1], ['소총 쏘기 홀', 3, 'rifle', 1],
      ['권총 낮춤', 12, 'pistol', 0], ['권총 쏘기', 12, 'pistol', 1], ['권총 쏘기 방', 7, 'pistol', 1]];
    const bad1 = [], bad2 = [], bad3 = [];
    let foreR = [Infinity, -Infinity], upR = [Infinity, -Infinity];
    for (const [name, view, wpn, alert] of CASES) {
      const g = await openGame(L.context, `test=1&clock=manual&seed=11&view=${view}`), Q = g.page; await clickStart(Q);
      const stepQ = (k) => Q.evaluate((m) => window.__bc.step(m), k);
      await Q.evaluate((a) => window.__bc.vmTune({ alert: a, carry: 0 }), alert);
      await stepQ(60);
      if (wpn === 'pistol' && (await Q.evaluate(() => window.__bc.state())).player.weapon !== 'pistol') { await Q.keyboard.down('Digit2'); await stepQ(2); await Q.keyboard.up('Digit2'); }
      await stepQ(120);
      const a = await Q.evaluate(() => window.__bc.vmArms());
      extraErrors.push(...g.errors); extraExternal.push(...g.external); await Q.close();
      for (const k of ['R', 'L']) {
        const d = a[k].drawn;
        foreR = [Math.min(foreR[0], d.fore), Math.max(foreR[1], d.fore)]; upR = [Math.min(upR[0], d.upper), Math.max(upR[1], d.upper)];
        if (Math.abs(d.fore - 0.27) > 0.02 || Math.abs(d.upper - 0.31) > 0.03 || !d.up) bad1.push(`${name} ${k} 팔뚝 ${d.fore} 위팔 ${d.upper}${d.up ? '' : '(안 그림)'}`);
        if (d.e[1] >= 0 || d.e[1] > d.w[1] + 0.03) bad2.push(`${name} ${k} 팔꿈치 높이 ${d.e[1]} 손목 ${d.w[1]}`);
        if (wpn === 'pistol' && alert && d.w[2] > -0.42) bad3.push(`${name} ${k} 손목 앞 ${(-d.w[2]).toFixed(2)} m`);
      }
    }
    rec('(p) 팔이 사람 팔의 치수로 이어진다', !bad1.length && !bad2.length && !bad3.length,
      `① 팔뚝 ${foreR[0].toFixed(2)}~${foreR[1].toFixed(2)} m, 위팔 ${upR[0].toFixed(2)}~${upR[1].toFixed(2)} m${bad1.length ? ` (벗어남 ${bad1.length}: ${bad1.slice(0, 3).join('; ')})` : ' (모두 안)'}` +
      ` ② 팔꿈치${bad2.length ? ` 벗어남 ${bad2.length}: ${bad2.slice(0, 3).join('; ')}` : ' 모두 렌즈 아래'}` +
      ` ③ 권총 쏘기 손목${bad3.length ? ` 벗어남: ${bad3.join('; ')}` : ' 모두 0.42 m 넘게 앞'}`);
  }
  // (r) 봇이 걸을 때 디딘 발이 땅에서 미끄러지지 않는다, (s) 쓰러질 때 무릎이 거꾸로 꺾이지 않는다(2단계 ②, 2026-11-18).
  //  판정자들이 '걸음이 뻣뻣하고 기계적', '마네킹'이라 적었다(A/B 68·69). 다리를 엉덩이에 매단 진자로 그려서 디딘 발이 몸과 함께 끌려갔다.
  //  (r) 연속 프레임 bot-walk-yard, bot-run-yard, bot-walk-room과 같은 자리에서 0.5초 걸은 뒤 1.5초 동안, 땅에 닿은 발(발목이 발 밑 땅에서 0.09 m 아래. 처음에는 몸 높이 기준이라 방 장면의 0.29 m 단에서 단 아래의 든 발까지 셌다)이
  //   두 프레임 사이에 수평으로 움직인 거리의 합이 몸이 움직인 거리의 10% 이하다
  //  (s) 마당, 방, 홀에서 쓰러진 봇의 4초 동안, 무릎이 엉덩이와 발목을 잇는 선에서 몸 뒤쪽으로 3 cm 넘게 나가지 않는다
  //  고치기 전 빌드에서 실패하는 것을 먼저 확인했다(PROGRESS.md 2단계 ②). CHECK_ONLY=bot 이면 이 검사만 돈다
  async function botMotionChecks() {
    const open = async (vp, bots) => { const g = await openGame(L.context, `test=1&clock=manual&seed=11&vp=${vp}&bots=${bots}`); await clickStart(g.page); return g; };
    const close = async (g) => { extraErrors.push(...g.errors); extraExternal.push(...g.external); await g.page.close(); };
    const WALKS = [['마당 걷기', '6,20,0.22,0', '0,2.31,17.23,-1.35,march', 0], ['마당 달리기', '6,20,0.22,0', '0,-0.13,17.78,-1.35,run', 0], ['방 걷기', '8,-5.6,3.1416,0', '1,7.4,-3.2,-1.5708,march', 1]];
    const slips = [];
    for (const [name, vp, bots, i] of WALKS) {
      const g = await open(vp, bots);
      // 발 밑 땅 높이: 실내 바닥에서 땅 함수가 바깥 땅을 주면(0.45 m 넘게 차이) 봇이 선 높이를 쓴다
      const fr = await g.page.evaluate((i) => { const gr = (j, b) => { const h = window.__bc.ground(j[0], j[2], j[1] + 0.3); return h > -0.4 && Math.abs(h - b.pos[1]) < 0.45 ? h : b.pos[1]; }; window.__bc.step(30); const o = []; for (let k = 0; k < 90; k++) { window.__bc.step(1); const b = window.__bc.botJ(i); b.g = [gr(b.J[11], b), gr(b.J[14], b)]; o.push(b); } return o; }, i);
      await close(g);
      let foot = 0, body = 0;
      for (let k = 1; k < fr.length; k++) {
        const a = fr[k - 1], b = fr[k];
        body += Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
        for (const f of [11, 14]) {
          const gi = f === 11 ? 0 : 1;
          if (a.J[f][1] - a.g[gi] < 0.09 && b.J[f][1] - b.g[gi] < 0.09) foot += Math.hypot(b.J[f][0] - a.J[f][0], b.J[f][2] - a.J[f][2]);
        }
      }
      slips.push({ name, r: foot / Math.max(body, 1e-6), body });
    }
    rec('(r) 봇이 걸을 때 디딘 발이 미끄러지지 않는다', slips.every(s => s.r <= 0.1 && s.body > 0.5),
      slips.map(s => `${s.name} ${(s.r * 100).toFixed(0)}% (몸 ${s.body.toFixed(1)} m)`).join(', ') + ' (10% 이하)');
    const FALLS = [['마당', '6,20,0.22,0', '0,4.76,17.2,1.79,dead', 0], ['방', '8,-5.6,3.1416,-0.45', '1,8.5,-4.0,-2.8,dead', 1], ['홀', '2,-8,1.0,0.05', '2,-0.62,-9.1,-2.6,dead', 2]];
    const worst = [];
    for (const [name, vp, bots, i] of FALLS) {
      const g = await open(vp, bots);
      const w = await g.page.evaluate((i) => {
        const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm = (a) => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
        let worst = 0;
        for (let k = 0; k < 240; k++) {
          window.__bc.step(1);
          const J = window.__bc.botJ(i).J;
          const fwd = nrm(cross(sub(J[1], J[0]), sub(J[6], J[3])));
          for (const [h, kn, f] of [[9, 10, 11], [12, 13, 14]]) {
            const ax = nrm(sub(J[f], J[h])), v = sub(J[kn], J[h]), t = dot(v, ax), perp = [v[0] - ax[0] * t, v[1] - ax[1] * t, v[2] - ax[2] * t];
            worst = Math.max(worst, -dot(perp, fwd));
          }
        }
        return worst;
      }, i);
      await close(g);
      worst.push({ name, w });
    }
    rec('(s) 쓰러질 때 무릎이 거꾸로 꺾이지 않는다', worst.every(x => x.w <= 0.03), worst.map(x => `${x.name} ${(x.w * 100).toFixed(1)} cm`).join(', ') + ' (3 cm 이하)');
  }
  // (t)(u)(v)(w) 봇의 엄폐·시야·제압·우회가 보이는 형상과 맞는다(3단계 ①, 2026-11-18). 기준은 탄이 쓰는 보이는 삼각형(BVH)이다.
  //  봇의 지각과 엄폐와 우회가 충돌 상자로 판단해서, 상자가 없는 드럼통과 방벽 뒤를 엄폐로 여기지 않고, 선반 빈틈 너머를 못 보고, 상자보다 낮은 그림 너머로 쏠 수 있었다.
  //  (u) 시야: 길목 점의 눈 × 사람 자리(앉음/섬) 쌍에서, 봇이 보인다는데 몸 다섯 점이 모두 가린 비율 1% 이하, 안 보인다는데 머리와 가슴이 트인 비율 2% 이하
  //  (t) 엄폐: 위협에게 드러난 봇이 고른 자리에서 앉은 몸이 위협에게 하나도 보이지 않는 비율 95% 이상, 10 m 안에 가리는 자리가 있는데 못 찾은 경우 20% 이하
  //  (v) 제압: 교전 중인 봇 머리 0.7 m 옆으로 탄 4발(0.13초 간격)이 지나가면 마지막 탄 뒤 1.5초 안에 앉거나 엄폐로 가거나 시선에서 빠진다(시드 10개 중 8개 이상).
  //   벽에서 멈춘 탄은 벽 너머의 봇을 제압하지 않는다
  //  (w) 우회: 측면 역할의 길이 정면 길보다 30% 넘게 덜 드러나는 경우가, 정면 길이 20% 넘게 드러나고 돌아갈 길이 있는 시나리오(자리 격자 전체에서 찾은
  //   가장 덜 드러나는 길이 정면보다 30% 넘게 덜 드러난다)의 80% 이상. 처음에는 돌아갈 길이 있는지 따지지 않았다. 마당 한가운데의 위협처럼 어떤 길로도
  //   드러나는 시나리오가 절반을 넘어서, 그 기준은 어떤 봇도 넘을 수 없었다(PROGRESS.md 3단계 ①). 고치기 전 빌드는 바뀐 기준에서도 실패한다(33%)
  //  고치기 전 빌드에서 실패하는 것을 먼저 확인했다(PROGRESS.md 3단계 ①). CHECK_ONLY=ai 이면 이 검사만 돈다
  async function aiChecks() {
    const open = async (q) => { const g = await openGame(L.context, `test=1&clock=manual&${q}`); await clickStart(g.page); return g; };
    const close = async (g) => { extraErrors.push(...g.errors); extraExternal.push(...g.external); await g.page.close(); };
    const pct = (x) => (x * 100).toFixed(1) + '%';
    let g = await open('seed=11&bots=0,-15.5,2.6,0,idle');
    const S = await g.page.evaluate(() => window.__bc.ai('sight'));
    const C = await g.page.evaluate(() => window.__bc.ai('cover'));
    const F = await g.page.evaluate(() => window.__bc.ai('flank'));
    await close(g);
    rec('(u) 봇의 시야가 보이는 형상과 맞는다', S.falseSeeRate <= 0.01 && S.blindRate <= 0.02,
      `쌍 ${S.pairs}, 가린 몸을 봄 ${pct(S.falseSeeRate)}(1% 이하), 트인 몸을 못 봄 ${pct(S.blindRate)}(2% 이하)` + (S.exFalseSee.length ? ` 예: 봄 ${JSON.stringify(S.exFalseSee.slice(0, 2))}` : '') + (S.exBlind.length ? ` 못 봄 ${JSON.stringify(S.exBlind.slice(0, 2))}` : ''));
    rec('(t) 봇이 고른 엄폐가 실제로 몸을 가린다', C.badRate <= 0.05 && C.missRate <= 0.2,
      `시나리오 ${C.scenarios}, 고름 ${C.chosen}, 드러난 엄폐 ${C.bad}(${pct(C.badRate)}, 5% 이하), 못 고름 ${C.none} 중 놓침 ${C.missed}(${pct(C.missRate)}, 20% 이하)` + (C.exBad.length ? ` 예 ${JSON.stringify(C.exBad.slice(0, 2))}` : ''));
    rec('(w) 우회 길이 정면 길보다 덜 드러난다', F.altRate >= 0.8,
      `시나리오 ${F.rows}, 정면이 드러나고 돌아갈 길이 있는 ${F.alt} 중 우회가 나은 ${F.altBetter}(${pct(F.altRate)}, 80% 이상). 돌아갈 길과 상관없이 ${F.better}/${F.open}. 드러난 비율 평균 정면 ${F.meanDirect} 우회 ${F.meanFlank}, 길 짜기 평균 ${F.planMs} ms 최대 ${F.planMsMax} ms`);
    const sup = [];
    for (let seed = 1; seed <= 10; seed++) {
      g = await open(`seed=${seed}&vp=6,22,0.38,0&bots=0,2,12,-2.76,live`);
      sup.push(await g.page.evaluate(() => window.__bc.ai('suppress')));
      await close(g);
    }
    g = await open('seed=3&vp=0,8,0,0&bots=1,8,-2.6,0,idle');
    const wall = await g.page.evaluate(() => window.__bc.ai('suppress', { wall: true, i: 1 }));
    await close(g);
    const ok = sup.filter(s => s.engaged && s.reacted).length;
    rec('(v) 탄이 스치면 봇이 몸을 숨기고, 벽에 막힌 탄은 제압하지 않는다', ok >= 8 && wall.stopped === wall.shots && !wall.suppressedChanged,
      `반응 ${ok}/10(8 이상, 교전 ${sup.filter(s => s.engaged).length}, 첫 탄부터 반응까지 ${sup.filter(s => s.reacted).map(s => s.rt.toFixed(2)).join('/')}), 벽 탄 ${wall.stopped}/${wall.shots} 막힘, 제압됨 ${wall.suppressedChanged}`);
  }
  if (process.env.CHECK_ONLY === 'ai') { await aiChecks(); return; }
  if (process.env.CHECK_ONLY === 'arms') { await armChecks(); return; }
  if (process.env.CHECK_ONLY === 'bot') { await botMotionChecks(); return; }
  if (process.env.CHECK_ONLY === 'motion') { await motionChecks(); return; }

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
  // (l) 실내 면과 뷰모델이 실제 재료의 반사율을 지킨다(실내 세션 2026-11-15에 만들고, 측정 정비 2차 2026-11-17에 실효 반사율로 다시 썼다.
  //  A/B 43과 critic 31의 '형광등 아래 흰 석고 모형', '올리브색을 잃은 소매'. 원인은 둘레의 벽과 바닥이 실제의 절반쯤으로 어두웠던 것과 천의 거친 정반사였다)
  //  옛 (l)은 '뷰모델 밝기 ÷ 둘레 밝기'를 봐서 형광등까지의 거리가 다르면 재질이 맞아도 실패했다(가까운 바닥). 이제 빛을 지운 값만 본다.
  //  ① 레벨 실내 재질의 반사율(__bc.levelAlbedo(): 텍스처 평균 × 색, 선형 휘도)이 아래 실제 재료의 범위 안. level.js의 반사율 표와 따로 적어 둔다
  //  ② 시점 여섯 곳에서 뷰모델 재질의 확산 실효 반사율(정반사·결 반사·환경 반사·닳은 모서리를 끄고 흰 종이로 나눈 중앙값)이 재질 표(weapons.js)의 ±25% 안.
  //     장갑은 표의 3%가 손등 천의 값이고 메시에 가죽 손바닥(×0.62)·마디 덧댐(×0.45)·틈 그늘이 정점 색으로 들어가 −13~−20%로 나온다
  //  ③ 천(장갑, 소매)의 전체 실효 반사율이 표의 1.3배 이하(천에는 정반사가 없고 결 반사만 있다. 총은 정반사에 맺히는 등과 창 때문에 표와 비교하지 않고, 위쪽은 (k)가 본다)
  //  ④ 소매 채도가 확산만 그린 같은 소매의 0.8배 이상. 고치기 전 빌드(51268bb = ca642c4의 게임 + 측정 API)에서 ①과 ③이 실패하는 것을 먼저 확인했다
  {
    const RANGE = { // 실제 재료의 확산 반사율(선형)
      plaster: [0.40, 0.55], concrete: [0.25, 0.35], linoleum: [0.30, 0.40],            // 낡은 칠 회벽, 먼지 앉은 실내 콘크리트 바닥, 비닐 바닥
      plywood: [0.20, 0.45], plywoodB: [0.20, 0.45], plywoodC: [0.20, 0.45],            // 소나무 합판(바랜 것은 더 어둡다)
      pallet: [0.20, 0.30], deskTop: [0.20, 0.40], doorPaint: [0.20, 0.30],             // 바랜 팔레트 나무, 나무결 상판, 칠한 문틀
      cardboard: [0.15, 0.40], cardboardB: [0.15, 0.40], cardboardC: [0.15, 0.40],      // 골판지(젖거나 때 묻은 것 0.15~0.25)
      block: [0.20, 0.40], ceiling: [0.45, 0.85],                                        // 콘크리트 블록, 때 탄 천장 타일
    };
    const TABLE = { polymer: 0.035, steel: 0.045, scopeBody: 0.030, tan: 0.070, glove: 0.030, sleeve: 0.045 };   // weapons.js 재질 표
    const MATS = Object.keys(TABLE), FABRIC = ['glove', 'sleeve'];
    const sat = (c) => (c && c.every((x) => x > 0) ? 1 - Math.min(...c) / Math.max(...c) : 0);
    let albedo = null;
    const rows = [];
    for (const [v, name] of [[2, '복도'], [4, '사무실'], [6, '문간'], [7, '방 안의 봇'], [10, '가까운 바닥'], [0, '마당']]) {
      const q = await openGame(L.context, `test=1&clock=manual&seed=11&view=${v}`);
      const Q = q.page; await clickStart(Q);
      await Q.evaluate(() => window.__bc.step(90));
      const o = await Q.evaluate((mats) => {
        const b = window.__bc; if (!b.vmLight || !b.vmMat) return null;
        const seen = (r) => r.refl.all.n >= 100;
        const full = {}, diff = {};
        for (const m of mats) { const r = b.vmLight({ only: m }); full[m] = seen(r) ? { p50: r.refl.all.p50, rgb: r.rgb } : null; }
        b.vmMat({ spec: 0, env: 0, sheen: 0, finish: 0 });
        try { for (const m of mats) { const r = b.vmLight({ only: m }); diff[m] = seen(r) ? { p50: r.refl.all.p50, rgb: r.rgb } : null; } }
        finally { b.vmMat(null); }
        return { full, diff, albedo: b.levelAlbedo ? b.levelAlbedo() : null };
      }, MATS);
      extraErrors.push(...q.errors); extraExternal.push(...q.external);
      await Q.close();
      if (o && !albedo) albedo = o.albedo;
      rows.push({ name, o });
    }
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const f2 = (x) => x.toFixed(2), pc = (x) => (x * 100).toFixed(1);
    // ① 레벨 반사율
    const lvBad = [], lvAll = [];
    for (const [k, [lo, hi]] of Object.entries(RANGE)) {
      const a = albedo && albedo[k] ? lum(albedo[k]) : null;
      lvAll.push(`${k} ${a == null ? '없음' : f2(a)}`);
      if (a == null || a < lo || a > hi) lvBad.push(`${k} ${a == null ? '없음' : f2(a)}(${lo}~${hi})`);
    }
    // ②③④ 뷰모델: 재질마다 시점별 비(측정 ÷ 표)의 최소·최대
    const span = {}, fab = {}, satBad = [];
    for (const m of MATS) { span[m] = []; fab[m] = []; }
    for (const r of rows) {
      if (!r.o) continue;
      for (const m of MATS) {
        if (r.o.diff[m]) span[m].push(r.o.diff[m].p50 / TABLE[m]);
        if (FABRIC.includes(m) && r.o.full[m]) fab[m].push(r.o.full[m].p50 / TABLE[m]);
      }
      const s = r.o.full.sleeve, s0 = r.o.diff.sleeve;
      if (s && s0 && sat(s.rgb) < 0.8 * sat(s0.rgb)) satBad.push(`${r.name} ${f2(sat(s.rgb))}/${f2(sat(s0.rgb))}`);
    }
    const diffBad = MATS.filter((m) => !span[m].length || Math.min(...span[m]) < 0.75 || Math.max(...span[m]) > 1.25);
    const fabBad = FABRIC.filter((m) => !fab[m].length || Math.max(...fab[m]) > 1.3);
    const unseen = rows.filter((r) => !r.o).map((r) => r.name);
    const rng = (a) => (a.length ? `${f2(Math.min(...a))}~${f2(Math.max(...a))}` : '잴 수 없음');
    rec('(l) 실내 면과 뷰모델이 실제 재료의 반사율을 지킨다',
      !lvBad.length && !diffBad.length && !fabBad.length && !satBad.length && !unseen.length,
      `① 레벨 반사율 ${lvBad.length ? '범위 밖 ' + lvBad.join(', ') : '모두 범위 안'} [${lvAll.join(', ')}]` +
      ` / ② 뷰모델 확산 ÷ 재질 표 ${MATS.map((m) => `${m} ${rng(span[m])}`).join(', ')} (0.75~1.25)` +
      ` / ③ 천 전체 ÷ 재질 표 ${FABRIC.map((m) => `${m} 최대 ${fab[m].length ? f2(Math.max(...fab[m])) : '잴 수 없음'}`).join(', ')} (1.3 이하)` +
      ` / ④ 소매 채도 ${satBad.length ? '0.8배 미만 ' + satBad.join(', ') : '모든 시점 0.8배 이상'}` +
      (unseen.length ? ` / 잴 수 없는 시점 ${unseen.join(', ')}` : ''));
  }
  if (!process.env.CHECK_ONLY) { await motionChecks(); await armChecks(); await botMotionChecks(); await aiChecks(); }
  if (process.env.CHECK_ONLY === 'move' || process.env.CHECK_ONLY === 'surface') return;

  const { page, errors, external } = await openGame(L.context, 'test=1&seed=7');
  rec('로딩 완료', true);

  // (m) 로딩이 끝나면 장면의 정점 버퍼가 모두 GPU에 올라가 있다(실내 세션, 2026-11-16). 컬링을 끄고 장면 전체를 한 번 더 그려도
  //  새로 올라가는 지오메트리가 없어야 한다. 아니면 주 카메라가 아직 보지 않은 물체를 반사 프로브가 처음 그리는 프레임에 업로드가 몰려
  //  한 프레임이 45~57 ms 걸렸다(창문을 넘는 자리의 +Z 면). 고치기 전 빌드에서 실패하는 것을 먼저 확인했다
  {
    const r = await page.evaluate(() => window.__bc.geoCheck());
    rec('(m) 로딩이 끝나면 장면의 정점 버퍼가 모두 올라가 있다', r.after === r.before, `컬링 없이 다시 그린 뒤 GPU 지오메트리 ${r.before} → ${r.after}`);
  }

  // (q) 탄은 보이는 형상에서 멈추고 보이는 빈틈은 지나간다(2026-11-18, 사용자 요청). 탄은 레벨의 충돌 상자로 쏘는데,
  //  상자는 보이는 형상과 따로 손으로 둔 것이라 선반·의자·돌린 상자에서는 빈틈에서 탄이 멈추고(막힘), 팔레트 더미·드럼통·방벽·나무 줄기에서는
  //  보이는 물체를 탄이 지나갔다(뚫림). 교전이 벌어지는 8자리의 가슴 높이에서 네 방향으로, 레벨의 보이는 형상(잎, 낙엽, 철망, 비닐, 웅덩이,
  //  얼룩, 종이, 전선은 빼고)을 핀홀 카메라로 그린 거리와 탄의 길(level.bulletRay)이 처음 닿는 거리를 화소마다 견준다(__bc.bulletMatch).
  //  어긋남은 0.1 m + 거리의 1.5%보다 큰 차이다. 뚫림과 막힘이 각각 닿은 광선의 1% 이하여야 한다. 고치기 전 빌드에서 실패하는 것을 먼저 확인했다
  {
    const SPOTS = [[0, 16], [-12, 12], [16, 6], [-7.5, -0.9], [0.5, -2.4], [8, -2.6], [-6, -5.8], [2, -8]];
    const SKIP = ['weeds', 'sheet', 'chain', 'tube', 'puddle', 'stain', 'paper', 'cable', '?treeCards', '?treeLitter'];
    const r = await page.evaluate(({ SPOTS, SKIP }) => {
      const tot = { solid: 0, pass: 0, block: 0, pk: {}, bk: {} };
      for (const [x, z] of SPOTS) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const m = window.__bc.bulletMatch({ x, y: 1.35, z, yaw, w: 120, h: 68, skip: SKIP });
        tot.solid += m.solid; tot.pass += m.passN; tot.block += m.blockN;
        for (const k in m.pass) tot.pk[k] = (tot.pk[k] || 0) + m.pass[k];
        for (const k in m.block) tot.bk[k] = (tot.bk[k] || 0) + m.block[k];
      }
      return tot;
    }, { SPOTS, SKIP });
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ') || '없음';
    const pp = r.pass / Math.max(1, r.solid), bp = r.block / Math.max(1, r.solid);
    rec('(q) 탄은 보이는 형상에서 멈추고 보이는 빈틈은 지나간다', pp <= 0.01 && bp <= 0.01,
      `닿은 광선 ${r.solid}, 뚫림 ${(pp * 100).toFixed(2)}% [${top(r.pk)}], 막힘 ${(bp * 100).toFixed(2)}% [${top(r.bk)}] (각각 1% 이하)`);
  }
  if (process.env.CHECK_ONLY === 'bullet') return;   // (q)만 빠르게 돌려 보는 용도

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
    const p0 = await st();
    await page.keyboard.down('KeyW'); await sleep(500);
    const walk = await peak(500, (p) => p.speed);
    await page.keyboard.down('ShiftLeft'); await sleep(500);
    const run = await peak(500, (p) => p.speed);
    const runSprint = (await st()).sprinting;
    await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW'); await sleep(700);
    rec('걷기와 달리기 구분 (조준을 한 번 한 뒤 Shift+W)', run > walk * 1.6, `걷기 ${walk.toFixed(2)} m/s, 달리기 ${run.toFixed(2)} m/s (${(run / Math.max(walk, 0.01)).toFixed(2)}배), 출발 x ${p0.x.toFixed(2)} z ${p0.z.toFixed(2)} 방향 ${(p0.yaw ?? 0).toFixed(2)}, 달리기 중 sprinting ${runSprint}`);
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
