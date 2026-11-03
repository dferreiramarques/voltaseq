/* VoltaSeq instrument: Behringer TD-3 — pattern codec + editor. MIT, see LICENSE. */
/* ── TD-3 pattern codec ────────────────────────────────────────────────
   Format knowledge: community documentation (303patterns.com, td3-tool docs/TD-3-MO.md).
   Reimplemented here; no code copied.
   A step = { note: 0..12 (C..C'), oct: -1|0|1 (DOWN/none/UP), acc, slide, time: 'note'|'tie'|'rest' } */
const TD3 = (() => {
  const HDR = [0xF0, 0x00, 0x20, 0x32, 0x00, 0x01, 0x0A];
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', "C'"];
  const emptyStep = () => ({ note: 0, oct: 0, acc: false, slide: false, time: 'rest' });
  const newPattern = () => ({ steps: Array.from({ length: 16 }, emptyStep), length: 16, triplet: false, marker: 0 });
  const clone = p => JSON.parse(JSON.stringify(p));

  const pitchByte = s => { const v = 12 + s.note + 12 * (s.oct + 1); return s.note === 12 ? (v | 0x80) : v; };
  function fromPitchByte(b) {
    const v = (b & 0x7F) - 12;
    if (b & 0x80) return { note: 12, oct: Math.max(-1, Math.min(1, Math.round((v - 12) / 12) - 1)) };
    const t = Math.max(0, Math.min(2, Math.floor(v / 12)));
    return { note: v - 12 * t, oct: t - 1 };
  }
  const midiNote = s => (pitchByte(s) & 0x7F) + 12;          // key C, no transpose = MIDI 36

  // 16-bit masks travel as nibbles: bits 4–7, bits 0–3, bits 12–15, bits 8–11
  const maskOut = m => [(m >> 4) & 15, m & 15, (m >> 12) & 15, (m >> 8) & 15];
  const maskIn = a => ((a[0] & 15) << 4) | (a[1] & 15) | ((a[2] & 15) << 12) | ((a[3] & 15) << 8);

  function encodePayload(p) {
    const pitches = [], accents = [], slides = []; let gate = 0, rest = 0;
    p.steps.forEach((s, i) => {
      if (s.time === 'note') { gate |= 1 << i; pitches.push(pitchByte(s)); accents.push(s.acc ? 1 : 0); slides.push(s.slide ? 1 : 0); }
      else if (s.time === 'rest') { gate |= 1 << i; rest |= 1 << i; }
    });
    while (pitches.length < 16) { pitches.push(0x18); accents.push(0); slides.push(0); }
    const out = [];
    pitches.forEach(b => out.push((b >> 4) & 15, b & 15));
    accents.forEach(f => out.push(0, f));
    slides.forEach(f => out.push(0, f));
    out.push(0, p.triplet ? 1 : 0);
    out.push((p.length >> 4) & 15, p.length & 15);
    out.push(0, 0);
    out.push(...maskOut(gate), ...maskOut(rest));
    return out;                                            // 110 bytes
  }
  function decodePayload(d) {
    const pool = i => ((d[2 * i] & 15) << 4) | (d[2 * i + 1] & 15);
    const gate = maskIn(d.slice(102, 106)), rest = maskIn(d.slice(106, 110));
    const p = newPattern(); let k = 0;
    p.triplet = !!(d[97] & 1);
    p.length = Math.max(1, Math.min(16, ((d[98] & 15) << 4) | (d[99] & 15)));
    for (let i = 0; i < 16; i++) {
      const g = (gate >> i) & 1, r = (rest >> i) & 1, s = p.steps[i];
      if (g && !r) {
        Object.assign(s, fromPitchByte(pool(k)), { acc: !!(d[32 + 2 * k + 1] & 1), slide: !!(d[64 + 2 * k + 1] & 1), time: 'note' });
        k = Math.min(15, k + 1);
      } else s.time = (!g && !r) ? 'tie' : 'rest';
    }
    return p;
  }
  const writeMessage = (g, slot, p) => [...HDR, 0x78, g & 3, slot & 15, 0, (p.marker || 0) & 15, ...encodePayload(p), 0xF7];
  function parsePatternMessage(m) {
    if (m.length !== 123 || m[7] !== 0x78) return null;
    const p = decodePayload(Array.from(m.slice(12, 122))); p.marker = m[11] & 15;
    return { group: m[8], slot: m[9], pattern: p };
  }
  const isTD3 = m => m.length >= 9 && HDR.every((b, i) => m[i] === b);
  const readRequest = (g, s) => [...HDR, 0x77, g & 3, s & 15, 0xF7];
  const configRequest = () => [...HDR, 0x75, 0xF7];
  const firmwareRequest = () => [...HDR, 0x08, 0x00, 0xF7];
  const parseConfig = m => (m[7] === 0x76 ? { outCh: m[8], inCh: m[9], transpose: m[10] - 12, bend: m[11], clock: ['internal', 'MIDI DIN', 'USB', 'trigger'][m[16]] || '?', accentThreshold: m[17] } : null);
  const parseAck = m => (m[7] === 0x01 ? { ok: m[9] === 0 } : null);

  // Notes the TD-3 itself would play, in steps: start, steps held, MIDI note, accent, slide
  function playedNotes(p) {
    const out = []; let cur = null;
    for (let i = 0; i < p.length; i++) {
      const s = p.steps[i];
      if (s.time === 'note') { cur = { start: i, steps: 1, note: midiNote(s), acc: s.acc, slide: s.slide }; out.push(cur); }
      else if (s.time === 'tie') { if (cur) cur.steps++; }
      else cur = null;
    }
    return out;
  }
  const label = (g, s) => ['I', 'II', 'III', 'IV'][g] + '-' + (s < 8 ? 'A' : 'B') + ((s % 8) + 1);

  // SynthTribe .seq (single pattern) and .sqs (bank) files
  function utf16(str) { const a = []; for (const c of str) a.push(0, c.charCodeAt(0)); return a; }
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  function seqFile(p) { const d = utf16('TD-3'), v = utf16('1.3.7'); return [0x23, 0x98, 0x54, 0x76, ...u32(d.length), ...d, ...u32(v.length), ...v, ...u32(112), 0, (p.marker || 0) & 15, ...encodePayload(p)]; }
  function readU32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function parseSeqFile(b) {
    if (b[0] !== 0x23 || b[1] !== 0x98) return null;
    let o = 4; o += 4 + readU32(b, o); o += 4 + readU32(b, o); o += 4;
    const p = decodePayload(Array.from(b.slice(o + 2, o + 112))); p.marker = b[o + 1] & 15; return p;
  }
  function parseSqsFile(b) {
    if (b[0] !== 0x87 || b[1] !== 0x43) return null;
    let o = 4; o += 4 + readU32(b, o); o += 4 + readU32(b, o);
    const out = [];
    while (o + 124 <= b.length) {
      const g = readU32(b, o), s = readU32(b, o + 4), len = readU32(b, o + 8);
      if (len !== 112) break;
      const p = decodePayload(Array.from(b.slice(o + 14, o + 124))); p.marker = b[o + 13] & 15;
      out.push({ group: g, slot: s, pattern: p }); o += 124;
    }
    return out;
  }
  function splitSysex(bytes) { const out = []; let cur = null; for (const b of bytes) { if (b === 0xF0) cur = [b]; else if (cur) { cur.push(b); if (b === 0xF7) { out.push(cur); cur = null; } } } return out; }

  return { HDR, NAMES, newPattern, emptyStep, clone, pitchByte, fromPitchByte, midiNote, encodePayload, decodePayload, writeMessage, parsePatternMessage, isTD3, readRequest, configRequest, firmwareRequest, parseConfig, parseAck, playedNotes, label, seqFile, parseSeqFile, parseSqsFile, splitSysex };
})();

