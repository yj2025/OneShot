// 판정용 시트를 만드는 공용 도구 (npm run sheet, npm run ab)
import crypto from 'node:crypto';
import sharp from 'sharp';

export const BG = '#1a1a1a';

export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// 칸 이름표. 화면 위에 겹치지 않게 화면 바깥 띠에 놓는다
export const label = (w, h, text, size = 20) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${BG}"/><text x="4" y="${Math.round(h * 0.74)}" font-family="Arial, 'Malgun Gothic', sans-serif" font-size="${size}" fill="#e6e6e6">${text}</text></svg>`);

// 정지 화면 한 칸: 알파를 버리고 같은 크기로 줄인다. 비교할 두 화면은 반드시 이 같은 경로를 거친다
export const still = (file, w, h) => sharp(file).removeAlpha().resize(w, h, { fit: 'fill' }).png().toBuffer();

// 연속 프레임 묶음(8장 한 줄)을 4장씩 두 줄로 다시 놓는다. 한 줄 그대로는 판정자가 읽을 때 축소되어 세부가 사라진다
export async function stripBlock(file, fw, fh, gap = 4) {
  const m = await sharp(file).metadata();
  const sw = Math.floor(m.width / 8);
  const tiles = await Promise.all([...Array(8)].map((_, i) => sharp(file).removeAlpha().extract({ left: i * sw, top: 0, width: sw, height: m.height }).resize(fw, fh, { fit: 'fill' }).png().toBuffer()));
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
