// 뷰모델의 반사 프로브: 총 자리(두 손 사이)에서 방을 작은 큐브맵으로 그려 총, 조준경, 장갑, 소매의 환경 반사로 쓴다.
// 그 전에는 실내에서 뷰모델이 비추는 것이 조도 볼륨의 L1 구면 조화(방향에 따른 밝기 기울기 하나)뿐이었다.
// 창, 문밖, 형광등, 어두운 구석이 반사에 맺히지 않아서 밝기를 올리면 고르게 깔린 '회색 석고', 내리면 반사 없는 '검은 덩어리'가 됐다
// (critic 31·32, A/B 43~46). 큐브맵은 장면을 그린 선형 HDR이라 창의 날아간 흰빛과 그늘이 제자리에 비친다. 거칠기에 맞는 흐림은
// three.js가 PMREM으로 만든다(렌더 타깃 텍스처의 needsPMREMUpdate). 프레임마다 면 하나씩 그려 비용을 나눈다(6프레임에 한 바퀴).
// 프로브 자리가 1.5 m 넘게 바뀌거나(다시 시작) 건물 안팎이 바뀌면 한 바퀴를 처음부터 다시 그린다. 그동안은 앞 바퀴의 반사를 그대로 쓴다
// (PMREM은 한 바퀴가 끝날 때만 만든다). 여섯 면을 한 프레임에 그리면 52~55 ms가 걸려서 처음 한 번(로딩 중)만 그렇게 한다.
// 화염이 켜진 동안은 멈춘다(화염에 물든 벽이 늦게 비치지 않게).
// 건물 밖에서는 장면 대신 지금까지의 환경(하늘과 땅만 있는 envScene)을 그리고 uLocEnv를 끈다. 바깥 반사는 이 세션 전과 같다.
// 바깥 재질의 반사율(아스팔트 8.7%, 자갈 9.9%)이 실제의 절반쯤이라, 장면을 그대로 비추면 바깥 총이 더 어두워진다(마당 총 0.21 → 0.17). BACKLOG에 남긴다
import * as THREE from 'three';
import { bodyUniforms } from './materials.js';
import { insideBuilding } from './lightbake.js';

export class LocalProbe {
  constructor(renderer, size = 64) {
    this.r = renderer;
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.cube = new THREE.CubeCamera(0.03, 90, this.rt);
    this.face = 0; this.cycles = 0; this.on = false; this.mats = []; this.inside = null; this.cycleInside = false; this.envInside = false;
    this.stats = { full: 0, fullMaxMs: 0, oneMaxMs: 0 };
    this.at = new THREE.Vector3(1e9, 0, 0); this.prev = new THREE.Vector3(1e9, 0, 0);
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
  }

  // 뷰모델 재질(입은 사람의 몸 가림을 켠 bcMaterial) 모두에 프로브를 환경맵으로 붙이거나 뗀다
  attach(roots, on) {
    this.on = on;
    const mats = new Set();
    for (const r of roots) r.traverse((o) => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.userData.bc && m.userData.bc.uBody.value > 0.5) mats.add(m); });
    this.mats = [...mats];
    for (const m of this.mats) { m.envMap = on ? this.rt.texture : null; m.needsUpdate = true; }
    if (!on) bodyUniforms.uLocEnv.value = 0;
    this.cycles = 0; this.at.set(1e9, 0, 0); this.prev.set(1e9, 0, 0);
  }

  // scene의 행렬은 이미 이번 프레임 것으로 갱신돼 있어야 한다. hide: 그리지 않을 뷰모델 노드, cull: 봇 단위 컬링(main.js)
  update(scene, envScene, vm, hide, cull, busy) {
    if (!this.on) return;
    vm.handR.getWorldPosition(this._a); vm.handL.getWorldPosition(this._b);
    const p = this._a.add(this._b).multiplyScalar(0.5);
    // 순간 이동(다시 시작)은 앞 프레임과의 거리로 가린다. 바퀴 시작 자리와 견주면 낮은 프레임률에서 달릴 때 바퀴가 끝나지 않는다
    const inside = insideBuilding(p), jump = p.distanceTo(this.prev) > 1.5 || inside !== this.inside;
    this.inside = inside; this.prev.copy(p);
    if (busy && !jump) return;
    const R = this.r, C = this.cube;
    if (C.coordinateSystem !== R.coordinateSystem) { C.coordinateSystem = R.coordinateSystem; C.updateCoordinateSystem(); }
    if (this.face === 0 || jump) { this.at.copy(p); C.position.copy(p); C.updateMatrixWorld(true); this.face = 0; this.cycleInside = inside; }
    const was = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    const prevT = R.getRenderTarget(), prevF = R.getActiveCubeFace(), prevM = R.getActiveMipmapLevel();
    const n = this.cycles === 0 ? 6 : 1, t0 = performance.now(), pg0 = R.info.programs ? R.info.programs.length : -1, f0 = this.face;
    for (let k = 0; k < n; k++) {
      const cam = C.children[this.face];
      R.setRenderTarget(this.rt, this.face);
      if (this.cycleInside) cull(cam, () => R.render(scene, cam)); else R.render(envScene, cam);
      this.face = (this.face + 1) % 6;
      if (this.face === 0) { this.rt.texture.needsPMREMUpdate = true; this.cycles++; this.envInside = this.cycleInside; }
    }
    R.setRenderTarget(prevT, prevF, prevM);
    const ms = performance.now() - t0;
    if (n === 6) { this.stats.full++; this.stats.fullMaxMs = Math.max(this.stats.fullMaxMs, ms); } else { if (ms > this.stats.oneMaxMs) this.stats.slow = { ms, cycles: this.cycles, inside: this.cycleInside, face: this.face, calls: R.info.render.calls, progs: R.info.programs ? R.info.programs.length : -1, pg0, f0, pos: this.at.toArray().map((x) => +x.toFixed(2)) }; this.stats.oneMaxMs = Math.max(this.stats.oneMaxMs, ms); }
    hide.forEach((o, i) => { o.visible = was[i]; });
    bodyUniforms.uLocEnv.value = this.cycles > 0 && this.envInside ? 1 : 0;
  }
}
