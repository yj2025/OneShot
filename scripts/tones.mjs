// 개발 중 확인용: 이미지의 밝기 분포(화면값 0~255의 백분위)를 출력한다. 레퍼런스와 빌드의 계조를 수치로 견줄 때 쓴다.
// 사용: node scripts/tones.mjs <파일 또는 폴더> ...   (비교 시트와 같은 띠만 본다: 가로 3.5~96.5%, 세로 20~86%)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const files = [];
for (const a of process.argv.slice(2)) {
  if (fs.statSync(a).isDirectory()) for (const f of fs.readdirSync(a).sort()) { if (/\.(png|jpg)$/i.test(f) && !/^strip-/.test(f)) files.push(path.join(a, f)); }
  else files.push(a);
}
const pct = (h, n, p) => { let c = 0; for (let i = 0; i < 256; i++) { c += h[i]; if (c >= n * p) return i; } return 255; };
const rows = [];
for (const f of files) {
  const m = await sharp(f).metadata();
  const left = Math.round(m.width * 0.035), top = Math.round(m.height * 0.2), width = Math.round(m.width * 0.93), height = Math.round(m.height * 0.66);
  const { data, info } = await sharp(f).extract({ left, top, width, height }).resize(320, null).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const h = new Array(256).fill(0); const n = info.width * info.height; let sat = 0;
  for (let i = 0; i < n; i++) { const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]; h[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++; sat += Math.max(r, g, b) - Math.min(r, g, b); }
  // 이웃 화소와의 밝기 차(잔디테일의 대비)
  let lc = 0, k = 0;
  for (let y = 0; y < info.height; y++) for (let x = 1; x < info.width; x++) { const i = (y * info.width + x) * 3; lc += Math.abs(data[i + 1] - data[i - 2]); k++; }
  const r = { f: path.basename(f), p2: pct(h, n, 0.02), p10: pct(h, n, 0.1), p25: pct(h, n, 0.25), p50: pct(h, n, 0.5), p75: pct(h, n, 0.75), p90: pct(h, n, 0.9), p98: pct(h, n, 0.98), dark: (h.slice(0, 26).reduce((a, b) => a + b, 0) / n * 100), white: (h.slice(235).reduce((a, b) => a + b, 0) / n * 100), sat: sat / n, lc: lc / k };
  rows.push(r);
  console.log(`${r.f.padEnd(30)} p2 ${String(r.p2).padStart(3)} p10 ${String(r.p10).padStart(3)} p25 ${String(r.p25).padStart(3)} p50 ${String(r.p50).padStart(3)} p75 ${String(r.p75).padStart(3)} p90 ${String(r.p90).padStart(3)} p98 ${String(r.p98).padStart(3)} | <26: ${r.dark.toFixed(0).padStart(2)}%  >234: ${r.white.toFixed(0).padStart(2)}%  채도 ${r.sat.toFixed(0).padStart(2)}  이웃차 ${r.lc.toFixed(1)}`);
}
const med = (k) => { const v = rows.map(r => r[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
if (rows.length > 1) console.log(`${'중앙값'.padEnd(28)} p2 ${String(med('p2')).padStart(3)} p10 ${String(med('p10')).padStart(3)} p25 ${String(med('p25')).padStart(3)} p50 ${String(med('p50')).padStart(3)} p75 ${String(med('p75')).padStart(3)} p90 ${String(med('p90')).padStart(3)} p98 ${String(med('p98')).padStart(3)} | <26: ${med('dark').toFixed(0).padStart(2)}%  >234: ${med('white').toFixed(0).padStart(2)}%  채도 ${med('sat').toFixed(0).padStart(2)}  이웃차 ${med('lc').toFixed(1)}`);
