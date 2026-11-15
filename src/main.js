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
import { Post, OVERSCAN } from './post.js';
import { ScopeView } from './scope.js';
import { OSD } from './osd.js';
import { bakeLight, skyGain, volUniforms, probeLight } from './lightbake.js';
import { bcMaterial, setBodyArms } from './materials.js';

const Q = new URLSearchParams(location.search);
const TEST = Q.get('test') === '1';
// 수동 시계(테스트 촬영 전용): 게임 시간이 __bc.step()으로만 흐른다. 같은 빌드가 매번 같은 화면을 내게 하려는 것이다.
const MANUAL = TEST && Q.get('clock') === 'manual';
const SEED = +(Q.get('seed') || 1);
const VIEW = Q.has('view') ? +Q.get('view') : null;
const TOUR = Q.get('tour') === '1';
// 살펴보기용 임의 시점(테스트 진입 경로 전용): ?vp=x,z,yaw,pitch
const VP = TEST && Q.get('vp') ? Q.get('vp').split(',').map(Number) : null;
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
    uniforms: { uTime: { value: 0 }, uGain: { value: skyGain } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `varying vec3 vDir; uniform float uTime; uniform float uGain;
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
        // 밝기 배율은 빛 굽기(lightbake.js)의 하늘빛과 같은 값을 쓴다. 보이는 하늘과 그 하늘이 비추는 땅의 비율을 맞추려는 것이다
        gl_FragColor = vec4(c * uGain, 1.0);
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
    this.scene.fog = new THREE.FogExp2(new THREE.Color(0xb4b8bb).multiplyScalar(skyGain), 0.0085);   // 안개는 하늘빛이 흩어진 것이라 하늘 밝기를 따른다
    // 세로 화각 80도. 렌즈 패스가 화면 밖을 읽을 수 있도록 OVERSCAN배 넓게 그린다(post.js)
    this.camera = new THREE.PerspectiveCamera(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(40)) * OVERSCAN) * 180 / Math.PI, 16 / 9, 0.04, 420);
    this.input = new Input(this.canvas);
    this.osd = new OSD($('osd'), SEED, TEST);
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
    // 하늘빛과 반사광은 조도 볼륨이 맡는다(lightbake.js). 환경맵은 하늘이 비치는 반사에만 쓴다
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = makeSky(); envScene.add(envSky);
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(250, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.42 * skyGain, 0.4 * skyGain, 0.36 * skyGain) })); gnd.position.y = -2; envScene.add(gnd);
    this.scene.environment = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();
    // 총구 화염의 점광원 두 개는 FX가 만든다(형광등 뒤에 놓여야 가시도 채널이 없다)
    this.fx = new FX(this.scene, this.tex, this.level, this.rng);
    this.fx.cameraPos = this.camera.position;
    this.fx.onCasingLand = (pos, mat, b) => this.sound.play('tink_' + (mat === 'metal' ? 'metal' : (mat === 'gravel' || mat === 'water') ? 'gravel' : 'concrete'), { gain: 0.16 / (b + 1), send: 0.15 });
    this.vm = new Viewmodel(this.scene, this.rng);
    this.player = new Player(this.level, this.rng);
    this.setLoad(0.88, '훈련 상대 배치 중');
    const B = [
      { spawn: [-15.5, 2.6, Math.PI * 0.9], patrol: [[-13, 3.0], [-16, 10.5], [-12, 12], [-20, 4]], role: 'hold' },
      { spawn: [8, -2.6, 0.2], patrol: [[8, -2.6], [5.5, -2.8], [10, -0.8], [8, -4.3]], role: 'hold' },
      { spawn: [-6, -11.4, -0.6], patrol: [[-6, -11.4], [-2, -13.6], [-10, -12.2], [-6, -9.5]], role: 'flank' },
      { spawn: [6.2, -12.3, 1.8], patrol: [[6.2, -12.3], [9.8, -13], [8, -9.5], [6.2, -14.6]], role: 'flank' },
    ];
    this.bots = B.map((b, i) => new Bot(this, i, b.spawn, b.patrol, b.role));
    this.post = new Post(this.renderer);
    this.scope = new ScopeView(this.renderer);   // 소총 조준경 안의 상(조준할 때만 그린다)
    // 빛 굽기: 하늘빛 가시도, 형광등 그림자, 반사광을 한 번 계산한다
    this.setLoad(0.9, '빛 계산 중: 하늘빛');
    await new Promise(r => setTimeout(r, 0));
    this.bake = await bakeLight(this.renderer, {
      casters: this.level.casters, nearCasters: this.level.nearCasters, occ: this.level.occ, lights: this.level.bakeLights(),
      onProgress: (p, k) => this.setLoad(0.9 + p * 0.06, `빛 계산 중: ${k}`),
    });
    this.level.lightBaked = this.bake.ok;
    if (TEST && Q.get('clay') === '1') volUniforms.uClay.value = 1;
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
    if (MANUAL) this.tick(1 / 60); else requestAnimationFrame((t) => this.frame(t));
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
    this.scope?.setQuality(this.settings.quality);
    this.fx?.setQuality(this.settings.quality);
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
    this.threatSince = null; this.threat = false; this.threatT = 0;
    this.playTime = 0; this.stats.kills = 0; this.wonAt = null; this.deadAt = null; this.deadFade = 0;
    const v = VIEW !== null ? VIEWS[VIEW] : VP ? { pos: [VP[0], VP[1]], yaw: VP[2] || 0, pitch: VP[3] || 0 } : null;
    if (v) {
      this.player.spawn(v.pos[0], v.pos[1], v.yaw, v.pitch || 0);
      for (const b of this.bots) b.dormant = 'idle';
      if (v.bot) { const b = this.bots[v.bot.i]; b.pos.set(v.bot.pos[0], b.pos.y, v.bot.pos[1]); b.pos.y = this.level.insideBuilding(b.pos.x, b.pos.z) ? FL : 0; b.yaw = b.aimYaw = b.lookYaw = v.bot.yaw; b.dormant = v.bot.active ? null : 'idle'; if (v.bot.active) { b.alerted = true; } }
      if (v.weapon) this.vm.setWeapon(v.weapon);
    } else {
      this.player.spawn(0, 24.5, 0, -0.05);
      if (TOUR) for (const b of this.bots) b.dormant = 'walk';
    }
    // 떠도는 자세의 위상: 생명마다 다르다. 고정 시점은 그 자리에서 정해서 같은 시점은 늘 같게 찍힌다
    this.vm.holdPhase = v ? ((v.pos[0] * 12.9898 + v.pos[1] * 78.233) % 37 + 37) % 37 : this.rng() * 37;
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
    // 총구 화염, 탄피, 반동, 소리. 총구가 벽 너머로 나가 있으면(벽에 바짝 붙어 쏨) 화염의 빛은 벽 이쪽에 둔다
    const lightPos = block ? chest.clone().addScaledVector(toM, Math.max(0, block.dist - 0.08)) : null;
    this.fx.muzzleFlash(origin, dir, vm.current === 'rifle' ? 'rifle' : 'pistol', 'player', lightPos);
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
    const L = this.listener();
    const occ = !this.level.lineClear(V(p.pos.x, p.pos.y + 1.4, p.pos.z), m);
    // 봇의 총구가 플레이어에게서 가려져 있으면 빛도 작게 둔다(그림자가 없어 벽 너머 바닥까지 비추지 않게)
    this.fx.muzzleFlash(m, dir, 'rifle', 'bot', null, occ ? 0.15 : 1);
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
    this.tick(Math.min(dt, 0.05));
  }

  // 한 프레임. 실시간에서는 frame()이, 수동 시계에서는 __bc.step()이 부른다
  tick(dt) {
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
    // 위협: 앞에 보이는 봇(15 m 안, 시선에서 40° 안, 가리는 것 없음)을 보면 사람처럼 0.3~0.7초 뒤에 총을 든다.
    // 15 m는 근접전 훈련장의 교전 거리다. 넓은 화각의 가슴 카메라에서 20 m 밖의 사람은 키가 화면의 5% 남짓이라
    // 든 총에 가려 보이지 않고, 그러면 총을 든 이유가 화면에 없다(마당 장면, 22.7 m의 봇).
    // 0.1초마다 한 번 본다(시선 검사 비용). 반응 시간은 게임의 난수를 쓰지 않는다(다른 난수의 순서를 바꾸지 않게)
    this.threatT = (this.threatT ?? 0) - dt;
    if (this.threatT <= 0) {
      this.threatT = 0.1;
      let seen = false;
      if (p.alive) for (const b of this.bots) {
        if (!b.alive) continue;
        const c = b.chest, to = c.clone().sub(ct.pos), d = to.length();
        if (d > 15 || d < 0.3 || to.dot(aimDir) < d * Math.cos(0.7)) continue;
        if (this.level.lineClear(ct.pos, c)) { seen = true; break; }
      }
      if (!seen) this.threatSince = null;
      else if (this.threatSince == null) {
        const h = Math.sin(this.time * 12.9898 + 78.233) * 43758.5453;
        this.threatSince = this.time; this.threatDelay = 0.3 + 0.4 * (h - Math.floor(h));
      }
    }
    this.threat = this.threatSince != null && this.time - this.threatSince >= this.threatDelay;
    vm.update(dt, this.time, {
      threat: this.threat,
      // 파쿠르 중에는 두 손으로 짚으니 총을 화면 아래로 내린다(stow). 조준과 사격은 막는다
      anchor: ct.pos, aimQuat: aq, ads: inp.rmb && p.alive && !p.pk, sprint: p.sprinting ? 1 : 0, wallDist, stow: !!p.pk, plant: p.pkHand,
      camQuat: ct.quat, aimYawOff: p.aimYaw - p.bodyYaw, aimPitchOff: p.aimPitch - p.camPitch, shake: ct.shake, camRecoil: ct.recoil,
      camYawVel: p.yawVel, camPitchVel: p.pitchVel, vy: p.vel.y, hits: this.stats.playerHits, exertion: p.exertion, moving: p.moving, stepPhase: p.stepPhaseFrac || 0, roll: ct.roll, level: this.level,
    });
    if (p.alive && vm.tryFire(dt, !p.pk)) this.playerShot();
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
      } else if (e.type === 'land') {
        this.sound.play('step_' + e.mat, { gain: 0.5 + e.strength * 0.3, send: 0.25 }); this.sound.play('rustle', { gain: 0.25 });
        for (const b of this.bots) b.hear(p.pos, 4 + e.strength * 6, this.time);
      } else if (e.type === 'jump') {
        // 디딤발이 바닥을 차는 소리와 장비가 출렁이는 소리
        this.sound.play('step_' + e.mat, { gain: 0.32, send: 0.2, rate: 1.1 }); this.sound.play('rustle', { gain: 0.3, delay: 0.04 });
        for (const b of this.bots) b.hear(p.pos, 5, this.time);
      }
      else if (e.type === 'vault') {
        // 손바닥과 무릎이 장애물을 짚는 소리와 장비가 부딪는 소리. 봇이 듣는다
        const m = e.mat === 'metal' || e.mat === 'fence' ? 'metal' : e.mat === 'gravel' ? 'gravel' : 'concrete';
        this.sound.play('step_' + m, { gain: e.phase === 'hands' ? 0.36 : 0.24, send: 0.2, rate: 1.2 + this.rng() * 0.15 });
        this.sound.play('rustle', { gain: 0.3, send: 0.1, delay: 0.03 });
        for (const b of this.bots) b.hear(p.pos, 6, this.time);
      }
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
    P.flash = 0;
    this.hitFx = Math.max(0, this.hitFx - dt * 2.5); P.hit = this.hitFx;
    P.rim.set(Math.sin(p.camShake.x.y * 0.02) * 0.02 * S.shake, -p.camShake.x.x * 0.0004 * S.shake);
    this.deadFade = !p.alive ? Math.min(1, this.deadFade + dt * 0.5) : Math.max(0, this.deadFade - dt * 2);
    P.dead = this.deadFade;
    P.q = Math.min(1, 0.12 + P.blurVec.length() * 25 + speed * 0.04);
    P.key = 0.28;   // 노출 목표. 화면값 중앙값을 레퍼런스(81) 가까이 둔다(85). 0.275(77)에서는 하늘을 6.0배로 밝힌 뒤 문간 장면의 실내가 기준선보다 어두웠고(A/B 라운드 28) 0.30으로 올렸다. 넓은 번짐(post.js uVeil)을 더한 뒤 실제 카메라처럼 글레어가 낀 화면을 측광한 만큼 0.28로 내렸다
    // 조준경 시점을 먼저 그린다: 본 화면에서 접안렌즈 셰이더가 이 상을 읽는다
    const vm = this.vm, cull = (cam, fn) => this.withBotsCulled(cam, fn);
    // 살펴보기용(테스트): __bc.vmView({az, el, d, side})로 총과 손을 다른 각도에서 본다
    if (this.vmView && !this.vmView.fp) {
      const c = this.vmView, t = new THREE.Vector3();
      (c.side === 'L' ? vm.handL : vm.handR).localToWorld(t.set(0, -0.01, -0.06));
      const yaw = this.player.bodyYaw + (c.az || 0), el = c.el || 0, d = c.d || 0.3;
      this.camera.position.set(t.x + Math.sin(yaw) * Math.cos(el) * d, t.y + Math.sin(el) * d, t.z + Math.cos(yaw) * Math.cos(el) * d);
      this.camera.lookAt(t);
    }
    // 입은 사람의 위팔(뷰모델 빛 가림)을 이번 프레임의 팔꿈치로 옮긴다
    if (vm.elbowW) setBodyArms(this.camera, vm.elbowW);
    this.scope.update(this.scene, this.camera, vm, [vm.root, vm.foreR, vm.foreL], cull);
    // 조준경 패스가 이번 프레임의 장면 행렬을 이미 갱신했으면 본 화면 패스는 다시 갱신하지 않는다(장면 전체를 한 번 더 훑는 비용)
    const auto = this.scene.matrixWorldAutoUpdate;
    if (this.scope.rendered) this.scene.matrixWorldAutoUpdate = false;
    if (this.vmView && this.vmView.raw) { this.renderer.setRenderTarget(null); this.renderer.render(this.scene, this.camera); }   // 살펴보기용: 렌즈와 센서 효과 없이
    else cull(this.camera, () => this.post.render(this.scene, this.camera, dt));
    this.scene.matrixWorldAutoUpdate = auto;
    this.osd.draw(this.playTime, true);
  }

  // ---------------- 성능 측정용 순회 ----------------
  // 봇 단위 컬링: 봇 부품(한 명에 49개)은 관절 위치로 바로 놓여 부품별 컬링을 꺼 두었고, 그래서 화면 밖에서도 매 패스 그려졌다
  // (조준경 패스 그리기 호출 약 250번 중 196번). 패스의 절두체와 봇 하나를 감싸는 구를 견주어 밖이면 그 패스 동안만 통째로 숨긴다
  withBotsCulled(cam, fn) {
    const fr = this._cullFr || (this._cullFr = new THREE.Frustum()), m = this._cullM || (this._cullM = new THREE.Matrix4());
    cam.updateMatrixWorld();
    fr.setFromProjectionMatrix(m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const prev = this.bots.map((b) => [b.group.visible, b.blob.visible]);
    for (const b of this.bots) if (b.group.visible && !fr.intersectsSphere(b.bounds())) { b.group.visible = false; b.blob.visible = false; }
    try { fn(); } finally { this.bots.forEach((b, i) => { b.group.visible = prev[i][0]; b.blob.visible = prev[i][1]; }); }
  }

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
      bake() { return g.bake || null; },
      // 형상 도구가 만든 삼각형 수와 한 프레임에 그린 삼각형 수(살펴보기용)
      geo() { return { wearTris: g.level.wearTris, byKey: g.level.wearStat, worn: g.level.wornStat, boxes: g.level.specs.length }; },
      // 형상 점검: 재질별로 [법선이 면의 실제 방향과 어긋난 삼각형, 넓이가 0인 삼각형, 전체 삼각형]. 법선이 뒤집히면 조도 볼륨을 물체 안쪽에서 읽어 면이 검게 나온다
      normals() {
        const out = {}, keyOf = new Map(Object.entries(g.level.mats).map(([k, m]) => [m, k]));
        g.level.group.traverse((o) => {
          const ge = o.geometry; if (!o.isMesh || !ge || !ge.index || !ge.attributes.aWear) return;
          const p = ge.attributes.position.array, n = ge.attributes.normal.array, ix = ge.index.array;
          let bad = 0, zero = 0;
          for (let t = 0; t < ix.length; t += 3) {
            const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
            const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
            const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx, gl = Math.hypot(gx, gy, gz);
            if (gl < 1e-12) { zero++; continue; }
            const d = (gx * (n[a] + n[b] + n[c]) + gy * (n[a + 1] + n[b + 1] + n[c + 1]) + gz * (n[a + 2] + n[b + 2] + n[c + 2])) / (3 * gl);
            if (!(d > 0.2)) bad++;
          }
          const k = keyOf.get(o.material) || '?'; const e = out[k] || (out[k] = [0, 0, 0]); e[0] += bad; e[1] += zero; e[2] += ix.length / 3;
        });
        return out;
      },
      // 조도 볼륨을 한 점에서 읽는다(검사와 살펴보기용)
      light(x, y, z) { return probeLight(g.renderer, x, y, z); },
      state() {
        const p = g.player, vm = g.vm;
        if (!p) return { phase: g.phase };
        const d = vm.dirWorld;
        return {
          phase: g.phase, kills: g.bots.filter(b => !b.alive).length,
          player: { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.bodyYaw, pitch: p.camPitch, gunYaw: Math.atan2(-d.x, -d.z), gunPitch: Math.asin(Math.max(-1, Math.min(1, d.y))), hp: p.hp, alive: p.alive, weapon: vm.current, ammo: vm.ammo, reloading: !!vm.reload, crouch: p.crouch, aimYaw: p.aimYaw, aimPitch: p.aimPitch, alert: vm.alert, threat: !!g.threat,
            speed: Math.hypot(p.vel.x, p.vel.z), vy: p.vel.y, onGround: p.onGround, sprinting: p.sprinting, ads: vm.ads, parkour: p.pk ? p.pk.plan.kind : null,
            // 검사용: 카메라 높이, 총구와 왼손의 화면 위치(투영 좌표 -1~1, 어안 왜곡 전), 왼손이 짚은 자리
            eye: g.camera.position.y,
            gunNdc: (() => { const v = vm.muzzleWorld.clone().project(g.camera); return [v.x, v.y]; })(),
            gripNdc: (() => { const v = new THREE.Vector3(); vm.gunHolder.getWorldPosition(v); v.project(g.camera); return [v.x, v.y]; })(),
            handL: vm.handLWorld ? (() => { const v = vm.handLWorld.clone().project(g.camera); return { x: vm.handLWorld.x, y: vm.handLWorld.y, z: vm.handLWorld.z, ndc: [v.x, v.y, v.z], planted: !!vm.planted }; })() : null },
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
      // 조준경 상태: 상을 그리는지, 그린 횟수, 카메라와 사출동공의 어긋남(m)
      scope() { const s = g.scope; return { on: s.on, frames: s.frames, pupilOffset: s.pupilOffset, axialOffset: s.axialOffset, size: s.size, calls: s.calls, tris: s.tris, cpu: s.cpu, ads: g.vm.ads, weapon: g.vm.current }; },
      scopeSkip(b) { g.scope.skip = !!b; },
      // 충돌 상자 목록과 플레이어 옮기기(검사와 살펴보기용)
      boxes() { return g.level.boxes.map(b => ({ min: b.min, max: b.max, mat: b.mat, thin: !!b.thin, cover: !!b.cover })); },
      vmView(c) { g.vmView = c || null; },
      // 살펴보기용: 총 자세 값을 덮어쓴다({ low: { p: [x,y,z], r: [숙임,돌림,기울임] }, alert, carry, handle, handleW })
      vmTune(o) { g.vm.tune = o || null; },
      // 검사용: 지금 시점에서 총·손·소매가 받는 빛을 선형 HDR(노출과 센서 곡선 전)로 잰다. vmLightStats 참고
      vmLight(o) { return vmLightStats(g, o || {}); },
      // 살펴보기용: 총·손·소매 재질 값을 덮어쓴다({ env, spec, albedo, rough }). null이면 되돌린다
      vmMat(o) { return vmMatOverride(g, o); },
      // 불러오기 비용: 총의 자기 가림 굽기(ms)
      loadStats() { return { selfOccMs: g.vm.selfOccMs }; },
      // 살펴보기와 검사용: 레벨 재질마다 반사율(텍스처의 선형 평균 × 색, 셰이더의 때와 얼룩 전). [R, G, B]
      levelAlbedo() {
        const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        const out = {};
        for (const [k, m] of Object.entries(g.level.mats)) {
          if (!m || !m.color) continue;
          let a = [1, 1, 1];
          const img = m.map && m.map.image;
          if (img && img.getContext) {
            const d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data, s = [0, 0, 0];
            let n = 0;
            for (let i = 0; i < img.width * img.height; i += 7) { for (let c = 0; c < 3; c++) s[c] += lin(d[i * 4 + c]); n++; }
            a = s.map((x) => x / n);
          }
          out[k] = a.map((x, c) => +(x * [m.color.r, m.color.g, m.color.b][c]).toFixed(3));
        }
        return out;
      },
      place(x, z, yaw, pitch = 0) { g.player.spawn(x, z, yaw, pitch); g.player.crouchToggle = false; return { x: g.player.pos.x, y: g.player.pos.y, z: g.player.pos.z }; },
      scopeDiag() {
        const names = new Map([[g.level.group, 'level'], [g.vm.root, 'viewmodel'], [g.sky, 'sky']]);
        g.bots.forEach((b, i) => { for (const k of ['grp', 'group', 'root', 'mesh']) if (b[k] && b[k].isObject3D) names.set(b[k], 'bot' + i); });
        if (g.fx) for (const [k, v] of Object.entries(g.fx)) if (v && v.isObject3D) names.set(v, 'fx.' + k);
        return { scope: g.scope.diag(g.scene, names), main: { calls: g.post.sceneCalls, tris: g.post.sceneTris } }; },
      perfStart() { g.perf = { frames: [], t0: performance.now(), d0: g.distance }; },
      perfStop() { const r = g.perf; g.perf = null; return { frames: r.frames.slice(2), seconds: (performance.now() - r.t0) / 1000, renderScale: SCALE[g.settings.quality], canvas: `${innerWidth}x${innerHeight}`, distance: g.distance - r.d0 }; },
      async audioTest() { return g.sound.offlineStats(); },
      // 수동 시계에서 1/60초짜리 프레임을 n번 진행한다 (입력은 그 사이에 실제 이벤트로 넣는다)
      step(n = 1) { if (!MANUAL) return null; for (let i = 0; i < n; i++) g.tick(1 / 60); return { time: g.time, phase: g.phase, playerHits: g.stats.playerHits, shotsFired: g.stats.shotsFired }; },
    };
  }
}

// 총·손·소매(뷰모델)를 이루는 객체와 재질
function vmParts(g) { return [g.vm.root, g.vm.foreR, g.vm.foreL]; }
function vmMaterials(g) {
  const s = new Set();
  for (const o of vmParts(g)) o.traverse((c) => { if (c.isMesh && c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => s.add(m)); });
  return [...s];
}

// 검사용 측정: 지금 카메라로 장면을 네 번 그린다. ① 선형 HDR 색 ② 모든 면의 법선 ③ 뷰모델만의 법선 ④ 뷰모델만, 흰 종이(반사율 1, 정반사 없음)로.
// ①을 ④로 나누면 화소마다 '그 자리에 떨어진 빛 가운데 카메라로 돌아온 비율'(실효 반사율)이 나온다. 조명과 노출에 상관없이 재질의 응답만 남는다.
// 실제 검은 폴리머·아노다이징은 확산 반사율 4~6%에 비스듬한 면의 정반사가 더해지고, 짙은 장갑 천은 5~8%, 올리브색 소매는 8~15%쯤이다.
// 뷰모델 화소는 면의 방향(위·옆·아래, 월드 기준)으로도 나누고, 같은 화면에서 위를 향한 바닥(뷰모델 밖, 화면 아래쪽 절반)의 밝기도 함께 낸다(노출과 센서 곡선 전의 값)
// only: 재질 이름 목록('polymer,steel')을 주면 그 재질이 보이는 화소만 센다(다른 뷰모델 부품은 깊이만 쓰고 표시만 남긴다)
// ring: 뷰모델 실루엣 바깥으로 화면 폭의 ringFrac 안에 드는 장면 화소의 밝기. '총이 둘레보다 밝게 뜨는가'를 잰다
// rgb: 채널별 실효 반사율(색 ÷ 흰 종이)의 중앙값. 빛의 색이 지워지므로 재질이 제 색을 지키는지 본다
// ringCard: 장면 전체를 몸 가림 없는 흰 종이로 한 번 더 그려 둘레가 받는 빛(ringCard)과 둘레의 실효 반사율(ringRefl)을 낸다
// noLamps: 형광등(점광원)을 끄고 잰다. 뷰모델과 둘레가 받는 빛 가운데 형광등 몫을 가린다
function vmLightStats(g, { scale = 0.5, only = null, ringFrac = 0.06, ringCard = false, noLamps = false } = {}) {
  const R = g.renderer, cam = g.camera, scene = g.scene;
  const w = Math.max(16, Math.floor(innerWidth * scale)), h = Math.max(16, Math.floor(innerHeight * scale));
  const mk = () => new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: true });
  const rtC = mk(), rtN = mk(), rtM = mk(), rtW = mk(), rtA = ringCard ? mk() : null;
  const prevT = R.getRenderTarget(), prevO = scene.overrideMaterial, prevCC = R.getClearColor(new THREE.Color()), prevCA = R.getClearAlpha();
  const nm = new THREE.MeshNormalMaterial();
  // 흰 종이도 뷰모델과 같은 몸 가림(body)을 받는다. 나눈 값에는 빛이 지워지고 재질의 응답만 남는다
  const white = g._whiteCard || (g._whiteCard = bcMaterial({ color: 0xffffff, roughness: 1, metalness: 0, specularIntensity: 0, envMapIntensity: 0 }, { grime: 0, physical: true, body: true }));
  const parts = new Set(vmParts(g));
  // 뷰모델이 아닌 메시만 숨긴다. 장면의 자식(레벨 묶음)을 통째로 숨기면 그 안의 형광등(점광원)까지 꺼져
  // 흰 종이가 형광등 직접광 없이 그려졌다(2026-11-15, 실내 실효 반사율이 2~3배 부풀었다)
  const inVm = (o) => { for (let a = o; a; a = a.parent) if (parts.has(a)) return true; return false; };
  const hid = [], lampsOff = [];
  if (noLamps) scene.traverse((o) => { if (o.isPointLight && o.visible) { lampsOff.push(o); o.visible = false; } });
  const whiteNB = ringCard ? (g._whiteCardNB || (g._whiteCardNB = bcMaterial({ color: 0xffffff, roughness: 1, metalness: 0, specularIntensity: 0, envMapIntensity: 0 }, { grime: 0, physical: true }))) : null;
  const hideRest = () => scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible && !inVm(o)) { hid.push(o); o.visible = false; } });
  try {
    R.setClearColor(0x000000, 0);
    R.setRenderTarget(rtC); R.clear(); R.render(scene, cam);
    scene.overrideMaterial = nm;
    R.setRenderTarget(rtN); R.clear(); R.render(scene, cam);
    if (rtA) { scene.overrideMaterial = whiteNB; R.setRenderTarget(rtA); R.clear(); R.render(scene, cam); scene.overrideMaterial = nm; }
    hideRest();
    const swap = [];
    if (only) {
      // 고르지 않은 부품은 알파 0.25로 표시만 남긴다(색은 세지 않고, 둘레 고리에서는 뷰모델로 뺀다)
      const names = only.split(','), hide = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0.25, blending: THREE.NoBlending });   // NoBlending이면 불투명 대기열에 남고 알파가 그대로 써진다
      scene.overrideMaterial = null;
      for (const p of parts) p.traverse((m) => { if (m.isMesh) { swap.push([m, m.material]); m.material = names.includes(m.material.name) ? nm : hide; } });
    }
    R.setRenderTarget(rtM); R.clear(); R.render(scene, cam);
    for (const [m, mat] of swap) m.material = mat;
    scene.overrideMaterial = white;
    R.setRenderTarget(rtW); R.clear(); R.render(scene, cam);
  } finally {
    for (const o of hid) o.visible = true;
    for (const o of lampsOff) o.visible = true;
    scene.overrideMaterial = prevO; R.setRenderTarget(prevT); R.setClearColor(prevCC, prevCA); nm.dispose();
  }
  const C = new Float32Array(w * h * 4), N = new Float32Array(w * h * 4), M = new Float32Array(w * h * 4), W = new Float32Array(w * h * 4);
  R.readRenderTargetPixels(rtC, 0, 0, w, h, C); R.readRenderTargetPixels(rtN, 0, 0, w, h, N); R.readRenderTargetPixels(rtM, 0, 0, w, h, M); R.readRenderTargetPixels(rtW, 0, 0, w, h, W);
  const A = rtA ? new Float32Array(w * h * 4) : null;
  if (rtA) { R.readRenderTargetPixels(rtA, 0, 0, w, h, A); rtA.dispose(); }
  rtC.dispose(); rtN.dispose(); rtM.dispose(); rtW.dispose();
  const q = cam.getWorldQuaternion(new THREE.Quaternion()), n = new THREE.Vector3();
  const acc = () => ({ n: 0, sum: 0, v: [] });
  const vmAll = acc(), vmUp = acc(), vmSide = acc(), vmDown = acc(), gnd = acc(), rest = acc(), ring = acc();
  const rAll = acc(), rUp = acc(), rSide = acc(), rDown = acc(), rR = acc(), rG = acc(), rB = acc(), vCard = acc(), aCard = acc(), aRefl = acc();
  // 뷰모델 전체(고른 재질 + 표시만 남긴 부품)의 실루엣을 화면 폭의 ringFrac만큼 넓힌 고리
  const full = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) full[i] = M[i * 4 + 3] > 0.1 ? 1 : 0;
  const rad = Math.max(1, Math.round(w * ringFrac)), tmp = new Uint8Array(w * h), dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let c = 0; const o = y * w;
    for (let x = 0; x < Math.min(w, rad); x++) c += full[o + x];
    for (let x = 0; x < w; x++) { if (x + rad < w) c += full[o + x + rad]; if (x - rad - 1 >= 0) c -= full[o + x - rad - 1]; tmp[o + x] = c > 0 ? 1 : 0; } }
  for (let x = 0; x < w; x++) { let c = 0;
    for (let y = 0; y < Math.min(h, rad); y++) c += tmp[y * w + x];
    for (let y = 0; y < h; y++) { if (y + rad < h) c += tmp[(y + rad) * w + x]; if (y - rad - 1 >= 0) c -= tmp[(y - rad - 1) * w + x]; dil[y * w + x] = c > 0 ? 1 : 0; } }
  const add = (a, l) => { a.n++; a.sum += l; a.v.push(l); };
  const Y = (A, k) => 0.2126 * A[k] + 0.7152 * A[k + 1] + 0.0722 * A[k + 2];
  for (let i = 0; i < w * h; i++) {
    const k = i * 4, l = Y(C, k);
    if (!(l >= 0) || !isFinite(l)) continue;
    if (M[k + 3] > 0.5) {
      n.set(M[k] * 2 - 1, M[k + 1] * 2 - 1, M[k + 2] * 2 - 1).normalize().applyQuaternion(q);
      const dir = n.y > 0.5 ? 1 : n.y < -0.5 ? -1 : 0;
      add(vmAll, l); add(dir > 0 ? vmUp : dir < 0 ? vmDown : vmSide, l);
      const lw = Y(W, k);
      if (lw > 1e-5) { const r = l / lw; add(rAll, r); add(dir > 0 ? rUp : dir < 0 ? rDown : rSide, r); add(vCard, lw); }
      if (W[k] > 1e-5 && W[k + 1] > 1e-5 && W[k + 2] > 1e-5) { add(rR, C[k] / W[k]); add(rG, C[k + 1] / W[k + 1]); add(rB, C[k + 2] / W[k + 2]); }
    } else if (full[i]) {
      continue;
    } else if (N[k + 3] > 0.5) {
      add(rest, l);
      if (dil[i]) { add(ring, l); if (A) { const la = Y(A, k); add(aCard, la); if (la > 1e-5) add(aRefl, l / la); } }
      const y = Math.floor(i / w);
      if (y < h * 0.5) { n.set(N[k] * 2 - 1, N[k + 1] * 2 - 1, N[k + 2] * 2 - 1).normalize().applyQuaternion(q); if (n.y > 0.8) add(gnd, l); }
    }
  }
  const sum = (a) => { if (!a.n) return { n: 0 }; a.v.sort((x, y) => x - y); const pc = (p) => a.v[Math.min(a.v.length - 1, Math.floor(p * a.v.length))]; return { n: a.n, frac: +(a.n / (w * h)).toFixed(4), mean: a.sum / a.n, p10: pc(0.1), p50: pc(0.5), p90: pc(0.9), p99: pc(0.99) }; };
  return { w, h, vm: sum(vmAll), up: sum(vmUp), side: sum(vmSide), down: sum(vmDown), ground: sum(gnd), scene: sum(rest), ring: sum(ring), vmCard: sum(vCard), ringCard: A ? sum(aCard) : null, ringRefl: A ? sum(aRefl) : null, refl: { all: sum(rAll), up: sum(rUp), side: sum(rSide), down: sum(rDown) }, rgb: [sum(rR).p50, sum(rG).p50, sum(rB).p50] };
}

// 살펴보기용: 뷰모델 재질의 반사와 반사율을 바꿔 본다. 원래 값은 처음 바꿀 때 저장하고 null이면 되돌린다.
// { only: 'glove,sleeve' }처럼 재질 이름(weapons.js 재질 표의 키)을 주면 그 재질만 바꾼다. sheen은 결 반사 색(회색 값), sheenRough는 그 거칠기, finish는 닳은 모서리 켜기(1)·끄기(0)
function vmMatOverride(g, o) {
  const only = o && o.only ? o.only.split(',') : null;
  const mats = vmMaterials(g).filter((m) => m.isMeshStandardMaterial);
  for (const m of mats) {
    const u = m.userData;
    if (!u.orig) u.orig = { env: m.envMapIntensity, spec: m.specularIntensity, color: m.color.clone(), rough: m.roughness, sheen: m.sheenColor ? m.sheenColor.clone() : null, sheenRough: m.sheenRoughness, map: m.map };
    const on = o && (!only || only.includes(m.name));
    m.envMapIntensity = on && o.env != null ? o.env : u.orig.env;
    if (m.specularIntensity !== undefined) m.specularIntensity = on && o.spec != null ? o.spec : u.orig.spec;
    m.color.copy(u.orig.color).multiplyScalar(on && o.albedo != null ? o.albedo : 1);
    m.roughness = on && o.rough != null ? o.rough : u.orig.rough;
    const map = on && o.map === 0 ? null : u.orig.map;   // map: 0이면 반사율 텍스처를 떼고 색(albedo 값)만 쓴다
    if (m.map !== map) { m.map = map; m.needsUpdate = true; }
    if (u.bc && u.bc.uFinish) { if (u.orig.finish === undefined) u.orig.finish = u.bc.uFinish.value; u.bc.uFinish.value = on && o.finish != null ? o.finish : u.orig.finish; }
    if (u.orig.sheen) { if (on && o.sheen != null) m.sheenColor.setScalar(o.sheen); else m.sheenColor.copy(u.orig.sheen); m.sheenRoughness = on && o.sheenRough != null ? o.sheenRough : u.orig.sheenRough; }
  }
  return mats.map((m) => ({ name: m.name, type: m.type, env: m.envMapIntensity, spec: m.specularIntensity, rough: m.roughness, color: m.color.getHexString(), map: !!m.map }));
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
  // 가까운 장면(9~12): 1~2 m 안의 표면과 손과 총. 판정 시트 크기에서 작은 변화가 보이도록 A/B에 더했다(2026-11-14)
  { pos: [-6.6, -1.4], yaw: 2.28, pitch: 0.05 },
  { pos: [1.5, -2.5], yaw: 1.07, pitch: -0.75 },
  { pos: [-10, -5.9], yaw: -1.07, pitch: 0 },
  { pos: [6.8, -7.6], yaw: 0.3, pitch: -0.1, weapon: 'pistol' },
  // 13: 마당의 콘크리트 방벽(높이 0.8 m) 1 m 앞. 파쿠르(Space 두 번) 연속 프레임용(2026-11-14)
  { pos: [9.0, 10.6], yaw: 0.0, pitch: -0.08 },
];

const game = new Game();
game.load().catch((e) => { console.error(e); $('load-msg').textContent = '불러오기 실패: ' + e.message; });
