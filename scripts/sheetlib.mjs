// 판정용 시트를 만드는 공용 도구 (npm run sheet, npm run ab)
import crypto from 'node:crypto';
import sharp from 'sharp';

export const BG = '#1a1a1a';

export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// 칸 이름표. 화면 위에 겹치지 않게 화면 바깥 띠에 놓는다
export const label = (w, h, text, size = 20) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${BG}"/><text x="4" y="${Math.round(h * 0.74)}" font-family="Arial, 'Malgun Gothic', sans-serif" font-size="${size}" fill="#e6e6e6">${text}</text></svg>`);

// 확대 영역: 화면에 대한 비율 {x, y, w, h}. 두 빌드에서 같은 영역을 같은 배율로 자른다 (docs/evaluation.md '확대 쌍')
export function parseRegion(s) {
  const v = String(s).split(',').map(Number);
  if (v.length !== 4 || v.some(x => !Number.isFinite(x)) || v[0] < 0 || v[1] < 0 || v[2] <= 0 || v[3] <= 0 || v[0] + v[2] > 1 || v[1] + v[3] > 1) throw new Error(`확대 영역은 'x,y,w,h' (화면 비율, 0~1)로 준다: ${s}`);
  return { x: v[0], y: v[1], w: v[2], h: v[3] };
}
const px = (r, W, H) => { const left = Math.round(r.x * W), top = Math.round(r.y * H); return { left, top, width: Math.min(W - left, Math.round(r.w * W)), height: Math.min(H - top, Math.round(r.h * H)) }; };
// 영역을 잘랐을 때의 칸 높이 (폭 w 기준, 화면 크기 W×H)
export const zoomHeight = (r, w, W, H) => { const p = px(r, W, H); return Math.round((w * p.height) / p.width); };

// 정지 화면 한 칸: 알파를 버리고 같은 크기로 줄인다. 비교할 두 화면은 반드시 이 같은 경로를 거친다. region이 있으면 그 영역만 잘라 키운다
export async function still(file, w, h, region = null) {
  let img = sharp(file).removeAlpha();
  if (region) { const m = await sharp(file).metadata(); img = sharp(await img.extract(px(region, m.width, m.height)).png().toBuffer()); }
  return img.resize(w, h, { fit: 'fill' }).png().toBuffer();
}

// 연속 프레임 묶음(8장 한 줄)을 4장씩 두 줄로 다시 놓는다. 한 줄 그대로는 판정자가 읽을 때 축소되어 세부가 사라진다
export async function stripBlock(file, fw, fh, gap = 4, region = null) {
  const m = await sharp(file).metadata();
  const sw = Math.floor(m.width / 8);
  const cut = (i) => { if (!region) return { left: i * sw, top: 0, width: sw, height: m.height }; const p = px(region, sw, m.height); return { ...p, left: i * sw + p.left }; };
  const tiles = await Promise.all([...Array(8)].map((_, i) => sharp(file).removeAlpha().extract(cut(i)).resize(fw, fh, { fit: 'fill' }).png().toBuffer()));
  const w = fw * 4 + gap * 3, h = fh * 2 + gap;
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: BG } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % 4) * (fw + gap), top: Math.floor(i / 4) * (fh + gap) }))).png().toBuffer();
  return { buf, w, h };
}

export async function page(width, height, comps, file, jpeg = false) {
  const img = sharp({ create: { width, height, channels: 3, background: BG } }).composite(comps);
  await (jpeg ? img.jpeg({ quality: 80, mozjpeg: true }) : img.png()).toFile(file);
}

export const STRIP_NOTE = '8 frames over 1 s, order: left to right, then next row';
