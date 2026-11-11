// 소리: 전부 코드로 합성. 몸에 단 카메라 마이크로 녹음된 것처럼 — 근접 총성은 찌그러지고, 직후 주변음이 줄어든다.
import { mulberry32 } from './rng.js';

const SR = 48000;
const TAU = Math.PI * 2;

// ---------- 합성 도구 ----------
function buf(sec) { return new Float32Array(Math.max(1, Math.floor(sec * SR))); }
function onePoleLP(x, fc) { const a = Math.exp(-TAU * fc / SR); let y = 0; for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; x[i] = y; } return x; }
function onePoleHP(x, fc) { const a = Math.exp(-TAU * fc / SR); let y = 0, px = 0; for (let i = 0; i < x.length; i++) { y = a * (y + x[i] - px); px = x[i]; x[i] = y; } return x; }
function bandpass(x, fc, q = 1) { // RBJ biquad
  const w = TAU * fc / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const xi = x[i]; const y = (b0 * xi + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y; }
  return x;
}
function normalize(x, peak = 0.9) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m; return x; }
function addInto(dst, src, offset = 0, gain = 1) { for (let i = 0; i < src.length && i + offset < dst.length; i++) if (i + offset >= 0) dst[i + offset] += src[i] * gain; return dst; }
function fade(x, inS = 0.002, outS = 0.01) { const a = Math.floor(inS * SR), b = Math.floor(outS * SR); for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a; for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= i / b; return x; }

function noiseBurst(r, sec, tau, attack = 0.0005) { const x = buf(sec); for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = (r() * 2 - 1) * Math.exp(-t / tau) * Math.min(1, t / attack); } return x; }
function sweep(sec, f0, f1, tau, phaseTau = 0.05) { const x = buf(sec); let ph = 0; for (let i = 0; i < x.length; i++) { const t = i / SR; const f = f1 + (f0 - f1) * Math.exp(-t / phaseTau); ph += TAU * f / SR; x[i] = Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.0015); } return x; }
function modes(r, sec, freqs, taus, amps) { const x = buf(sec); for (let k = 0; k < freqs.length; k++) { const f = freqs[k] * (0.97 + r() * 0.06), ph = r() * TAU; for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] += Math.sin(ph + TAU * f * t) * Math.exp(-t / taus[k]) * amps[k]; } } return x; }
function softsat(x, d) { const n = Math.tanh(d); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * d) / n; return x; }

