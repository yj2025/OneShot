// 검증 스크립트 공용 도구: GPU 브라우저 실행, 빌드, 페이지 열기
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'out');
export const DIST = path.join(ROOT, 'dist', 'index.html');

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

export function build({ quiet = true } = {}) {
  execSync('npx vite build', { cwd: ROOT, stdio: quiet ? 'pipe' : 'inherit' });
}

export function distUrl(query = '') {
  return pathToFileURL(DIST).href + (query ? `?${query}` : '');
}

const GPU_ARGS = [
  '--use-angle=d3d11',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--disable-gpu-vsync',
  '--disable-frame-rate-limit',
  '--autoplay-policy=no-user-gesture-required',
];

export function isSoftware(name) {
  return /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(name || '');
}

async function probeRenderer(browser) {
  const page = await browser.newPage();
  const name = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'no-webgl2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  await page.close();
  return name;
}

// 헤드리스(새 모드)로 먼저 띄우고, 소프트웨어 렌더러면 창 모드로 다시 시도한다.
export async function launch({ width = 1280, height = 720, vsync = false } = {}) {
  const args = vsync ? GPU_ARGS.filter(a => !/vsync|frame-rate/.test(a)) : GPU_ARGS;
  const attempts = [
    { headless: true, channel: 'chromium', label: 'headless-new' },
    { headless: false, label: 'headed' },
  ];
  let last;
  for (const a of attempts) {
    const browser = await chromium.launch({ headless: a.headless, channel: a.channel, args: [...args, `--window-size=${width},${height + 90}`] });
    const renderer = await probeRenderer(browser);
    last = { browser, renderer, mode: a.label, software: isSoftware(renderer) };
    if (!last.software) break;
    if (a !== attempts[attempts.length - 1]) await browser.close();
  }
  const context = await last.browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  return { ...last, context };
}

export async function openGame(context, query, { onConsoleError, onExternal } = {}) {
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); onConsoleError?.(m.text()); } });
  page.on('pageerror', e => { errors.push(String(e)); onConsoleError?.(String(e)); });
  page.on('request', r => {
    const u = r.url();
    if (!/^(file|data|blob|about):/i.test(u)) { external.push(u); onExternal?.(u); }
  });
  await page.goto(distUrl(query));
  await page.waitForFunction(() => window.__bc && window.__bc.ready, null, { timeout: 120000 });
  return { page, errors, external };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// 테스트 진입 경로의 시작 버튼을 실제 마우스 클릭으로 누른다.
export async function clickStart(page) {
  await page.waitForSelector('#btn-start', { state: 'visible', timeout: 60000 });
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__bc.state().phase === 'playing', null, { timeout: 15000 });
}

// 마우스 상대 이동: 화면 중앙 근처에서 움직이고, 가장자리에 가까워지면 Alt를 누른 채 중앙으로 되돌린다(테스트 모드에서 Alt 이동은 무시된다).
export function makeMouse(page, width, height) {
  let x = width / 2, y = height / 2;
  return {
    async move(dx, dy) {
      const nx = x + dx, ny = y + dy;
      if (nx < 40 || nx > width - 40 || ny < 40 || ny > height - 40) {
        await page.keyboard.down('Alt');
        x = width / 2; y = height / 2;
        await page.mouse.move(x, y);
        await page.keyboard.up('Alt');
      }
      x += dx; y += dy;
      await page.mouse.move(x, y, { steps: 1 });
    },
    async click(button = 'left') { await page.mouse.down({ button }); await sleep(30); await page.mouse.up({ button }); },
    async down(button = 'left') { await page.mouse.down({ button }); },
    async up(button = 'left') { await page.mouse.up({ button }); },
    async center() { await page.keyboard.down('Alt'); x = width / 2; y = height / 2; await page.mouse.move(x, y); await page.keyboard.up('Alt'); },
  };
}

export function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// 자동 플레이 한 걸음: 디버그 상태를 읽고 실제 입력으로 조작한다.
export function makeAutoPilot(page, mouse) {
  const held = new Set();
  async function hold(code, on) {
    if (on && !held.has(code)) { held.add(code); await page.keyboard.down(code); }
    if (!on && held.has(code)) { held.delete(code); await page.keyboard.up(code); }
  }
  let lastFire = 0, aimSettle = 0;
  return {
    held,
    async releaseAll() { for (const c of [...held]) await hold(c, false); },
    async step(now) {
      const s = await page.evaluate(() => window.__bc.state());
      if (s.phase !== 'playing') { await this.releaseAll(); return s; }
      const p = s.player;
      const plan = await page.evaluate(() => window.__bc.autoplan());
      // plan: { mode:'engage'|'travel'|'idle', yaw, pitch, dist }
      const rpp = s.radPerPixel;
      const dyaw = angDiff(plan.yaw, p.gunYaw);
      const dpitch = plan.pitch - p.gunPitch;
      const k = plan.mode === 'engage' ? 0.55 : 0.35;
      let mx = Math.max(-140, Math.min(140, (-dyaw / rpp) * k));
      let my = Math.max(-90, Math.min(90, (-dpitch / rpp) * k));
      if (Math.abs(mx) > 0.5 || Math.abs(my) > 0.5) await mouse.move(mx, my);
      if (p.ammo === 0 && !p.reloading) { await page.keyboard.press('KeyR'); }
      if (plan.mode === 'engage') {
        await hold('KeyW', false); await hold('ShiftLeft', false);
        // 사선 확보를 위해 가끔 옆걸음
        await hold('KeyA', plan.strafe < 0); await hold('KeyD', plan.strafe > 0);
        const err = Math.hypot(dyaw, dpitch);
        if (err < Math.max(0.012, 0.35 / Math.max(plan.dist, 1))) aimSettle++; else aimSettle = 0;
        if (aimSettle >= 2 && plan.clear && now - lastFire > 160 && !p.reloading) { await mouse.click('left'); lastFire = now; }
      } else if (plan.mode === 'travel') {
        const bodyErr = Math.abs(angDiff(plan.yaw, p.yaw));
        await hold('KeyA', false); await hold('KeyD', false);
        await hold('KeyW', bodyErr < 0.6);
        await hold('ShiftLeft', bodyErr < 0.25 && plan.dist > 6);
      } else {
        await this.releaseAll();
      }
      return s;
    },
  };
}
