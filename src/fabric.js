// 천 표면 도구: 소매와 장갑의 반사율 맵과 노멀 맵을 같은 높이장에서 만든다(2026-11-17, 2단계 ③ 재개).
// 이전에는 반사율 맵에 밝고 어두운 사각형만 흩뿌렸고, 반복이 둘레와 길이에서 4.5배 달라 소매에서 흰 빗금으로 늘어졌다.
// 노멀 맵이 없어서 천의 결과 보강 실은 빛을 받아도 드러나지 않았다(critic 16~36라운드 '천의 결 없는 원통').
// 한 장은 실제 치수 TILE(4 cm) 정사각형이다. 쓰는 쪽이 UV 길이에 맞춰 반복을 정한다(repeatFor).
//  ripstop: 면·폴리 립스탑. 5 mm 간격의 굵은 보강 실(폭 약 0.5 mm, 0.15 mm 솟음)과 실 굵기의 불규칙함, 바래고 때 탄 얼룩
//  knit:    장갑 손등의 합성 니트. 1.6 mm 간격의 비스듬한 골과 얼룩
// 반사율 맵의 선형 평균 휘도는 base 색과 같게 맞춘다(재질 표의 반사율, 검사 (l) ②가 본다).
import * as THREE from 'three';
import { fbm, mulberry32 } from './rng.js';

export const TILE = 0.04;
const S = 256;
const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const srgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export function fabricMaps(base, { kind = 'ripstop', seed = 1, bump = 1 } = {}) {
  const c = new THREE.Color(base);
  const rgb = [lin(((c.getHex() >> 16) & 255) / 255), lin(((c.getHex() >> 8) & 255) / 255), lin((c.getHex() & 255) / 255)];
  const rnd = mulberry32(seed * 7919 + 13);
  const H = new Float32Array(S * S), A = new Float32Array(S * S);
  const px = TILE / S;                                     // 화소 하나의 실제 크기(m)
  const jit = [...Array(64)].map(() => rnd());
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // 얼룩: 바램과 때(타일마다 이어지도록 주기 함수)
    const mott = fbm(u * 3, v * 3, 3, 4, seed) - 0.5, fine = fbm(u * 24, v * 24, 24, 3, seed + 5) - 0.5;
    let h = mott * 0.25 + fine * 0.18, a = 1 + mott * 0.16 + fine * 0.06;
    if (kind === 'ripstop') {
      // 보강 실: 5 mm(32화소)마다 가로세로. 실마다 굵기와 자리가 조금씩 다르다
      const G = 32;
      const gx = x % G, gy = y % G, ix = Math.floor(x / G), iy = Math.floor(y / G);
      const wx = 1.6 + jit[ix % 64] * 1.2, wy = 1.6 + jit[(iy + 17) % 64] * 1.2;
      const dx = Math.min(gx, G - gx) - jit[(ix + 31) % 64] * 0.8, dy = Math.min(gy, G - gy) - jit[(iy + 47) % 64] * 0.8;
      const rx = Math.max(0, 1 - Math.abs(dx) / wx), ry = Math.max(0, 1 - Math.abs(dy) / wy);
      const rib = Math.max(rx * rx * (3 - 2 * rx), ry * ry * (3 - 2 * ry));
      // 바탕 평직: 실 두 가닥(약 0.3 mm)마다 오르내리는 결. 화소보다 작아 밉맵에서 평균이 되고, 가까울 때만 보인다
      const weave = ((x >> 1) + (y >> 1)) & 1 ? 0.12 : -0.12;
      h += rib * 0.95 + weave;
      a *= 1 + rib * 0.08;
    } else {
      // 니트: 비스듬한 골(1.6 mm, 10화소)
      const d = (x + y * 0.55) / 10;
      const k = 0.5 + 0.5 * Math.cos(d * Math.PI * 2);
      h += k * 0.55;
      a *= 1 - (1 - k) * 0.08;
    }
    H[y * S + x] = h; A[y * S + x] = a;
  }
  // 반사율: 선형 평균을 1로 맞춘 뒤 base 색을 곱한다
  let m = 0; for (let i = 0; i < S * S; i++) m += A[i]; m /= S * S;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.round(Math.min(1, srgb(rgb[k] * A[i] / m)) * 255);
  for (let i = 0; i < S * S; i++) img.data[i * 4 + 3] = 255;
  ctx.putImageData(img, 0, 0);
  // 노멀: 높이 단위 1 = 0.15 mm. 기울기는 화소 크기로 나눠 실제 경사로 만든다
  const hn = document.createElement('canvas'); hn.width = hn.height = S;
  const nctx = hn.getContext('2d'), nimg = nctx.createImageData(S, S);
  const unit = 0.00015 * bump;
  const at = (x, y) => H[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const gx = (at(x + 1, y) - at(x - 1, y)) * unit / (2 * px), gy = (at(x, y + 1) - at(x, y - 1)) * unit / (2 * px);
    const l = Math.hypot(gx, gy, 1), i = (y * S + x) * 4;
    nimg.data[i] = Math.round((-gx / l * 0.5 + 0.5) * 255); nimg.data[i + 1] = Math.round((gy / l * 0.5 + 0.5) * 255); nimg.data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); nimg.data[i + 3] = 255;
  }
  nctx.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(hn); normalMap.colorSpace = THREE.NoColorSpace;
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  // UV 한 칸이 실제로 uLen × vLen(m)일 때 한 장이 TILE이 되게 반복을 정한다
  const repeatFor = (uLen, vLen) => { for (const t of [map, normalMap]) t.repeat.set(Math.max(1, Math.round(uLen / TILE)), vLen / TILE); };
  return { map, normalMap, repeatFor };
}