// ---------- 소리 생성기 ----------
function gunshot(r, kind) {
  const rifle = kind === 'rifle';
  const len = rifle ? 0.6 : 0.45;
  const out = buf(len);
  // 초음속 크랙 + 화약 폭발음
  const crack = onePoleHP(noiseBurst(r, 0.02, rifle ? 0.0022 : 0.0016), 1800);
  addInto(out, crack, 0, 1.0);
  const blast = sweep(len, rifle ? 190 : 230, rifle ? 48 : 62, rifle ? 0.07 : 0.05, 0.02);
  addInto(out, blast, Math.floor(0.0008 * SR), rifle ? 1.1 : 0.8);
  const body = onePoleLP(noiseBurst(r, len, rifle ? 0.05 : 0.035, 0.0008), rifle ? 2200 : 2600);
  addInto(out, body, 0, rifle ? 1.6 : 1.3);
  const low = onePoleLP(noiseBurst(r, len, rifle ? 0.12 : 0.08, 0.003), 260);
  addInto(out, low, 0, 2.6);
  // 노리쇠·슬라이드 기계음
  const mech = modes(r, 0.05, [1900, 3400, 5200], [0.008, 0.006, 0.004], [0.2, 0.15, 0.1]);
  addInto(out, mech, Math.floor((rifle ? 0.012 : 0.018) * SR), 0.6);
  return fade(normalize(softsat(out, 1.4), 0.95), 0.0002, 0.05);
}
function footstep(r, mat) {
  let x;
  switch (mat) {
    case 'concrete': {
      x = buf(0.16);
      addInto(x, bandpass(noiseBurst(r, 0.05, 0.007), 1700 + r() * 500, 1.1), 0, 1.0);
      addInto(x, sweep(0.08, 120, 70, 0.018), 0, 0.5);
      addInto(x, onePoleLP(noiseBurst(r, 0.12, 0.03, 0.01), 1300), Math.floor(0.03 * SR), 0.35); // 끌림
      break;
    }
    case 'gravel': {
      x = buf(0.22);
      const n = 60 + Math.floor(r() * 40);
      for (let i = 0; i < n; i++) {
        const t = Math.pow(r(), 1.6) * 0.15;
        addInto(x, onePoleHP(noiseBurst(r, 0.004, 0.0007), 2500 + r() * 2500), Math.floor(t * SR), (0.3 + r() * 0.7) * Math.exp(-t / 0.08));
      }
      addInto(x, onePoleLP(noiseBurst(r, 0.1, 0.02), 500), 0, 0.25);
      break;
    }
    case 'metal': {
      x = buf(0.3);
      addInto(x, modes(r, 0.3, [380, 960, 1720, 2650, 3900], [0.11, 0.08, 0.06, 0.04, 0.03], [0.5, 0.45, 0.35, 0.2, 0.12]), 0, 1);
      addInto(x, onePoleLP(noiseBurst(r, 0.03, 0.004), 3000), 0, 0.5);
      break;
    }
    case 'tile': {
      x = buf(0.12);
      addInto(x, bandpass(noiseBurst(r, 0.02, 0.0025), 3600 + r() * 600, 1.6), 0, 1.2);
      addInto(x, modes(r, 0.06, [3100, 4700], [0.012, 0.008], [0.2, 0.15]), 0, 0.6);
      addInto(x, onePoleHP(onePoleLP(noiseBurst(r, 0.06, 0.012, 0.01), 3500), 800), Math.floor(0.025 * SR), 0.3);
      break;
    }
    case 'water': {
      x = buf(0.3);
      addInto(x, bandpass(noiseBurst(r, 0.25, 0.06, 0.01), 700 + r() * 200, 0.9), 0, 1.0);
      for (let i = 0; i < 6; i++) { const f0 = 400 + r() * 700; const s = sweep(0.04, f0, f0 * 1.8, 0.012, 0.02); addInto(s, s, 0, 0); addInto(x, s, Math.floor((0.02 + r() * 0.15) * SR), 0.25); }
      break;
    }
    default: x = footstep(r, 'concrete');
  }
  return fade(normalize(x, 0.8), 0.0005, 0.02);
}
function rustle(r) { const x = onePoleHP(onePoleLP(noiseBurst(r, 0.32, 0.12, 0.05), 5000), 900); for (let i = 0; i < x.length; i++) x[i] *= 0.6 + 0.4 * Math.sin(i / SR * TAU * (14 + r() * 6)); if (r() < 0.6) addInto(x, modes(r, 0.05, [2800, 4300], [0.01, 0.007], [0.4, 0.3]), Math.floor(r() * 0.2 * SR), 0.5); return fade(normalize(x, 0.6), 0.03, 0.08); }
function breath(r, inhale, heavy) {
  const len = (inhale ? 0.55 : 0.75) * (heavy ? 0.8 : 1.1);
  const x = buf(len);
  for (let i = 0; i < x.length; i++) x[i] = r() * 2 - 1;
  bandpass(x, inhale ? 1500 : 900, 0.8); onePoleLP(x, 3500);
  for (let i = 0; i < x.length; i++) { const t = i / x.length; x[i] *= Math.sin(Math.PI * Math.pow(t, inhale ? 0.7 : 1.3)) ** 1.5; }
  return fade(normalize(x, heavy ? 0.5 : 0.3), 0.02, 0.05);
}
function clack(r, f, tau, noiseAmt = 0.6) { const x = modes(r, tau * 6, [f, f * 1.73, f * 2.9], [tau, tau * 0.7, tau * 0.5], [0.5, 0.35, 0.2]); addInto(x, onePoleHP(noiseBurst(r, 0.02, 0.002), 1500), 0, noiseAmt); return fade(normalize(x, 0.7)); }
function magOut(r) { const x = buf(0.35); addInto(x, clack(r, 2300, 0.01), 0, 0.8); addInto(x, onePoleHP(onePoleLP(noiseBurst(r, 0.2, 0.08, 0.02), 4000), 700), Math.floor(0.02 * SR), 0.35); return normalize(x, 0.6); }
function magIn(r) { const x = buf(0.2); addInto(x, clack(r, 1700, 0.014, 0.9), 0, 1); addInto(x, clack(r, 3100, 0.006), Math.floor(0.012 * SR), 0.5); return normalize(x, 0.75); }
function charge(r) { const x = buf(0.4); addInto(x, clack(r, 2100, 0.01), 0, 0.6); addInto(x, onePoleHP(noiseBurst(r, 0.1, 0.03), 2000), Math.floor(0.01 * SR), 0.2); addInto(x, clack(r, 1500, 0.016, 1), Math.floor(0.16 * SR), 1); return normalize(x, 0.75); }
function dry(r) { return clack(r, 2600, 0.006, 0.4); }
function casingTink(r, mat) {
  if (mat === 'gravel' || mat === 'water') return fade(normalize(onePoleLP(noiseBurst(r, 0.04, 0.006), 2500), 0.3));
  const x = modes(r, 0.15, [4200, 6900, 9300], [0.05, 0.035, 0.02], [0.5, 0.35, 0.2]);
  return fade(normalize(x, mat === 'metal' ? 0.5 : 0.35));
}
function impact(r, mat) {
  let x;
  if (mat === 'metal') { x = modes(r, 0.25, [900, 2300, 3900, 6100], [0.08, 0.05, 0.03, 0.02], [0.5, 0.4, 0.3, 0.2]); addInto(x, onePoleHP(noiseBurst(r, 0.02, 0.002), 2000), 0, 0.8); }
  else if (mat === 'wood') { x = modes(r, 0.12, [320, 780, 1500], [0.02, 0.012, 0.008], [0.6, 0.4, 0.2]); addInto(x, bandpass(noiseBurst(r, 0.05, 0.006), 1800, 1), 0, 0.8); }
  else if (mat === 'gravel' || mat === 'water') { x = onePoleLP(noiseBurst(r, 0.2, 0.03, 0.001), 1500); addInto(x, onePoleHP(noiseBurst(r, 0.1, 0.02), 3000), Math.floor(0.01 * SR), 0.4); }
  else { x = bandpass(noiseBurst(r, 0.12, 0.012), 2200, 0.8); addInto(x, onePoleHP(noiseBurst(r, 0.25, 0.05, 0.01), 2500), Math.floor(0.008 * SR), 0.25); }
  return fade(normalize(x, 0.8));
}
function snap(r) { const x = onePoleHP(noiseBurst(r, 0.03, 0.0025), 1500); addInto(x, sweep(0.03, 3000, 1500, 0.006, 0.01), 0, 0.3); return fade(normalize(x, 0.9)); }
function bodyHit(r) { const x = sweep(0.25, 140, 55, 0.05, 0.03); addInto(x, onePoleLP(noiseBurst(r, 0.2, 0.04, 0.002), 900), 0, 0.8); addInto(x, rustle(r), Math.floor(0.03 * SR), 0.3); return fade(normalize(x, 0.9)); }
function bodyFall(r) { const x = buf(0.9); addInto(x, sweep(0.3, 90, 45, 0.06, 0.05), 0, 0.8); addInto(x, onePoleLP(noiseBurst(r, 0.3, 0.06, 0.004), 700), 0, 0.6); addInto(x, sweep(0.25, 80, 40, 0.05, 0.05), Math.floor(0.22 * SR), 0.5); addInto(x, rustle(r), Math.floor(0.05 * SR), 0.5); addInto(x, clack(r, 1300, 0.03, 0.5), Math.floor(0.3 * SR), 0.35); return fade(normalize(x, 0.85)); }
function loop(sec, gen) { // 끝과 처음을 겹쳐 끊김 없는 반복
  const n = Math.floor(sec * SR), x = gen(n + Math.floor(SR * 0.5)), ov = Math.floor(SR * 0.5), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i];
  for (let i = 0; i < ov; i++) { const a = i / ov; out[i] = x[i] * a + x[n + i] * (1 - a); }
  return out;
}
function ambOutdoor(r) {
  return loop(8, (n) => {
    const x = new Float32Array(n); let b = 0;
    for (let i = 0; i < n; i++) { b = b * 0.995 + (r() * 2 - 1) * 0.05; x[i] = b; }
    onePoleLP(x, 500);
    const t2 = new Float32Array(n); for (let i = 0; i < n; i++) t2[i] = r() * 2 - 1; onePoleLP(t2, 140); onePoleLP(t2, 140);
    for (let i = 0; i < n; i++) { const t = i / SR; x[i] = x[i] * (0.6 + 0.4 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1)) + t2[i] * 0.5 * (0.7 + 0.3 * Math.sin(t * 0.3)); }
    // 멀리서 가끔 들리는 금속성 소리
    addInto(x, onePoleLP(modes(r, 0.6, [610, 1340], [0.2, 0.12], [0.3, 0.2]), 1200), Math.floor(n * 0.4), 0.15);
    return normalize(x, 0.5);
  });
}
function ambIndoor(r) {
  return loop(6, (n) => {
    const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = r() * 2 - 1; onePoleLP(x, 300); onePoleLP(x, 300);
    for (let i = 0; i < n; i++) { const t = i / SR; x[i] = x[i] * 0.8 + 0.05 * Math.sin(TAU * 100 * t) + 0.02 * Math.sin(TAU * 200 * t + 1) + 0.012 * Math.sin(TAU * 300 * t + 2) + 0.004 * Math.sin(TAU * 1200 * t) * (Math.sin(TAU * 100 * t) > 0.8 ? 1 : 0); }
    return normalize(x, 0.4);
  });
}
function windNoise(r) { return loop(4, (n) => { const x = new Float32Array(n); let b = 0; for (let i = 0; i < n; i++) { b = b * 0.98 + (r() * 2 - 1) * 0.2; x[i] = b; } onePoleLP(x, 400); for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= 0.6 + 0.4 * Math.sin(t * 9 + Math.sin(t * 3)); } return normalize(x, 0.8); }); }

