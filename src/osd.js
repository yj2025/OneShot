// 녹화 표시: 렌즈를 거치지 않는 2D 오버레이 (날짜·시각·장치 ID)
const pad = (n, l = 2) => String(n).padStart(l, '0');

export class OSD {
  constructor(canvas, seed) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.device = 'KESTREL BC-7';
    this.serial = 'X' + String(40000 + (seed * 7919) % 59999).padStart(5, '0');
    this.officer = 'TRN-' + pad((seed * 37) % 97 + 3, 3);
    // 영상 속 시각: 흐린 날 늦은 오후
    const now = new Date();
    this.base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 41, 12).getTime();
    this.t0 = performance.now();
  }
  resize(w, h) { this.c.width = w; this.c.height = h; this.w = w; this.h = h; }
  draw(elapsed, visible = true) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (!visible) return;
    const d = new Date(this.base + elapsed * 1000);
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} +0900`;
    const fs = Math.round(h * 0.026);
    ctx.font = `600 ${fs}px Consolas, "Lucida Console", "DejaVu Sans Mono", monospace`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    const x = w - Math.round(w * 0.035), y = Math.round(h * 0.04);
    const lines = [`${date}  T${time}`, `${this.device}  ${this.serial}`];
    ctx.lineJoin = 'round';
    for (let i = 0; i < lines.length; i++) {
      const yy = y + i * fs * 1.25;
      ctx.lineWidth = Math.max(2, fs * 0.16); ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(lines[i], x, yy);
      ctx.fillStyle = 'rgba(238,238,232,0.92)';
      ctx.fillText(lines[i], x, yy);
    }
    // 아래 왼쪽: 담당 ID
    ctx.textAlign = 'left';
    const yb = h - Math.round(h * 0.06) - fs;
    ctx.lineWidth = Math.max(2, fs * 0.16); ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(this.officer, Math.round(w * 0.035), yb);
    ctx.fillStyle = 'rgba(238,238,232,0.9)'; ctx.fillText(this.officer, Math.round(w * 0.035), yb);
  }
}
