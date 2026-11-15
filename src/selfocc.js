// 총의 자기 가림: 부품끼리 가린 하늘빛과 반사를 꼭짓점마다 한 번 굽는다(aSelfOcc, 0 = 트임, 1 = 다 가림).
// 화면 공간 차폐는 0.7 m 안쪽(뷰모델)을 건너뛴다. 반경(0.45 m, 0.13 m)이 총보다 커서 총 전체가 팔과 함께 어두워지기 때문이다.
// 그래서 조준경 아래의 리시버 윗면, 레일 이 사이, 핸드가드 구멍, 탄창 삽입구가 트인 면과 똑같이 방의 빛과 반사를 다 받아
// 그늘 없이 고르게 밝은 '회색 석고 모형'이 됐다(A/B 43, critic 31). 재질 셰이더(materials.js)가 이 값으로 간접광의 확산과 반사만 줄인다.
// 방법: 무기 하나의 부품을 무기 좌표의 4 mm 격자에 채우고(삼각형 위 점을 찍는다), 꼭짓점마다 법선 쪽 반구로 코사인 분포 광선을 보내
// 8 cm 안에서 다른 부품에 닿는 비율을 잰다. 움직이는 부품(탄창, 슬라이드)은 제자리 기준이다. 손과 소매는 넣지 않는다(무기마다 쥐는 자리가 바뀐다)
import * as THREE from 'three';

export function bakeSelfOcclusion(root, { voxel = 0.004, reach = 0.08, rays = 24, bias = 2.5 } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position && o.geometry.attributes.normal) meshes.push(o); });
  // 여러 부품이 나눠 쓰는 형상(같은 크기의 둥근 상자)은 부품마다 가림이 다르므로 복제한다
  const seen = new Set();
  for (const m of meshes) { if (seen.has(m.geometry)) m.geometry = m.geometry.clone(); seen.add(m.geometry); }
  const M = meshes.map((m) => new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
  const box = new THREE.Box3(), v = new THREE.Vector3();
  meshes.forEach((m, k) => { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(M[k])); });
  if (box.isEmpty()) return;
  box.expandByScalar(voxel * 2);
  const o = box.min, nx = Math.ceil((box.max.x - o.x) / voxel), ny = Math.ceil((box.max.y - o.y) / voxel), nz = Math.ceil((box.max.z - o.z) / voxel);
  const grid = new Uint8Array(nx * ny * nz);
  const cell = (x, y, z) => {
    const i = Math.floor((x - o.x) / voxel), j = Math.floor((y - o.y) / voxel), k = Math.floor((z - o.z) / voxel);
    return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : (k * ny + j) * nx + i;
  };
  // 1) 부품 표면을 격자에 채운다
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  meshes.forEach((m, k) => {
    const g = m.geometry, p = g.attributes.position, idx = g.index, tri = idx ? idx.count / 3 : p.count / 3;
    for (let t = 0; t < tri; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(p, i0).applyMatrix4(M[k]); b.fromBufferAttribute(p, i1).applyMatrix4(M[k]); c.fromBufferAttribute(p, i2).applyMatrix4(M[k]);
      const n = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (voxel * 0.5)));
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const u = i / n, w = j / n;
        const q = cell(a.x + (b.x - a.x) * u + (c.x - a.x) * w, a.y + (b.y - a.y) * u + (c.y - a.y) * w, a.z + (b.z - a.z) * u + (c.z - a.z) * w);
        if (q >= 0) grid[q] = 1;
      }
    }
  });
  // 2) 꼭짓점마다 코사인 분포 광선(황금각 나선)
  const dirs = [];
  for (let i = 0; i < rays; i++) { const u = (i + 0.5) / rays, r = Math.sqrt(u), ang = i * 2.39996; dirs.push([r * Math.cos(ang), r * Math.sin(ang), Math.sqrt(1 - u)]); }
  const nm = new THREE.Matrix3(), n = new THREE.Vector3(), T = new THREE.Vector3(), B = new THREE.Vector3();
  meshes.forEach((m, k) => {
    const g = m.geometry, p = g.attributes.position, nr = g.attributes.normal, occ = new Float32Array(p.count);
    nm.getNormalMatrix(M[k]);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(M[k]);
      n.fromBufferAttribute(nr, i).applyMatrix3(nm).normalize();
      T.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize(); B.crossVectors(n, T);
      let hit = 0;
      for (const [x, y, z] of dirs) {
        const dx = T.x * x + B.x * y + n.x * z, dy = T.y * x + B.y * y + n.y * z, dz = T.z * x + B.z * y + n.z * z;
        for (let s = bias * voxel; s < reach; s += voxel) { const q = cell(v.x + dx * s, v.y + dy * s, v.z + dz * s); if (q < 0) break; if (grid[q]) { hit++; break; } }
      }
      occ[i] = hit / rays;
    }
    g.setAttribute('aSelfOcc', new THREE.BufferAttribute(occ, 1));
  });
}
