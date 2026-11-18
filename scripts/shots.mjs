// npm run shots: 고정 지점 + 플레이 장면 스크린샷과 1초 8장 연속 프레임 묶음을 out/shots/에 저장
// 촬영은 수동 시계(?clock=manual)로 한다. 게임 시간이 __bc.step()으로만 흐르고 입력은 그 사이에 실제 이벤트로 넣으므로,
// 같은 빌드는 몇 번을 찍어도 같은 화면이 나온다. 전후 비교(npm run ab)에서 촬영 시점의 우연이 차이로 보이지 않게 하려는 것이다.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { OUT, ensureDir, build, launch, openGame, clickStart, makeMouse } from './lib.mjs';
import { BOT_SHOTS, BOT_STRIPS } from './botscenes.mjs';

const W = 1280, H = 720, FPS = 60;
const dir = ensureDir(path.join(OUT, 'shots'));
for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
if (!process.argv.includes('--nobuild')) build();

const L = await launch({ width: W, height: H });
console.log(`렌더러: ${L.renderer} (${L.mode})`);
const meta = { renderer: L.renderer, mode: L.mode, software: L.software, clock: 'manual', simFps: FPS, shots: [], strips: [] };

const step = (page, n = 1) => page.evaluate((k) => window.__bc.step(k), n);
// 마지막으로 그린 프레임이 화면에 올라온 뒤에 찍는다
const settle = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

async function open(view, settleFrames = 156) {
  const g = await openGame(L.context, `test=1&clock=manual&seed=11&view=${view}`);
  await clickStart(g.page);
  if (settleFrames) await step(g.page, settleFrames); // 2.6초: 자동 노출과 자세가 자리를 잡을 시간
  return g;
}
// 임의 시점(?vp=x,z,yaw,pitch)으로 연다
async function openVp(vp, settleFrames = 156) {
  const g = await openGame(L.context, `test=1&clock=manual&seed=11&vp=${vp}`);
  await clickStart(g.page);
  if (settleFrames) await step(g.page, settleFrames);
  return g;
}
// 권총으로 바꾸고 다 꺼낼 때까지(1.5초) 기다린다
async function toPistol(page) {
  await page.keyboard.down('Digit2'); await step(page, 2); await page.keyboard.up('Digit2');
  await step(page, 90);
}
async function shot(page, name) {
  const file = path.join(dir, `${name}.png`);
  await settle(page);
  await page.screenshot({ path: file });
  meta.shots.push(`${name}.png`);
  return file;
}
// 1초(60프레임) 동안 8장: 1, 9, 16, 24, 31, 39, 46, 54번째 프레임. perFrame은 프레임마다 그 직전에 불린다(입력을 넣는 자리)
async function strip(page, name, perFrame) {
  const frames = [];
  let done = 0;
  for (let i = 0; i < 8; i++) {
    const target = 1 + Math.round(i * FPS / 8);
    while (done < target) { if (perFrame) await perFrame(done); await step(page, 1); done++; }
    await settle(page);
    frames.push(await page.screenshot({ type: 'png' }));
  }
  const fw = 480, fh = 270;
  const tiles = await Promise.all(frames.map(b => sharp(b).resize(fw, fh).png().toBuffer()));
  await sharp({ create: { width: fw * 8, height: fh, channels: 3, background: '#000' } })
    .composite(tiles.map((t, i) => ({ input: t, left: i * fw, top: 0 })))
    .png().toFile(path.join(dir, `strip-${name}.png`));
  meta.strips.push({ file: `strip-${name}.png`, simMs: Math.round((done - 1) * 1000 / FPS) });
}

