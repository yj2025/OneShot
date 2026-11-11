// npm run shots: 고정 지점 + 플레이 장면 스크린샷과 1초 8장 연속 프레임 묶음을 out/shots/에 저장
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { OUT, ensureDir, build, launch, openGame, clickStart, makeMouse, sleep } from './lib.mjs';

const W = 1280, H = 720;
const dir = ensureDir(path.join(OUT, 'shots'));
for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
if (!process.argv.includes('--nobuild')) build();

const L = await launch({ width: W, height: H });
console.log(`렌더러: ${L.renderer} (${L.mode})`);
const meta = { renderer: L.renderer, mode: L.mode, software: L.software, shots: [], strips: [] };

async function open(view, extra = '') {
  const g = await openGame(L.context, `test=1&seed=11&view=${view}${extra}`);
  await clickStart(g.page);
  await sleep(2600); // 자동 노출이 자리를 잡을 시간
  return g;
}
async function shot(page, name) {
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  meta.shots.push(`${name}.png`);
  return file;
}
async function strip(page, name, action) {
  const frames = [];
  const t0 = Date.now();
  const actP = action ? action() : Promise.resolve();
  for (let i = 0; i < 8; i++) {
    const wait = t0 + i * 125 - Date.now();
    if (wait > 0) await sleep(wait);
    frames.push(await page.screenshot({ type: 'png' }));
  }
  await actP;
  const elapsed = Date.now() - t0;
  const fw = 480, fh = 270;
  const tiles = await Promise.all(frames.map(b => sharp(b).resize(fw, fh).png().toBuffer()));
  const file = path.join(dir, `strip-${name}.png`);
  await sharp({ create: { width: fw * 8, height: fh, channels: 3, background: '#000' } })
    .composite(tiles.map((t, i) => ({ input: t, left: i * fw, top: 0 })))
    .png().toFile(file);
  meta.strips.push({ file: `strip-${name}.png`, ms: elapsed });
}

const VIEWS = [
  ['01-yard', 0], ['02-entrance', 1], ['03-corridor', 2], ['04-hall-windows', 3],
  ['05-office-fluorescent', 4], ['06-loading-dock-stairs', 5], ['07-doorway-to-yard', 6], ['08-bot-in-room', 7],
];
for (const [name, v] of VIEWS) {
  const { page } = await open(v);
  await shot(page, name);
  await page.close();
}

// 사격 순간
{
  const { page } = await open(7);
  const mouse = makeMouse(page, W, H); await mouse.center();
  await mouse.down('left');
  await sleep(40);
  await shot(page, '09-firing');
  await mouse.up('left');
  await sleep(700);
  await strip(page, 'firing-burst', async () => { await mouse.down('left'); await sleep(620); await mouse.up('left'); });
  await page.close();
}
// 피격 순간: 경계 상태 봇이 플레이어를 향해 사격하는 장면
{
  const { page } = await open(8);
  await page.waitForFunction(() => window.__bc.state().stats.playerHits > 0, null, { timeout: 20000 }).catch(() => console.log('  (피격이 일어나지 않음)'));
  await sleep(50);
  await shot(page, '10-hit-taken');
  await page.close();
}
// 어두운 실내 → 밝은 마당
{
  const { page } = await open(6);
  await page.keyboard.down('KeyW');
  await sleep(300);
  await strip(page, 'indoor-to-outdoor', null);
  await sleep(200);
  await shot(page, '11-stepped-outside');
  await page.keyboard.up('KeyW');
  await page.close();
}
// 걷기, 달리며 회전
{
  const { page } = await open(2);
  await page.keyboard.down('KeyW');
  await sleep(500);
  await strip(page, 'walking', null);
  await page.keyboard.down('ShiftLeft');
  const mouse = makeMouse(page, W, H); await mouse.center();
  await strip(page, 'running-turn', async () => { for (let i = 0; i < 20; i++) { await mouse.move(14, 0); await sleep(40); } });
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.close();
}
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
await L.browser.close();
console.log(`저장: ${meta.shots.length}장 + 연속 프레임 ${meta.strips.length}묶음 → out/shots/`);