// 공간 잔향 IR (스테레오). rt = -60 dB 감쇠 시간
function makeIR(r, env) {
  const P = {
    outdoor: { rt: 0.32, len: 0.9, early: [[0.072, 0.35], [0.155, 0.18], [0.31, 0.08]], hfRt: 0.22, lp: 6000 },
    room: { rt: 0.78, len: 1.6, early: [[0.006, 0.5], [0.011, 0.4], [0.017, 0.35], [0.024, 0.3], [0.031, 0.25]], hfRt: 0.45, lp: 7000 },
    corridor: { rt: 1.15, len: 2.2, early: [[0.005, 0.5], [0.009, 0.45], [0.014, 0.42], [0.019, 0.4], [0.024, 0.37], [0.029, 0.33], [0.034, 0.3]], hfRt: 0.6, lp: 6500 },
    hall: { rt: 2.3, len: 3.6, early: [[0.018, 0.4], [0.033, 0.35], [0.047, 0.3], [0.061, 0.28], [0.08, 0.25]], hfRt: 1.2, lp: 5500 },
  }[env];
  const n = Math.floor(P.len * SR);
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const lo = new Float32Array(n), hi = new Float32Array(n);
    for (let i = 0; i < n; i++) { lo[i] = r() * 2 - 1; hi[i] = r() * 2 - 1; }
    onePoleLP(lo, 900); onePoleHP(hi, 900); onePoleLP(hi, P.lp);
    const x = new Float32Array(n);
    const pre = Math.floor((env === 'outdoor' ? 0.06 : 0.004) * SR);
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / SR;
      x[i] = lo[i] * 2.2 * Math.exp(-6.9 * t / P.rt) + hi[i] * Math.exp(-6.9 * t / P.hfRt);
      if (env !== 'outdoor') x[i] *= Math.min(1, t / 0.012);
      else x[i] *= 0.35;
    }
    for (const [t, a] of P.early) { const k = Math.floor((t * (c ? 1.07 : 0.95)) * SR); if (k < n) { x[k] += a * (r() < 0.5 ? -1 : 1) * 3; if (k + 1 < n) x[k + 1] += a * 1.5; } }
    chans.push(normalize(x, 0.5));
  }
  return chans;
}

