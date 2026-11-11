// 잿빛 훈련장 — 바디캠 스타일 1인칭 슈터
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { buildTextures } from './textures.js';
import { Level, FL } from './level.js';
import { FX } from './fx.js';
import { Viewmodel } from './weapons.js';
import { Player } from './player.js';
import { Bot, angDiff } from './bots.js';
import { Sound } from './audio.js';
import { Post } from './post.js';
import { OSD } from './osd.js';

const Q = new URLSearchParams(location.search);
const TEST = Q.get('test') === '1';
const SEED = +(Q.get('seed') || 1);
const VIEW = Q.has('view') ? +Q.get('view') : null;
const TOUR = Q.get('tour') === '1';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const $ = (id) => document.getElementById(id);

// ---------------- 입력 (event.code 기준) ----------------
class Input {
  constructor(canvas) {
    this.down = new Set(); this.edge = new Set(); this.dx = 0; this.dy = 0; this.lmb = false; this.rmb = false; this.wheel = 0;
    this.lastX = null; this.lastY = null; this.virtual = null;
    addEventListener('keydown', (e) => {
      if (!e.code) return;
      if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.edge.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => { this.down.delete(e.code); });
    addEventListener('blur', () => { this.down.clear(); this.lmb = this.rmb = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) { this.dx += e.movementX; this.dy += e.movementY; return; }
      if (!TEST) return;
      // 테스트 진입 경로: 포인터 잠금 없이 커서 이동량을 쓴다. Alt를 누른 이동은 커서 되돌리기라 무시.
      if (this.lastX !== null && !e.altKey) { this.dx += e.clientX - this.lastX; this.dy += e.clientY - this.lastY; }
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('.screen')) return; if (e.button === 0) this.lmb = true; if (e.button === 2) this.rmb = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.lmb = false; if (e.button === 2) this.rmb = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }
  key(c) { if (this.virtual && this.virtual.keys?.has(c)) return true; return this.down.has(c); }
  pressed(c) { return this.edge.has(c); }
  endFrame() { this.edge.clear(); this.dx = 0; this.dy = 0; this.wheel = 0; }
}

// ---------------- 설정 ----------------
const DEFAULTS = { sens: 1.0, shake: 1.0, blur: 1.0, quality: 'high' };
function loadSettings() {
  let s = { ...DEFAULTS };
  try { const j = JSON.parse(localStorage.getItem('bc-settings') || '{}'); s = { ...s, ...j }; } catch (e) {}
  if (Q.get('quality')) s.quality = Q.get('quality');
  return s;
}
function saveSettings(s) { try { localStorage.setItem('bc-settings', JSON.stringify(s)); } catch (e) {} }
const SCALE = { high: 1.0, medium: 0.8, low: 0.62 };

// ---------------- 하늘 ----------------
function makeSky() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `varying vec3 vDir; uniform float uTime;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.1; a*=.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float up = clamp(d.y, -0.2, 1.0);
        vec3 horizon = vec3(2.5, 2.55, 2.6), zenith = vec3(1.75, 1.82, 1.95);
        vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.7, up));
        vec2 uv = d.xz / max(d.y + 0.15, 0.05) * 0.6 + uTime * 0.004;
        float cl = fbm(uv * 1.3);
        c *= 0.82 + 0.3 * cl;
        // 해가 있는 쪽이 조금 밝은 흐린 하늘
        vec3 sunDir = normalize(vec3(-0.6, 0.25, 0.75));
        c += vec3(1.0, 0.95, 0.85) * pow(max(dot(d, sunDir), 0.0), 6.0) * 1.2;
        c = mix(vec3(1.6, 1.6, 1.6), c, smoothstep(-0.1, 0.05, d.y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), m);
  s.frustumCulled = false; s.renderOrder = -1;
  return s;
}

// ---------------- 게임 ----------------
class Game {
  constructor() {
    this.canvas = $('view');
    this.settings = loadSettings();
    this.rng = mulberry32(SEED);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xb4b8bb, 0.0085);
    this.camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.04, 420);
    this.input = new Input(this.canvas);
    this.osd = new OSD($('osd'), SEED);
    this.phase = 'loading';
    this.stats = { shotsFired: 0, hits: 0, botShots: 0, playerHits: 0, deaths: 0, kills: 0 };
    this.events = [];
    this.time = 0; this.playTime = 0; this.lastDt = 1 / 60;
    this.perf = null;
    this.hitFx = 0; this.flash = 0; this.deadFade = 0;
    this.distance = 0;
    window.__bc = this.api();
  }

  setLoad(p, msg) { $('load-fill').style.width = `${Math.round(p * 100)}%`; if (msg) $('load-msg').textContent = msg; }

  async load() {
    const T = { concrete: '콘크리트 바닥', plaster: '회반죽 벽', ceiling: '천장 타일', block: '블록 외벽', asphalt: '아스팔트', gravel: '자갈', corrugated: '골판 강판', plywood: '합판', linoleum: '리놀륨', cardboard: '종이 상자', locker: '사물함', fabric: '천', chainlink: '철망', holes: '탄흔', puff: '먼지', weeds: '잡초', sign: '안내판', plywoodB: '합판', plywoodC: '합판', flash: '총구 화염', stain: '얼룩', paper: '서류' };
    this.tex = await buildTextures(SEED, (p, k) => this.setLoad(p * 0.45, `재질 만드는 중: ${T[k] || k}`));
    this.sound = new Sound(SEED);
    await this.sound.generate((p) => this.setLoad(0.45 + p * 0.35, '소리 합성 중: 총성, 발소리, 공간 잔향'));
    this.setLoad(0.82, '건물과 마당 짓는 중');
    await new Promise(r => setTimeout(r, 0));
    this.level = new Level(this.tex, SEED, this.settings.quality);
    this.scene.add(this.level.group);
    this.sky = makeSky(); this.scene.add(this.sky);
    this.hemi = new THREE.HemisphereLight(0xdfe4ea, 0x6a665c, 6.2);
    this.scene.add(this.hemi);
    // 흐린 하늘 반사용 환경맵 (실내에서는 셰이더가 줄인다)
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = makeSky(); envScene.add(envSky);
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(250, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a3833 })); gnd.position.y = -2; envScene.add(gnd);
    this.scene.environment = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();
    this.flashLight = new THREE.PointLight(0xffb36a, 0, 10, 1.8); this.scene.add(this.flashLight);
    this.botFlashLight = new THREE.PointLight(0xffb36a, 0, 9, 1.8); this.scene.add(this.botFlashLight);
    this.fx = new FX(this.scene, this.tex, this.level, this.rng);
    this.fx.onCasingLand = (pos, mat, b) => this.sound.play('tink_' + (mat === 'metal' ? 'metal' : (mat === 'gravel' || mat === 'water') ? 'gravel' : 'concrete'), { gain: 0.16 / (b + 1), send: 0.15 });
    this.vm = new Viewmodel(this.scene, this.rng);
    this.player = new Player(this.level, this.rng);
    this.setLoad(0.9, '훈련 상대 배치 중');
    const B = [
      { spawn: [-15.5, 2.6, Math.PI * 0.9], patrol: [[-13, 3.0], [-16, 10.5], [-12, 12], [-20, 4]], role: 'hold' },
      { spawn: [8, -2.6, 0.2], patrol: [[8, -2.6], [5.5, -2.8], [10, -0.8], [8, -4.3]], role: 'hold' },
      { spawn: [-6, -11.4, -0.6], patrol: [[-6, -11.4], [-2, -13.6], [-10, -12.2], [-6, -9.5]], role: 'flank' },
      { spawn: [6.2, -12.3, 1.8], patrol: [[6.2, -12.3], [9.8, -13], [8, -9.5], [6.2, -14.6]], role: 'flank' },
    ];
    this.bots = B.map((b, i) => new Bot(this, i, b.spawn, b.patrol, b.role));
    this.post = new Post(this.renderer);
    this.resize();
    addEventListener('resize', () => this.resize());
    this.setLoad(0.96, '셰이더 준비 중');
    this.applyQuality();
    this.reset();
    await new Promise(r => setTimeout(r, 0));
    this.renderer.compile(this.scene, this.camera);
    this.setLoad(1, '준비 완료');
    this.bindUI();
    this.phase = 'menu';
    $('loading').classList.remove('on'); $('menu').classList.add('on');
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    window.__bc.ready = true;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h, SCALE[this.settings.quality] || 1);
    if (this.post) this.post.aoEnabled = this.settings.quality !== 'low';
    this.osd.resize(w, h);
  }
  applyQuality() {
    this.level?.setQuality(this.settings.quality);
    this.resize();
  }

  bindUI() {
    const S = this.settings;
    const sync = () => {
      $('set-sens').value = S.sens; $('val-sens').textContent = (+S.sens).toFixed(2);
      $('set-shake').value = S.shake; $('val-shake').textContent = Math.round(S.shake * 100) + '%';
      $('set-blur').value = S.blur; $('val-blur').textContent = Math.round(S.blur * 100) + '%';
      $('set-quality').value = S.quality;
    };
    sync();
    $('set-sens').oninput = (e) => { S.sens = +e.target.value; sync(); saveSettings(S); };
    $('set-shake').oninput = (e) => { S.shake = +e.target.value; sync(); saveSettings(S); };
    $('set-blur').oninput = (e) => { S.blur = +e.target.value; sync(); saveSettings(S); };
    $('set-quality').onchange = (e) => { S.quality = e.target.value; sync(); saveSettings(S); this.applyQuality(); };
    let back = 'menu';
    const show = (id) => { for (const s of ['menu', 'pause', 'settings', 'end']) $(s).classList.toggle('on', s === id); };
    $('btn-settings').onclick = () => { back = 'menu'; show('settings'); };
    $('btn-settings2').onclick = () => { back = 'pause'; show('settings'); };
    $('btn-settings-back').onclick = () => show(back);
    $('btn-start').onclick = () => this.startPlay();
    $('btn-resume').onclick = () => this.startPlay(true);
    $('btn-quit').onclick = () => { this.reset(); this.phase = 'menu'; show('menu'); };
    $('btn-restart').onclick = () => { this.reset(); this.startPlay(); };
    this.show = show;
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas && this.phase === 'playing' && !TEST) this.pause();
    });
  }

  async startPlay(resume = false) {
    this.show(null);
    if (!TEST) { try { await this.canvas.requestPointerLock({ unadjustedMovement: true }); } catch (e) { try { await this.canvas.requestPointerLock(); } catch (e2) {} } }
    await this.sound.start();
    if (!resume && this.phase !== 'paused') { this.post.resetExposure(); }
    this.phase = 'playing';
    this.input.down.clear(); this.input.lmb = this.input.rmb = false;
  }
  pause() { if (this.phase !== 'playing') return; this.phase = 'paused'; this.show('pause'); this.sound.ctx?.suspend(); }

  reset() {
    this.fx?.clear();
    this.events = [];
    for (const b of this.bots) b.reset();
    this.vm.reset();
    this.playTime = 0; this.stats.kills = 0; this.wonAt = null; this.deadAt = null; this.deadFade = 0;
    const v = VIEW !== null ? VIEWS[VIEW] : null;
    if (v) {
      this.player.spawn(v.pos[0], v.pos[1], v.yaw, v.pitch || 0);
      for (const b of this.bots) b.dormant = 'idle';
      if (v.bot) { const b = this.bots[v.bot.i]; b.pos.set(v.bot.pos[0], b.pos.y, v.bot.pos[1]); b.pos.y = this.level.insideBuilding(b.pos.x, b.pos.z) ? FL : 0; b.yaw = b.aimYaw = b.lookYaw = v.bot.yaw; b.dormant = v.bot.active ? null : 'idle'; if (v.bot.active) { b.alerted = true; } }
      if (v.weapon) this.vm.setWeapon(v.weapon);
    } else {
      this.player.spawn(0, 24.5, 0, -0.05);
      if (TOUR) for (const b of this.bots) b.dormant = 'walk';
    }
    this.tourI = 0;
    this.post?.resetExposure();
  }

  // ---------------- 사격 ----------------
  playerShot() {
    const vm = this.vm, p = this.player, r = this.rng;
    const def = vm.def;
    const origin = vm.muzzleWorld.clone();
    const dir = vm.dirWorld.clone();
    const spread = def.spread * (1 + (1 - vm.ads) * 0.8 + Math.hypot(p.vel.x, p.vel.z) * 0.25);
    dir.x += r.gauss() * spread; dir.y += r.gauss() * spread; dir.z += r.gauss() * spread; dir.normalize();
    // 몸에서 총구까지 벽이 있으면 그 벽에 맞는다
    const chest = V(p.pos.x, p.eyeSmooth + p.eyeHeight - 0.05, p.pos.z);
    const toM = origin.clone().sub(chest); const lm = toM.length();
    let start = origin;
    const block = this.level.raycast(chest, toM.normalize(), lm, true);
    if (block) start = chest;
    const hitL = this.level.raycast(start, dir, 200);
    let best = null, bestBot = null;
    for (const b of this.bots) { const h = b.hitTest(start, dir, hitL ? hitL.dist : 200); if (h && (!best || h.dist < best.dist)) { best = h; bestBot = b; } }
    this.stats.shotsFired++;
    const now = this.time;
    if (bestBot) {
      this.stats.hits++;
      const killed = bestBot.damage(best.part, dir, best.point, now);
      this.fx.impact(best.point, dir.clone().negate(), 'body', dir);
      this.sound.play('bodyHit', { pos: best.point, listener: this.listener(), gain: 0.5, zone: this.level.zoneAt(best.point.x, best.point.z) });
      if (killed) { this.stats.kills++; }
    } else if (hitL) {
      this.fx.hole(hitL.point, hitL.normal, hitL.mat);
      this.fx.impact(hitL.point, hitL.normal, hitL.mat, dir);
      const im = { metal: 'metal', wood: 'wood', gravel: 'gravel', water: 'gravel', cloth: 'gravel', rubber: 'gravel', fence: 'metal' }[hitL.mat] || 'concrete';
      this.sound.play('impact_' + im, { pos: hitL.point, listener: this.listener(), gain: 0.55, zone: this.level.zoneAt(hitL.point.x, hitL.point.z), occluded: hitL.dist > 3 && !this.level.lineClear(chest, hitL.point.clone().addScaledVector(hitL.normal, 0.1)) });
    }
    // 봇: 총성 듣기, 탄이 가까이 지나가면 제압
    for (const b of this.bots) {
      if (!b.alive) continue;
      b.hear(p.pos, 45, now);
      const c = b.chest; const t = c.clone().sub(start).dot(dir);
      if (t > 0) { const d = start.clone().addScaledVector(dir, t).distanceTo(c); if (d < 1.6) b.suppressed = now; }
    }
    // 총구 화염, 탄피, 반동, 소리
    this.fx.muzzleFlash(origin, dir, vm.current === 'rifle' ? 0.55 : 0.4);
    this.flashLight.position.copy(origin).addScaledVector(dir, 0.15);
    this.flashLight.intensity = 5 + r() * 5; this.flashT = 0.03;
    this.flash = 1;
    vm.ejectCasing(this.fx, p.vel);
    p.shotKick(this.settings.shake * (vm.current === 'rifle' ? 1 : 0.8));
    // 총이 위로 튀며 조준이 조금 올라간다
    p.aimPitch += (0.009 + r() * 0.009) * def.recoil * (1 - vm.ads * 0.3);
    p.aimYaw += (r() - 0.5) * 0.014 * def.recoil;
    vm.stress = Math.min(1, vm.stress + 0.08);
    this.sound.play(vm.current === 'rifle' ? 'rifle' : 'pistol', { gain: vm.current === 'rifle' ? 1.75 : 1.5, send: 0.5 });
    this.sound.duck(0.15, 1.6);
  }

  botShot(bot, m, dir) {
    const p = this.player, r = this.rng;
    this.stats.botShots++;
    const hitL = this.level.raycast(m, dir, 150);
    const maxD = hitL ? hitL.dist : 150;
    // 플레이어 원기둥과의 교차
    let hitP = false;
    if (p.alive) {
      const a = V(p.pos.x, p.pos.y + 0.15, p.pos.z), b = V(p.pos.x, p.pos.y + 1.7 - p.crouch * 0.5, p.pos.z);
      const res = rayCapsule(m, dir, a, b, 0.3);
      if (res !== null && res < maxD) hitP = true;
      // 근접 통과음
      const c = V(p.pos.x, p.pos.y + 1.4, p.pos.z); const t = c.clone().sub(m).dot(dir);
      if (!hitP && t > 0 && t < maxD) { const d = m.clone().addScaledVector(dir, t).distanceTo(c); if (d < 2.2) this.sound.play('snap', { gain: 0.55 * (1 - d / 2.4), send: 0.2 }); }
    }
    if (hitP) {
      this.stats.playerHits++;
      p.hp -= 36 + r() * 8;
      p.hit(dir);
      this.hitFx = 1;
      this.sound.play('bodyHit', { gain: 1.0, send: 0.1 });
      this.sound.duck(0.2, 1.2);
      if (p.hp <= 0 && p.alive) { p.die(this.rng); this.deadAt = this.time; this.stats.deaths++; }
    } else if (hitL) {
      this.fx.hole(hitL.point, hitL.normal, hitL.mat);
      this.fx.impact(hitL.point, hitL.normal, hitL.mat, dir);
      const dl = hitL.point.distanceTo(p.pos);
      if (dl < 25) this.sound.play('impact_' + ({ metal: 'metal', wood: 'wood', gravel: 'gravel' }[hitL.mat] || 'concrete'), { pos: hitL.point, listener: this.listener(), gain: 0.5, zone: this.level.zoneAt(hitL.point.x, hitL.point.z) });
    }
    this.fx.muzzleFlash(m, dir, 0.9);
    this.botFlashLight.position.copy(m); this.botFlashLight.intensity = 30; this.botFlashT = 0.035;
    const L = this.listener();
    const occ = !this.level.lineClear(V(p.pos.x, p.pos.y + 1.4, p.pos.z), m);
    const d = this.sound.play('rifle', { pos: m, listener: L, gain: 2.2, zone: this.level.zoneAt(m.x, m.z), occluded: occ, send: 0.6 });
    if (d !== undefined && d < 6) this.sound.duck(0.35, 1.0);
    for (const b of this.bots) if (b !== bot) b.hear(m, 30, this.time);
  }

  listener() { return { pos: this.camera.position, yaw: this.player.bodyYaw }; }

  // ---------------- 갱신 ----------------
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.last) / 1000; this.last = now;
    if (this.perf) this.perf.frames.push(dt * 1000);
    dt = Math.min(dt, 0.05);
    this.lastDt = dt;
    this.time += dt;
    if (this.phase === 'playing') this.update(dt);
    this.renderFrame(dt);
    this.input.endFrame();
  }

  update(dt) {
    const p = this.player, vm = this.vm, inp = this.input, S = this.settings;
    this.playTime += dt;
    if (TOUR) this.tourDrive(dt);
    // 입력 → 무기
    if (p.alive) {
      if (inp.pressed('Escape') && TEST) this.pause();
      if (inp.pressed('KeyR')) vm.startReload();
      if (inp.pressed('Digit1')) vm.requestSwitch('rifle');
      if (inp.pressed('Digit2')) vm.requestSwitch('pistol');
      if (inp.wheel) vm.requestSwitch(vm.current === 'rifle' ? 'pistol' : 'rifle');
      vm.triggerHeld = inp.lmb;
    } else vm.triggerHeld = false;
    const prevPos = p.pos.clone();
    p.update(dt, this.time, inp, S, vm);
    this.distance += prevPos.distanceTo(p.pos);
    const ct = p.cameraTransform(this.time, S);
    this.camera.position.copy(ct.pos); this.camera.quaternion.copy(ct.quat);
    // 벽까지 거리 (총 내리기)
    const aq = p.aimQuat(this.time);
    const aimDir = V(0, 0, -1).applyQuaternion(aq);
    const wh = this.level.raycast(ct.pos, aimDir, 1.2, true);
    let wallDist = wh ? wh.dist : 2;
    for (const b of this.bots) if (b.alive) { const h = b.hitTest(ct.pos, aimDir, 1.0); if (h) wallDist = Math.min(wallDist, h.dist + 0.2); }
    vm.update(dt, this.time, {
      anchor: ct.pos, aimQuat: aq, ads: inp.rmb && p.alive, sprint: p.sprinting ? 1 : 0, wallDist,
      camYawVel: p.yawVel, camPitchVel: p.pitchVel, exertion: p.exertion, moving: p.moving, stepPhase: p.stepPhaseFrac || 0, roll: ct.roll, level: this.level,
    });
    if (p.alive && vm.tryFire(dt, true)) this.playerShot();
    if (inp.pressed('KeyR') && vm.ammo === 0 && !vm.reload) vm.startReload();
    // 봇
    for (const b of this.bots) b.update(dt, this.time);
    this.level.update(this.time, dt);
    this.fx.cameraQuat = this.camera.quaternion;
    this.fx.update(dt);
    // 이벤트 → 소리
    this.handleEvents();
    // 승패
    if (!p.alive && this.deadAt !== null && this.time - this.deadAt > 2.4) { this.reset(); this.post.resetExposure(); }
    if (this.wonAt == null && this.bots.every(b => !b.alive)) this.wonAt = this.time;
    if (this.wonAt != null && this.time - this.wonAt > 2.8 && VIEW === null && !TOUR) this.win();
    // 소리 갱신
    this.sound.update(dt, { zone: this.level.zoneAt(p.pos.x, p.pos.z), yawVel: p.yawVel, speed: Math.hypot(p.vel.x, p.vel.z), exertion: p.exertion });
  }

  handleEvents() {
    const p = this.player, L = this.listener();
    for (const e of p.events) {
      if (e.type === 'step') {
        const g = (e.sprint ? 0.6 : 0.42) * (1 - e.crouch * 0.5);
        this.sound.play('step_' + e.mat, { gain: g, send: 0.25 });
        if (this.rng() < (e.sprint ? 0.9 : 0.55)) this.sound.play('rustle', { gain: e.sprint ? 0.22 : 0.12, send: 0.1, delay: this.rng() * 0.05 });
        // 플레이어 발소리를 봇이 듣는다
        for (const b of this.bots) b.hear(p.pos, e.sprint ? 10 : e.crouch > 0.5 ? 2 : 4.5, this.time);
      } else if (e.type === 'land') { this.sound.play('step_' + e.mat, { gain: 0.5 + e.strength * 0.3, send: 0.25 }); this.sound.play('rustle', { gain: 0.25 }); }
      else if (e.type === 'death') { this.sound.play('bodyFall', { gain: 0.9, send: 0.3, delay: 0.5 }); }
    }
    p.events.length = 0;
    for (const e of this.vm.events) {
      const map = { reloadStart: ['rustle', 0.2], magOut: ['magOut', 0.5], magIn: ['magIn', 0.6], charge: ['charge', 0.6], dry: ['dry', 0.45], switch: ['rustle', 0.3] };
      if (map[e.type]) this.sound.play(map[e.type][0], { gain: map[e.type][1], send: 0.2 });
      if (e.type === 'switch') this.sound.play('magIn', { gain: 0.15, send: 0.1, delay: 0.15 });
      if (e.type === 'magDrop') this.sound.play('tink_' + (e.mat === 'metal' ? 'metal' : e.mat === 'gravel' || e.mat === 'water' ? 'gravel' : 'concrete'), { gain: 0.35, rate: 0.55, send: 0.2 });
    }
    this.vm.events.length = 0;
    for (const e of this.events) {
      if (e.type === 'botStep') { const d = e.pos.distanceTo(p.pos); if (d < 22) this.sound.play('step_' + e.mat, { pos: e.pos, listener: L, gain: 0.5, zone: this.level.zoneAt(e.pos.x, e.pos.z), occluded: !this.level.lineClear(this.camera.position, e.pos.clone().add(V(0, 0.4, 0))) }); }
      if (e.type === 'botDown') this.sound.play('bodyFall', { pos: e.pos, listener: L, gain: 0.9, zone: this.level.zoneAt(e.pos.x, e.pos.z) });
    }
    this.events.length = 0;
  }

  win() {
    this.phase = 'won';
    const t = this.playTime, m = Math.floor(t / 60), s = Math.floor(t % 60);
    $('end-text').innerHTML = `상대 네 명을 모두 제압했습니다.<br>소요 시간 ${m}분 ${s}초 · 발사 ${this.stats.shotsFired}발 · 피격 ${this.stats.playerHits}회`;
    this.show('end');
    if (!TEST) document.exitPointerLock?.();
  }

  renderFrame(dt) {
    const P = this.post.params, p = this.player;
    if (this.phase !== 'playing' && this.phase !== 'paused' && this.phase !== 'won') {
      // 메뉴 뒤 배경: 시작 위치의 정지 화면
      const ct = p.cameraTransform(this.time, this.settings);
      this.camera.position.copy(ct.pos); this.camera.quaternion.copy(ct.quat);
      for (const b of this.bots) b.render();
    }
    this.flashT = (this.flashT || 0) - dt; if (this.flashT <= 0) this.flashLight.intensity = 0;
    this.botFlashT = (this.botFlashT || 0) - dt; if (this.botFlashT <= 0) this.botFlashLight.intensity = 0;
    this.sky.position.copy(this.camera.position);
    this.sky.material.uniforms.uTime.value = this.time;
    // 후처리 매개변수
    const S = this.settings;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const shutter = Math.min(1, dt * 30);
    P.blurVec.set(-p.yawVel * 0.016 * shutter, p.pitchVel * 0.022 * shutter);
    // 흔들림 속도도 번짐에 반영
    P.blurVec.x += -p.camShake.v.y * 0.0006; P.blurVec.y += p.camShake.v.x * 0.0006;
    if (P.blurVec.length() > 0.05) P.blurVec.setLength(0.05);
    P.zoomBlur = Math.min(0.012, speed * 0.0018) * shutter;
    P.blur = S.blur;
    P.flash = this.flash; this.flash = Math.max(0, this.flash - dt * 30);
    this.hitFx = Math.max(0, this.hitFx - dt * 2.5); P.hit = this.hitFx;
    P.rim.set(Math.sin(p.camShake.x.y * 0.02) * 0.02 * S.shake, -p.camShake.x.x * 0.0004 * S.shake);
    this.deadFade = !p.alive ? Math.min(1, this.deadFade + dt * 0.5) : Math.max(0, this.deadFade - dt * 2);
    P.dead = this.deadFade;
    P.q = Math.min(1, 0.12 + P.blurVec.length() * 25 + speed * 0.04);
    P.key = 0.26;
    this.post.render(this.scene, this.camera, dt);
    this.osd.draw(this.playTime, true);
  }

  // ---------------- 성능 측정용 순회 ----------------
  tourDrive(dt) {
    const route = [[0, 16], [-7.5, 3.6], [-7.5, -0.9], [-9, -4.3], [-9, -5.8], [-8, -7.4], [-6, -9.5], [-2, -13.6], [3.7, -11], [5.3, -11], [8, -9.5], [8, -7.4], [8, -5.8], [8, -4.3], [8, -0.4], [8, 1.0], [6, 1.6], [3.3, 1.8], [0, 8], [-8, 8], [-12, 12], [0, 16]];
    const p = this.player, tgt = route[this.tourI % route.length];
    const dx = tgt[0] - p.pos.x, dz = tgt[1] - p.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.8) this.tourI++;
    const want = Math.atan2(-dx, -dz);
    const err = angDiff(want, p.aimYaw);
    this.input.dx += -err * 6 / (0.0021 * this.settings.sens);
    this.input.dx = Math.max(-40, Math.min(40, this.input.dx));
    this.input.virtual = { keys: new Set(Math.abs(err) < 0.7 ? ['KeyW'] : []) };
  }

  // ---------------- 테스트·측정 API (읽기 전용 + 측정) ----------------
  api() {
    const g = this;
    return {
      ready: false,
      state() {
        const p = g.player, vm = g.vm;
        if (!p) return { phase: g.phase };
        const d = vm.dirWorld;
        return {
          phase: g.phase, kills: g.bots.filter(b => !b.alive).length,
          player: { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.bodyYaw, pitch: p.camPitch, gunYaw: Math.atan2(-d.x, -d.z), gunPitch: Math.asin(Math.max(-1, Math.min(1, d.y))), hp: p.hp, alive: p.alive, weapon: vm.current, ammo: vm.ammo, reloading: !!vm.reload, crouch: p.crouch },
          bots: g.bots.map(b => ({ x: b.pos.x, y: b.pos.y, z: b.pos.z, alive: b.alive, state: b.state })),
          stats: { ...g.stats }, radPerPixel: 0.0021 * g.settings.sens * (1 - vm.ads * 0.35),
          renderer: (() => { const gl = g.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''; })(),
        };
      },
      // 자동 플레이 도우미: 다음 목표 방향만 계산한다 (조작은 실제 입력으로)
      autoplan() {
        const p = g.player, vm = g.vm, L = g.level;
        if (!p.alive) return { mode: 'idle' };
        const m = vm.muzzleWorld.clone();
        const eye = g.camera.position.clone();
        const alive = g.bots.filter(b => b.alive);
        if (!alive.length) return { mode: 'idle' };
        let best = null;
        for (const b of alive) {
          const dist = b.pos.distanceTo(p.pos);
          if (dist > 45) continue;
          for (const [pt, kind] of [[b.chest, 'chest'], [b.headPos, 'head']]) {
            if (L.lineClear(eye, pt) && L.lineClear(m, pt)) { if (!best || dist < best.dist) best = { b, pt, dist, kind }; break; }
          }
        }
        if (best) {
          const d = best.pt.clone().sub(m);
          const dir = d.clone().normalize();
          const hl = L.raycast(m, dir, d.length() + 0.5);
          return { mode: 'engage', yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), dist: best.dist, clear: !hl || hl.dist > d.length() - 0.3, strafe: 0, bot: best.b.idx };
        }
        // 이동: 가장 가까운 봇까지의 경로
        alive.sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
        const tgt = alive[0];
        const start = L.nearestNode(p.pos.x, p.pos.z, p.pos.y), goal = L.nearestNode(tgt.pos.x, tgt.pos.z, tgt.pos.y, false);
        const path = start && goal ? L.path(start, goal) : null;
        let wp = path && path.length ? path[0] : { x: tgt.pos.x, z: tgt.pos.z, y: tgt.pos.y };
        if (path) for (let i = Math.min(path.length - 1, 3); i >= 0; i--) { const n = path[i]; if (L.walkable({ x: p.pos.x, y: p.pos.y, z: p.pos.z }, n)) { wp = n; break; } }
        if (Math.hypot(wp.x - p.pos.x, wp.z - p.pos.z) < 0.4 && path && path[1]) wp = path[1];
        // 막힘 감지
        g._stuck = g._stuck || { t: g.time, x: p.pos.x, z: p.pos.z, side: 0 };
        if (g.time - g._stuck.t > 1.5) { const mv = Math.hypot(p.pos.x - g._stuck.x, p.pos.z - g._stuck.z); g._stuck = { t: g.time, x: p.pos.x, z: p.pos.z, side: mv < 0.4 ? (Math.random() < 0.5 ? -1 : 1) : 0 }; }
        const dx = wp.x - p.pos.x, dz = wp.z - p.pos.z;
        return { mode: g._stuck.side ? 'engage' : 'travel', yaw: Math.atan2(-dx, -dz), pitch: -0.08, dist: Math.hypot(dx, dz), clear: false, strafe: g._stuck.side };
      },
      perfStart() { g.perf = { frames: [], t0: performance.now(), d0: g.distance }; },
      perfStop() { const r = g.perf; g.perf = null; return { frames: r.frames.slice(2), seconds: (performance.now() - r.t0) / 1000, renderScale: SCALE[g.settings.quality], canvas: `${innerWidth}x${innerHeight}`, distance: g.distance - r.d0 }; },
      async audioTest() { return g.sound.offlineStats(); },
    };
  }
}

// 광선-캡슐 교차 (거리 반환, 없으면 null)
function rayCapsule(o, d, a, b, r) {
  const ab = b.clone().sub(a), ao = o.clone().sub(a);
  let best = null;
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const c = a.clone().addScaledVector(ab, i / steps);
    const oc = o.clone().sub(c); const bb = oc.dot(d); const cc = oc.lengthSq() - r * r; const disc = bb * bb - cc;
    if (disc < 0) continue;
    const t = -bb - Math.sqrt(disc);
    if (t > 0 && (best === null || t < best)) best = t;
  }
  return best;
}

// 스크린샷용 고정 시점 (테스트 진입 경로 전용)
const VIEWS = [
  { pos: [6, 20], yaw: 0.22, pitch: 0.02 },
  { pos: [-6.6, 6.2], yaw: 0.12, pitch: 0.06 },
  { pos: [-11, -5.8], yaw: -Math.PI / 2, pitch: 0.0 },
  { pos: [2, -8.0], yaw: 1.0, pitch: 0.14 },
  { pos: [3.2, -0.8], yaw: 1.07, pitch: 0.06 },
  { pos: [1.2, 5.8], yaw: -0.84, pitch: -0.02 },
  { pos: [-7.5, -3.2], yaw: Math.PI, pitch: 0.02 },
  { pos: [8, -5.6], yaw: Math.PI, pitch: -0.02, bot: { i: 1, pos: [8.7, -2.0], yaw: -1.9 } },
  { pos: [0, -7.2], yaw: 0, pitch: 0, bot: { i: 2, pos: [-2, -12.5], yaw: -2.78, active: true } },
];

const game = new Game();
game.load().catch((e) => { console.error(e); $('load-msg').textContent = '불러오기 실패: ' + e.message; });