// 방아쇠를 당긴 뒤 첫 발이 실제로 나간 프레임까지 한 프레임씩 진행한다(최대 0.6초).
// 총을 드는 데 시간이 걸리는 빌드와 바로 쏘는 빌드를 같은 순간(첫 발이 나간 프레임)으로 맞춘다
async function pullUntilShot(page, mouse) {
  const before = (await step(page, 0))?.shotsFired ?? 0;
  await mouse.down('left');
  for (let i = 0; i < 36; i++) { const s = await step(page, 1); if (s.shotsFired > before) return true; }
  console.log('  (0.6초 안에 발사되지 않음)');
  return false;
}
// --bots-only: 봇 장면만 찍는다(기준선의 봇 장면을 다시 찍을 때)
if (!process.argv.includes('--bots-only')) {
const VIEWS = [
  ['01-yard', 0], ['02-entrance', 1], ['03-corridor', 2], ['04-hall-windows', 3],
  ['05-office-fluorescent', 4], ['06-loading-dock-stairs', 5], ['07-doorway-to-yard', 6], ['08-bot-in-room', 7],
  // 가까운 장면: A/B에만 쓴다(npm run sheet의 레퍼런스 비교에는 넣지 않는다)
  ['12-close-doorway', 9], ['13-close-floor', 10], ['14-close-wall', 11], ['15-close-pistol', 12],
];
for (const [name, v] of VIEWS) {
  const { page } = await open(v);
  await shot(page, name);
  await page.close();
}

// 사격 순간: 첫 발이 나간 바로 그 프레임. 이어서 방아쇠를 1초 내내 누른 연사
{
  const { page } = await open(7);
  const mouse = makeMouse(page, W, H); await mouse.center();
  await step(page, 1);
  await pullUntilShot(page, mouse);
  await shot(page, '09-firing');
  await mouse.up('left');
  await step(page, 42);
  await mouse.down('left');
  await strip(page, 'firing-burst', null);
  await mouse.up('left');
  await page.close();
}
// 피격 순간: 경계 상태 봇이 쏜 탄에 처음 맞고 3프레임(0.05초) 뒤
{
  const { page } = await open(8, 0);
  let hit = false;
  for (let i = 0; i < 1500 && !hit; i++) hit = (await step(page, 1)).playerHits > 0;
  if (!hit) console.log('  (피격이 일어나지 않음)');
  await step(page, 3);
  await shot(page, '10-hit-taken');
  await page.close();
}
// 어두운 실내 → 밝은 마당
{
  const { page } = await open(6);
  await page.keyboard.down('KeyW');
  await step(page, 18);
  await strip(page, 'indoor-to-outdoor', null);
  await step(page, 12);
  await shot(page, '11-stepped-outside');
  await page.keyboard.up('KeyW');
  await page.close();
}
// 소총 조준(우클릭): 홀과 마당을 1초 동안 조준한 뒤 한 장씩, 그리고 방 안의 봇을 조준한 채 천천히 따라가는 연속 프레임.
// 조준 장면은 A/B에만 쓴다(npm run sheet의 레퍼런스 비교에는 넣지 않는다. 칸 수와 구성을 이전 라운드와 같게 둔다)
for (const [name, v] of [['16-aim-hall', 3], ['17-aim-yard', 0]]) {
  const { page } = await open(v);
  const mouse = makeMouse(page, W, H); await mouse.center();
  await mouse.down('right');
  await step(page, 60);
  await shot(page, name);
  await mouse.up('right');
  await page.close();
}
{
  const { page } = await open(7);
  const mouse = makeMouse(page, W, H); await mouse.center();
  await mouse.down('right');
  await step(page, 30);
  await strip(page, 'aim-track', async (f) => { await mouse.move(f < 30 ? 2 : -2, f % 20 < 10 ? 1 : -1); });
  await mouse.up('right');
  await page.close();
}
// 사격 순간을 밝기가 다른 세 곳에서 더 찍는다: 어두운 복도, 흐린 마당, 권총(가까운 실내). 첫 발이 나간 바로 그 프레임이다.
// 총구 화염의 빛을 고칠 때 더했다(2026-11-14). A/B에만 쓴다(npm run sheet의 레퍼런스 비교에는 넣지 않는다)
for (const [name, v] of [['18-fire-corridor', 2], ['19-fire-yard', 0], ['20-fire-pistol', 12]]) {
  const { page } = await open(v);
  const mouse = makeMouse(page, W, H); await mouse.center();
  await step(page, 1);
  await pullUntilShot(page, mouse);
  await shot(page, name);
  await mouse.up('left');
  await page.close();
}
// 마당 방벽 앞으로 걸어가며 Space를 두 번 누른다(파쿠르). A/B에만 쓴다
{
  const { page } = await open(13);
  await page.keyboard.down('KeyW');
  await strip(page, 'vault-barrier', async (f) => {
    if (f === 6 || f === 15) await page.keyboard.down('Space');
    if (f === 9 || f === 18) await page.keyboard.up('Space');
  });
  await page.keyboard.up('KeyW');
  await page.close();
}
// 사용자 지시 세션 3(2026-11-15)에 더한 장면. 모두 A/B에만 쓴다(npm run sheet의 레퍼런스 비교에는 넣지 않는다)
// 실내의 금속 통(높이 0.9 m) 0.9 m 앞에 서서 Space를 두 번 누른다. 서 있다가 넘을 때 튕겨 나가던 장면이다
{
  const g = await openGame(L.context, 'test=1&clock=manual&seed=11&vp=1.92,-15.4,-1.5708,-0.12');
  await clickStart(g.page); await step(g.page, 156);
  const page = g.page;
  await strip(page, 'vault-barrel', async (f) => {
    if (f === 4 || f === 13) await page.keyboard.down('Space');
    if (f === 7 || f === 16) await page.keyboard.up('Space');
  });
  await page.close();
}
// 제자리에서 마우스로 오른쪽, 왼쪽으로 돌았다가 멈춘다(총이 먼저 가고 몸이 따라오는 움직임). 이어서 D, A로 옆걸음
{
  const { page } = await open(4);
  const mouse = makeMouse(page, W, H); await mouse.center();
  await strip(page, 'turn-sway', async (f) => { if (f < 20) await mouse.move(12, 0); else if (f < 40) await mouse.move(-12, 0); });
  await page.close();
}
// 옆걸음: 트인 마당에서 D 0.5초, A 0.5초. 옛 'strafe'(시점 0)는 출발 자리 오른쪽이 막혀 D 동안 움직이지 않았다.
// 이름을 바꿔 옛 기준선의 'strafe'와 짝지어지지 않게 했다(2026-11-17)
{
  const { page } = await openVp('3,18,0.22,0.02');
  await strip(page, 'strafe-yard', async (f) => {
    if (f === 0) await page.keyboard.down('KeyD');
    if (f === 30) { await page.keyboard.up('KeyD'); await page.keyboard.down('KeyA'); }
  });
  await page.keyboard.up('KeyA');
  await page.close();
}
// 걷기, 달리며 회전
{
  const { page } = await open(2);
  await page.keyboard.down('KeyW');
  await step(page, 30);
  await strip(page, 'walking', null);
  await page.keyboard.down('ShiftLeft');
  const mouse = makeMouse(page, W, H); await mouse.center();
  await strip(page, 'running-turn', async (f) => { if (f < 48) await mouse.move(6, 0); });
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.close();
}
// 뷰모델 구도 세션(2026-11-15)에 더한 장면. 판정자가 재장전을 본 적이 없었다. A/B에만 쓴다
// 밝은 홀에서 R을 누르고 1.25초 뒤(빈 탄창이 빠지고 새 탄창을 꺼내 오는 중) 한 장, 다른 자리(사무실)에서 R을 누르고 0.3초 뒤부터 1초 연속 프레임
{
  const { page } = await open(3);
  await page.keyboard.down('KeyR'); await step(page, 2); await page.keyboard.up('KeyR');
  await step(page, 73);
  await shot(page, '21-reload');
  await page.close();
}
{
  const { page } = await open(4);
  await page.keyboard.down('KeyR'); await step(page, 2); await page.keyboard.up('KeyR');
  await step(page, 16);
  await strip(page, 'reload', null);
  await page.close();
}
// 움직임 묶음용 연속 프레임(2026-11-17 측정 정비 3차). 움직임만 바꾸는 묶음은 정지 화면이 두 빌드에서 같아 갈린 쌍이 모자랐다
// (2단계 ④, A/B 63~65가 모두 갈린 쌍 4). 연속 프레임만으로 15쌍 넘게 판정할 수 있도록(`--only strip`) 여기서 일곱 묶음을 더한다. 모두 A/B에만 쓴다
// 걷다 멈추기: 복도를 0.5초 걷고, 연속 프레임 16번째 프레임에서 W를 뗀다(총이 멈추며 흔들리는 것)
{
  const { page } = await open(2);
  await page.keyboard.down('KeyW');
  await step(page, 30);
  await strip(page, 'walk-stop', async (f) => { if (f === 16) await page.keyboard.up('KeyW'); });
  await page.close();
}
// 달리다 멈추기: 홀을 달리다가 16번째 프레임에서 W와 Shift를 뗀다
{
  const { page } = await open(3);
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
  await step(page, 40);
  await strip(page, 'sprint-stop', async (f) => { if (f === 16) { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); } });
  await page.close();
}
// 권총을 겨눈 채(우클릭) 복도를 걷는다. 낮춘 자세의 권총은 걷는 동안 화면 밖에 있어 총의 움직임이 보이지 않는다
{
  const { page } = await open(2);
  await toPistol(page);
  const mouse = makeMouse(page, W, H); await mouse.center();
  await mouse.down('right');
  await step(page, 20);
  await page.keyboard.down('KeyW');
  await step(page, 30);
  await strip(page, 'pistol-aim-walk', null);
  await page.keyboard.up('KeyW');
  await mouse.up('right');
  await page.close();
}
// 권총 연발: 방 안에서 0.15초마다 방아쇠를 당긴다
{
  const { page } = await open(7);
  await toPistol(page);
  const mouse = makeMouse(page, W, H); await mouse.center();
  await strip(page, 'pistol-fire', async (f) => {
    if (f % 9 === 0) await mouse.down('left');
    if (f % 9 === 4) await mouse.up('left');
  });
  await mouse.up('left');
  await page.close();
}
// 앉아 걷기: 홀에서 C로 앉고 0.7초 뒤 W
{
  const { page } = await open(3);
  await page.keyboard.down('KeyC'); await step(page, 2); await page.keyboard.up('KeyC');
  await step(page, 40);
  await page.keyboard.down('KeyW');
  await strip(page, 'crouch-walk', null);
  await page.keyboard.up('KeyW');
  await page.close();
}
// 계단 오르기: 정문 계단 앞에서 걸어 올라간다(20~50번째 프레임에 계단 세 단)
{
  const { page } = await openVp('-7.5,3.5,0,0');
  await page.keyboard.down('KeyW');
  await step(page, 10);
  await strip(page, 'stairs', null);
  await page.keyboard.up('KeyW');
  await page.close();
}
// 뒷걸음: 마당에서 S
{
  const { page } = await open(0);
  await page.keyboard.down('KeyS');
  await step(page, 20);
  await strip(page, 'backpedal', null);
  await page.keyboard.up('KeyS');
  await page.close();
}
}
// 봇을 가까이 찍는 장면과 움직이는 봇(2단계 ①에서 더함, scripts/botscenes.mjs). A/B에만 쓴다
for (const s of [...BOT_SHOTS, ...BOT_STRIPS.map(x => ({ ...x, strip: true }))]) {
  const g = await openGame(L.context, `test=1&clock=manual&seed=11&vp=${s.vp}&bots=${s.bots}${s.novm ? "&novm=1" : ""}`);
  await clickStart(g.page);
  await step(g.page, s.frames || 156);
  if (s.strip && s.fire) {
    const mouse = makeMouse(g.page, W, H); await mouse.center();
    await strip(g.page, s.name, async (f) => { if (s.fire.includes(f)) await mouse.down('left'); if (s.fire.includes(f - 2)) await mouse.up('left'); });
  } else if (s.strip) await strip(g.page, s.name, null); else await shot(g.page, s.name);
  await g.page.close();
}
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
await L.browser.close();
console.log(`저장: ${meta.shots.length}장 + 연속 프레임 ${meta.strips.length}묶음 → out/shots/ (수동 시계, ${FPS}Hz)`);
