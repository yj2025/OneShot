// npm run sheet: 빌드 화면과 refs/ 이미지를 같은 크기로 섞은 비교 시트(out/sheets/round-N.png)와 정답 키(out/keys/round-N.json)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { ROOT, OUT, ensureDir } from './lib.mjs';

const sheets = ensureDir(path.join(OUT, 'sheets'));
const keys = ensureDir(path.join(OUT, 'keys'));
const shotsDir = path.join(OUT, 'shots');
const argRound = process.argv.slice(2).find(a => /^\d+$/.test(a));
const round = argRound ? +argRound : fs.readdirSync(sheets).filter(f => /^round-\d+\.png$/.test(f)).length + 1;

const buildImgs = fs.readdirSync(shotsDir).filter(f => /^\d\d-.*\.png$/.test(f)).map(f => path.join(shotsDir, f));
const refDir = path.join(ROOT, 'refs');
const refImgs = fs.existsSync(refDir) ? fs.readdirSync(refDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).map(f => path.join(refDir, f)) : [];

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const nBuild = refImgs.length ? Math.min(buildImgs.length, Math.max(4, refImgs.length)) : 9;
const pickBuild = shuffle([...buildImgs]).slice(0, nBuild);
const items = shuffle([...pickBuild.map(p => ({ p, build: true })), ...refImgs.map(p => ({ p, build: false }))]);

const CW = 640, CH = 360, LABEL = 34, COLS = 3;
const rows = Math.ceil(items.length / COLS);
const names = items.map((_, i) => String.fromCharCode(65 + i));
const comps = [];
for (let i = 0; i < items.length; i++) {
  // 같은 해상도·같은 압축 단계를 거쳐 출처 단서를 지운다 (16:9 가운데 자르기 → 640×360 → JPEG q80)
  const jpg = await sharp(items[i].p).resize(CW, CH, { fit: 'cover' }).removeAlpha().jpeg({ quality: 80 }).toBuffer();
  const x = (i % COLS) * CW, y = Math.floor(i / COLS) * (CH + LABEL);
  comps.push({ input: await sharp(jpg).png().toBuffer(), left: x, top: y + LABEL });
  const svg = `<svg width="${CW}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#1a1a1a"/><text x="12" y="25" font-family="Arial" font-size="22" fill="#e6e6e6">${names[i]}</text></svg>`;
  comps.push({ input: Buffer.from(svg), left: x, top: y });
}
const file = path.join(sheets, `round-${round}.png`);
await sharp({ create: { width: CW * COLS, height: rows * (CH + LABEL), channels: 3, background: '#1a1a1a' } }).composite(comps).png().toFile(file);
fs.writeFileSync(path.join(keys, `round-${round}.json`), JSON.stringify({ round, build: names.filter((_, i) => items[i].build), total: items.length }));
console.log(`시트: out/sheets/round-${round}.png (${items.length}칸, 레퍼런스 ${refImgs.length}장${refImgs.length ? '' : ' — refs/ 비어 있음, 빌드 화면만'})`);
