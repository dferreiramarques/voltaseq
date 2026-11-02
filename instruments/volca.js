/* VoltaSeq instrument: KORG volca sample 2 — 10-part sequence, part sounds (KORG MIDI chart), sample manager.
   USB sample protocol from volsa2 by 00nktk (MIT, github.com/00nktk/volsa2), reimplemented. MIT, see LICENSE. */
(() => {
/* ===== volca sample 2 — USB SysEx protocol =====
   Protocol knowledge from the open-source volsa2 project (MIT, github.com/00nktk/volsa2),
   reimplemented in JavaScript for Web MIDI. */
const EOX = 0xF7, KORG = 0x42;
const VS2_MODEL = [0x2D, 0x01, 0x08, 0x00];
const VS2_RATE = 31250;
const NAME_LEN = 24, DEFAULT_LEVEL = 65535, DEFAULT_SPEED = 16384;
const STATUS = { 0x23: 'ok', 0x24: 'busy', 0x25: 'memory full', 0x26: 'invalid data format' };

/* 8-bit data <-> Korg 7-bit packing: every 7 bytes become 8, the first holding the high bits */
function pack7(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 7) {
    const n = Math.min(7, bytes.length - i); let msb = 0;
    for (let j = 0; j < n; j++) msb |= ((bytes[i + j] >> 7) & 1) << j;
    out.push(msb);
    for (let j = 0; j < n; j++) out.push(bytes[i + j] & 0x7F);
  }
  return out;
}
function unpack7(data) {
  const out = [];
  for (let i = 0; i < data.length; i += 8) {
    const n = Math.min(8, data.length - i), msb = data[i];
    for (let j = 1; j < n; j++) out.push(data[i + j] | (((msb >> (j - 1)) & 1) << 7));
  }
  return out;
}
const slotBytes = n => [n & 0x7F, (n >> 7) & 1];
const readSlot = (lo, hi) => (lo & 0x7F) | ((hi & 1) << 7);
const hdr = ch => [0xF0, KORG, 0x30 | (ch & 0x0F), 0x00, 0x01, 0x2D];

/* outgoing */
const searchRequest = (echo = 42) => [0xF0, KORG, 0x50, 0x00, echo & 0x7F, EOX];
const spaceRequest = ch => [...hdr(ch), 0x1B, EOX];
const headerRequest = (ch, slot) => [...hdr(ch), 0x1E, ...slotBytes(slot), EOX];
const dataRequest = (ch, slot) => [...hdr(ch), 0x1F, ...slotBytes(slot), EOX];
function headerMessage(ch, slot, { name = '', length = 0, level = DEFAULT_LEVEL, speed = DEFAULT_SPEED }) {
  const raw = new Array(32).fill(0);
  const nm = asciiName(name);
  for (let i = 0; i < nm.length; i++) raw[i] = nm.charCodeAt(i);
  raw[24] = length & 0xFF; raw[25] = (length >>> 8) & 0xFF; raw[26] = (length >>> 16) & 0xFF; raw[27] = (length >>> 24) & 0xFF;
  raw[28] = level & 0xFF; raw[29] = (level >> 8) & 0xFF;
  raw[30] = speed & 0xFF; raw[31] = (speed >> 8) & 0xFF;
  return [...hdr(ch), 0x4E, ...slotBytes(slot), ...pack7(raw), EOX];
}
const emptyHeaderMessage = (ch, slot) => headerMessage(ch, slot, { name: '', length: 0, level: 0, speed: 0 });
function dataMessage(ch, slot, pcm /* Int16Array */) {
  const bytes = new Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) { const v = pcm[i] & 0xFFFF; bytes[2 * i] = v & 0xFF; bytes[2 * i + 1] = v >> 8; }
  const packed = pack7(bytes);
  const m = new Uint8Array(6 + 1 + 2 + packed.length + 1);
  m.set(hdr(ch), 0); m[6] = 0x4F; m.set(slotBytes(slot), 7); m.set(packed, 9); m[m.length - 1] = EOX;
  return m;
}
function asciiName(s) { return String(s).normalize('NFKD').replace(/[^\x20-\x7E]/g, '').slice(0, NAME_LEN); }

/* incoming */
const isExt = m => m.length >= 8 && m[0] === 0xF0 && m[1] === KORG && (m[2] & 0xF0) === 0x30 && m[3] === 0 && m[4] === 1 && m[5] === 0x2D;
function parseSearchReply(m) {
  if (m.length !== 15 || m[0] !== 0xF0 || m[1] !== KORG || m[2] !== 0x50 || m[3] !== 0x01) return null;
  const model = Array.from(m.slice(6, 10));
  if (model.join() !== VS2_MODEL.join()) return null;
  return { channel: m[4], echo: m[5], version: `${m[12] | (m[13] << 8)}.${m[10] | (m[11] << 8)}` };
}
function classify(m) {
  if (parseSearchReply(m)) return 'search';
  if (!isExt(m)) return null;
  if (m.length === 8) return 'status';
  return ({ 0x4B: 'space', 0x4E: 'header', 0x4F: 'data' })[m[6]] || null;
}
const parseStatus = m => ({ code: m[6], ok: m[6] === 0x23, text: STATUS[m[6]] || 'unknown reply 0x' + m[6].toString(16) });
function parseSpace(m) { const used = m[7] | (m[8] << 7), all = m[9] | (m[10] << 7); return { used, all, ratio: all ? used / all : 0 }; }
function parseHeader(m) {
  const slot = readSlot(m[7], m[8]);
  const raw = unpack7(Array.from(m.slice(9, m.length - 1)));
  let name = ''; for (let i = 0; i < NAME_LEN && raw[i]; i++) name += String.fromCharCode(raw[i]);
  const length = (raw[24] | (raw[25] << 8) | (raw[26] << 16) | (raw[27] << 24)) >>> 0;
  const level = raw[28] | (raw[29] << 8), speed = raw[30] | (raw[31] << 8);
  return { slot, name, length, level, speed, empty: !name && !length && !level && !speed };
}
function parseData(m) {
  const slot = readSlot(m[7], m[8]);
  const raw = unpack7(Array.from(m.slice(9, m.length - 1)));
  const pcm = new Int16Array(raw.length >> 1);
  for (let i = 0; i < pcm.length; i++) { const v = raw[2 * i] | (raw[2 * i + 1] << 8); pcm[i] = v > 32767 ? v - 65536 : v; }
  return { slot, pcm };
}

