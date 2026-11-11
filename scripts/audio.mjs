// npm run audio: 소리를 오프라인으로 렌더링해 통계를 out/audio.json에 저장하고 공간·재질 차이를 수치로 확인
import fs from 'node:fs';
import path from 'node:path';
import { OUT, ensureDir, build, launch, openGame } from './lib.mjs';

if (!process.argv.includes('--nobuild')) build();
const L = await launch({ width: 640, height: 360 });
const { page, errors } = await openGame(L.context, 'test=1&seed=3');
const stats = await page.evaluate(() => window.__bc.audioTest());
await L.browser.close();

const checks = [];
const by = n => stats.sounds.find(s => s.name === n);
const hallT = by('gunshot_indoor_hall').tailMs, roomT = by('gunshot_indoor_room').tailMs, outT = by('gunshot_outdoor').tailMs;
checks.push({ name: '실내(홀) 총성 울림 > 실외', ok: hallT > outT * 1.5, detail: `홀 ${hallT} ms, 방 ${roomT} ms, 실외 ${outT} ms (-40 dB 감쇠 시간)` });
checks.push({ name: '실내(방) 총성 울림 > 실외', ok: roomT > outT * 1.2, detail: `방 ${roomT} ms vs 실외 ${outT} ms` });
const steps = stats.sounds.filter(s => s.name.startsWith('footstep_'));
let minGap = Infinity;
for (let i = 0; i < steps.length; i++) for (let j = i + 1; j < steps.length; j++) minGap = Math.min(minGap, Math.abs(Math.log2(steps[i].centroidHz / steps[j].centroidHz)));
checks.push({ name: '재질별 발소리의 주파수 분포가 서로 다름', ok: minGap > 0.15, detail: steps.map(s => `${s.name.replace('footstep_', '')} ${s.centroidHz} Hz`).join(', ') + ` / 무게중심 최소 간격 ${minGap.toFixed(2)} 옥타브` });
const clipped = stats.sounds.filter(s => s.clipped).map(s => s.name);
checks.push({ name: '최종 출력 클리핑(0 dBFS 초과) 없음', ok: clipped.length === 0, detail: clipped.join(', ') || '없음' });
checks.push({ name: '콘솔 오류 없음', ok: errors.length === 0, detail: errors.join(' | ') });

ensureDir(OUT);
fs.writeFileSync(path.join(OUT, 'audio.json'), JSON.stringify({ sampleRate: stats.sampleRate, bands: stats.bands, sounds: stats.sounds, checks, measuredAt: new Date().toISOString() }, null, 2));
for (const s of stats.sounds) console.log(`  ${s.name.padEnd(24)} ${String(s.durationMs).padStart(5)} ms  peak ${s.peakDb} dB  rms ${s.rmsDb} dB  tail ${s.tailMs} ms  centroid ${s.centroidHz} Hz${s.clipped ? '  CLIP' : ''}`);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);
process.exit(checks.every(c => c.ok) ? 0 : 1);
