// 합친 형상을 공간 덩어리로 나눈다.
//
// 레벨은 재질마다 형상을 하나로 합쳐 그리기 호출을 줄인다. 그 대신 덩어리 하나가 맵 전체에 걸쳐 있어서,
// 화면에 한 귀퉁이만 걸려도 통째로 그려진다(나무 껍질 136만 삼각형, 잔가지 카드 70만이 매 패스).
// 시야가 6°인 조준경 시점은 본 화면과 거의 같은 삼각형 수를 그렸다.
// 삼각형이 많은 덩어리만 경계 상자의 긴 축 가운데에서 반씩 나눠 maxTris 이하로 만든다. 작은 덩어리는 그대로 둔다
// (나누면 그리기 호출이 늘어 본 화면의 CPU 시간이 는다).
import * as THREE from 'three';

// geo: 위치가 월드 좌표인 BufferGeometry(인덱스가 있어도 없어도 된다). 반환: 나눈 BufferGeometry 배열(나눌 필요가 없으면 [geo])
export function splitGeometry(geo, maxTris = 60000, minSize = 5) {
  const ix = geo.index ? geo.index.array : null;
  const pos = geo.attributes.position.array;
  const nt = ix ? ix.length / 3 : geo.attributes.position.count / 3;
  if (nt <= maxTris) return [geo];
  // 여러 재질 묶음(groups)이나 끼워 넣은 속성은 나누지 않는다
  if (geo.groups.length || Object.keys(geo.morphAttributes).length || Object.values(geo.attributes).some((a) => a.isInterleavedBufferAttribute)) return [geo];
  const vi = (t, k) => (ix ? ix[t * 3 + k] : t * 3 + k);
  // 삼각형 무게중심
  const cen = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = vi(t, 0) * 3, b = vi(t, 1) * 3, c = vi(t, 2) * 3;
    cen[t * 3] = (pos[a] + pos[b] + pos[c]) / 3; cen[t * 3 + 1] = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3; cen[t * 3 + 2] = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
  }
  const leaves = [];
  const rec = (tris) => {
    if (tris.length <= maxTris) { leaves.push(tris); return; }
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < tris.length; i++) { const o = tris[i] * 3; for (let k = 0; k < 3; k++) { const v = cen[o + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; } }
    // 높이(y)로는 나누지 않는다: 같은 자리의 위아래는 대개 함께 보인다
    const ax = mx[0] - mn[0] >= mx[2] - mn[2] ? 0 : 2, ext = mx[ax] - mn[ax];
    if (ext < minSize) { leaves.push(tris); return; }
    const mid = (mn[ax] + mx[ax]) / 2;
    let nl = 0; for (let i = 0; i < tris.length; i++) if (cen[tris[i] * 3 + ax] < mid) nl++;
    const L = new Uint32Array(nl), R = new Uint32Array(tris.length - nl);
    let li = 0, ri = 0; for (let i = 0; i < tris.length; i++) { const t = tris[i]; if (cen[t * 3 + ax] < mid) L[li++] = t; else R[ri++] = t; }
    if (!nl || nl === tris.length) { leaves.push(tris); return; }
    rec(L); rec(R);
  };
  const all = new Uint32Array(nt); for (let t = 0; t < nt; t++) all[t] = t;
  rec(all);
  // 덩어리마다 쓰는 꼭짓점만 모아 새 형상을 만든다
  const nv = geo.attributes.position.count, remap = new Int32Array(nv).fill(-1);
  const names = Object.keys(geo.attributes);
  const out = [];
  for (const tris of leaves) {
    const used = [];
    const idx = new Uint32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) for (let k = 0; k < 3; k++) {
      const v = vi(tris[i], k);
      if (remap[v] < 0) { remap[v] = used.length; used.push(v); }
      idx[i * 3 + k] = remap[v];
    }
    const g = new THREE.BufferGeometry();
    for (const n of names) {
      const A = geo.attributes[n], s = A.itemSize, src = A.array;
      const arr = new src.constructor(used.length * s);
      for (let j = 0; j < used.length; j++) { const o = used[j] * s; for (let k = 0; k < s; k++) arr[j * s + k] = src[o + k]; }
      g.setAttribute(n, new THREE.BufferAttribute(arr, s, A.normalized));
    }
    g.setIndex(new THREE.BufferAttribute(used.length > 65535 ? idx : Uint16Array.from(idx), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    for (const v of used) remap[v] = -1;
    out.push(g);
  }
  geo.dispose();
  return out;
}