/* ── VoltaSeq instrument: KORG volca sample 2 ──────────────────────────── */
(() => {
  if (typeof window === 'undefined') return;
  // Part sound controls from KORG's volca sample 2 MIDI implementation chart (multi-channel mode, ch 1–10 = parts 1–10)
  const PARAMS = [
    { k: 'level', cc: 7, label: 'Level', def: 127 }, { k: 'pan', cc: 10, label: 'Pan', def: 64, bi: true },
    { k: 'start', cc: 40, label: 'Start', def: 0 }, { k: 'len', cc: 41, label: 'Length', def: 127 },
    { k: 'hicut', cc: 42, label: 'Hi cut', def: 127 }, { k: 'speed', cc: 43, label: 'Speed', def: 64, bi: true },
    { k: 'egint', cc: 44, label: 'Pitch EG', def: 64, bi: true }, { k: 'egatt', cc: 45, label: 'P. attack', def: 0 },
    { k: 'egdec', cc: 46, label: 'P. decay', def: 64 }, { k: 'ampatt', cc: 47, label: 'Attack', def: 0 },
    { k: 'ampdec', cc: 48, label: 'Decay', def: 127 }, { k: 'delay', cc: 50, label: 'Delay', def: 0 }
  ];
  const SWITCHES = [{ k: 'loop', cc: 68, label: 'Loop' }, { k: 'reverb', cc: 70, label: 'Reverb' }, { k: 'reverse', cc: 75, label: 'Reverse' }];
  const VEL = [127, 90, 50];

  const CSS = `
  .vk { padding: 14px; min-width: 860px; }
  .vk-body { background: linear-gradient(180deg, #ffffff, #f4f4f2); color: #1c1d1f; border-radius: 12px; padding: 14px 16px 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); font-family: Inter, sans-serif; }
  .vk-top { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
  .vk-name { font: 700 24px/1 Inter, sans-serif; color: #e8402a; letter-spacing: -0.5px; }
  .vk-name small { display: block; font: 600 9px/1.4 Inter, sans-serif; letter-spacing: 1.2px; text-transform: uppercase; }
  .vk-tabs { display: flex; gap: 8px; }
  .vk-tabs button, .vk-btn { flex: none; background: linear-gradient(180deg, #fbfbf9, #e6e6e3); color: #1c1d1f; border: 0; border-radius: 4px; padding: 7px 12px; font: 700 10px/1 Inter, sans-serif; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 2px 0 rgba(0,0,0,0.22); }
  .vk-tabs button:hover, .vk-btn:hover { background: linear-gradient(180deg, #ffffff, #ededea); border: 0; color: #1c1d1f; }
  .vk-tabs button[aria-selected="true"] { background: linear-gradient(180deg, #ff7a63, #e8402a); color: #fff; box-shadow: 0 0 8px rgba(232,64,42,0.5); }
  .vk-btn.red { background: linear-gradient(180deg, #f2654f, #c5301d); color: #fff; }
  .vk-link { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 11px; color: #5f6366; }
  .vk-link i { width: 8px; height: 8px; border-radius: 50%; background: #7a1a10; }
  .vk-link i.on { background: #ff3b1f; box-shadow: 0 0 6px #ff3b1f; }
  .vk-sec { background: #d9dad8; border-radius: 6px; padding: 10px 12px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.12); }
  .vk-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 11px; margin-bottom: 8px; }
  .vk-bar select, .vk-sec select { background: #fff; color: #1c1d1f; border: 1px solid #b9bbb8; padding: 3px 6px; width: auto; font-size: 11px; }
  .vk-grid { display: grid; grid-template-columns: 34px 150px 26px repeat(16, minmax(22px, 1fr)); gap: 4px 5px; align-items: center; }
  .vk-grid .ph { font: 700 9px/1 Inter, sans-serif; color: #5f6366; text-align: center; }
  .vk-part { flex: none; padding: 0; height: 28px; border: 0; border-radius: 3px; background: transparent; color: #1c1d1f; font: 700 11px Inter, sans-serif; display: flex; align-items: center; gap: 5px; justify-content: center; }
  .vk-part i { width: 7px; height: 7px; border-radius: 50%; background: #7a1a10; }
  .vk-part.sel { background: #fff; box-shadow: inset 0 0 0 2px #e8402a; }
  .vk-part.hit i { background: #ff3b1f; box-shadow: 0 0 6px #ff3b1f; }
  .vk-part:hover { background: #fff; border: 0; color: #1c1d1f; }
  .vk-mute { flex: none; padding: 0; width: 24px; height: 24px; font: 700 9px Inter, sans-serif; background: #fff; color: #5f6366; border: 1px solid #b9bbb8; border-radius: 3px; }
  .vk-mute.on { background: #1c1d1f; color: #fff; }
  .vk-pad { flex: none; padding: 0; height: 28px; border: 0; border-radius: 2px; background: linear-gradient(180deg, color-mix(in srgb, #d9dad8 84%, #000) 0, #d9dad8 26%); box-shadow: inset 0 2px 3px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.95); position: relative; }
  .vk-pad:hover { background: linear-gradient(180deg, color-mix(in srgb, #d9dad8 80%, #000) 0, #cfd0ce 26%); border: 0; }
  .vk-pad::after { content: ""; position: absolute; left: 50%; top: 50%; width: 9px; height: 9px; margin: -4.5px; border-radius: 50%; background: #8a2a1f; opacity: 0.35; }
  .vk-pad.on::after { background: #ff3b1f; opacity: var(--v, 1); box-shadow: 0 0 7px rgba(255,59,31, var(--v, 1)); }
  .vk-pad.off { opacity: 0.35; }
  .vk-pad.beat { box-shadow: inset 0 2px 3px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.95), inset 0 0 0 1px rgba(232,64,42,0.35); }
  .vk-pad.play { outline: 2px solid #1c1d1f; outline-offset: -2px; }
  .vk-knobs { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: flex-start; margin-top: 12px; }
  .vk-knob { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 56px; user-select: none; touch-action: none; }
  .vk-knob b { font: 700 9px/1 Inter, sans-serif; text-transform: uppercase; letter-spacing: 0.4px; color: #1c1d1f; white-space: nowrap; }
  .vk-knob .d { width: 34px; height: 34px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #ffb6a3 0, #f2694c 38%, #d84a2e 100%); box-shadow: 0 3px 5px rgba(0,0,0,0.3); position: relative; cursor: ns-resize; }
  .vk-knob .d::after { content: ""; position: absolute; left: 50%; top: 3px; width: 3px; height: 10px; margin-left: -1.5px; border-radius: 2px; background: #fff; }
  .vk-knob span { font: 11px 'JetBrains Mono', monospace; color: #5f6366; }
  .vk-sw { display: flex; flex-direction: column; gap: 6px; }
  .vk-tog { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font: 700 10px Inter, sans-serif; text-transform: uppercase; color: #1c1d1f; }
  .vk-tog i { width: 8px; height: 8px; border-radius: 50%; background: #7a1a10; }
  .vk-tog.on i { background: #ff3b1f; box-shadow: 0 0 6px #ff3b1f; }
  .vk-note { font-size: 11px; color: #5f6366; margin-top: 8px; line-height: 1.5; }
  .vk-slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 4px; max-height: 300px; overflow: auto; margin-top: 8px; }
  .vk-slot { flex: none; text-align: left; background: #fff; color: #1c1d1f; border: 0; border-radius: 3px; padding: 5px 7px; font-size: 11px; display: flex; gap: 6px; white-space: nowrap; overflow: hidden; box-shadow: 0 1px 0 rgba(0,0,0,0.12); }
  .vk-slot:hover { background: #fff; border: 0; color: #1c1d1f; }
  .vk-slot small { font-family: 'JetBrains Mono', monospace; color: #5f6366; }
  .vk-slot.empty { color: #8a8d90; }
  .vk-slot.sel { box-shadow: inset 0 0 0 2px #e8402a; }
  .vk-mem { display: flex; align-items: center; gap: 8px; font-size: 11px; flex: 1; min-width: 200px; }
  .vk-mem div { flex: 1; height: 8px; border-radius: 4px; background: #fff; overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,0.2); }
  .vk-mem div i { display: block; height: 100%; background: linear-gradient(90deg, #f2694c, #e8402a); width: 0; }
  `;
  const injectCSS = () => { if (document.getElementById('vk-css')) return; const s = document.createElement('style'); s.id = 'vk-css'; s.textContent = CSS; document.head.appendChild(s); };
  const pad3 = n => String(n).padStart(3, '0');

  /* ---------- notes for VoltaSeq ---------- */
  function regen(trk, seq) {
    const I = trk.inst, sb = 0.25, period = I.length * sb, loop = seq.loopBeats(), notes = [];
    for (let rep = 0; rep * period < loop - 1e-9; rep++)
      I.parts.forEach((p, pi) => {
        if (p.mute) return;
        p.steps.forEach((v, i) => {
          if (!v || i >= I.length) return;
          const start = rep * period + i * sb; if (start >= loop - 1e-9) return;
          notes.push({ _id: seq.newNoteId(), note: I.note, velocity: v, startBeat: start, durBeats: 0.12, ch: (I.partCh + pi) & 15, part: pi });
        });
      });
    trk.notes = notes;
  }
  // a stand-in drum voice per part, for listening without the hardware
  function synth(seq, n) {
    const c = seq.audio; if (!c) return;
    const t = c.currentTime, part = n.part || 0, v = n.velocity / 127;
    const g = c.createGain(); g.connect(seq.master);
    if (part === 0) { const o = c.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18); g.gain.setValueAtTime(0.7 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g); o.start(t); o.stop(t + 0.32); return; }
    const len = Math.floor(c.sampleRate * 0.2), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(), f = c.createBiquadFilter(); s.buffer = b;
    f.type = part === 1 ? 'bandpass' : 'highpass'; f.frequency.value = 600 + part * 900;
    g.gain.setValueAtTime(0.35 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + (part === 1 ? 0.16 : 0.06 + part * 0.01));
    s.connect(f).connect(g); s.start(t); s.stop(t + 0.22);
  }

  /* ---------- device link (samples over USB SysEx; protocol from volsa2, MIT) ---------- */
  const cur = { trk: null, seq: null };
  const ui = {};
  let dev = null, waiters = [], unSx = null, opChain = Promise.resolve(), raf = 0;
  const slots = new Array(200).fill(null); let space = null, selSlot = -1;
  const op = fn => { const p = opChain.then(fn, fn); opChain = p.catch(() => {}); return p; };
  function out() { return cur.seq.outputs.get(cur.trk.outputId); }
  function send(m) { const o = out(); if (!o) throw new Error('Choose the volca as MIDI output'); o.send(m); }
  function waitFor(kind, test, timeout) {
    return new Promise((res, rej) => { const w = { kind, test, res, t: setTimeout(() => { waiters = waiters.filter(x => x !== w); rej(new Error('The volca did not answer')); }, timeout) }; waiters.push(w); });
  }
  function onSx(data) {
    const m = Array.from(data), kind = classify(m); if (!kind) return;
    const i = waiters.findIndex(w => w.kind === kind && (!w.test || w.test(m)));
    if (i >= 0) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.t); w.res(m); }
  }
  const slotOf = m => (m[7] & 0x7F) | ((m[8] & 1) << 7);
  async function expectOk(timeout) { const st = parseStatus(await waitFor('status', null, timeout)); if (!st.ok) { const e = new Error('volca: ' + st.text); e.code = st.code; throw e; } }
  async function connect() {
    const seq = cur.seq;
    if (!(await seq.ensureSysex())) return false;
    if (!cur.trk.outputId) for (const [id, o] of seq.outputs) if (/volca/i.test(o.name || '')) { cur.trk.outputId = id; seq.fillDeviceSelects(); break; }
    try {
      const r = await op(async () => { send(searchRequest(42)); return parseSearchReply(await waitFor('search', null, 1500)); });
      dev = r; render(); return true;
    } catch (e) { dev = null; seq.toast('No answer from the volca. Check the USB cable.'); render(); return false; }
  }
  const readSpace = async () => { send(spaceRequest(dev.channel)); space = parseSpace(await waitFor('space', null, 2000)); };
  async function readHeader(n) { send(headerRequest(dev.channel, n)); return parseHeader(await waitFor('header', m => slotOf(m) === n, 2500)); }
  async function downloadPcm(n) { send(dataRequest(dev.channel, n)); return parseData(await waitFor('data', m => slotOf(m) === n, 20000 + (slots[n]?.length || 0) / 5)).pcm; }
  async function uploadPcm(n, name, pcm, level = 65535, speed = 16384) {
    for (let a = 0; ; a++) {
      try {
        send(headerMessage(dev.channel, n, { name, length: pcm.length, level, speed })); await expectOk(4000);
        send(dataMessage(dev.channel, n, pcm)); await expectOk(30000 + pcm.length / 3);
        slots[n] = { slot: n, name: asciiName(name), length: pcm.length, level, speed, empty: false }; return;
      } catch (e) { if (e.code === 0x24 && a < 3) { await new Promise(r => setTimeout(r, 500)); continue; } throw e; }
    }
  }
  async function erase(n) { send(emptyHeaderMessage(dev.channel, n)); await expectOk(4000); slots[n] = { slot: n, name: '', length: 0, empty: true }; }

  // any audio file → mono 31.25 kHz 16-bit, normalised and trimmed
  async function prepare(file, { norm = true, trim = true } = {}) {
    const ac = cur.seq.audio, buf = await ac.decodeAudioData(await file.arrayBuffer());
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    let a = 0, b = buf.length - 1;
    if (trim) { while (a < b && Math.abs((L[a] + R[a]) / 2) < 0.02) a++; while (b > a && Math.abs((L[b] + R[b]) / 2) < 0.02) b--; a = Math.max(0, a - 64); b = Math.min(buf.length - 1, b + 256); }
    const mono = new Float32Array(b - a + 1); for (let i = 0; i < mono.length; i++) mono[i] = (L[a + i] + R[a + i]) / 2;
    const n = Math.max(1, Math.ceil(mono.length / buf.sampleRate * VS2_RATE)), o = new OfflineAudioContext(1, n, VS2_RATE);
    const ib = o.createBuffer(1, mono.length, buf.sampleRate); ib.copyToChannel(mono, 0);
    const s = o.createBufferSource(); s.buffer = ib; s.connect(o.destination); s.start();
    const x = (await o.startRendering()).getChannelData(0);
    let pk = 0; if (norm) for (const v of x) pk = Math.max(pk, Math.abs(v));
    const k = norm && pk > 1e-4 ? 0.98 / pk : 1, pcm = new Int16Array(x.length);
    for (let i = 0; i < x.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * k * 32767)));
    return pcm;
  }
  function wav(pcm) {
    const b = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, VS2_RATE, true); v.setUint32(28, VS2_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);
    return new Uint8Array(b);
  }
  function readWav16(ab) {
    const v = new DataView(ab); let o = 12, fmt = null;
    while (o + 8 <= v.byteLength) {
      const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)), sz = v.getUint32(o + 4, true);
      if (id === 'fmt ') fmt = { ch: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
      if (id === 'data' && fmt && fmt.ch === 1 && fmt.bits === 16 && fmt.rate === VS2_RATE) { const p = new Int16Array(sz / 2); for (let i = 0; i < p.length; i++) p[i] = v.getInt16(o + 8 + i * 2, true); return p; }
      o += 8 + sz + (sz & 1);
    }
    return null;
  }

  /* ---------- part sound ---------- */
  function sendCC(pi, cc, val) {
    const o = out(); if (!o) return;
    o.send([0xB0 | ((cur.trk.inst.partCh + pi) & 15), cc, val & 127]);
  }
  function sendSample(pi) {
    const n = cur.trk.inst.parts[pi].sample; if (n == null) return;
    sendCC(pi, 3, n >> 7); sendCC(pi, 35, n & 127);
  }
  function sendPartSound(pi) {
    const p = cur.trk.inst.parts[pi];
    sendSample(pi);
    PARAMS.forEach(d => { if (p.p[d.k] != null) sendCC(pi, d.cc, p.p[d.k]); });
    SWITCHES.forEach(d => { if (p.p[d.k] != null) sendCC(pi, d.cc, p.p[d.k] ? 127 : 0); });
  }

  /* ---------- UI ---------- */
  function mount(host, trk, seq) {
    injectCSS(); cur.trk = trk; cur.seq = seq;
    if (!unSx) unSx = seq.onSysex(onSx);
    host.innerHTML = `<div class="vk"><div class="vk-body">
      <div class="vk-top">
        <div class="vk-name">volca sample 2<small>10-part sequence · VoltaSeq</small></div>
        <div class="vk-tabs" role="tablist"><button data-v="grid" role="tab">Sequence</button><button data-v="samples" role="tab">Samples</button></div>
        <div class="vk-link"><i id="vkDot"></i><span id="vkInfo">Not connected</span><button class="vk-btn" id="vkConn">Connect volca</button></div>
      </div>
      <div id="vkGridView">
        <div class="vk-sec">
          <div class="vk-bar">
            <label>Length <select id="vkLen"></select></label>
            <label>Part 1 channel <select id="vkCh"></select></label>
            <span style="flex:1"></span>
            <button class="vk-btn" id="vkSendAll" title="Send every part's sample and sound settings to the volca">Send sounds to volca</button>
            <button class="vk-btn" id="vkClear">Clear</button>
          </div>
          <div class="vk-grid" id="vkGrid"></div>
          <p class="vk-note">Click a step to add or remove a hit; right-click to change its strength. Click a part number to edit that part's sound. Parts play on MIDI channels 1–10 (KORG's default); every knob is sent to the volca as you turn it.</p>
        </div>
        <div class="vk-sec" style="margin-top:10px"><div class="vk-bar"><b id="vkPartName">Part 1</b><label>Sample <select id="vkSample"></select></label></div><div class="vk-knobs" id="vkKnobs"></div></div>
      </div>
      <div id="vkSampleView" hidden>
        <div class="vk-sec">
          <div class="vk-bar">
            <div class="vk-mem"><b>Memory</b><div><i id="vkMem"></i></div><span id="vkMemTxt">—</span></div>
            <button class="vk-btn" id="vkRead">Read slots</button>
            <button class="vk-btn" id="vkBackup">Back up .zip</button>
            <button class="vk-btn" id="vkRestore">Restore .zip</button>
          </div>
          <div class="vk-bar">
            <span id="vkSel">Select a slot</span>
            <button class="vk-btn red" id="vkUp">Send audio file here</button>
            <span class="vk-tog on" id="vkNorm"><i></i>Normalise</span><span class="vk-tog on" id="vkTrim"><i></i>Trim silence</span>
            <button class="vk-btn" id="vkListen">Listen</button><button class="vk-btn" id="vkWav">Save WAV</button><button class="vk-btn" id="vkDel">Delete</button>
          </div>
          <div class="vk-slots" id="vkSlots"></div>
          <p class="vk-note">Files are converted to the volca's format (mono, 31.25 kHz, 16-bit). For recording and detailed trimming, use the standalone sample loader; backups from both are compatible.</p>
        </div>
      </div>
      <input type="file" id="vkFile" accept="audio/*" hidden><input type="file" id="vkZip" accept=".zip" hidden>
    </div></div>`;
    const $ = id => host.querySelector('#' + id);
    Object.assign(ui, { host, grid: $('vkGrid'), len: $('vkLen'), ch: $('vkCh'), knobs: $('vkKnobs'), sample: $('vkSample'), partName: $('vkPartName'), dot: $('vkDot'), info: $('vkInfo'), slots: $('vkSlots'), sel: $('vkSel'), mem: $('vkMem'), memTxt: $('vkMemTxt') });
    for (let i = 1; i <= 16; i++) ui.len.add(new Option(i + ' steps', i));
    for (let i = 0; i < 7; i++) ui.ch.add(new Option('ch ' + (i + 1), i));
    host.querySelectorAll('.vk-tabs button').forEach(b => b.onclick = () => { trk.inst.view = b.dataset.v; render(); });
    ui.len.onchange = () => edit(I => { I.length = +ui.len.value; });
    ui.ch.onchange = () => edit(I => { I.partCh = +ui.ch.value; });
    $('vkClear').onclick = () => edit(I => I.parts.forEach(p => p.steps.fill(0)));
    $('vkSendAll').onclick = () => { if (!out()) return seq.toast('Choose the volca as MIDI output'); trk.inst.parts.forEach((_, i) => sendPartSound(i)); seq.toast('Part sounds sent'); };
    $('vkConn').onclick = async () => { if (await connect()) readSlots(); };
    ui.sample.onchange = () => { const v = ui.sample.value; edit(I => { I.parts[I.sel].sample = v === '' ? null : +v; }); sendSample(trk.inst.sel); };
    $('vkRead').onclick = readSlots;
    $('vkUp').onclick = () => { if (selSlot < 0) return seq.toast('Select a slot first'); $('vkFile').click(); };
    $('vkFile').onchange = e => { if (e.target.files[0]) uploadFile(e.target.files[0]); e.target.value = ''; };
    ['vkNorm', 'vkTrim'].forEach(id => $(id).onclick = () => $(id).classList.toggle('on'));
    $('vkListen').onclick = listen; $('vkWav').onclick = saveWav; $('vkDel').onclick = del;
    $('vkBackup').onclick = backup; $('vkRestore').onclick = () => $('vkZip').click();
    $('vkZip').onchange = e => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ''; };
    buildGrid(); buildKnobs(); render();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
  }
  function unmount() { cancelAnimationFrame(raf); }
  function edit(fn, undo = true) { if (undo) cur.seq.pushUndo(); fn(cur.trk.inst); regen(cur.trk, cur.seq); render(); cur.seq.renderTracks(); cur.seq.updateStatus(); }

  function buildGrid() {
    const g = ui.grid; g.innerHTML = '<span></span><span class="ph">Sample</span><span></span>' + Array.from({ length: 16 }, (_, i) => `<span class="ph">${i + 1}</span>`).join('');
    ui.rows = [];
    for (let pi = 0; pi < 10; pi++) {
      const part = document.createElement('button'); part.className = 'vk-part'; part.innerHTML = `<i></i>${pi + 1}`; part.title = 'Edit part ' + (pi + 1) + ' (plays it)';
      part.onclick = () => { cur.trk.inst.sel = pi; render(); audition(pi); };
      const sm = document.createElement('span'); sm.style.cssText = 'font-size:10px;color:#5f6366;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      const mute = document.createElement('button'); mute.className = 'vk-mute'; mute.textContent = 'M'; mute.title = 'Mute part';
      mute.onclick = () => edit(I => { I.parts[pi].mute = !I.parts[pi].mute; });
      g.append(part, sm, mute);
      const pads = [];
      for (let i = 0; i < 16; i++) {
        const b = document.createElement('button'); b.className = 'vk-pad' + (i % 4 === 0 ? ' beat' : '');
        b.setAttribute('aria-label', `Part ${pi + 1} step ${i + 1}`);
        b.onclick = () => edit(I => { const s = I.parts[pi].steps; s[i] = s[i] ? 0 : 127; });
        b.oncontextmenu = e => { e.preventDefault(); edit(I => { const s = I.parts[pi].steps; s[i] = s[i] ? VEL[(VEL.indexOf(s[i]) + 1) % VEL.length] : 127; }); };
        g.append(b); pads.push(b);
      }
      ui.rows.push({ part, sm, mute, pads });
    }
  }
  function audition(pi) {
    const I = cur.trk.inst, o = out(), ch = (I.partCh + pi) & 15;
    if (o) { o.send([0x90 | ch, I.note, 127]); setTimeout(() => o.send([0x80 | ch, I.note, 0]), 100); }
    else if (cur.seq.audioPreview) synth(cur.seq, { velocity: 127, part: pi });
  }
  function buildKnobs() {
    ui.knobEls = {};
    PARAMS.forEach(d => {
      const k = document.createElement('div'); k.className = 'vk-knob'; k.title = 'Drag up/down · double-click to reset · CC ' + d.cc;
      k.innerHTML = `<b>${d.label}</b><div class="d" role="slider" tabindex="0" aria-label="${d.label}" aria-valuemin="0" aria-valuemax="127"></div><span></span>`;
      const dial = k.querySelector('.d');
      const set = v => {
        v = Math.max(0, Math.min(127, Math.round(v)));
        const I = cur.trk.inst, p = I.parts[I.sel];
        if (p.p[d.k] === v) return; p.p[d.k] = v; sendCC(I.sel, d.cc, v); showKnob(d);
      };
      let y0 = 0, v0 = 0, moved = false;
      dial.addEventListener('pointerdown', e => { dial.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = val(d); moved = false; });
      dial.addEventListener('pointermove', e => { if (!dial.hasPointerCapture(e.pointerId)) return; if (!moved) { cur.seq.pushUndo(); moved = true; } set(v0 + (y0 - e.clientY) * 0.8); });
      dial.addEventListener('dblclick', () => { cur.seq.pushUndo(); set(d.def); });
      dial.addEventListener('keydown', e => { const s = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]; if (s) { e.preventDefault(); set(val(d) + s * (e.shiftKey ? 10 : 1)); } });
      ui.knobs.appendChild(k); ui.knobEls[d.k] = { k, dial, out: k.querySelector('span') };
    });
    const sw = document.createElement('div'); sw.className = 'vk-sw';
    SWITCHES.forEach(d => {
      const t = document.createElement('span'); t.className = 'vk-tog'; t.innerHTML = `<i></i>${d.label}`; t.title = 'CC ' + d.cc;
      t.onclick = () => { const I = cur.trk.inst, p = I.parts[I.sel]; cur.seq.pushUndo(); p.p[d.k] = p.p[d.k] ? 0 : 1; sendCC(I.sel, d.cc, p.p[d.k] ? 127 : 0); render(); };
      sw.appendChild(t); ui.knobEls[d.k] = { tog: t };
    });
    ui.knobs.appendChild(sw);
  }
  const val = d => { const I = cur.trk.inst, v = I.parts[I.sel].p[d.k]; return v == null ? d.def : v; };
  function showKnob(d) {
    const e = ui.knobEls[d.k], v = val(d), set = cur.trk.inst.parts[cur.trk.inst.sel].p[d.k] != null;
    e.dial.style.transform = `rotate(${-135 + v / 127 * 270}deg)`;
    e.dial.setAttribute('aria-valuenow', v);
    e.out.textContent = set ? (d.bi ? (v - 64 > 0 ? '+' : '') + (v - 64) : v) : '—';
    e.dial.style.opacity = set ? 1 : 0.55;
  }
  const slotName = n => { const s = slots[n]; return pad3(n) + (s ? ' · ' + (s.empty ? 'empty' : s.name) : ''); };

  function render() {
    const { trk } = cur, I = trk.inst;
    ui.host.querySelectorAll('.vk-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.v === (I.view || 'grid')));
    ui.host.querySelector('#vkGridView').hidden = I.view === 'samples';
    ui.host.querySelector('#vkSampleView').hidden = I.view !== 'samples';
    ui.dot.classList.toggle('on', !!dev);
    ui.info.textContent = dev ? `volca sample 2 · firmware ${dev.version}` : 'Not connected';
    ui.len.value = I.length; ui.ch.value = I.partCh;
    ui.rows.forEach((r, pi) => {
      const p = I.parts[pi];
      r.part.classList.toggle('sel', pi === I.sel);
      r.mute.classList.toggle('on', p.mute);
      r.sm.textContent = p.sample == null ? 'as set on volca' : slotName(p.sample);
      r.pads.forEach((b, i) => { const v = p.steps[i]; b.classList.toggle('on', !!v); b.classList.toggle('off', i >= I.length); b.style.setProperty('--v', v ? (0.35 + 0.65 * v / 127).toFixed(2) : 1); });
    });
    ui.partName.textContent = 'Part ' + (I.sel + 1);
    const s = ui.sample, cur0 = I.parts[I.sel].sample;
    s.innerHTML = ''; s.add(new Option('As set on the volca', ''));
    for (let n = 0; n < 200; n++) if (!slots[n] || !slots[n].empty || n === cur0) s.add(new Option(slotName(n), n));
    s.value = cur0 == null ? '' : String(cur0);
    PARAMS.forEach(showKnob);
    SWITCHES.forEach(d => ui.knobEls[d.k].tog.classList.toggle('on', !!I.parts[I.sel].p[d.k]));
    if (I.view === 'samples') renderSlots();
  }
  function renderSlots() {
    ui.slots.innerHTML = '';
    for (let n = 0; n < 200; n++) {
      const s = slots[n], b = document.createElement('button');
      b.className = 'vk-slot' + (!s || s.empty ? ' empty' : '') + (n === selSlot ? ' sel' : '');
      b.innerHTML = `<small>${pad3(n)}</small><span></span>`; b.lastChild.textContent = s ? (s.empty ? 'empty' : s.name) : '…';
      b.onclick = () => { selSlot = n; renderSlots(); };
      ui.slots.appendChild(b);
    }
    ui.sel.textContent = selSlot < 0 ? 'Select a slot' : 'Slot ' + slotName(selSlot);
    if (space) { ui.mem.style.width = Math.round(space.ratio * 100) + '%'; ui.memTxt.textContent = Math.round(space.ratio * 100) + '% used'; }
  }
  function tick() {
    const { trk, seq } = cur; if (!ui.rows || !trk) return;
    const I = trk.inst; let idx = -1;
    if (seq.playing) idx = Math.floor((seq.currentBeat() % (I.length * 0.25)) / 0.25);
    ui.rows.forEach((r, pi) => { r.pads.forEach((b, i) => b.classList.toggle('play', i === idx)); r.part.classList.toggle('hit', idx >= 0 && !!I.parts[pi].steps[idx] && !I.parts[pi].mute); });
    raf = requestAnimationFrame(tick);
  }

  /* ---------- sample actions ---------- */
  const need = async () => dev || (await connect());
  async function readSlots() {
    if (!(await need())) return;
    const b = cur.seq.busy('Reading the volca\u2019s slots');
    try { await op(async () => { await readSpace(); for (let n = 0; n < 200; n++) { slots[n] = await readHeader(n); if (n % 10 === 9) b.sub(`${n + 1} / 200`); } }); render(); renderSlots(); await b.done(`${slots.filter(s => s && !s.empty).length} samples found`); }
    catch (e) { await b.done(e.message); }
  }
  async function uploadFile(f) {
    if (!(await need())) return;
    const n = selSlot;
    if (slots[n] && !slots[n].empty && !confirm(`Slot ${pad3(n)} holds “${slots[n].name}”. Replace it?`)) return;
    const b = cur.seq.busy(`Sending ${f.name} to slot ${pad3(n)}`);
    try {
      const pcm = await prepare(f, { norm: ui.host.querySelector('#vkNorm').classList.contains('on'), trim: ui.host.querySelector('#vkTrim').classList.contains('on') });
      b.sub(`${(pcm.length / VS2_RATE).toFixed(2)} s · ${Math.round(pcm.length / 512)} kB`);
      await op(async () => { await uploadPcm(n, f.name.replace(/\.[^.]+$/, ''), pcm); await readSpace(); });
      render(); await b.done('Stored in slot ' + pad3(n));
    } catch (e) { await b.done(e.message); }
  }
  async function fetchPcm(n) { if (!(await need()) || !slots[n] || slots[n].empty) return null; const b = cur.seq.busy('Reading slot ' + pad3(n)); try { const p = await op(() => downloadPcm(n)); await b.done(); return p; } catch (e) { await b.done(e.message); return null; } }
  async function listen() {
    const pcm = await fetchPcm(selSlot); if (!pcm) return;
    const c = cur.seq.audio, buf = c.createBuffer(1, pcm.length, VS2_RATE), d = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) d[i] = pcm[i] / 32768;
    const s = c.createBufferSource(); s.buffer = buf; s.connect(cur.seq.master); s.start();
  }
  async function saveWav() { const pcm = await fetchPcm(selSlot); if (pcm) cur.seq.download(`${pad3(selSlot)} ${slots[selSlot].name}.wav`, wav(pcm), 'audio/wav'); }
  async function del() {
    const n = selSlot; if (!slots[n] || slots[n].empty) return;
    if (!confirm(`Delete “${slots[n].name}” from slot ${pad3(n)}?`)) return;
    const b = cur.seq.busy('Deleting slot ' + pad3(n));
    try { await op(async () => { await erase(n); await readSpace(); }); render(); await b.done('Deleted'); } catch (e) { await b.done(e.message); }
  }
  async function backup() {
    if (!(await need())) return;
    if (typeof JSZip === 'undefined') return cur.seq.toast('JSZip did not load; check the connection');
    if (!slots.every(Boolean)) await readSlots();
    const used = slots.filter(s => s && !s.empty), zip = new JSZip(), man = [];
    const b = cur.seq.busy('Backing up the volca');
    try {
      for (const [i, h] of used.entries()) {
        b.sub(`${i + 1} / ${used.length} · ${h.name}`);
        const pcm = await op(() => downloadPcm(h.slot)), file = `${pad3(h.slot)} ${h.name.replace(/[^\w\- ]+/g, '')}.wav`;
        zip.file(file, wav(pcm)); man.push({ slot: h.slot, name: h.name, length: h.length, level: h.level, speed: h.speed, file });
      }
      zip.file('manifest.json', JSON.stringify({ app: 'VoltaSeq', device: 'volca sample 2', date: new Date().toISOString(), samples: man }, null, 1));
      const blob = await zip.generateAsync({ type: 'uint8array' });
      cur.seq.download(`volca-sample-backup-${new Date().toISOString().slice(0, 10)}.zip`, blob, 'application/zip');
      await b.done(`${man.length} samples backed up`);
    } catch (e) { await b.done(e.message); }
  }
  async function restore(file) {
    if (!(await need())) return;
    let zip, man;
    try { zip = await JSZip.loadAsync(file); man = JSON.parse(await zip.file('manifest.json').async('string')).samples; }
    catch (e) { return cur.seq.toast('That is not a volca sample backup'); }
    if (!confirm(`Restore ${man.length} samples into their original slots? Samples already in those slots are replaced.`)) return;
    const b = cur.seq.busy('Restoring the backup');
    try {
      for (const [i, m] of man.entries()) {
        b.sub(`${i + 1} / ${man.length} · ${m.name}`);
        const pcm = readWav16(await zip.file(m.file).async('arraybuffer'));
        if (!pcm) continue;
        await op(() => uploadPcm(m.slot, m.name, pcm, m.level || 65535, m.speed || 16384));
      }
      await op(readSpace); render(); await b.done('Backup restored');
    } catch (e) { await b.done(e.message); }
  }

  VoltaInstruments.volca = {
    id: 'volca', name: 'KORG volca sample 2', short: 'VOLCA', editor: 'custom', hideChannel: true, portMatch: /volca/i,
    create(trk, seq) {
      trk.name = 'volca sample';
      const parts = Array.from({ length: 10 }, () => ({ steps: new Array(16).fill(0), mute: false, sample: null, p: {} }));
      [0, 4, 8, 12].forEach(i => parts[0].steps[i] = 127);          // a starting beat: kick, snare, hats
      [4, 12].forEach(i => parts[1].steps[i] = 127);
      for (let i = 2; i < 16; i += 4) parts[2].steps[i] = 90;
      trk.inst = { length: 16, partCh: 0, note: 60, sel: 0, view: 'grid', parts };
      regen(trk, seq);
    },
    onLoad: regen, onTimeline: regen, synth,
    trackInfo: trk => `10 parts · ${trk.inst.length} steps`,
    onPortChange() { dev = null; if (cur.trk) render(); },
    mount, unmount, refresh(trk, seq) { cur.trk = trk; cur.seq = seq; render(); }
  };
})();
})();
