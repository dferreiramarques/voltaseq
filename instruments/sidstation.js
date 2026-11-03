/* VoltaSeq instrument: Elektron SidStation — Notes/Sound views, live editing via Direct Program SysEx, wavetables, patch dumps.
   Based on the SidStation owner's manual rev 2.2b (OS 1.1) MIDI implementation; shares its patch model with the standalone SidStation editor. MIT, see LICENSE. */
(() => {
/* ===== SidStation core: patch model, SysEx encode/decode (from manual rev 2.2b, OS 1.1) ===== */
const HDR = [0xF0, 0x00, 0x20, 0x3C, 0x01, 0x00];
const cfg = { ch: 0, live: true, dpDelay: 6, dumpDelay: 150, swapPitch: false, signed8: false, sizeAdj: 0 };

const NOTE = ['C-','C#','D-','D#','E-','F-','F#','G-','G#','A-','A#','B-'];
const noteName = n => NOTE[((n % 12) + 12) % 12] + Math.floor(n / 12);   // manual: index 45 = A-3
const ATK = ['2ms','8ms','16ms','24ms','38ms','56ms','68ms','80ms','100ms','240ms','500ms','800ms','1s','3s','5s','8s'];
const DEC = ['6ms','24ms','48ms','72ms','114ms','168ms','204ms','240ms','300ms','750ms','1.5s','2.4s','3s','9s','15s','24s'];
const ATKms = [2,8,16,24,38,56,68,80,100,240,500,800,1000,3000,5000,8000];
const DECms = [6,24,48,72,114,168,204,240,300,750,1500,2400,3000,9000,15000,24000];

const LFOSEL = [[0,'LFO 1'],[1,'LFO 2'],[2,'LFO 3'],[3,'LFO 4']];
const WAVES  = [[1,'Triangle'],[2,'Sawtooth'],[4,'Pulse'],[5,'Mixed'],[8,'Noise'],[0,'Silent']];
const FTYPES = [[0,'Off'],[1,'Low pass'],[2,'Band pass'],[3,'Low + band'],[4,'High pass'],[5,'Notch (low + high)'],[6,'Band + high'],[7,'All three']];
const LTYPES = [[0,'Triangle'],[1,'Sawtooth'],[2,'Ramp'],[3,'Square'],[4,'Random'],[7,'Flat']];
const SRCS   = [[0,'Mod wheel'],[1,'Pitch bend'],[2,'Velocity'],[3,'Aftertouch'],[4,'CTRL1 (CC 20)'],[5,'CTRL2 (CC 21)'],[6,'CTRL3 (CC 22)'],[7,'CTRL4 (CC 23)'],[8,'LFO 1'],[9,'LFO 2'],[10,'LFO 3'],[11,'LFO 4']];
const DESTS  = [[0,'None'],[1,'Depth'],[2,'Speed'],[3,'Sample & hold'],[4,'Lace']];
const LACEW  = [[0,'Zero'],[1,'LFO 1'],[2,'LFO 2'],[3,'LFO 3'],[4,'LFO 4']];
const TWAVES = [[9,'---'],[1,'Tri'],[2,'Saw'],[4,'Puls'],[5,'Mix'],[8,'Nois'],[0,'Off']];
const TBASE  = [246, 376, 506];   // Direct Program memory address of table 1/2/3 (65 rows x 2 bytes)

function decodeSigned(b) { b &= 0xFF; if (b & 0x80) return b - 256; if (b & 0x40) return b - 128; return b; }

/* ---- parameter map: idx = byte in patch dump, addr = Direct Program memory address ---- */
const P = [], PK = {};
function def(o) {
  o.mask = o.mask ?? 0xFF; o.shift = o.shift ?? 0; o.min = o.min ?? 0;
  if (o.max == null) o.max = o.kind === 'bool' ? 1 : (o.options ? Math.max(...o.options.map(x => x[0])) : 127);
  o.addr = o.addr ?? o.idx; P.push(o); PK[o.key] = o; return o;
}
const B = (key, sec, label, idx, bit, x) => def(Object.assign({ key, sec, label, idx, mask: 1, shift: bit, kind: 'bool' }, x || {}));
const R = (key, sec, label, idx, min, max, x) => def(Object.assign({ key, sec, label, idx, kind: 'range', min, max }, x || {}));
const S = (key, sec, label, idx, mask, shift, options, x) => def(Object.assign({ key, sec, label, idx, mask, shift, kind: 'select', options }, x || {}));
const off0 = v => v ? String(v) : 'Off';

// patch-level
S('poly', 'patch', 'Voice mode', 22, 1, 3, [[0,'Single (3 layers, mono)'],[1,'Poly (3 voices, osc 1)']], { noRand: 1 });
B('legato', 'patch', 'Legato portamento', 22, 5);
B('reinit', 'patch', 'Retrigger every note', 25, 6);
R('speed', 'patch', 'Update speed', 34, 50, 200, { fmt: v => v + ' Hz', noRand: 1 });
R('hcut', 'patch', 'Hard cut', 35, 0, 15, { noRand: 1 });
for (let n = 0; n < 4; n++) {
  R(`dc${n}`, 'dc', `Knob ${n+1} target`, 10 + 3*n, 0, 96, { fmt: v => v ? '#' + v : 'None', noRand: 1 });
  R(`dc${n}ld`, 'dc', 'Lowest value', 11 + 3*n, 0, 127, { noRand: 1 });
  R(`dc${n}lu`, 'dc', 'Highest value', 12 + 3*n, 0, 127, { noRand: 1 });
}
// filter
S('ftype', 'filter', 'Type', 25, 7, 0, FTYPES);
R('cut', 'filter', 'Cutoff', 26, 0, 127);
R('res', 'filter', 'Resonance', 24, 0, 15, { mask: 0x0F, shift: 4 });
R('fenv', 'filter', 'Env amount', 27, 0, 127);
R('fatt', 'filter', 'Attack', 28, 0, 127);
R('fdec', 'filter', 'Decay', 29, 0, 127);
R('fsus', 'filter', 'Sustain', 30, 0, 127);
R('frel', 'filter', 'Release', 31, 0, 127);
B('finv', 'filter', 'Invert env', 22, 7);
B('fwrap', 'filter', 'Wrap cutoff', 22, 6);
B('fsync', 'filter', 'Env restarts on note', 22, 4);
S('flfo', 'filter', 'Mod LFO', 25, 3, 4, LFOSEL);
R('flfod', 'filter', 'LFO depth', 32, 0, 127);
R('flfow', 'filter', 'Wheel adds', 33, 0, 127);
// oscillators (21 bytes each)
for (let o = 0; o < 3; o++) {
  const b = 36 + 21*o, a = 71 + 21*o, s = 'osc' + o, k = x => `o${o}_${x}`;
  B(k('on'), s, 'Active', 22, o, { noRand: 1 });
  B(k('flt'), s, 'Filter', 24, o);
  B(k('spwm'), s, 'PW key sync', b, 0, { addr: a });
  B(k('gate'), s, 'Gate env', b, 1, { addr: a });
  R(k('track'), s, 'Pitch', b+1, 0, 99, { addr: a+1, fmt: v => v ? 'Fixed ' + noteName(v) : 'Keyboard', noRand: 1 });
  R(k('arp'), s, 'Arp speed', b+2, 0, 127, { addr: a+2, fmt: off0, noRand: 1 });
  R(k('trn'), s, 'Transpose', b+3, -24, 24, { addr: a+3, signed: 1, fmt: v => (v > 0 ? '+' : '') + v + ' st', step: 1 });
  R(k('det'), s, 'Detune', b+4, -64, 63, { addr: a+4, signed: 1, fmt: v => (v > 0 ? '+' : '') + v });
  R(k('pb'), s, 'Bend range', b+5, 0, 24, { addr: a+5, fmt: v => '±' + v, noRand: 1 });
  R(k('a'), s, 'Attack', b+6, 0, 15, { addr: a+6, fmt: v => ATK[v] });
  R(k('d'), s, 'Decay', b+7, 0, 15, { addr: a+7, fmt: v => DEC[v] });
  R(k('s'), s, 'Sustain', b+8, 0, 15, { addr: a+8 });
  R(k('r'), s, 'Release', b+9, 0, 15, { addr: a+9, fmt: v => DEC[v] });
  R(k('dly'), s, 'Delay', b+10, 0, 127, { addr: a+10, fmt: off0, noRand: 1 });
  R(k('pws'), s, 'PW start', b+11, 0, 127, { addr: a+11 });
  R(k('pwa'), s, 'PW sweep', b+12, 0, 127, { addr: a+12, fmt: off0 });
  S(k('pwl'), s, 'PW LFO', b+13, 0xFF, 0, LFOSEL, { addr: a+13 });
  R(k('pwd'), s, 'PW depth', b+14, 0, 127, { addr: a+14 });
  S(k('wave'), s, 'Waveform', b+15, 0x0F, 4, WAVES, { addr: a+15 });
  B(k('sync'), s, 'Hard sync', b+15, 1, { addr: a+15, cc: [40,56,78][o], help: 'Locks this oscillator to the previous one (osc 2 to 1, 3 to 2, 1 to 3). Best on triangle, with transpose or vibrato on this oscillator.' });
  B(k('ring'), s, 'Ring mod', b+15, 2, { addr: a+15, cc: [41,57,79][o], help: 'Ring-modulates with the previous oscillator (osc 2 with 1, 3 with 2, 1 with 3). Best on triangle.' });
  R(k('port'), s, 'Portamento', b+16, 0, 99, { addr: a+16, fmt: off0 });
  S(k('vibl'), s, 'Vib LFO', b+17, 0xFF, 0, LFOSEL, { addr: a+17 });
  R(k('vibd'), s, 'Vib depth', b+18, 0, 127, { addr: a+18 });
  R(k('vibw'), s, 'Wheel adds', b+19, 0, 127, { addr: a+19 });
  R(k('tbl'), s, 'Table speed', b+20, 0, 127, { addr: a+20, fmt: off0, noRand: 1 });
}
// LFOs (11 bytes in dump, 28-byte stride in memory)
for (let l = 0; l < 4; l++) {
  const b = 99 + 11*l, a = 134 + 28*l, s = 'lfo' + l, k = x => `l${l}_${x}`;
  S(k('type'), s, 'Shape', b, 7, 0, LTYPES, { addr: a });
  S(k('src'), s, 'Controlled by', b, 0x0F, 4, SRCS, { addr: a, noRand: 1 });
  B(k('sync'), s, 'Restart on note', b+1, 0, { addr: a+1 });
  B(k('inv'), s, 'Invert', b+1, 1, { addr: a+1 });
  B(k('abz'), s, 'Positive only', b+1, 2, { addr: a+1 });
  B(k('snoff'), s, 'Restart on release', b+1, 3, { addr: a+1 });
  S(k('dest'), s, 'Control target', b+1, 7, 4, DESTS, { addr: a+1, noRand: 1 });
  R(k('speed'), s, 'Speed', b+2, 0, 127, { addr: a+2, help: 'Higher numbers are slower' });
  R(k('sh'), s, 'Sample & hold', b+3, 0, 127, { addr: a+3, fmt: off0 });
  R(k('depth'), s, 'Depth', b+4, 0, 127, { addr: a+4 });
  S(k('add'), s, 'Add LFO', b+5, 0xFF, 0, LFOSEL, { addr: a+5 });
  R(k('lace'), s, 'Lace speed', b+6, 0, 127, { addr: a+6, fmt: off0 });
  S(k('lacew'), s, 'Lace with', b+7, 0xFF, 0, LACEW, { addr: a+7 });
  R(k('addd'), s, 'Add depth', b+8, 0, 127, { addr: a+8, fmt: off0 });
  R(k('ctrlv'), s, 'Control amount', b+9, 0, 127, { addr: a+9, noRand: 1 });
  R(k('fade'), s, 'Fade in', b+10, 0, 127, { addr: a+10, fmt: off0 });
}

/* ---- patch object ---- */
const mkTable = () => ({ steps: [], term: { type: 'end', lp: 0 } });
const newPatch = () => ({ name: 'Init', bytes: new Uint8Array(143), tables: [mkTable(), mkTable(), mkTable()] });
function clonePatch(pt) { return { name: pt.name, bytes: new Uint8Array(pt.bytes), tables: JSON.parse(JSON.stringify(pt.tables)) }; }

function getVal(pt, p) { const b = pt.bytes[p.idx]; return p.signed ? decodeSigned(b) : (b >> p.shift) & p.mask; }
function setVal(pt, p, v) {
  v = Math.round(Math.max(p.min, Math.min(p.max, v)));
  if (p.signed) { pt.bytes[p.idx] = cfg.signed8 ? (v & 0xFF) : (v & 0x7F); return v; }
  const m = (p.mask << p.shift) & 0xFF;
  pt.bytes[p.idx] = ((pt.bytes[p.idx] & ~m) | ((v & p.mask) << p.shift)) & 0xFF;
  return v;
}

/* ---- tables ---- */
const pitchBases = () => cfg.swapPitch ? { ADD: 0x80, SUB: 0xC0 } : { ADD: 0xC0, SUB: 0x80 };
function stepPitchByte(st) { const { ADD, SUB } = pitchBases(); if (st.m === 'F') return st.n & 0x7F; return (st.m === '+' ? ADD : SUB) + Math.min(63, st.n); }
function decodePitch(b) { const { ADD, SUB } = pitchBases(); if (b < 0x80) return { m: 'F', n: b }; if ((b & 0xC0) === ADD) return { m: '+', n: b - ADD }; return { m: '-', n: b - SUB }; }
function encodeTable(t) {
  const a = [];
  t.steps.forEach(st => a.push(((st.w & 15) << 4) | (st.r ? 4 : 0) | (st.s ? 2 : 0), stepPitchByte(st)));
  if (t.term.type === 'loop' && t.steps.length) a.push(0xFE, Math.min(t.term.lp, t.steps.length - 1) & 0x7F); else a.push(0xFF);
  return a;
}
function parseTables(dec, pos) {
  const ts = [];
  for (let o = 0; o < 3; o++) {
    const t = mkTable();
    while (pos < dec.length && t.steps.length < 32) {
      const b1 = dec[pos];
      if (b1 === 0xFF) { pos++; break; }
      if (b1 === 0xFE) { t.term = { type: 'loop', lp: dec[pos+1] ?? 0 }; pos += 2; break; }
      const pp = decodePitch(dec[pos+1] ?? 0);
      t.steps.push({ w: b1 >> 4, r: (b1 >> 2) & 1, s: (b1 >> 1) & 1, m: pp.m, n: pp.n });
      pos += 2;
    }
    if (t.steps.length > 31) t.steps.length = 31;
    ts.push(t);
  }
  return ts;
}

/* ---- dump encode / decode ---- */
function serializeDecoded(pt) {
  const nm = (pt.name + '          ').slice(0, 10);
  const out = [];
  for (let i = 0; i < 10; i++) out.push(nm.charCodeAt(i) & 0x7F);
  for (let i = 10; i < 143; i++) out.push(pt.bytes[i]);
  pt.tables.forEach(t => out.push(...encodeTable(t)));
  return out;
}
function fromDecoded(dec) {
  const pt = newPatch();
  pt.name = String.fromCharCode(...dec.slice(0, 10).map(c => (c < 32 || c > 126) ? 32 : c)).replace(/\s+$/, '');
  for (let i = 10; i < 143; i++) pt.bytes[i] = dec[i] ?? 0;
  pt.tables = parseTables(dec, 143);
  return pt;
}
function buildDump(pt) {
  const dec = serializeDecoded(pt);
  const size = dec.length + cfg.sizeAdj;
  const m = [...HDR, 0x02, 0x00, (size >> 7) & 0x03, size & 0x7F];
  for (let i = 0; i < 24; i++) m.push(0x2D);
  m.push(0x45, ...dec.slice(0, 10));
  dec.slice(10).forEach(b => m.push((b >> 4) & 0x0F, b & 0x0F));
  m.push(0xF7);
  return m;
}
function parseDump(m) {
  const s = m.indexOf(0x45, 10), end = m.lastIndexOf(0xF7);
  if (s < 0 || end < s) return null;
  const dec = m.slice(s + 1, s + 11);
  for (let i = s + 11; i + 1 < end; i += 2) dec.push(((m[i] & 0x0F) << 4) | (m[i+1] & 0x0F));
  const size = ((m[8] & 0x03) << 7) | (m[9] & 0x7F);
  return { pt: fromDecoded(dec), size, decLen: dec.length, dec };
}
function learnFromDump(r) {
  const d = r.size - r.decLen;
  if (Math.abs(d) <= 20) cfg.sizeAdj = d;
  for (let o = 0; o < 3; o++) for (const k of [3, 4]) if ((r.dec[36 + 21*o + k] ?? 0) & 0x80) cfg.signed8 = true;
}
const skipMsg = () => [...HDR, 0x03, 0xF7];
const clearMsg = () => [...HDR, 0x01, 0x45, ...Array(14).fill(0x2D), 0xF7];
const dpMsg = (addr, mask, shift, data) => [...HDR, 0x04, (addr >> 7) & 0x07, addr & 0x7F, mask & 0x7F, shift & 0x07, data & 0x7F, 0xF7];

function splitSysex(arr) {
  const out = []; let cur = null;
  for (const b of arr) {
    if (b === 0xF0) cur = [b];
    else if (cur) { cur.push(b); if (b === 0xF7) { out.push(cur); cur = null; } }
  }
  return out;
}
const isSid = m => m.length > 6 && m[0] === 0xF0 && m[1] === 0x00 && m[2] === 0x20 && m[3] === 0x3C && m[4] === 0x01;

/* ---- live (Direct Program) messages ---- */
function paramMsgs(pt, p) {
  if (p.cc) return [{ k: 'cc' + p.cc, cc: [p.cc, getVal(pt, p) ? 127 : 0] }];
  const raw = pt.bytes[p.idx];
  if (p.mask === 0xFF) {
    const out = [{ k: `${p.addr}:7f:0`, m: dpMsg(p.addr, 0x7F, 0, raw & 0x7F) }];
    if (p.max > 127 || (p.signed && cfg.signed8)) out.push({ k: `${p.addr}:1:7`, m: dpMsg(p.addr, 1, 7, (raw >> 7) & 1) });
    return out;
  }
  return [{ k: `${p.addr}:${p.mask}:${p.shift}`, m: dpMsg(p.addr, p.mask, p.shift, (raw >> p.shift) & p.mask) }];
}
function nameMsgs(pt) {
  const nm = (pt.name + '          ').slice(0, 10);
  return [...nm].map((c, i) => ({ k: `${i}:7f:0`, m: dpMsg(i, 0x7F, 0, c.charCodeAt(0)) }));
}
function rowMsgs(o, i, b1, b2) {
  const a = TBASE[o] + 2*i, k = `t${o}:${i}`;
  return [
    { k: k + 'a', m: dpMsg(a, 0x0F, 4, b1 >> 4) }, { k: k + 'b', m: dpMsg(a, 0x0F, 0, b1 & 15) },
    { k: k + 'c', m: dpMsg(a + 1, 0x0F, 4, b2 >> 4) }, { k: k + 'd', m: dpMsg(a + 1, 0x0F, 0, b2 & 15) }];
}
function tableMsgs(pt, o) {
  const t = pt.tables[o], out = [];
  t.steps.forEach((st, i) => out.push(...rowMsgs(o, i, ((st.w & 15) << 4) | (st.r ? 4 : 0) | (st.s ? 2 : 0), stepPitchByte(st))));
  const n = t.steps.length;
  if (t.term.type === 'loop' && n) out.push(...rowMsgs(o, n, 0xFE, Math.min(t.term.lp, n - 1)));
  else out.push(...rowMsgs(o, n, 0xFF, 0xFF));
  return out;
}
function fullPatchMsgs(pt) {
  const out = nameMsgs(pt);
  P.forEach(p => out.push(...paramMsgs(pt, p)));
  for (let o = 0; o < 3; o++) out.push(...tableMsgs(pt, o));
  return out;
}

const TABLE_PRESETS = {
  'Kick drum': { sp: 1, steps: [[8, 'F', 60], [4, 'F', 40], [1, 'F', 34], [1, 'F', 30], [1, 'F', 27], [1, 'F', 24], [1, 'F', 21]] },
  'Snare': { sp: 1, steps: [[8, 'F', 76], [4, 'F', 44], [8, 'F', 72], [4, 'F', 40], [8, 'F', 70], [8, 'F', 68]] },
  'Closed hat': { sp: 1, steps: [[8, 'F', 80], [8, 'F', 79], [0, 'F', 0]] },
  'Noise click attack': { sp: 1, steps: [[8, 'F', 70], [9, '+', 0]] },
  'Hubbard lead attack': { sp: 2, steps: [[8, 'F', 80], [9, '+', 12], [9, '+', 0]] },
  'Octave loop': { sp: 3, loop: 0, steps: [[9, '+', 0], [9, '+', 12]] },
  'Major chord arp': { sp: 2, loop: 0, steps: [[9, '+', 0], [9, '+', 4], [9, '+', 7]] },
  'Minor chord arp': { sp: 2, loop: 0, steps: [[9, '+', 0], [9, '+', 3], [9, '+', 7]] },
  'Sync sweep': { sp: 2, steps: [[9, '+', 0], [2, '+', 0, 0, 1], [2, '+', 12, 0, 1], [2, '+', 24, 0, 1]] },
};
function applyTablePreset(o, name, pt) {
  const pr = TABLE_PRESETS[name]; if (!pr) return;
  pt.tables[o] = { steps: pr.steps.map(([w, m, n, r, s]) => ({ w, m, n, r: r || 0, s: s || 0 })), term: pr.loop != null ? { type: 'loop', lp: pr.loop } : { type: 'end', lp: 0 } };
  setVal(pt, PK[`o${o}_tbl`], pr.sp);
}
function initPatch(pt) {
  pt.name = 'Init Saw'; pt.bytes.fill(0); pt.tables = [mkTable(), mkTable(), mkTable()];
  const S = (k, v) => setVal(pt, PK[k], v);
  S('o0_on', 1); S('o0_flt', 1);
  for (let o = 0; o < 3; o++) { S(`o${o}_wave`, 2); S(`o${o}_pb`, 2); S(`o${o}_a`, 0); S(`o${o}_d`, 9); S(`o${o}_s`, 12); S(`o${o}_r`, 6); S(`o${o}_pws`, 48); }
  S('ftype', 1); S('cut', 127); S('fatt', 0); S('fdec', 60); S('fsus', 100); S('frel', 30);
  S('speed', 100); S('hcut', 2);
  for (let l = 0; l < 4; l++) { S(`l${l}_speed`, 40); S(`l${l}_depth`, 100); }
  for (let n = 0; n < 4; n++) S(`dc${n}lu`, 127);
  return pt;
}
const TEMPLATES = {
  'Init saw': pt => {},
  'PWM lead': pt => { const S = (k, v) => setVal(pt, PK[k], v); pt.name = 'PWM Lead';
    S('o0_wave', 4); S('o0_pws', 16); S('o0_pwa', 3); S('o0_spwm', 1); S('o1_on', 1); S('o1_flt', 1); S('o1_wave', 4); S('o1_pws', 40); S('o1_pwa', 2); S('o1_det', 10);
    S('cut', 85); S('res', 6); S('o0_vibd', 6); S('o1_vibd', 6); S('l0_speed', 18); S('l0_depth', 127); S('l0_fade', 40); S('l0_sync', 1);
    for (const o of [0, 1]) { S(`o${o}_a`, 1); S(`o${o}_r`, 7); } },
  'Sync lead': pt => { const S = (k, v) => setVal(pt, PK[k], v); pt.name = 'Sync Lead';
    S('o0_wave', 1); S('o0_a', 0); S('o0_d', 0); S('o0_s', 0); S('o0_flt', 0);
    S('o1_on', 1); S('o1_flt', 1); S('o1_wave', 2); S('o1_sync', 1); S('o1_trn', 12); S('o1_vibl', 1); S('o1_vibd', 40); S('o1_vibw', 30);
    S('l1_type', 1); S('l1_speed', 60); S('l1_depth', 127); S('l1_sync', 1); S('cut', 110); },
  'Ring mod bell': pt => { const S = (k, v) => setVal(pt, PK[k], v); pt.name = 'Ring Bell';
    S('o0_wave', 1); S('o1_on', 1); S('o1_wave', 1); S('o1_ring', 1); S('o1_trn', 19); S('o1_flt', 1);
    for (const o of [0, 1]) { S(`o${o}_a`, 0); S(`o${o}_d`, 10); S(`o${o}_s`, 0); S(`o${o}_r`, 10); } },
  'Acid bass': pt => { const S = (k, v) => setVal(pt, PK[k], v); pt.name = 'Acid Bass';
    S('o0_trn', -12); S('o0_s', 12); S('o0_r', 3); S('o0_port', 20); S('legato', 1);
    S('cut', 18); S('res', 13); S('fenv', 95); S('fatt', 0); S('fdec', 45); S('fsus', 0); S('frel', 20); S('fsync', 1); },
  'Poly pad': pt => { const S = (k, v) => setVal(pt, PK[k], v); pt.name = 'Poly Pad';
    S('poly', 1); S('o0_wave', 4); S('o0_pws', 20); S('o0_pwa', 1); S('o0_a', 9); S('o0_d', 10); S('o0_s', 11); S('o0_r', 10);
    S('cut', 70); S('res', 5); S('l0_speed', 90); S('l0_depth', 60); S('flfo', 0); S('flfod', 30); },
  'Kick drum (table)': pt => { const S = (k, v) => setVal(pt, PK[k], v); pt.name = 'Kick';
    S('o0_wave', 1); S('o0_d', 8); S('o0_s', 0); S('o0_r', 8); S('o0_flt', 0); applyTablePreset(0, 'Kick drum', pt); },
  'Snare (table)': pt => { const S = (k, v) => setVal(pt, PK[k], v); pt.name = 'Snare';
    S('o0_wave', 8); S('o0_d', 8); S('o0_s', 0); S('o0_r', 8); S('o0_flt', 0); applyTablePreset(0, 'Snare', pt); },
  'Hubbard lead (table)': pt => { const S = (k, v) => setVal(pt, PK[k], v); pt.name = 'Hubbard Ld';
    S('o0_wave', 4); S('o0_pws', 30); S('o0_pwa', 4); S('o0_spwm', 1); S('o0_vibd', 8); S('l0_fade', 60); S('l0_speed', 20); applyTablePreset(0, 'Hubbard lead attack', pt); },
  'Chord arp (table)': pt => { const S = (k, v) => setVal(pt, PK[k], v); pt.name = 'Chord Arp';
    S('o0_wave', 4); S('o0_pws', 32); applyTablePreset(0, 'Major chord arp', pt); },
};
/* ── VoltaSeq instrument: Elektron SidStation ─────────────────────────── */
  const CSS = `
  .sd { padding: 14px; min-width: 860px; }
  .sd-unit { background: #40318D; border: 8px solid #6C5EB5; border-radius: 10px; padding: 12px 14px 14px; color: #fff; font-family: 'JetBrains Mono', monospace; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
  .sd-unit * { border-radius: 0 !important; }
  .sd [hidden] { display: none !important; }
  .sd-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; text-transform: uppercase; font-size: 11px; }
  .sd-name { font: 400 20px/1 'VT323', 'JetBrains Mono', monospace; letter-spacing: 1px; }
  .sd-name small { display: block; font-size: 12px; color: #B3AAEE; }
  .sd-unit button { flex: none; background: transparent; border: 2px solid #7869C4; color: #fff; padding: 3px 9px; font: 11px 'JetBrains Mono', monospace; text-transform: uppercase; }
  .sd-unit button:hover { background: #A99EE8; color: #2E2270; border-color: #A99EE8; }
  .sd-unit button.pri { background: #fff; color: #40318D; border-color: #fff; }
  .sd-unit select, .sd-unit input[type=text], .sd-unit input[type=number] { background: #3B2D86; color: #B3AAEE; border: 0; border-bottom: 2px dotted #7869C4; padding: 2px 4px; width: auto; font: 11px 'JetBrains Mono', monospace; text-transform: uppercase; }
  .sd-unit input[type=text] { width: 11ch; color: #fff; font-size: 13px; }
  .sd-link { margin-left: auto; display: flex; align-items: center; gap: 8px; color: #B3AAEE; }
  .sd-link i { width: 10px; height: 10px; border-radius: 50% !important; border: 2px solid #B3AAEE; }
  .sd-link i.on { background: #fff; border-color: #fff; }
  .sd-tabs { display: flex; gap: 0; margin-bottom: -2px; }
  .sd-tabs button { border-bottom: 0; margin-right: -2px; }
  .sd-tabs button[aria-selected="true"] { background: #fff; color: #40318D; border-color: #fff; }
  .sd-page { border: 2px solid #7869C4; padding: 10px; }
  .sd-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0; border: 2px solid #7869C4; }
  .sd-mod { border: 2px solid #7869C4; margin: -1px; padding: 8px 10px; }
  .sd-mod h4 { display: flex; align-items: center; gap: 6px; font: 400 16px/1 'VT323', monospace; text-transform: uppercase; margin-bottom: 6px; }
  .sd-mod h4 span { margin-right: auto; }
  .sd-grp { font-size: 10px; color: #fff; text-transform: uppercase; border-bottom: 2px solid #7869C4; display: inline-block; margin: 6px 0 3px; padding-right: 6px; }
  .sd-row { display: grid; grid-template-columns: minmax(70px, 42%) minmax(0, 1fr) 58px; gap: 6px; align-items: center; min-height: 20px; font-size: 10px; text-transform: uppercase; }
  .sd-row.sel { grid-template-columns: minmax(70px, 42%) minmax(0, 1fr); }
  .sd-row output { text-align: right; color: #B3AAEE; }
  .sd-row input[type=range] { -webkit-appearance: none; appearance: none; height: 14px; background: transparent; width: 100%; }
  .sd-row input[type=range]::-webkit-slider-runnable-track { height: 4px; background: repeating-linear-gradient(90deg, #7869C4 0 4px, transparent 4px 8px); }
  .sd-row input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 9px; height: 12px; background: #fff; margin-top: -4px; border: 0; }
  .sd-row input[type=range]::-moz-range-thumb { width: 9px; height: 12px; background: #fff; border: 0; }
  .sd-togs { display: flex; flex-wrap: wrap; gap: 2px 10px; margin: 3px 0; }
  .sd-tog { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; font-size: 10px; text-transform: uppercase; color: #B3AAEE; user-select: none; }
  .sd-tog i { width: 9px; height: 9px; border-radius: 50% !important; border: 2px solid #B3AAEE; }
  .sd-tog.on { color: #fff; } .sd-tog.on i { background: #fff; border-color: #fff; }
  .sd-steps { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; font-size: 10px; }
  .sd-step { display: grid; grid-template-columns: 20px 58px 20px 20px 34px 40px minmax(28px, 1fr) 20px; gap: 4px; align-items: center; text-transform: uppercase; }
  .sd-step input, .sd-step select { width: 100% !important; min-width: 0; }
  .sd-step span { white-space: nowrap; overflow: hidden; }
  .sd-tcols { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)) !important; }
  .sd-step .mini { padding: 0; height: 18px; font-size: 9px; border-width: 1px; }
  .sd-step .mini.on { background: #fff; color: #40318D; }
  .sd-help { font-size: 10px; color: #B3AAEE; line-height: 1.5; margin-top: 8px; text-transform: none; }
  `;
  function injectCSS() {
    if (document.getElementById('sd-css')) return;
    const st = document.createElement('style'); st.id = 'sd-css'; st.textContent = CSS; document.head.appendChild(st);
    if (!document.getElementById('sd-font')) { const l = document.createElement('link'); l.id = 'sd-font'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=VT323&display=swap'; document.head.appendChild(l); }
  }

  const cur = { trk: null, seq: null }, ui = { reg: {} };
  let unSx = null, page = 'osc';
  const patchOf = trk => (trk._sidPatch && trk._sidPatchSrc === trk.inst.dec) ? trk._sidPatch : (trk._sidPatch = fromDecoded(trk.inst.dec), trk._sidPatchSrc = trk.inst.dec, trk._sidPatch);
  const pt = () => patchOf(cur.trk);
  function commit() { const t = cur.trk; t.inst.dec = serializeDecoded(t._sidPatch); t._sidPatchSrc = t.inst.dec; }   // keep JSON-safe bytes in the project

  /* ---------- sending (throttled, coalesced) ---------- */
  const Q = new Map(), order = []; let busyQ = false;
  const out = () => cur.seq.outputs.get(cur.trk.outputId);
  function enqueue(it, delay) { if (!Q.has(it.k)) order.push(it.k); Q.set(it.k, { ...it, d: delay }); pump(); }
  function pump() {
    if (busyQ) return; const k = order.shift(); if (k === undefined) return;
    const it = Q.get(k); Q.delete(k); const o = out();
    try { if (o) { if (it.cc) o.send([0xB0 | (cur.trk.channel & 15), it.cc[0], it.cc[1]]); else if (cur.seq.sysex) o.send(it.m); } } catch (e) { console.warn(e); }
    busyQ = true; setTimeout(() => { busyQ = false; pump(); }, it.cc ? 2 : it.d);
  }
  const live = items => { if (!out() || !cur.trk.inst.live) return; if (!cur.seq.sysex && items.some(i => !i.cc)) return needSysex(); items.forEach(i => enqueue(i, 6)); };
  let warned = false;
  function needSysex() { if (!warned) { warned = true; cur.seq.toast('Press “Connect SidStation” to allow SysEx, then edits go to the unit'); } }

  async function connect() {
    if (!(await cur.seq.ensureSysex())) return;
    if (!cur.trk.outputId) for (const [id, o] of cur.seq.outputs) if (/sid/i.test(o.name || '')) { cur.trk.outputId = id; cur.seq.fillDeviceSelects(); break; }
    if (!out()) return cur.seq.toast('Choose the SidStation’s MIDI interface as this track’s output');
    warned = false; render(); cur.seq.toast('SidStation ready: edits go to its edit buffer');
  }
  function onSysex(data) {
    const m = Array.from(data); if (!isSid(m) || m[6] !== 0x02 || !cur.trk) return;
    const r = parseDump(m); if (!r) return; learnFromDump(r);
    cur.seq.pushUndo(); cur.trk._sidPatch = r.pt; commit(); render(); cur.seq.renderTracks(); cur.seq.toast(`Received “${r.pt.name}” from the SidStation`);
  }

  /* ---------- controls ---------- */
  function change(p, v, fromInput) {
    const P0 = pt(); v = setVal(P0, p, v); commit();
    (ui.reg[p.key] || []).forEach(f => f(fromInput)); if (p.key === 'speed') (ui.reg.hcut || []).forEach(f => f());
    live(paramMsgs(P0, p)); updateHead();
  }
  function control(key) {
    const p = PK[key], reg = (ui.reg[key] = ui.reg[key] || []);
    if (p.kind === 'bool') {
      const b = document.createElement('span'); b.className = 'sd-tog'; b.tabIndex = 0; b.setAttribute('role', 'switch'); b.innerHTML = '<i></i>'; b.append(p.label);
      const tg = () => { cur.seq.pushUndo(); change(p, getVal(pt(), p) ? 0 : 1); };
      b.onclick = tg; b.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tg(); } };
      reg.push(() => { const on = !!getVal(pt(), p); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
      return b;
    }
    const row = document.createElement('label'); row.className = 'sd-row' + (p.kind === 'select' ? ' sel' : '');
    const lab = document.createElement('span'); lab.textContent = p.label; row.appendChild(lab);
    if (p.kind === 'select') {
      const s = document.createElement('select'); s.setAttribute('aria-label', p.label);
      p.options.forEach(([v, l]) => s.add(new Option(l, v)));
      s.onchange = () => { cur.seq.pushUndo(); change(p, +s.value); };
      reg.push(() => { s.value = String(getVal(pt(), p)); }); row.appendChild(s); return row;
    }
    const r = document.createElement('input'); r.type = 'range'; r.min = p.min; r.max = p.max; r.setAttribute('aria-label', p.label);
    const o = document.createElement('output');
    let pushed = false; r.onpointerdown = () => { pushed = false; };
    r.oninput = () => { if (!pushed) { cur.seq.pushUndo(); pushed = true; } change(p, +r.value, true); };
    r.ondblclick = () => { cur.seq.pushUndo(); change(p, p.min < 0 ? 0 : p.min); };
    reg.push(skip => { const v = getVal(pt(), p); if (!skip) r.value = v; o.textContent = key === 'hcut' ? (v ? Math.round(v / getVal(pt(), PK.speed) * 1000) + 'ms' : 'off') : (p.fmt ? p.fmt(v) : v); });
    row.append(r, o); return row;
  }
  function group(title, keys) {
    const g = document.createElement('div');
    if (title) { const h = document.createElement('div'); h.className = 'sd-grp'; h.textContent = title; g.appendChild(h); }
    const togs = document.createElement('div'); togs.className = 'sd-togs';
    keys.forEach(k => { const c = control(k); if (PK[k].kind === 'bool') togs.appendChild(c); else g.appendChild(c); });
    if (togs.childElementCount) g.appendChild(togs);
    return g;
  }
  function mod(title, sec, children, headExtra) {
    const m = document.createElement('section'); m.className = 'sd-mod';
    const h = document.createElement('h4'); const t = document.createElement('span'); t.textContent = title; h.appendChild(t);
    (headExtra || []).forEach(x => h.appendChild(x));
    if (sec) ['Mutate', 'Random'].forEach(lbl => { const b = document.createElement('button'); b.textContent = lbl; b.onclick = () => randomize(sec, lbl === 'Mutate' ? 'mutate' : 'random'); h.appendChild(b); });
    m.appendChild(h); children.forEach(c => m.appendChild(c)); return m;
  }
  function randomize(sec, mode) {
    cur.seq.pushUndo(); const P0 = pt(), keys = P.filter(p => p.sec === sec && !p.noRand), rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    keys.forEach(p => {
      const v = getVal(P0, p);
      if (mode === 'mutate') { if (p.kind === 'range') setVal(P0, p, v + Math.round((Math.random() - 0.5) * 2 * (p.max - p.min) * 0.12)); else if (Math.random() < 0.12) setVal(P0, p, p.kind === 'bool' ? 1 - v : p.options[rnd(0, p.options.length - 1)][0]); }
      else if (p.kind === 'range') setVal(P0, p, rnd(p.min, p.max));
      else if (p.kind === 'bool') setVal(P0, p, Math.random() < 0.35 ? 1 : 0);
      else { const opts = p.options.filter(o => !(p.key.endsWith('_wave') && o[0] === 0)); setVal(P0, p, opts[rnd(0, opts.length - 1)][0]); }
    });
    if (mode !== 'mutate' && sec.startsWith('osc')) { const o = sec[3]; setVal(P0, PK[`o${o}_s`], rnd(6, 15)); setVal(P0, PK[`o${o}_trn`], [0, 0, 12, -12, 7][rnd(0, 4)]); setVal(P0, PK[`o${o}_det`], rnd(-12, 12)); setVal(P0, PK[`o${o}_vibd`], rnd(0, 20)); }
    if (sec === 'filter' && mode !== 'mutate') setVal(P0, PK.cut, rnd(30, 120));
    commit(); render(); live(P.filter(p => p.sec === sec).flatMap(p => paramMsgs(P0, p)));
  }

  /* ---------- pages ---------- */
  function buildPages() {
    const host = ui.pages; host.innerHTML = ''; ui.reg = {};
    const pg = (id, el) => { el.dataset.page = id; el.hidden = id !== page; host.appendChild(el); };
    const cols = () => { const c = document.createElement('div'); c.className = 'sd-cols'; return c; };
    const oscC = cols();
    for (let o = 0; o < 3; o++) { const k = x => `o${o}_${x}`; oscC.appendChild(mod(`Osc ${o + 1}`, 'osc' + o, [group('', [k('wave'), k('on'), k('sync'), k('ring'), k('flt')]), group('Pitch', [k('track'), k('trn'), k('det'), k('port'), k('pb'), k('arp')]), group('Envelope', [k('a'), k('d'), k('s'), k('r'), k('dly'), k('gate')]), group('Pulse width', [k('pws'), k('pwa'), k('pwl'), k('pwd'), k('spwm')]), group('Vibrato', [k('vibl'), k('vibd'), k('vibw'), k('tbl')])])); }
    pg('osc', oscC);
    const fC = cols();
    fC.appendChild(mod('Filter', 'filter', [group('', ['ftype', 'cut', 'res', 'fwrap', 'o0_flt', 'o1_flt', 'o2_flt'])]));
    fC.appendChild(mod('Filter envelope', null, [group('', ['fenv', 'fatt', 'fdec', 'fsus', 'frel', 'finv', 'fsync'])]));
    fC.appendChild(mod('Filter modulation', null, [group('', ['flfo', 'flfod', 'flfow'])]));
    pg('filter', fC);
    const lC = cols();
    for (let l = 0; l < 4; l++) { const k = x => `l${l}_${x}`; lC.appendChild(mod(`LFO ${l + 1}`, 'lfo' + l, [group('', [k('type'), k('speed'), k('depth'), k('fade'), k('sh'), k('sync'), k('snoff'), k('inv'), k('abz')]), group('Mix and lace', [k('add'), k('addd'), k('lace'), k('lacew')]), group('Control', [k('src'), k('dest'), k('ctrlv')])])); }
    pg('lfo', lC);
    const tC = cols(); tC.classList.add('sd-tcols'); ui.tableHosts = [];
    for (let o = 0; o < 3; o++) {
      const preset = document.createElement('select'); preset.add(new Option('Preset…', '')); Object.keys(TABLE_PRESETS).forEach(n => preset.add(new Option(n, n)));
      preset.onchange = () => { if (!preset.value) return; cur.seq.pushUndo(); applyTablePreset(o, preset.value, pt()); commit(); render(); live([...paramMsgs(pt(), PK[`o${o}_tbl`]), ...tableMsgs(pt(), o)]); preset.value = ''; };
      const steps = document.createElement('div'); steps.className = 'sd-steps'; ui.tableHosts.push(steps);
      tC.appendChild(mod(`Osc ${o + 1} table`, null, [group('', [`o${o}_tbl`]), steps], [preset]));
    }
    const help = document.createElement('p'); help.className = 'sd-help'; help.style.gridColumn = '1/-1'; help.style.padding = '0 10px 8px';
    help.textContent = 'A table plays a list of waveforms and pitches at the start of each note, or loops it: C64 drums, Hubbard-style attacks, chord arps. Set Table speed above Off (1 is fastest).';
    tC.appendChild(help); pg('tables', tC);
    const pC = cols();
    pC.appendChild(mod('Voice', null, [group('', ['poly', 'speed', 'hcut', 'legato', 'reinit'])]));
    for (let n = 0; n < 4; n++) pC.appendChild(mod(`Front knob ${n + 1}`, null, [group('', [`dc${n}`, `dc${n}ld`, `dc${n}lu`])]));
    pg('patch', pC);
  }
  function renderTables() {
    const P0 = pt();
    ui.tableHosts.forEach((host, o) => {
      host.innerHTML = ''; const t = P0.tables[o];
      const changed = rebuild => { commit(); if (rebuild) renderTables(); live(tableMsgs(P0, o)); };
      t.steps.forEach((st, i) => {
        const row = document.createElement('div'); row.className = 'sd-step';
        const w = document.createElement('select'); TWAVES.forEach(([v, l]) => w.add(new Option(l, v))); w.value = st.w; w.onchange = () => { cur.seq.pushUndo(); st.w = +w.value; changed(); };
        const mk = (lab, key) => { const b = document.createElement('button'); b.className = 'mini' + (st[key] ? ' on' : ''); b.textContent = lab; b.title = key === 'r' ? 'Ring mod' : 'Sync'; b.onclick = () => { cur.seq.pushUndo(); st[key] = st[key] ? 0 : 1; b.classList.toggle('on', !!st[key]); changed(); }; return b; };
        const m = document.createElement('select'); [['F', 'F'], ['+', '+'], ['-', '−']].forEach(([v, l]) => m.add(new Option(l, v))); m.value = st.m; m.title = 'F = fixed note, +/− = semitones from the played key';
        const n = document.createElement('input'); n.type = 'number'; n.min = 0; n.max = st.m === 'F' ? 81 : 47; n.value = st.n;
        const nn = document.createElement('span'); const upd = () => { nn.textContent = st.m === 'F' ? noteName(st.n) : (st.m === '+' ? '+' : '−') + st.n; n.max = st.m === 'F' ? 81 : 47; }; upd();
        m.onchange = () => { cur.seq.pushUndo(); st.m = m.value; st.n = Math.min(st.n, st.m === 'F' ? 81 : 47); n.value = st.n; upd(); changed(); };
        n.onchange = () => { cur.seq.pushUndo(); st.n = Math.max(0, Math.min(+n.max, +n.value || 0)); upd(); changed(); };
        const del = document.createElement('button'); del.className = 'mini'; del.textContent = '×'; del.title = 'Delete step';
        del.onclick = () => { cur.seq.pushUndo(); t.steps.splice(i, 1); if (!t.steps.length) t.term.type = 'end'; t.term.lp = Math.min(t.term.lp, Math.max(0, t.steps.length - 1)); changed(true); };
        const ix = document.createElement('span'); ix.textContent = String(i).padStart(2, '0');
        row.append(ix, w, mk('R', 'r'), mk('S', 's'), m, n, nn, del); host.appendChild(row);
      });
      const end = document.createElement('div'); end.className = 'sd-step';
      const term = document.createElement('select'); term.add(new Option('End', 'end')); term.add(new Option('Loop to', 'loop')); term.value = t.term.type;
      const lp = document.createElement('select'); t.steps.forEach((_, i) => lp.add(new Option(String(i).padStart(2, '0'), i))); lp.value = t.term.lp; lp.style.visibility = t.term.type === 'loop' ? '' : 'hidden';
      term.onchange = () => { if (term.value === 'loop' && !t.steps.length) { term.value = 'end'; return; } cur.seq.pushUndo(); t.term.type = term.value; lp.style.visibility = term.value === 'loop' ? '' : 'hidden'; changed(); };
      lp.onchange = () => { cur.seq.pushUndo(); t.term.lp = +lp.value; changed(); };
      const add = document.createElement('button'); add.className = 'mini'; add.textContent = '+'; add.title = 'Add step'; add.disabled = t.steps.length >= 31;
      add.onclick = () => { cur.seq.pushUndo(); const last = t.steps[t.steps.length - 1]; t.steps.push(last ? { ...last } : { w: 9, r: 0, s: 0, m: '+', n: 0 }); changed(true); };
      const ix = document.createElement('span'); ix.textContent = String(t.steps.length).padStart(2, '0');
      end.append(ix, term, lp, document.createElement('span'), document.createElement('span'), document.createElement('span'), document.createElement('span'), add);
      host.appendChild(end);
    });
  }

  /* ---------- mount ---------- */
  function mount(host, trk, seq) {
    injectCSS(); cur.trk = trk; cur.seq = seq;
    if (!unSx) unSx = seq.onSysex(onSysex);
    host.innerHTML = `<div class="sd"><div class="sd-unit">
      <div class="sd-top">
        <div class="sd-name">SidStation<small>Sound · VoltaSeq</small></div>
        <label>Name <input type="text" id="sdName" maxlength="10" spellcheck="false"></label>
        <select id="sdTpl"><option value="">Start from…</option></select>
        <span class="sd-tog" id="sdLive" role="switch" tabindex="0"><i></i>Live</span>
        <button class="pri" id="sdSend" title="Send the whole sound into the SidStation's edit buffer (not stored)">Send to edit buffer</button>
        <button id="sdStore" title="Patch dump: the SidStation stores it in the selected slot or the next free one">Store on SidStation</button>
        <button id="sdOpen">Open .syx</button><button id="sdSave">Save .syx</button>
        <div class="sd-link"><i id="sdDot"></i><span id="sdInfo"></span><button id="sdConn">Connect SidStation</button></div>
      </div>
      <div class="sd-tabs" role="tablist"><button data-p="osc">Oscillators</button><button data-p="filter">Filter</button><button data-p="lfo">LFOs</button><button data-p="tables">Tables</button><button data-p="patch">Patch &amp; knobs</button></div>
      <div class="sd-page" id="sdPages"></div>
      <p class="sd-help">Edits go into the patch selected on the SidStation (Live), like turning its knobs; nothing is kept until you store it. Dump a patch from the unit (System › MIDI › SYSEXDump › Patch) and it opens here. For the full librarian, use the standalone SidStation editor.</p>
      <input type="file" id="sdFile" accept=".syx" hidden>
    </div></div>`;
    const $ = id => host.querySelector('#' + id);
    Object.assign(ui, { host, pages: $('sdPages') });
    Object.keys(TEMPLATES).forEach(n => $('sdTpl').add(new Option(n, n)));
    $('sdTpl').onchange = e => { const n = e.target.value; e.target.value = ''; if (!n) return; seq.pushUndo(); const P0 = initPatch(newPatch()); TEMPLATES[n](P0); trk._sidPatch = P0; commit(); render(); seq.renderTracks(); live(fullPatchMsgs(P0)); };
    $('sdName').oninput = e => { pt().name = e.target.value.replace(/[^\x20-\x7E]/g, ''); commit(); live(nameMsgs(pt())); seq.renderTracks(); };
    $('sdName').onfocus = () => seq.pushUndo();
    const lv = $('sdLive'); lv.onclick = () => { trk.inst.live = !trk.inst.live; updateHead(); }; lv.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); lv.click(); } };
    $('sdSend').onclick = () => { if (!out()) return seq.toast('Choose the SidStation’s MIDI interface as this track’s output'); if (!seq.sysex) return needSysex(); fullPatchMsgs(pt()).forEach(i => enqueue(i, 6)); seq.toast('Sending the sound to the edit buffer'); };
    $('sdStore').onclick = () => { if (!out()) return seq.toast('Choose the SidStation’s MIDI interface as this track’s output'); if (!seq.sysex) return needSysex(); enqueue({ k: 'dump' + Date.now(), m: buildDump(pt()) }, 150); seq.toast(`Stored “${pt().name}” on the SidStation`); };
    $('sdSave').onclick = () => seq.download((pt().name || 'patch').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') + '.syx', buildDump(pt()));
    $('sdOpen').onclick = () => $('sdFile').click();
    $('sdFile').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const d = splitSysex(new Uint8Array(await f.arrayBuffer())).filter(isSid).find(m => m[6] === 0x02);
      if (!d) return seq.toast('No SidStation patch in that file');
      seq.pushUndo(); trk._sidPatch = parseDump(d).pt; commit(); render(); seq.renderTracks(); live(fullPatchMsgs(pt())); seq.toast(`Opened “${pt().name}”`);
    };
    $('sdConn').onclick = connect;
    host.querySelectorAll('.sd-tabs button').forEach(b => b.onclick = () => { page = b.dataset.p; render(); });
    buildPages(); render();
  }
  function updateHead() {
    const h = ui.host; if (!h) return;
    h.querySelector('#sdName').value = pt().name;
    const lv = h.querySelector('#sdLive'); lv.classList.toggle('on', !!cur.trk.inst.live); lv.setAttribute('aria-checked', !!cur.trk.inst.live);
    const ok = !!out() && cur.seq.sysex;
    h.querySelector('#sdDot').classList.toggle('on', ok);
    h.querySelector('#sdInfo').textContent = ok ? 'SysEx on · ch ' + (cur.trk.channel + 1) : (out() ? 'SysEx not allowed yet' : 'No MIDI output');
  }
  function render() {
    if (!ui.host) return;
    ui.host.querySelectorAll('.sd-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.p === page));
    ui.pages.querySelectorAll('[data-page]').forEach(el => el.hidden = el.dataset.page !== page);
    Object.values(ui.reg).forEach(fs => fs.forEach(f => f()));
    renderTables(); updateHead();
  }

  window.VoltaInstruments = window.VoltaInstruments || {};
  VoltaInstruments.sidstation = {
    id: 'sidstation', name: 'Elektron SidStation', short: 'SID', editor: 'both', hideChannel: false, portMatch: /sid/i,
    create(trk) { trk.name = 'SidStation'; trk.view = 'sound'; const P0 = initPatch(newPatch()); trk.inst = { dec: serializeDecoded(P0), live: true }; },
    trackInfo: trk => `${trk.notes.length} notes · ch${trk.channel + 1} · ${patchOf(trk).name || 'untitled'}`,
    mount, unmount() { ui.host = null; },
    refresh(trk, seq) { cur.trk = trk; cur.seq = seq; render(); },
    onPortChange() { if (ui.host) updateHead(); }
  };
})();