// ---------- FFT, 통계 ----------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const ar = re[i + j], ai = im[i + j], br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr; re[i + j] = ar + br; im[i + j] = ai + bi; re[i + j + len / 2] = ar - br; im[i + j + len / 2] = ai - bi; const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr; } }
  }
}
const BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export function analyze(x, sr) {
  const db = v => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -120);
  let peak = 0, peakI = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) { peak = a; peakI = i; } }
  let first = 0, last = 0; const th = 0.001;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > th) { first = i; break; }
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > th) { last = i; break; }
  let s = 0; for (let i = first; i <= last; i++) s += x[i] * x[i];
  const rms = Math.sqrt(s / Math.max(1, last - first + 1));
  // 10 ms RMS 엔벨로프로 잔향 감쇠 시간(-40 dB)
  const w = Math.floor(sr * 0.01), env = [];
  for (let i = 0; i + w <= x.length; i += w) { let e = 0; for (let k = 0; k < w; k++) e += x[i + k] ** 2; env.push(Math.sqrt(e / w)); }
  let ep = 0, epi = 0; env.forEach((v, i) => { if (v > ep) { ep = v; epi = i; } });
  let tailI = epi; for (let i = epi; i < env.length; i++) if (env[i] > ep * 0.01) tailI = i;
  // 스펙트럼
  const N = 8192; const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N && first + i < x.length; i++) re[i] = x[first + i] * (0.5 - 0.5 * Math.cos(TAU * i / (N - 1)));
  fft(re, im);
  let num = 0, den = 0; const bandE = BANDS.map(() => 0);
  for (let k = 1; k < N / 2; k++) {
    const f = k * sr / N, m = re[k] * re[k] + im[k] * im[k];
    num += f * m; den += m;
    for (let b = 0; b < BANDS.length; b++) if (f >= BANDS[b] / Math.SQRT2 && f < BANDS[b] * Math.SQRT2) bandE[b] += m;
  }
  const tot = bandE.reduce((a, b) => a + b, 0) || 1;
  return {
    durationMs: Math.round((last - first) / sr * 1000), peakDb: db(peak), rmsDb: db(rms), clipped: peak >= 0.999,
    tailMs: (tailI - epi) * 10, centroidHz: Math.round(num / (den || 1)),
    bandEnergyDb: Object.fromEntries(BANDS.map((b, i) => [b, +(10 * Math.log10(bandE[i] / tot + 1e-12)).toFixed(1)])),
  };
}

