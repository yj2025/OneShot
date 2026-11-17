// 봇 장면 모아 보기(2단계 ①, 살펴보기): node scripts/_botsheet.mjs <촬영 폴더> <출력.jpg>
import fs from 'node:fs';
import sharp from 'sharp';
const [d, out] = process.argv.slice(2);
const f = fs.readdirSync(d).filter(x => /close-bot/.test(x)).sort();
const t = await Promise.all(f.map(x => sharp(`${d}/${x}`).resize(640, 360).toBuffer()));
const strips = fs.readdirSync(d).filter(x => /^strip-bot-/.test(x)).sort();
const s = await Promise.all(strips.map(x => sharp(`${d}/${x}`).resize(1280, 90).toBuffer()));
const rows = Math.ceil(t.length / 2);
await sharp({ create: { width: 1280, height: 360 * rows + 90 * s.length, channels: 3, background: '#000' } })
  .composite([...t.map((b, i) => ({ input: b, left: (i % 2) * 640, top: Math.floor(i / 2) * 360 })), ...s.map((b, i) => ({ input: b, left: 0, top: 360 * rows + i * 90 }))])
  .jpeg({ quality: 85 }).toFile(out);
console.log(out, f.length, strips.length);