/* ── VoltaSeq instrument: Behringer TD-3 ───────────────────────────────── */
(() => {
  if (typeof window === 'undefined') return;
  const SCALES = {
    'Minor': [0, 2, 3, 5, 7, 8, 10], 'Phrygian': [0, 1, 3, 5, 7, 8, 10], 'Dorian': [0, 2, 3, 5, 7, 9, 10],
    'Minor pentatonic': [0, 3, 5, 7, 10], 'Blues': [0, 3, 5, 6, 7, 10], 'Major': [0, 2, 4, 5, 7, 9, 11],
    'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  };
  const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const rnd = n => Math.floor(Math.random() * n);
  const stepBeats = p => (p.triplet ? 1 / 6 : 1 / 4);

  /* ---------- styles (injected once) ---------- */
  const CSS = `
  .td3 { padding: 14px; display: flex; flex-direction: column; gap: 12px; min-width: 820px; }
  .td3-unit { border-radius: 10px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
  .td3-head { background: repeating-linear-gradient(90deg, rgba(255,255,255,0.10) 0 1px, transparent 1px 3px), linear-gradient(180deg, #e6e7e8, #bfc1c4); color: #1b1c1e; padding: 10px 14px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .td3-logo { font: 800 26px/1 Inter, sans-serif; letter-spacing: -1px; }
  .td3-logo small { display: block; font: 600 9px/1.2 Inter, sans-serif; letter-spacing: 1.5px; text-transform: uppercase; color: #4a4d52; }
  .td3-seg { display: flex; background: #a9acb0; border-radius: 6px; padding: 2px; gap: 2px; }
  .td3-seg button { flex: none; background: transparent; border: 0; color: #1b1c1e; padding: 5px 10px; font-size: 11px; font-weight: 600; border-radius: 5px; }
  .td3-seg button:hover { background: rgba(255,255,255,0.4); border: 0; }
  .td3-seg button[aria-pressed="true"] { background: #1b1c1e; color: #fff; }
  .td3-hlabel { font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #4a4d52; }
  .td3-link { margin-left: auto; display: flex; align-items: center; gap: 10px; font-size: 11px; color: #2b2d31; }
  .td3-link .dot { width: 9px; height: 9px; border-radius: 50%; background: #7a1d14; box-shadow: inset 0 1px 1px rgba(0,0,0,0.5); }
  .td3-link .dot.on { background: #ff3b2f; box-shadow: 0 0 6px #ff3b2f; }
  .td3-head select, .td3-head .td3-btn { background: #f3f3f3; color: #1b1c1e; border: 1px solid #8e9196; }
  .td3-btn { flex: none; padding: 5px 10px; font-size: 11px; font-weight: 600; }
  .td3-live { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; }
  .td3-live input { width: auto; accent-color: #ff3b2f; }
  .td3-live select { width: auto; padding: 3px 4px; }
  .td3-body { background: linear-gradient(180deg, #303236, #25272a); padding: 12px 14px 14px; color: #d9dbde; }
  .td3-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; font-size: 11px; }
  .td3-bar select { width: auto; padding: 3px 6px; background: #1c1d20; }
  .td3-bar .td3-btn { background: #3b3e43; border-color: #55595f; color: #e8eaed; }
  .td3-bar .td3-btn:hover { border-color: #ff7a3c; background: #4a4d53; }
  .td3-bar .sp { flex: 1; }
  .td3-tog { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
  .td3-tog i, .td3-step .led { width: 7px; height: 7px; border-radius: 50%; background: #5a1610; display: inline-block; }
  .td3-tog.on i { background: #ff3b2f; box-shadow: 0 0 6px #ff3b2f; }
  .td3-steps { display: grid; grid-template-columns: repeat(16, 1fr); gap: 5px; }
  .td3-step { flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 2px 7px; background: linear-gradient(180deg, #e3e4e6, #c4c6c9); color: #1b1c1e; border: 2px solid transparent; border-radius: 4px; box-shadow: 0 2px 0 #111, 0 3px 4px rgba(0,0,0,0.4); min-height: 104px; }
  .td3-step:hover { background: linear-gradient(180deg, #f0f1f2, #d0d2d5); border-color: transparent; }
  .td3-step.sel { border-color: #ff7a3c; }
  .td3-step.off { opacity: 0.32; }
  .td3-step.play .led { background: #ff3b2f; box-shadow: 0 0 6px #ff3b2f; }
  .td3-step .no { font: 600 9px 'JetBrains Mono', monospace; color: #55595f; }
  .td3-step .nt { font: 700 15px/1 Inter, sans-serif; min-height: 15px; }
  .td3-step .oc { font-size: 9px; font-weight: 700; min-height: 10px; color: #55595f; }
  .td3-step .fl { display: flex; gap: 3px; }
  .td3-step .fl b { font: 700 9px/1 Inter, sans-serif; padding: 2px 4px; border-radius: 3px; background: #a9acb0; color: #4a4d52; cursor: pointer; }
  .td3-step .fl b.on { background: #ff3b2f; color: #fff; }
  .td3-step .tm { font: 600 8px/1 Inter, sans-serif; letter-spacing: 0.5px; color: #55595f; text-transform: uppercase; }
  .td3-step.rest .nt, .td3-step.tie .nt { color: #8e9196; }
  .td3-keys { display: flex; align-items: flex-end; gap: 14px; margin-top: 14px; flex-wrap: wrap; }
  .td3-kb { position: relative; height: 74px; width: 360px; flex: none; }
  .td3-kb button { position: absolute; bottom: 0; padding: 0; border-radius: 0 0 4px 4px; flex: none; }
  .td3-kb .w { width: 44px; height: 74px; background: linear-gradient(180deg, #fafafa, #dcdcdc); border: 1px solid #111; color: #55595f; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 4px; font-size: 9px; font-weight: 700; }
  .td3-kb .b { width: 28px; height: 44px; top: 0; bottom: auto; background: linear-gradient(180deg, #2a2b2e, #0d0d0e); border: 1px solid #000; z-index: 2; }
  .td3-kb .w:hover { background: #fff; border-color: #111; }
  .td3-kb .b:hover { background: #3a3b3f; border-color: #000; }
  .td3-kb .hit { background: #ff7a3c !important; }
  .td3-fn { display: grid; grid-template-columns: repeat(3, auto); gap: 6px; }
  .td3-fn button { flex: none; min-width: 64px; padding: 7px 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; background: #3b3e43; border-color: #55595f; color: #e8eaed; }
  .td3-fn button:hover { border-color: #ff7a3c; background: #4a4d53; }
  .td3-fn button.on { background: #ff3b2f; border-color: #ff3b2f; color: #fff; }
  .td3-hint { font-size: 10px; color: #8e9196; max-width: 220px; line-height: 1.45; }
  .td3-lower { display: grid; grid-template-columns: minmax(300px, 0.9fr) minmax(420px, 1.1fr); gap: 12px; }
  .td3-card { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
  .td3-card h3 { font-size: 10px; color: var(--accent); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px; font-weight: 700; }
  .td3-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
  .td3-form label { display: flex; flex-direction: column; gap: 4px; font-size: 9px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
  .td3-form label span { display: flex; justify-content: space-between; }
  .td3-form label output { font-family: 'JetBrains Mono', monospace; color: var(--text-primary); text-transform: none; }
  .td3-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
  .td3-actions button { flex: none; }
  .td3-actions .primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .td3-lib { display: grid; grid-template-columns: 26px repeat(16, 1fr); gap: 3px; align-items: center; font-size: 9px; }
  .td3-lib .g { color: var(--text-secondary); font-weight: 700; }
  .td3-lib .h { color: var(--text-secondary); text-align: center; font-family: 'JetBrains Mono', monospace; }
  .td3-lib button { flex: none; padding: 0; height: 26px; border-radius: 3px; font-size: 8px; color: var(--text-secondary); position: relative; overflow: hidden; }
  .td3-lib button svg { position: absolute; inset: 3px; width: calc(100% - 6px); height: calc(100% - 6px); }
  .td3-lib button.sel { border-color: var(--warning); box-shadow: 0 0 0 1px var(--warning); }
  .td3-lib button.live::after { content: ""; position: absolute; top: 2px; right: 2px; width: 5px; height: 5px; border-radius: 50%; background: #ff3b2f; box-shadow: 0 0 4px #ff3b2f; }
  .td3-status { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-secondary); margin-top: 8px; min-height: 1.3em; }
  `;
  function injectCSS() { if (document.getElementById('td3-css')) return; const st = document.createElement('style'); st.id = 'td3-css'; st.textContent = CSS; document.head.appendChild(st); }

  /* ---------- pattern → VoltaSeq notes ---------- */
  function regen(trk, seq) {
    const p = trk.inst.pattern, sb = stepBeats(p), period = p.length * sb, loop = seq.loopBeats();
    let played = TD3.playedNotes(p);
    // a slide into the same pitch is a held note on the TD-3: merge so note-offs don't cut it
    for (let i = 0; i < played.length - 1; i++) {
      const a = played[i], b = played[i + 1];
      if (a.slide && b.start === a.start + a.steps && b.note === a.note) { a.steps += b.steps; a.slide = b.slide; played.splice(i + 1, 1); i--; }
    }
    const notes = [];
    for (let rep = 0; rep * period < loop - 1e-9; rep++) {
      played.forEach(n => {
        const start = rep * period + n.start * sb;
        if (start >= loop - 1e-9) return;
        let dur = n.slide ? n.steps * sb + Math.min(0.03, sb * 0.2) : Math.max(sb * 0.45, n.steps * sb - sb * 0.5);
        dur = Math.min(dur, loop - start + (n.slide ? 0.03 : 0));
        notes.push({ _id: seq.newNoteId(), note: n.note, velocity: n.acc ? 127 : 72, startBeat: +start.toFixed(6), durBeats: dur, acc: n.acc });
      });
    }
    trk.notes = notes;
  }

  /* ---------- acid generator ---------- */
  function generate(g) {
    const p = TD3.newPattern(), sc = SCALES[g.scale] || SCALES.Minor;
    p.length = g.length || 16;
    let prevNote = false;
    for (let i = 0; i < 16; i++) {
      const s = p.steps[i];
      const on = i === 0 || Math.random() < g.density;
      if (!on) { s.time = 'rest'; prevNote = false; continue; }
      if (prevNote && Math.random() < g.tie) { s.time = 'tie'; continue; }
      const deg = Math.random() < 0.3 ? 0 : sc[rnd(sc.length)];
      let total = g.root + deg;
      if (Math.random() < g.oct) total += Math.random() < 0.5 ? -12 : 12;
      Object.assign(s, fromTotal(total), { time: 'note', acc: Math.random() < g.acc, slide: Math.random() < g.slide });
      prevNote = true;
    }
    return p;
  }
  function fromTotal(total) {            // semitones from key C (no transpose) → note + octave switch
    total = Math.max(-12, Math.min(24, total));
    if (total === 24) return { note: 12, oct: 1 };
    const oct = Math.floor(total / 12);
    return { note: total - oct * 12, oct: Math.max(-1, Math.min(1, oct)) };
  }
  function mutate(p, g) {
    const q = TD3.clone(p), sc = SCALES[g.scale] || SCALES.Minor, n = 2 + rnd(3);
    for (let k = 0; k < n; k++) {
      const s = q.steps[rnd(q.length)], r = Math.random();
      if (r < 0.45) { Object.assign(s, fromTotal(g.root + sc[rnd(sc.length)] + (Math.random() < g.oct ? 12 : 0))); if (s.time !== 'note') s.time = 'note'; }
      else if (r < 0.65) s.acc = !s.acc;
      else if (r < 0.85) s.slide = !s.slide;
      else s.time = s.time === 'rest' ? 'note' : (s.time === 'note' ? 'rest' : 'note');
    }
    return q;
  }

  /* ---------- TD-3 preview voice (a simple 303-like sketch) ---------- */
  function synth(seq, n, durSec) {
    const c = seq.audio; if (!c) return;
    if (c.state === 'suspended') c.resume();
    const t = c.currentTime, acc = n.velocity >= 100;
    const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = 440 * Math.pow(2, (n.note - 69) / 12);
    f.type = 'lowpass'; f.Q.value = acc ? 14 : 10;
    f.frequency.setValueAtTime(acc ? 3200 : 1700, t); f.frequency.exponentialRampToValueAtTime(220, t + (acc ? 0.18 : 0.32));
    const d = Math.max(0.05, durSec), pk = acc ? 0.34 : 0.22;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.004);
    g.gain.setValueAtTime(pk * 0.85, t + d); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.04);
    o.connect(f).connect(g).connect(seq.master); o.start(t); o.stop(t + d + 0.06);
  }

  /* ---------- the instrument ---------- */
  const ui = {};
  let link = { ok: false, info: '', inId: null }, waiters = [], unSysex = null, raf = 0, liveT = 0, opChain = Promise.resolve();
  const cache = new Array(64).fill(null);

  function request(seq, msg, match, timeout = 600) {
    return new Promise((res, rej) => {
      const w = { match, res, t: setTimeout(() => { waiters = waiters.filter(x => x !== w); rej(new Error('The TD-3 did not answer')); }, timeout) };
      waiters.push(w);
      const out = seq.outputs.get(cur.trk.outputId);
      if (!out) { clearTimeout(w.t); waiters = waiters.filter(x => x !== w); return rej(new Error('Choose the TD-3 as MIDI output')); }
      out.send(msg);
    });
  }
  function onSysex(data) {
    const m = Array.from(data); if (!TD3.isTD3(m)) return;
    const i = waiters.findIndex(w => w.match(m));
    if (i >= 0) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.t); w.res(m); }
  }
  const op = fn => { const p = opChain.then(fn, fn); opChain = p.catch(() => {}); return p; };
  const readSlot = (seq, i) => request(seq, TD3.readRequest(i >> 4, i & 15), m => m[7] === 0x78 && m[8] === (i >> 4) && m[9] === (i & 15)).then(m => (cache[i] = TD3.parsePatternMessage(m).pattern));
  async function writeSlot(seq, i, p) {
    const ack = TD3.parseAck(await request(seq, TD3.writeMessage(i >> 4, i & 15, p), m => m[7] === 0x01, 1200));
    if (!ack.ok) throw new Error('The TD-3 refused the pattern');
    cache[i] = TD3.clone(p);
  }

  const cur = { trk: null, seq: null };
  const pat = () => cur.trk.inst.pattern;

  function edit(fn, opts = {}) {
    const { trk, seq } = cur;
    if (!opts.noUndo) seq.pushUndo();
    fn(trk.inst.pattern);
    changed();
  }
  function changed() {
    const { trk, seq } = cur;
    regen(trk, seq); render(); seq.renderTracks(); seq.updateStatus(); scheduleLive();
  }
  function scheduleLive() {
    const { trk, seq } = cur;
    if (!trk.inst.live || !link.ok) return;
    clearTimeout(liveT);
    liveT = setTimeout(() => op(() => writeSlot(seq, trk.inst.slot, trk.inst.pattern))
      .then(() => setStatus('Written to ' + TD3.label(trk.inst.slot >> 4, trk.inst.slot & 15) + ' · ' + new Date().toTimeString().slice(0, 8)))
      .catch(e => setStatus(e.message)), 140);
  }
  const setStatus = t => { if (ui.status) ui.status.textContent = t; };

  async function connect() {
    const { trk, seq } = cur;
    if (!(await seq.ensureSysex())) return;
    if (!trk.outputId) for (const [id, o] of seq.outputs) if (/TD-?3/i.test(o.name || '')) { trk.outputId = id; seq.fillDeviceSelects(); break; }
    const b = seq.busy('Connecting to the TD-3');
    try {
      const fw = await op(() => request(seq, TD3.firmwareRequest(), m => m[7] === 0x09));
      const cfg = TD3.parseConfig(await op(() => request(seq, TD3.configRequest(), m => m[7] === 0x76)));
      trk.channel = cfg.inCh; seq.syncTrackOptions(); seq.renderTracks();
      link = { ok: true, info: `firmware ${fw[9]}.${fw[10]}.${fw[11]} · listens on ch ${cfg.inCh + 1} · clock ${cfg.clock}` };
      await b.done('TD-3 connected');
    } catch (e) { link = { ok: false, info: e.message }; await b.done(e.message); }
    render();
  }

  /* ---------- UI ---------- */
  function mount(host, trk, seq) {
    injectCSS(); cur.trk = trk; cur.seq = seq;
    if (!unSysex) unSysex = seq.onSysex(onSysex);
    host.innerHTML = `
    <div class="td3">
      <div class="td3-unit">
        <div class="td3-head">
          <div class="td3-logo">TD-3<small>Analog bass line</small></div>
          <div><div class="td3-hlabel">Played by</div><div class="td3-seg" id="t3mode"><button data-m="seq" title="VoltaSeq sends the notes over MIDI, in time with your other tracks">VoltaSeq</button><button data-m="device" title="The TD-3 plays the pattern from its own memory">TD-3 sequencer</button></div></div>
          <label class="td3-live" title="Every edit is written straight into this slot of the TD-3"><input type="checkbox" id="t3live"> Live write to <select id="t3slot"></select></label>
          <div class="td3-link"><span class="dot" id="t3dot"></span><span id="t3info">Not connected</span><button class="td3-btn" id="t3conn">Connect TD-3</button></div>
        </div>
        <div class="td3-body">
          <div class="td3-bar">
            <label>Length <select id="t3len"></select></label>
            <span class="td3-tog" id="t3trip"><i></i>Triplets</span>
            <span class="sp"></span>
            <button class="td3-btn" id="t3shl" title="Shift pattern one step left">◀ Shift</button>
            <button class="td3-btn" id="t3shr" title="Shift pattern one step right">Shift ▶</button>
            <button class="td3-btn" id="t3tdn" title="Transpose down a semitone">− 1</button>
            <button class="td3-btn" id="t3tup" title="Transpose up a semitone">+ 1</button>
            <button class="td3-btn" id="t3clr">Clear</button>
          </div>
          <div class="td3-steps" id="t3steps"></div>
          <div class="td3-keys">
            <div class="td3-fn"><button id="t3down">Down</button><button id="t3up">Up</button><button id="t3acc">Accent</button><button id="t3sld">Slide</button><button id="t3tie">Tie</button><button id="t3rest">Rest</button></div>
            <div class="td3-kb" id="t3kb" aria-label="Pitch keys"></div>
            <div class="td3-hint">Select a step, then press a key to set its pitch. The selection moves to the next step, like pitch mode on the TD-3. Scroll on a step to change its pitch.</div>
          </div>
        </div>
      </div>
      <div class="td3-lower">
        <div class="td3-card"><h3>Acid generator</h3>
          <div class="td3-form" id="t3gen"></div>
          <div class="td3-actions"><button class="primary" id="t3genBtn">Generate</button><button id="t3mutBtn" title="Change a few steps">Mutate</button></div>
        </div>
        <div class="td3-card"><h3>TD-3 memory</h3>
          <div class="td3-lib" id="t3lib"></div>
          <div class="td3-actions">
            <button id="t3readAll">Read all</button><button id="t3load">Load slot</button><button class="primary" id="t3write">Write to slot</button>
            <button id="t3backup">Back up .syx</button><button id="t3restore">Restore…</button><button id="t3import">Import file…</button><button id="t3export">Export .seq</button>
          </div>
          <div class="td3-status" id="t3status"></div>
          <input type="file" id="t3file" accept=".syx,.seq,.sqs" hidden><input type="file" id="t3rfile" accept=".syx,.sqs" hidden>
        </div>
      </div>
    </div>`;
    const $ = id => host.querySelector('#' + id);
    Object.assign(ui, { host, steps: $('t3steps'), len: $('t3len'), trip: $('t3trip'), mode: $('t3mode'), live: $('t3live'), slot: $('t3slot'), dot: $('t3dot'), info: $('t3info'), lib: $('t3lib'), status: $('t3status'), gen: $('t3gen'), kb: $('t3kb') });
    for (let i = 1; i <= 16; i++) ui.len.add(new Option(i + ' steps', i));
    for (let i = 0; i < 64; i++) ui.slot.add(new Option(TD3.label(i >> 4, i & 15), i));
    buildSteps(); buildKeyboard(); buildGen(); buildLib();
    // events
    ui.len.onchange = () => edit(p => { p.length = +ui.len.value; });
    ui.trip.onclick = () => edit(p => { p.triplet = !p.triplet; });
    $('t3shl').onclick = () => edit(p => { p.steps.push(p.steps.shift()); });
    $('t3shr').onclick = () => edit(p => { p.steps.unshift(p.steps.pop()); });
    const tr = d => edit(p => p.steps.forEach(s => { if (s.time === 'note') Object.assign(s, fromTotal(s.note + 12 * s.oct + d)); }));
    $('t3tdn').onclick = () => tr(-1); $('t3tup').onclick = () => tr(1);
    $('t3clr').onclick = () => edit(p => { p.steps = TD3.newPattern().steps; });
    ui.mode.querySelectorAll('button').forEach(b => b.onclick = () => { seq.pushUndo(); trk.inst.mode = b.dataset.m; seq.renderTracks(); render(); if (trk.inst.mode === 'device') seq.toast('Press PLAY on the TD-3 to hear its own sequencer'); });
    ui.live.onchange = async () => {
      if (ui.live.checked && !link.ok) { await connect(); if (!link.ok) { ui.live.checked = false; return; } }
      trk.inst.live = ui.live.checked;
      if (trk.inst.live) {
        const b = seq.busy('Live write to ' + TD3.label(trk.inst.slot >> 4, trk.inst.slot & 15));
        try {
          const i = trk.inst.slot, name = TD3.label(i >> 4, i & 15), old = await op(() => readSlot(seq, i));
          seq.download(`td3-backup-${name}.syx`, TD3.writeMessage(i >> 4, i & 15, old));
          await op(() => writeSlot(seq, i, trk.inst.pattern));
          await b.done('Live write on');
          setStatus(`${name}'s previous pattern was saved to td3-backup-${name}.syx`);
        }
        catch (e) { trk.inst.live = false; ui.live.checked = false; await b.done(e.message); }
      }
      render();
    };
    ui.slot.onchange = () => { trk.inst.slot = +ui.slot.value; render(); scheduleLive(); };
    $('t3conn').onclick = connect;
    $('t3genBtn').onclick = () => edit(p => { const q = generate(trk.inst.gen); q.length = p.length; q.triplet = p.triplet; Object.assign(p, q); });
    $('t3mutBtn').onclick = () => edit(p => Object.assign(p, mutate(p, trk.inst.gen)));
    $('t3readAll').onclick = readAll;
    $('t3load').onclick = loadSlot;
    $('t3write').onclick = writeToSlot;
    $('t3backup').onclick = backupAll;
    $('t3restore').onclick = () => $('t3rfile').click();
    $('t3import').onclick = () => $('t3file').click();
    $('t3export').onclick = () => seq.download('td3-pattern.seq', TD3.seqFile(pat()));
    $('t3file').onchange = e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; };
    $('t3rfile').onchange = e => { if (e.target.files[0]) restoreFile(e.target.files[0]); e.target.value = ''; };
    render();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(tickPlayhead);
  }
  function unmount() { cancelAnimationFrame(raf); clearTimeout(liveT); }

  let selStep = 0;
  function buildSteps() {
    ui.stepEls = [];
    for (let i = 0; i < 16; i++) {
      const b = document.createElement('button');
      b.className = 'td3-step';
      b.innerHTML = `<i class="led"></i><span class="no">${i + 1}</span><span class="nt"></span><span class="oc"></span><span class="fl"><b class="a" title="Accent">A</b><b class="s" title="Slide">S</b></span><span class="tm"></span>`;
      b.onclick = e => {
        if (e.target.classList.contains('a')) return edit(p => { p.steps[i].acc = !p.steps[i].acc; });
        if (e.target.classList.contains('s')) return edit(p => { p.steps[i].slide = !p.steps[i].slide; });
        selStep = i; render(); previewStep(i);
      };
      b.ondblclick = () => edit(p => { const s = p.steps[i]; s.time = { note: 'tie', tie: 'rest', rest: 'note' }[s.time]; });
      b.addEventListener('wheel', e => { e.preventDefault(); const d = e.deltaY < 0 ? 1 : -1; edit(p => { const s = p.steps[i]; Object.assign(s, fromTotal(s.note + 12 * s.oct + d)); s.time = 'note'; }); selStep = i; }, { passive: false });
      ui.steps.appendChild(b); ui.stepEls.push(b);
    }
  }
  function buildKeyboard() {
    const whites = [0, 2, 4, 5, 7, 9, 11, 12], blacks = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };
    whites.forEach((n, wi) => { const k = document.createElement('button'); k.className = 'w'; k.style.left = (wi * 44) + 'px'; k.textContent = TD3.NAMES[n]; k.onclick = () => keyPress(n, k); ui.kb.appendChild(k); });
    Object.entries(blacks).forEach(([n, wi]) => { const k = document.createElement('button'); k.className = 'b'; k.style.left = (wi * 44 + 30) + 'px'; k.title = TD3.NAMES[n]; k.onclick = () => keyPress(+n, k); ui.kb.appendChild(k); });
    const h = ui.host;
    h.querySelector('#t3down').onclick = () => edit(p => { const s = p.steps[selStep]; s.oct = s.oct === -1 ? 0 : -1; });
    h.querySelector('#t3up').onclick = () => edit(p => { const s = p.steps[selStep]; s.oct = s.oct === 1 ? 0 : 1; });
    h.querySelector('#t3acc').onclick = () => edit(p => { p.steps[selStep].acc = !p.steps[selStep].acc; });
    h.querySelector('#t3sld').onclick = () => edit(p => { p.steps[selStep].slide = !p.steps[selStep].slide; });
    h.querySelector('#t3tie').onclick = () => { edit(p => { p.steps[selStep].time = 'tie'; }); advance(); };
    h.querySelector('#t3rest').onclick = () => { edit(p => { p.steps[selStep].time = 'rest'; }); advance(); };
  }
  function keyPress(n, el) {
    el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 140);
    edit(p => { const s = p.steps[selStep]; s.note = n; s.time = 'note'; });
    previewStep(selStep); advance();
  }
  function advance() { selStep = (selStep + 1) % pat().length; render(); }
  function previewStep(i) {
    const s = pat().steps[i]; if (s.time !== 'note' || cur.seq.playing) return;
    const out = cur.seq.outputs.get(cur.trk.outputId);
    if (!out && cur.seq.audioPreview) synth(cur.seq, { note: TD3.midiNote(s), velocity: s.acc ? 127 : 72 }, 0.18);
    if (out && cur.trk.inst.mode === 'seq') { const ch = cur.trk.channel & 15, n = TD3.midiNote(s); out.send([0x90 | ch, n, s.acc ? 127 : 72]); setTimeout(() => out.send([0x80 | ch, n, 0]), 160); }
  }
  function buildGen() {
    const g = cur.trk.inst.gen;
    const sel = (lab, key, opts) => { const l = document.createElement('label'); l.innerHTML = `<span>${lab}</span>`; const s = document.createElement('select'); opts.forEach(([v, t]) => s.add(new Option(t, v))); s.value = g[key]; s.onchange = () => { cur.trk.inst.gen[key] = isNaN(+s.value) ? s.value : +s.value; }; l.appendChild(s); ui.gen.appendChild(l); };
    const rng = (lab, key) => { const l = document.createElement('label'); l.innerHTML = `<span>${lab}<output></output></span>`; const r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = 100; r.value = Math.round(g[key] * 100); const o = l.querySelector('output'); o.textContent = r.value + '%'; r.oninput = () => { cur.trk.inst.gen[key] = r.value / 100; o.textContent = r.value + '%'; }; l.appendChild(r); ui.gen.appendChild(l); };
    sel('Root', 'root', ROOTS.map((n, i) => [i, n])); sel('Scale', 'scale', Object.keys(SCALES).map(k => [k, k]));
    rng('Notes', 'density'); rng('Accents', 'acc'); rng('Slides', 'slide'); rng('Octave jumps', 'oct'); rng('Ties', 'tie');
  }
  function buildLib() {
    ui.lib.innerHTML = '<span></span>' + Array.from({ length: 16 }, (_, s) => `<span class="h">${s < 8 ? 'A' : 'B'}${(s % 8) + 1}</span>`).join('');
    ui.libBtns = [];
    for (let g = 0; g < 4; g++) {
      const lab = document.createElement('span'); lab.className = 'g'; lab.textContent = ['I', 'II', 'III', 'IV'][g]; ui.lib.appendChild(lab);
      for (let s = 0; s < 16; s++) {
        const i = g * 16 + s, b = document.createElement('button');
        b.title = TD3.label(g, s);
        b.onclick = () => { cur.trk.inst.slot = i; render(); };
        b.ondblclick = () => { cur.trk.inst.slot = i; loadSlot(); };
        ui.lib.appendChild(b); ui.libBtns.push(b);
      }
    }
  }
  function miniSvg(p) {
    const notes = TD3.playedNotes(p); if (!notes.length) return '';
    const lo = Math.min(...notes.map(n => n.note)), hi = Math.max(...notes.map(n => n.note)), span = Math.max(12, hi - lo);
    return `<svg viewBox="0 0 16 10" preserveAspectRatio="none">${notes.map(n => `<rect x="${n.start}" y="${9 - (n.note - lo) / span * 8}" width="${Math.max(0.7, n.steps - 0.2)}" height="1.4" fill="${n.acc ? '#ff3b2f' : '#94a3b8'}"/>`).join('')}</svg>`;
  }

  function render() {
    const { trk } = cur, p = trk.inst.pattern;
    if (selStep >= 16) selStep = 0;
    ui.len.value = p.length; ui.trip.classList.toggle('on', p.triplet);
    ui.mode.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === trk.inst.mode));
    ui.live.checked = !!trk.inst.live; ui.slot.value = trk.inst.slot;
    ui.dot.classList.toggle('on', link.ok); ui.info.textContent = link.ok ? link.info : (link.info || 'Not connected');
    p.steps.forEach((s, i) => {
      const el = ui.stepEls[i];
      el.classList.toggle('sel', i === selStep); el.classList.toggle('off', i >= p.length);
      el.classList.toggle('rest', s.time === 'rest'); el.classList.toggle('tie', s.time === 'tie');
      el.querySelector('.nt').textContent = s.time === 'note' ? TD3.NAMES[s.note] : (s.time === 'tie' ? '—' : '·');
      el.querySelector('.oc').textContent = s.time === 'note' ? (s.oct > 0 ? '▲ UP' : s.oct < 0 ? '▼ DOWN' : '') : '';
      el.querySelector('.a').classList.toggle('on', s.time === 'note' && s.acc);
      el.querySelector('.s').classList.toggle('on', s.time === 'note' && s.slide);
      el.querySelector('.tm').textContent = s.time;
      el.setAttribute('aria-label', `Step ${i + 1}: ${s.time === 'note' ? TD3.NAMES[s.note] + (s.oct > 0 ? ' up' : s.oct < 0 ? ' down' : '') + (s.acc ? ', accent' : '') + (s.slide ? ', slide' : '') : s.time}`);
    });
    const s = p.steps[selStep];
    ui.host.querySelector('#t3down').classList.toggle('on', s.oct === -1);
    ui.host.querySelector('#t3up').classList.toggle('on', s.oct === 1);
    ui.host.querySelector('#t3acc').classList.toggle('on', s.acc);
    ui.host.querySelector('#t3sld').classList.toggle('on', s.slide);
    ui.libBtns.forEach((b, i) => { b.classList.toggle('sel', i === trk.inst.slot); b.classList.toggle('live', !!trk.inst.live && i === trk.inst.slot); b.innerHTML = cache[i] ? miniSvg(cache[i]) : ''; });
  }
  function tickPlayhead() {
    const { trk, seq } = cur;
    if (!ui.stepEls || !trk) return;
    let idx = -1;
    if (seq.playing && trk.inst.mode === 'seq') { const p = trk.inst.pattern, sb = stepBeats(p); idx = Math.floor((seq.currentBeat() % (p.length * sb)) / sb); }
    ui.stepEls.forEach((el, i) => el.classList.toggle('play', i === idx));
    raf = requestAnimationFrame(tickPlayhead);
  }

  /* ---------- library actions ---------- */
  async function needLink() { if (!link.ok) await connect(); return link.ok; }
  async function readAll() {
    if (!(await needLink())) return;
    const b = cur.seq.busy('Reading the TD-3 memory');
    try { for (let i = 0; i < 64; i++) { await op(() => readSlot(cur.seq, i)); if (i % 4 === 3) b.sub(`${i + 1} / 64`); } render(); await b.done('64 patterns read'); }
    catch (e) { render(); await b.done(e.message); }
  }
  async function loadSlot() {
    if (!(await needLink())) return;
    const i = cur.trk.inst.slot, b = cur.seq.busy('Loading ' + TD3.label(i >> 4, i & 15));
    try { const p = await op(() => readSlot(cur.seq, i)); edit(q => Object.assign(q, TD3.clone(p))); await b.done('Loaded into the track'); }
    catch (e) { await b.done(e.message); }
  }
  async function writeToSlot() {
    if (!(await needLink())) return;
    const i = cur.trk.inst.slot, name = TD3.label(i >> 4, i & 15);
    if (!confirm(`Write this pattern to ${name} on the TD-3? Its current pattern is saved to a backup file first.`)) return;
    const b = cur.seq.busy('Writing to ' + name);
    try {
      const old = await op(() => readSlot(cur.seq, i));
      cur.seq.download(`td3-backup-${name}.syx`, TD3.writeMessage(i >> 4, i & 15, old));
      await op(() => writeSlot(cur.seq, i, pat()));
      const back = await op(() => readSlot(cur.seq, i));
      const same = JSON.stringify(TD3.playedNotes(back)) === JSON.stringify(TD3.playedNotes(pat()));
      render(); await b.done(same ? 'Written and checked' : 'Written, but the read-back differs');
    } catch (e) { await b.done(e.message); }
  }
  async function backupAll() {
    if (!(await needLink())) return;
    const b = cur.seq.busy('Backing up all 64 patterns');
    try {
      const bytes = [];
      for (let i = 0; i < 64; i++) { const p = await op(() => readSlot(cur.seq, i)); bytes.push(...TD3.writeMessage(i >> 4, i & 15, p)); if (i % 4 === 3) b.sub(`${i + 1} / 64`); }
      cur.seq.download(`td3-backup-${new Date().toISOString().slice(0, 10)}.syx`, bytes);
      render(); await b.done('Backup saved');
    } catch (e) { await b.done(e.message); }
  }
  async function readFilePatterns(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.sqs$/i.test(file.name)) return TD3.parseSqsFile(bytes) || [];
    if (/\.seq$/i.test(file.name)) { const p = TD3.parseSeqFile(bytes); return p ? [{ group: null, slot: null, pattern: p }] : []; }
    return TD3.splitSysex(bytes).map(m => TD3.parsePatternMessage(m)).filter(Boolean);
  }
  async function importFile(file) {
    const list = await readFilePatterns(file);
    if (!list.length) return cur.seq.toast('No TD-3 patterns found in that file');
    let pick = list[0];
    if (list.length > 1) {
      const want = prompt(`This file holds ${list.length} patterns. Which one goes into the track? (e.g. I-A1)`, TD3.label(list[0].group, list[0].slot));
      if (want == null) return;
      pick = list.find(x => TD3.label(x.group, x.slot).toUpperCase() === want.trim().toUpperCase()) || list[0];
      list.forEach(x => { if (x.group != null) cache[x.group * 16 + x.slot] = x.pattern; });
    }
    edit(p => Object.assign(p, TD3.clone(pick.pattern)));
    cur.seq.toast('Pattern imported');
  }
  async function restoreFile(file) {
    const list = (await readFilePatterns(file)).filter(x => x.group != null);
    if (!list.length) return cur.seq.toast('No TD-3 patterns with slot numbers in that file');
    if (!(await needLink())) return;
    if (!confirm(`Write ${list.length} patterns into the TD-3? Its current memory is saved to a backup file first.`)) return;
    const b = cur.seq.busy('Restoring patterns');
    try {
      const before = [];
      for (let i = 0; i < 64; i++) { const p = await op(() => readSlot(cur.seq, i)); before.push(...TD3.writeMessage(i >> 4, i & 15, p)); }
      cur.seq.download('td3-before-restore.syx', before);
      for (const [k, x] of list.entries()) { await op(() => writeSlot(cur.seq, x.group * 16 + x.slot, x.pattern)); b.sub(`${k + 1} / ${list.length}`); }
      render(); await b.done(`${list.length} patterns restored`);
    } catch (e) { await b.done(e.message); }
  }

  VoltaInstruments.td3 = {
    id: 'td3', name: 'Behringer TD-3', short: 'TD-3', editor: 'custom', hideChannel: true, portMatch: /TD-?3/i,
    create(trk, seq) {
      trk.name = 'TD-3';
      trk.inst = { mode: 'seq', slot: 0, live: false, gen: { root: 9, scale: 'Minor', density: 0.8, acc: 0.3, slide: 0.25, oct: 0.25, tie: 0.12, length: 16 } };
      trk.inst.pattern = generate(trk.inst.gen);
      regen(trk, seq);
    },
    onLoad(trk, seq) { trk.inst.live = false; regen(trk, seq); },
    onTimeline: regen,
    silent: trk => trk.inst.mode === 'device',
    synth,
    trackInfo: trk => `${trk.inst.pattern.length} steps · ${trk.inst.mode === 'device' ? 'TD-3 sequencer' : 'played by VoltaSeq'}`,
    onPortChange() { link = { ok: false, info: '' }; if (cur.trk) render(); },
    mount, unmount,
    refresh(trk, seq) { cur.trk = trk; cur.seq = seq; render(); },
    _test: { generate, mutate, regen, fromTotal }
  };
})();