// ---------- 엔진 ----------
const ZONES = ['outdoor', 'room', 'corridor', 'hall'];

export class Sound {
  constructor(seed) {
    this.r = mulberry32(seed * 31 + 9);
    this.bank = null;
    this.ctx = null;
  }

  async generate(onProgress) {
    const r = this.r, B = {};
    const steps = [
      ['rifle', () => [0, 1, 2, 3].map(() => gunshot(r, 'rifle'))],
      ['pistol', () => [0, 1, 2].map(() => gunshot(r, 'pistol'))],
      ...['concrete', 'gravel', 'metal', 'tile', 'water'].map(m => ['step_' + m, () => [0, 1, 2, 3, 4, 5].map(() => footstep(r, m))]),
      ['rustle', () => [0, 1, 2, 3, 4].map(() => rustle(r))],
      ['breathIn', () => [0, 1, 2].map(() => breath(r, true, false))], ['breathOut', () => [0, 1, 2].map(() => breath(r, false, false))],
      ['breathInH', () => [0, 1, 2].map(() => breath(r, true, true))], ['breathOutH', () => [0, 1, 2].map(() => breath(r, false, true))],
      ['magOut', () => [0, 1].map(() => magOut(r))], ['magIn', () => [0, 1].map(() => magIn(r))], ['charge', () => [0, 1].map(() => charge(r))], ['dry', () => [dry(r)]],
      ...['concrete', 'metal', 'gravel'].map(m => ['tink_' + m, () => [0, 1, 2].map(() => casingTink(r, m))]),
      ...['concrete', 'metal', 'wood', 'gravel'].map(m => ['impact_' + m, () => [0, 1, 2].map(() => impact(r, m))]),
      ['snap', () => [0, 1, 2].map(() => snap(r))], ['bodyHit', () => [0, 1].map(() => bodyHit(r))], ['bodyFall', () => [0, 1, 2].map(() => bodyFall(r))],
      ['ambOut', () => [ambOutdoor(r)]], ['ambIn', () => [ambIndoor(r)]], ['wind', () => [windNoise(r)]],
      ...ZONES.map(z => ['ir_' + z, () => [makeIR(r, z)]]),
    ];
    let i = 0;
    for (const [k, fn] of steps) { B[k] = fn(); i++; onProgress?.(i / steps.length); await new Promise(res => setTimeout(res, 0)); }
    this.raw = B;
    return B;
  }

