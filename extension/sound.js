// 音效：全部用 Web Audio 现场合成，不带音频文件。
// 每次关注音高往上走一级；进度过半后叠加低频"咚"，越接近满额越重越长；满额奏一个上行和弦；撞限是两个往下走的低音。
(function (root) {
  let ctx = null;

  function audio() {
    if (!ctx) {
      const C = root.AudioContext || root.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function bus(c, volume) {
    const g = c.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume));
    const comp = c.createDynamicsCompressor();
    g.connect(comp).connect(c.destination);
    return g;
  }

  function tone(c, out, o) {
    const t0 = c.currentTime + (o.at || 0);
    const dur = o.dur || 0.2;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  // C 大调五声音阶，从 C5 往上
  const STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const BASE = 523.25;
  const note = (i) => BASE * Math.pow(2, STEPS[i] / 12);

  // p：本轮进度 0–1
  function follow(p, volume, at) {
    const c = audio();
    if (!c) return;
    const out = bus(c, volume);
    const i = Math.min(STEPS.length - 1, Math.round(p * (STEPS.length - 1)));
    const f = note(i);
    const w = Math.max(0, (p - 0.5) / 0.5);
    at = at || 0;
    tone(c, out, { at, freq: f, type: "triangle", dur: 0.16 + 0.22 * w, gain: 0.24 });
    tone(c, out, { at, freq: f * 2, dur: 0.1, gain: 0.07 * (1 - w) });
    if (w > 0) {
      tone(c, out, { at, freq: 150 - 50 * w, glideTo: 48, dur: 0.2 + 0.2 * w, gain: 0.5 * w, attack: 0.004 });
      tone(c, out, { at, freq: f / 2, type: "triangle", dur: 0.22 + 0.25 * w, gain: 0.12 * w });
    }
  }

  function complete(volume, at) {
    const c = audio();
    if (!c) return;
    const out = bus(c, volume);
    at = at || 0;
    tone(c, out, { at, freq: 130, glideTo: 45, dur: 0.45, gain: 0.55, attack: 0.004 });
    [0, 4, 7, 12].forEach((s, k) => {
      tone(c, out, { at: at + k * 0.07, freq: BASE * Math.pow(2, s / 12), type: "triangle", dur: 0.5 - k * 0.05, gain: 0.2 });
    });
    tone(c, out, { at: at + 0.28, freq: BASE * 4, dur: 0.6, gain: 0.05 });
  }

  function limit(volume) {
    const c = audio();
    if (!c) return;
    const out = bus(c, volume);
    tone(c, out, { freq: 233, type: "triangle", dur: 0.22, gain: 0.25 });
    tone(c, out, { at: 0.16, freq: 175, type: "triangle", dur: 0.4, gain: 0.25 });
    tone(c, out, { at: 0.16, freq: 90, glideTo: 40, dur: 0.4, gain: 0.45, attack: 0.004 });
  }

  // 试听：一轮 8 步加满额和弦
  function demo(volume) {
    const n = 8;
    for (let k = 1; k < n; k++) follow(k / n, volume, (k - 1) * 0.2);
    complete(volume, (n - 1) * 0.2 + 0.05);
  }

  root.XFP_Sound = { follow, complete, limit, demo };
})(typeof globalThis !== "undefined" ? globalThis : this);
