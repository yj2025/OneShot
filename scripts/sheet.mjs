// npm run sheet [라운드]: 빌드 화면과 refs/ 이미지를 같은 크기·같은 압축으로 섞은 비교 시트와 정답 키
//   out/sheets/round-N-1.png, -2.png …   한 장에 4칸. 칸이 많으면 판정자가 읽을 때 축소되어 세부가 사라진다
//   out/sheets/round-N-strip-K.png       연속 프레임 묶음을 4장씩 두 줄로 다시 놓은 것 (판정자에게는 이쪽을 준다)
//   out/keys/round-N.json                 어느 칸이 빌드인지
// refs/sheet.json (선택, 커밋되지 않음): { "crop": { "left": 0.035, "right": 0.965, "top": 0.2, "bottom": 0.86 }, "exclude": ["02.png"] }
//   crop은 빌드 칸과 레퍼런스 칸에 똑같이 적용한다. 레퍼런스에 자막·재생 버튼·로고가 박혀 있을 때 그 띠를 모든 칸에서 잘라 내서
//   판정자가 화면 품질이 아니라 그 표시로 구분하는 일을 막는다. exclude는 잘라도 표시가 남는 레퍼런스를 시트에서 뺀다.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, OUT, ensureDir } from './lib.mjs';
import { shuffle, label, stripBlock, page, STRIP_NOTE } from './sheetlib.mjs';

const sheets = ensureDir(path.join(OUT, 'sheets'));
const keys = ensureDir(path.join(OUT, 'keys'));
const shotsDir = path.join(OUT, 'shots');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const argRound = process.argv.slice(2).find(a => /^\d+$/.test(a));
const used = fs.readdirSync(sheets).map(f => /^round-(\d+)[-.]/.exec(f)).filter(Boolean).map(m => +m[1]);
const round = argRound ? +argRound : Math.max(0, ...used) + 1;
for (const f of fs.readdirSync(sheets)) if (new RegExp(`^round-${round}[-.]`).test(f)) fs.rmSync(path.join(sheets, f));

const refDir = path.join(ROOT, 'refs');
const cfgFile = path.join(refDir, 'sheet.json');
const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
const crop = { left: 0, right: 1, top: 0, bottom: 1, ...(cfg.crop || {}) };
const exclude = new Set(cfg.exclude || []);
const cropped = crop.left > 0 || crop.right < 1 || crop.top > 0 || crop.bottom < 1;

// 장면이 라운드마다 달라지면 난이도가 흔들린다. 빌드 정지 화면은 전부 넣는다
// 가까운 장면(-close-)은 A/B에만 쓴다. 레퍼런스 비교는 칸 수와 구성을 이전 라운드와 같게 둔다
const buildImgs = fs.readdirSync(shotsDir).filter(f => /^\d\d-.*\.png$/.test(f) && !/-close-/.test(f)).sort().map(f => path.join(shotsDir, f));
const refAll = fs.existsSync(refDir) ? fs.readdirSync(refDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort() : [];
const refImgs = refAll.filter(f => !exclude.has(f)).map(f => path.join(refDir, f));
if (!buildImgs.length) { console.error('out/shots/에 정지 화면이 없다. 먼저 npm run shots'); process.exit(1); }
const items = shuffle([...buildImgs.map(p => ({ p, build: true })), ...refImgs.map(p => ({ p, build: false }))]);
if (items.length > 26) { console.error(`칸이 ${items.length}개다. 이름이 A~Z라 26칸까지만 만든다.`); process.exit(1); }
const names = items.map((_, i) => String.fromCharCode(65 + i));

// 모든 칸이 같은 경로를 거친다: 같은 띠 자르기 → 같은 크기 → 같은 JPEG 압축(q80). 출처마다 다른 압축 흔적을 덮는다
const CW = cropped ? 704 : 640, CH = Math.round(CW * 9 / 16 * (crop.bottom - crop.top) / (crop.right - crop.left));
async function cell(file) {
  const m = await sharp(file).metadata();
  const left = Math.round(m.width * crop.left), top = Math.round(m.height * crop.top);
  const width = Math.round(m.width * crop.right) - left, height = Math.round(m.height * crop.bottom) - top;
  const jpg = await sharp(file).removeAlpha().extract({ left, top, width, height }).resize(CW, CH, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
  return sharp(jpg).png().toBuffer();
}

const PER = 4, COLS = 2, M = 12, GAP = 16, LAB = 32;
const pages = [];
for (let s = 0; s < items.length; s += PER) {
  const part = items.slice(s, s + PER), comps = [];
  for (let k = 0; k < part.length; k++) {
    const x = M + (k % COLS) * (CW + GAP), y = M + Math.floor(k / COLS) * (LAB + CH + M);
    comps.push({ input: label(CW, LAB, names[s + k], 22), left: x, top: y }, { input: await cell(part[k].p), left: x, top: y + LAB });
  }
  const file = path.join(sheets, `round-${round}-${pages.length + 1}.png`);
  await page(M * 2 + CW * COLS + GAP * (COLS - 1), M + Math.ceil(part.length / COLS) * (LAB + CH + M), comps, file);
  pages.push(file);
}

// 연속 프레임 묶음: 판정자가 읽기 좋은 크기로 다시 놓는다 (이름은 중립 번호)
const stripFiles = fs.readdirSync(shotsDir).filter(f => /^strip-.*\.png$/.test(f)).sort();
const strips = [];
for (const f of stripFiles) {
  const b = await stripBlock(path.join(shotsDir, f), 380, 214);
  const file = path.join(sheets, `round-${round}-strip-${strips.length + 1}.png`);
  await page(M * 2 + b.w, M * 2 + LAB + b.h, [{ input: label(b.w, LAB, `strip ${strips.length + 1}   (${STRIP_NOTE})`), left: M, top: M }, { input: b.buf, left: M, top: M + LAB }], file);
  strips.push(file);
}

fs.writeFileSync(path.join(keys, `round-${round}.json`), JSON.stringify({ round, build: names.filter((_, i) => items[i].build), total: items.length, refs: refImgs.length }));
console.log(`비교 시트 라운드 ${round}: ${items.length}칸 (빌드 ${buildImgs.length}, 레퍼런스 ${refImgs.length}${exclude.size ? `, 제외한 레퍼런스 ${refAll.length - refImgs.length}` : ''}${refImgs.length ? '' : ' — refs/ 비어 있음, 빌드 화면만'})${cropped ? ', 모든 칸에 같은 띠 자르기 적용' : ''}`);
for (const f of [...pages, ...strips]) console.log(`  ${rel(f)}`);