  toBuffers() {
    const out = {};
    for (const k in this.raw) out[k] = this.raw[k].map(d => {
      if (Array.isArray(d)) { const b = new AudioBuffer({ numberOfChannels: 2, length: d[0].length, sampleRate: SR }); b.copyToChannel(d[0], 0); b.copyToChannel(d[1], 1); return b; }
      const b = new AudioBuffer({ numberOfChannels: 1, length: d.length, sampleRate: SR }); b.copyToChannel(d, 0); return b;
    });
    return out;
  }

  // 마이크 체인: 소리 → (잔향 보내기) → 프리앰프 → 포화 → AGC 압축 → 리미터
  static buildChain(ctx, bank) {
    const C = {};
    C.mic = ctx.createGain(); C.mic.gain.value = 1;
    C.pre = ctx.createGain(); C.pre.gain.value = 1.0;
    C.shaper = ctx.createWaveShaper();
    const n = 2048, curve = new Float32Array(n), d = 2.2;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * d) / Math.tanh(d) * (x > 0 ? 1 : 0.94); }
    C.shaper.curve = curve; C.shaper.oversample = '4x';
    C.agc = ctx.createDynamicsCompressor();
    C.agc.threshold.value = -22; C.agc.knee.value = 6; C.agc.ratio.value = 6; C.agc.attack.value = 0.002; C.agc.release.value = 0.35;
    C.post = ctx.createGain(); C.post.gain.value = 0.62;
    C.lim = ctx.createDynamicsCompressor();
    C.lim.threshold.value = -3; C.lim.knee.value = 0; C.lim.ratio.value = 20; C.lim.attack.value = 0.001; C.lim.release.value = 0.1;
    C.hp = ctx.createBiquadFilter(); C.hp.type = 'highpass'; C.hp.frequency.value = 90; // 작은 마이크는 저음이 약하다
    C.mic.connect(C.hp).connect(C.pre).connect(C.shaper).connect(C.agc).connect(C.post).connect(C.lim);
    C.out = C.lim;
    C.rev = {};
    for (const z of ZONES) {
      const cv = ctx.createConvolver(); cv.normalize = false; cv.buffer = bank['ir_' + z][0];
      const g = ctx.createGain(); g.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      g.connect(cv).connect(lp).connect(C.mic);
      C.rev[z] = g;
    }
    C.amb = ctx.createGain(); C.amb.gain.value = 1; C.amb.connect(C.mic);
    return C;
  }

  async start(listenerCtx) {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {}); return; }
    this.ctx = listenerCtx || new AudioContext({ sampleRate: SR, latencyHint: 'interactive' });
    this.bank = this.toBuffers();
    this.C = Sound.buildChain(this.ctx, this.bank);
    this.C.out.connect(this.ctx.destination);
    this.master = this.C.post;
    // 주변음
    this.ambOut = this.loopSrc('ambOut', 0); this.ambIn = this.loopSrc('ambIn', 0); this.windSrc = this.loopSrc('wind', 0, false);
    this.zone = 'outdoor';
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
  }
  loopSrc(name, gain, toAmb = true) {
    const s = this.ctx.createBufferSource(); s.buffer = this.bank[name][0]; s.loop = true;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(toAmb ? this.C.amb : this.C.mic); s.start();
    return g;
  }
  pick(name) { const a = this.bank[name]; return a[Math.floor(this.r() * a.length)]; }

  // pos: 소리 위치(없으면 몸 가까이), zone: 소리가 울리는 공간
  play(name, { gain = 1, rate = 1, pos = null, listener = null, zone = null, occluded = false, send = null, delay = 0 } = {}) {
    if (!this.ctx || !this.bank[name]) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.pick(name); src.playbackRate.value = rate * (0.97 + this.r() * 0.06);
    const g = ctx.createGain(); let node = src;
    let dist = 0, pan = 0;
    if (pos && listener) {
      const dx = pos.x - listener.pos.x, dy = pos.y - listener.pos.y, dz = pos.z - listener.pos.z;
      dist = Math.hypot(dx, dy, dz);
      const ang = Math.atan2(-dx, -dz) - listener.yaw;
      pan = -Math.sin(ang) * 0.4;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = Math.max(500, 16000 / (1 + dist * 0.12)) * (occluded ? 0.12 : 1);
      node.connect(lp); node = lp;
      gain *= 1 / (1 + dist / 3.5) * (occluded ? 0.45 : 1);
    }
    g.gain.value = gain;
    node.connect(g);
    const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p);
    p.connect(this.C.mic);
    const z = zone || this.zone;
    const sendAmt = send ?? (0.35 + Math.min(0.6, dist * 0.03));
    if (sendAmt > 0) { const sg = ctx.createGain(); sg.gain.value = sendAmt; p.connect(sg).connect(this.C.rev[z]); this.C.rev[z].gain.value = 1; }
    src.start(t);
    src.onended = () => { try { p.disconnect(); g.disconnect(); } catch (e) {} };
    return dist;
  }

  duck(amount = 0.25, recover = 1.4) {
    if (!this.ctx) return;
    const g = this.C.amb.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(amount, t + 0.01); g.setTargetAtTime(1, t + 0.15, recover / 3);
  }

  // 매 프레임: 공간에 맞춘 주변음, 회전 속도에 따른 바람
  update(dt, { zone, yawVel, speed, exertion }) {
    if (!this.ctx) return;
    this.zone = zone;
    const t = this.ctx.currentTime;
    this.ambOut.gain.setTargetAtTime(zone === 'outdoor' ? 0.32 : 0.05, t, 0.4);
    this.ambIn.gain.setTargetAtTime(zone === 'outdoor' ? 0.0 : (zone === 'hall' ? 0.07 : 0.1), t, 0.4);
    const w = Math.min(1, Math.max(0, Math.abs(yawVel) - 1.2) / 5) * 0.7 + Math.min(1, speed / 5) * 0.08 + (zone === 'outdoor' ? 0.03 : 0);
    this.windSrc.gain.setTargetAtTime(w, t, 0.06);
    // 숨소리
    this.breathT = (this.breathT ?? 1) - dt;
    if (this.breathT <= 0) {
      const heavy = exertion > 0.55;
      this.breathPhase = !this.breathPhase;
      this.play((this.breathPhase ? 'breathIn' : 'breathOut') + (heavy ? 'H' : ''), { gain: 0.12 + exertion * 0.25, send: 0.05 });
      this.breathT = (heavy ? 0.55 : 1.4 - exertion * 0.6) * (0.85 + this.r() * 0.3) + (this.breathPhase ? 0 : 0.3 + this.r() * 0.5);
    }
  }

  // ---------- 오프라인 측정 (npm run audio) ----------
  async offlineStats() {
    if (!this.raw) await this.generate();
    const bank = this.toBuffers();
    const render = async (name, { zone = 'outdoor', gain = 1, send = 0.35, seconds = 3.5, seq = null, amb = false } = {}) => {
      const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.floor(SR * seconds), sampleRate: SR });
      const C = Sound.buildChain(ctx, bank);
      C.out.connect(ctx.destination);
      const items = seq || [[name, 0, gain]];
      for (const [n, at, g] of items) {
        const s = ctx.createBufferSource(); s.buffer = bank[n][0];
        if (s.buffer.length / SR < seconds && amb) s.loop = true;
        const gg = ctx.createGain(); gg.gain.value = g;
        s.connect(gg).connect(amb ? C.amb : C.mic);
        if (send > 0) { const sg = ctx.createGain(); sg.gain.value = send; gg.connect(sg).connect(C.rev[zone]); C.rev[zone].gain.value = 1; }
        s.start(at);
      }
      const out = await ctx.startRendering();
      return analyze(out.getChannelData(0), SR);
    };
    const sounds = [];
    const add = async (name, src, opts) => sounds.push({ name, ...(await render(src, opts)) });
    await add('gunshot_outdoor', 'rifle', { zone: 'outdoor', gain: 1.6, send: 0.5 });
    await add('gunshot_indoor_room', 'rifle', { zone: 'room', gain: 1.6, send: 0.5 });
    await add('gunshot_corridor', 'rifle', { zone: 'corridor', gain: 1.6, send: 0.5 });
    await add('gunshot_indoor_hall', 'rifle', { zone: 'hall', gain: 1.6, send: 0.5 });
    await add('pistol_indoor_room', 'pistol', { zone: 'room', gain: 1.4, send: 0.5 });
    for (const m of ['concrete', 'gravel', 'metal', 'tile', 'water']) await add('footstep_' + m, 'step_' + m, { zone: 'outdoor', gain: 0.5, send: 0, seconds: 1 });
    await add('reload_rifle', null, { zone: 'room', send: 0.2, seconds: 3, seq: [['magOut', 0, 0.7], ['magIn', 1.1, 0.8], ['charge', 1.6, 0.8]] });
    await add('ambient_outdoor', 'ambOut', { zone: 'outdoor', gain: 0.32, send: 0, seconds: 4, amb: true });
    await add('ambient_indoor', 'ambIn', { zone: 'room', gain: 0.1, send: 0, seconds: 4, amb: true });
    await add('breathing_heavy', 'breathInH', { gain: 0.37, send: 0.05, seconds: 1.5 });
    await add('gear_rustle', 'rustle', { gain: 0.25, send: 0.1, seconds: 1 });
    await add('casing_concrete', 'tink_concrete', { gain: 0.3, send: 0.2, seconds: 1 });
    return { sampleRate: SR, bands: BANDS, sounds };
  }
}
