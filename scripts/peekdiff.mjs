// 개발 중 확인용: out/dev/peek-<번호>.png가 기준선의 같은 장면과 얼마나 다른지 수치로 본다.
// 사용: node scripts/peekdiff.mjs <기준선 이름> <시점 번호...>   (평균 절대 차이 0~255, 8 넘게 다른 화소 비율)
import sharp from 'sharp';
const NAMES = ['01-yard', '02-entrance', '03-corridor', '04-hall-windows', '05-office-fluorescent', '06-loading-dock-stairs', '07-doorway-to-yard', '08-bot-in-room'];
const [base, ...views] = process.argv.slice(2);
for (const v of views) {
  const a = await sharp(`out/baseline/${base}/${NAMES[v]}.png`).removeAlpha().raw().toBuffer(), b = await sharp(`out/dev/peek-${v}.png`).removeAlpha().raw().toBuffer();
  let d = 0, n = 0; for (let i = 0; i < a.length; i += 3) { const e = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; d += e; if (e > 8) n++; }
  console.log(`${NAMES[v].padEnd(26)} 평균 차이 ${(d / (a.length / 3)).toFixed(2)}  ·  8 넘게 다른 화소 ${(n / (a.length / 3) * 100).toFixed(1)}%`);
}
