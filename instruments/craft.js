/* VoltaSeq instrument: Modal CRAFTsynth 2.0 — sound editor over MIDI CC. MIT, see LICENSE.
   Parameter map from the CRAFTsynth 2.0 user manual (OS 1.4), MIDI CC implementation chart. */
(() => {
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // Mod destinations 0–36, in the order of the manual's modulation table (check on the device)
  const DESTS = ['Wave 1', 'Wave 2', 'Mix', 'Global pitch', 'Osc2 pitch', 'Osc-mod', 'LFO1 rate', 'LFO2 rate', 'LFO1 shape', 'LFO2 shape', 'Cutoff', 'Reso', 'Morph', 'FEG amount', 'FEG attack', 'FEG decay', 'FEG sustain', 'FEG release', 'AEG amount', 'AEG attack', 'AEG decay', 'AEG sustain', 'AEG release', 'MEG amount', 'MEG attack', 'MEG decay', 'MEG sustain', 'MEG release', 'Distortion', 'Delay', 'Delay time', 'Feedback', 'Spread', 'Glide', 'LFO1 depth', 'LFO2 depth', 'MOD-EG depth'];
  const MODS = ['Phase mod', 'Window sync', 'Ring mod', 'Tri fold', 'De-rez', 'Rise/run', 'Glitchy sine', 'Window amp', 'FM', 'Hard sync', 'Min mod', 'Sine fold', 'Bit-crush', 'Scrunch', 'Lo-fi shaper', 'Vocal sync'];
  const BANKS = ['Virtual analogue', '002 bank 1', 'Math', 'Polygon', 'Modal 1', 'Formant', '002 bank 2', 'Modal 2', 'Sine / noise'];
  const enumVals = n => Array.from({ length: n }, (_, i) => Math.round((i + 0.5) * 128 / n));
  const E = (labels, n = labels.length) => ({ labels, vals: enumVals(n) });
  const P = (cc, label, o = {}) => Object.assign({ cc, label, def: 0 }, o);
  // def = INIT patch value used by Init and by Random's anchors
  const SECTIONS = [
    { t: 'Oscillators', p: [P(16, 'Wave 1', { def: 64 }), P(37, 'Bank 1', { e: E(BANKS.slice(0, 8)), def: 8 }), P(17, 'Wave 2', { def: 64 }), P(48, 'Bank 2', { e: E(BANKS), def: 7 }), P(18, 'Mix', { def: 0 }), P(41, 'Osc-mod', { e: E(MODS), def: 4 }), P(19, 'Mod amount', { def: 0 }), P(20, 'Spread', { def: 0 }), P(30, 'Osc2 coarse', { bi: 1, def: 64 }), P(31, 'Osc2 fine', { bi: 1, def: 64 }), P(40, 'Octave', { e: E(['-2', '-1', '0', '+1', '+2', '+3', '+4']), def: 46 }), P(5, 'Glide', { def: 0 })] },
    { t: 'Filter', p: [P(34, 'Cutoff', { def: 100 }), P(35, 'Reso', { def: 20 }), P(33, 'Morph', { def: 0, hint: 'LP · BP · HP' }), P(32, 'Env amount', { bi: 1, def: 80 })] },
    { t: 'Filter envelope', p: [P(22, 'Attack', { def: 0 }), P(23, 'Decay', { def: 50 }), P(24, 'Sustain', { def: 40 }), P(25, 'Release', { def: 30 })] },
    { t: 'Amp envelope', p: [P(26, 'Attack', { def: 0 }), P(27, 'Decay', { def: 60 }), P(28, 'Sustain', { def: 100 }), P(29, 'Release', { def: 30 }), P(51, 'Env amount', { bi: 1, def: 127 })] },
    { t: 'Mod envelope', p: [P(43, 'Attack', { def: 0 }), P(44, 'Decay', { def: 50 }), P(45, 'Sustain', { def: 0 }), P(46, 'Release', { def: 30 })] },
    { t: 'LFO 1', p: [P(36, 'Rate', { def: 50 }), P(39, 'Shape', { def: 0, hint: 'Sine · tri · saw · sq · S&H' }), P(56, 'Mode', { e: E(['Retrig', 'Free', 'Single']), def: 21 }), P(52, 'MIDI sync', { sw: 1 })] },
    { t: 'LFO 2', p: [P(47, 'Rate', { def: 40 }), P(50, 'Shape', { def: 0 }), P(57, 'Mode', { e: E(['Retrig', 'Free', 'Single']), def: 21 }), P(54, 'MIDI sync', { sw: 1 })] },
    { t: 'Effects', p: [P(12, 'Distortion', { def: 0 }), P(13, 'Delay', { def: 0 }), P(14, 'Time', { def: 60 }), P(15, 'Feedback', { def: 40 }), P(55, 'Delay sync', { sw: 1 })] },
    { t: 'Modulation matrix', mod: true, p: ['LFO 1', 'LFO 2', 'Mod env', 'Note', 'Velocity', 'Mod wheel', 'Expression', 'Aftertouch'].flatMap((s, i) => [P(88 + i, s, { bi: 1, def: 64, depth: true }), P(101 + i, s + ' dest', { dest: true, def: 10 })]) },
    { t: 'Play', p: [P(58, 'Arp-seq', { sw: 1 }), P(73, 'Scale', { e: E(['1', '2', '3', '4', '5', '6', '7', '8'], 8), vals: [0, 1, 2, 3, 4, 5, 6, 7], def: 0 }), P(79, 'Root', { note: 1, def: 60 }), P(7, 'Volume', { def: 100 })] }
  ];
  const ALL = SECTIONS.flatMap(s => s.p), BY = Object.fromEntries(ALL.map(p => [p.cc, p]));
  BY[73].e.vals = [0, 1, 2, 3, 4, 5, 6, 7];
  const LIB_KEY = 'voltaseq-craft-library';
  const lib = () => { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch (e) { return []; } };
  const saveLib = l => { try { localStorage.setItem(LIB_KEY, JSON.stringify(l)); } catch (e) {} };

  const CSS = `
  .cs { padding: 14px; min-width: 860px; }
  .cs-unit { background: linear-gradient(180deg, #1b1c1f, #121315); border: 1px solid #2c2e33; border-radius: 12px; padding: 14px 16px 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); color: #f1f3f5; }
  .cs-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .cs-name { font: 800 22px/1 Inter, sans-serif; letter-spacing: -0.5px; }
  .cs-name small { display: block; font: 600 9px/1.4 Inter, sans-serif; letter-spacing: 1.4px; text-transform: uppercase; color: #2fa8ff; }
  .cs-top select, .cs-top input { width: auto; background: #0c0d0f; border-color: #33363c; }
  .cs-top button { flex: none; background: #24262b; border-color: #3a3d44; padding: 6px 10px; font-size: 11px; }
  .cs-top button:hover { border-color: #2fa8ff; background: #2c2f35; }
  .cs-top .pri { background: #2fa8ff; border-color: #2fa8ff; color: #04111d; font-weight: 700; }
  .cs-sep { width: 1px; align-self: stretch; background: #2c2e33; }
  .cs-in { font-size: 10px; color: #8b929b; display: flex; align-items: center; gap: 6px; margin-left: auto; }
  .cs-in i { width: 7px; height: 7px; border-radius: 50%; background: #233; }
  .cs-in i.on { background: #2fa8ff; box-shadow: 0 0 6px #2fa8ff; }
  .cs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
  .cs-sec { background: #0e0f11; border: 1px solid #24262b; border-radius: 8px; padding: 10px 10px 12px; }
  .cs-sec.wide { grid-column: span 2; }
  .cs-sec h4 { font: 700 9px/1 Inter, sans-serif; letter-spacing: 1.4px; text-transform: uppercase; color: #8b929b; margin-bottom: 10px; }
  .cs-knobs { display: flex; flex-wrap: wrap; gap: 10px 6px; }
  .cs-k { width: 58px; display: flex; flex-direction: column; align-items: center; gap: 3px; user-select: none; touch-action: none; }
  .cs-k svg { width: 40px; height: 40px; cursor: ns-resize; }
  .cs-k b { font: 600 9px/1.15 Inter, sans-serif; color: #f1f3f5; text-align: center; min-height: 2.3em; display: flex; align-items: flex-end; }
  .cs-k span { font: 10px 'JetBrains Mono', monospace; color: #2fa8ff; min-height: 12px; text-align: center; white-space: nowrap; max-width: 64px; overflow: hidden; text-overflow: ellipsis; }
  .cs-k.unset span { color: #5b616a; }
  .cs-k.flash svg { filter: drop-shadow(0 0 6px #2fa8ff); }
  .cs-sw { flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; width: 58px; padding: 0; background: none; border: 0; color: #f1f3f5; font: 600 9px Inter, sans-serif; }
  .cs-sw:hover { background: none; border: 0; }
  .cs-sw i { width: 30px; height: 16px; border-radius: 3px; background: #24262b; border: 1px solid #3a3d44; margin-top: 12px; }
  .cs-sw.on i { background: #2fa8ff; border-color: #2fa8ff; box-shadow: 0 0 8px rgba(47,168,255,0.6); }
  .cs-mod { display: grid; grid-template-columns: 90px 1fr 54px; gap: 6px 10px; align-items: center; font-size: 11px; }
  .cs-mod select { background: #0c0d0f; border-color: #33363c; padding: 3px 6px; font-size: 11px; }
  .cs-mod input[type=range] { accent-color: #2fa8ff; }
  .cs-mod output { font: 10px 'JetBrains Mono', monospace; color: #2fa8ff; text-align: right; }
  .cs-note { font-size: 10px; color: #8b929b; margin-top: 10px; line-height: 1.5; }
  `;
  const injectCSS = () => { if (document.getElementById('cs-css')) return; const s = document.createElement('style'); s.id = 'cs-css'; s.textContent = CSS; document.head.appendChild(s); };

  const cur = { trk: null, seq: null }, ui = {};
  let unMidi = null, lastIn = 0;
  const outPort = () => cur.seq.outputs.get(cur.trk.outputId);
  function sendCC(cc, v) { const o = outPort(); if (o) o.send([0xB0 | (cur.trk.channel & 15), cc, v & 127]); }
  const get = cc => cur.trk.inst.params[cc];
  function fmt(p, v) {
    if (v == null) return '—';
    if (p.sw) return v >= 64 ? 'On' : 'Off';
    if (p.note) return NOTE[v % 12] + (Math.floor(v / 12) - 1);
    if (p.dest) return DESTS[Math.min(36, v)] || v;
    if (p.e) { const i = p.e.vals.reduce((b, x, k) => Math.abs(x - v) < Math.abs(p.e.vals[b] - v) ? k : b, 0); return p.e.labels[i]; }
    if (p.bi) return (v - 64 > 0 ? '+' : '') + (v - 64);
    return String(v);
  }
  function setParam(cc, v, send = true) {
    v = Math.max(0, Math.min(127, Math.round(v)));
    cur.trk.inst.params[cc] = v; if (send) sendCC(cc, v); showParam(cc);
  }

  /* knob as an SVG arc (bipolar arcs start in the middle) */
  function arc(v, bi) {
    const a0 = -225, a1 = 45, ang = x => a0 + (a1 - a0) * x / 127, r = 15, c = 20;
    const pt = a => [c + r * Math.cos(a * Math.PI / 180), c + r * Math.sin(a * Math.PI / 180)];
    const path = (from, to) => { const [x1, y1] = pt(from), [x2, y2] = pt(to), large = Math.abs(to - from) > 180 ? 1 : 0, sw = to > from ? 1 : 0; return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} ${sw} ${x2.toFixed(2)} ${y2.toFixed(2)}`; };
    const start = bi ? ang(64) : a0, end = ang(v == null ? (bi ? 64 : 0) : v), [px, py] = pt(end);
    return `<circle cx="20" cy="20" r="11" fill="#2a2c31" stroke="#3a3d44"/><path d="${path(a0, a1)}" fill="none" stroke="#2a2c31" stroke-width="3" stroke-linecap="round"/>` +
      (v == null ? '' : `<path d="${path(Math.min(start, end), Math.max(start, end) + 0.01)}" fill="none" stroke="#2fa8ff" stroke-width="3" stroke-linecap="round"/>`) +
      `<line x1="20" y1="20" x2="${(20 + (px - 20) * 0.6).toFixed(2)}" y2="${(20 + (py - 20) * 0.6).toFixed(2)}" stroke="#f1f3f5" stroke-width="2" stroke-linecap="round"/>`;
  }
  function knob(p) {
    if (p.sw) {
      const b = document.createElement('button'); b.className = 'cs-sw'; b.innerHTML = `<i></i>${p.label}`; b.title = 'CC ' + p.cc;
      b.onclick = () => { cur.seq.pushUndo(); setParam(p.cc, (get(p.cc) || 0) >= 64 ? 0 : 127); };
      ui.els[p.cc] = { sw: b }; return b;
    }
    const k = document.createElement('div'); k.className = 'cs-k'; k.title = `${p.hint ? p.hint + ' · ' : ''}CC ${p.cc} · drag up/down, double-click for init value`;
    k.innerHTML = `<svg viewBox="0 0 40 40" role="slider" tabindex="0" aria-label="${p.label}" aria-valuemin="0" aria-valuemax="127"></svg><b>${p.label}</b><span></span>`;
    const svg = k.querySelector('svg');
    const step = v => (p.e ? (() => { const vs = p.e.vals; let i = vs.reduce((b, x, j) => Math.abs(x - v) < Math.abs(vs[b] - v) ? j : b, 0); return vs[i]; })() : v);
    let y0 = 0, v0 = 0, moved = false;
    svg.addEventListener('pointerdown', e => { svg.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = get(p.cc) ?? p.def; moved = false; });
    svg.addEventListener('pointermove', e => { if (!svg.hasPointerCapture(e.pointerId)) return; if (!moved) { cur.seq.pushUndo(); moved = true; } const v = step(Math.max(0, Math.min(127, v0 + (y0 - e.clientY) * (e.shiftKey ? 0.2 : 0.8)))); if (v !== get(p.cc)) setParam(p.cc, v); });
    svg.addEventListener('dblclick', () => { cur.seq.pushUndo(); setParam(p.cc, p.def); });
    svg.addEventListener('wheel', e => { e.preventDefault(); const vs = p.e ? p.e.vals : null, now = get(p.cc) ?? p.def; let v; if (vs) { const i = vs.indexOf(step(now)); v = vs[Math.max(0, Math.min(vs.length - 1, i + (e.deltaY < 0 ? 1 : -1)))]; } else v = now + (e.deltaY < 0 ? 1 : -1); cur.seq.pushUndo(); setParam(p.cc, v); }, { passive: false });
    svg.addEventListener('keydown', e => { const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); setParam(p.cc, (get(p.cc) ?? p.def) + d * (e.shiftKey ? 10 : 1)); } });
    ui.els[p.cc] = { k, svg, out: k.querySelector('span') }; return k;
  }
  function showParam(cc) {
    const p = BY[cc], e = ui.els && ui.els[cc]; if (!p || !e) return;
    const v = get(cc);
    if (e.sw) { e.sw.classList.toggle('on', v != null && v >= 64); return; }
    if (e.sel) { e.sel.value = v == null ? '' : String(Math.min(36, v)); return; }
    if (e.range) { e.range.value = v ?? 64; e.out.textContent = fmt(p, v); return; }
    e.svg.innerHTML = arc(v, p.bi); e.svg.setAttribute('aria-valuenow', v ?? ''); e.svg.setAttribute('aria-valuetext', fmt(p, v));
    e.out.textContent = fmt(p, v); e.k.classList.toggle('unset', v == null);
  }
  function modMatrix() {
    const g = document.createElement('div'); g.className = 'cs-mod';
    for (let i = 0; i < 8; i++) {
      const dp = BY[88 + i], de = BY[101 + i];
      const name = document.createElement('b'); name.textContent = dp.label; name.style.fontWeight = 600;
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:center';
      const sel = document.createElement('select'); sel.title = 'Destination (CC ' + de.cc + ')'; sel.add(new Option('—', ''));
      DESTS.forEach((d, j) => sel.add(new Option(d, j)));
      sel.onchange = () => { if (sel.value === '') return; cur.seq.pushUndo(); setParam(de.cc, +sel.value); };
      const r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = 127; r.title = 'Depth (CC ' + dp.cc + '), centre = 0';
      const o = document.createElement('output');
      let pushed = false; r.onpointerdown = () => { pushed = false; };
      r.oninput = () => { if (!pushed) { cur.seq.pushUndo(); pushed = true; } setParam(dp.cc, +r.value); };
      r.ondblclick = () => setParam(dp.cc, 64);
      row.append(sel, r); g.append(name, row, o);
      ui.els[de.cc] = { sel }; ui.els[dp.cc] = { range: r, out: o };
    }
    return g;
  }

  function mount(host, trk, seq) {
    injectCSS(); cur.trk = trk; cur.seq = seq; ui.els = {};
    if (!unMidi) unMidi = seq.onMidi(onIncoming);
    host.innerHTML = `<div class="cs"><div class="cs-unit">
      <div class="cs-top">
        <div class="cs-name">CRAFTsynth 2.0<small>Sound · VoltaSeq</small></div>
        <span class="cs-sep"></span>
        <label style="font-size:10px;color:#8b929b">Preset <select id="csPc"></select></label><button id="csPcGo" title="Program change: the CRAFTsynth loads this preset from its memory">Load preset</button>
        <span class="cs-sep"></span>
        <select id="csLib" title="Sounds saved in VoltaSeq"></select><button id="csLibLoad">Use</button><button id="csLibSave">Save as…</button><button id="csLibDel">Delete</button><button id="csLibExp" title="Export your saved sounds">Export</button><button id="csLibImp">Import</button>
        <span class="cs-sep"></span>
        <button class="pri" id="csSend" title="Send every parameter of this sound to the CRAFTsynth">Send sound</button><button id="csInit">Init</button><button id="csRand">Random</button><button id="csMut">Mutate</button>
        <span class="cs-in" title="Turning a knob on the CRAFTsynth updates this panel"><i id="csInDot"></i>Knobs on the synth</span>
      </div>
      <div class="cs-grid" id="csGrid"></div>
      <p class="cs-note">Every change goes to the CRAFTsynth on this track's MIDI channel, and knobs you turn on the synth show up here. A dash means VoltaSeq doesn't know that value yet (for example after loading a preset on the synth): touch it or press Send sound. The CRAFTsynth can't send its whole patch over MIDI, so sounds are kept here in VoltaSeq.</p>
      <input type="file" id="csFile" accept=".json" hidden>
    </div></div>`;
    const $ = id => host.querySelector('#' + id);
    for (let b = 0; b < 8; b++) for (let s = 0; s < 8; s++) $('csPc').add(new Option(`Bank ${b + 1} · ${s + 1}`, b * 8 + s));
    $('csPc').value = trk.inst.program || 0;
    $('csPcGo').onclick = () => { const o = outPort(); if (!o) return seq.toast('Choose the CRAFTsynth as MIDI output'); trk.inst.program = +$('csPc').value; o.send([0xC0 | (trk.channel & 15), trk.inst.program]); seq.pushUndo(); trk.inst.params = {}; render(); seq.toast('Preset loaded on the CRAFTsynth'); };
    const grid = $('csGrid');
    SECTIONS.forEach(sec => {
      const box = document.createElement('div'); box.className = 'cs-sec' + (sec.mod ? ' wide' : '');
      box.innerHTML = `<h4>${sec.t}</h4>`;
      if (sec.mod) box.appendChild(modMatrix());
      else { const kn = document.createElement('div'); kn.className = 'cs-knobs'; sec.p.forEach(p => kn.appendChild(knob(p))); box.appendChild(kn); }
      grid.appendChild(box);
    });
    const fillLib = () => { const s = $('csLib'), l = lib(); s.innerHTML = ''; s.add(new Option(l.length ? 'Saved sounds…' : 'No saved sounds', '')); l.forEach((x, i) => s.add(new Option(x.name, i))); };
    fillLib();
    $('csLibSave').onclick = () => { const name = prompt('Name for this sound', trk.inst.name || 'My sound'); if (!name) return; const l = lib(); const i = l.findIndex(x => x.name === name); const item = { name, params: { ...trk.inst.params }, date: new Date().toISOString() }; if (i >= 0) l[i] = item; else l.push(item); saveLib(l); trk.inst.name = name; fillLib(); seq.toast('Saved in VoltaSeq'); };
    $('csLibLoad').onclick = () => { const i = $('csLib').value; if (i === '') return; const x = lib()[+i]; seq.pushUndo(); trk.inst.params = { ...x.params }; trk.inst.name = x.name; sendAll(); render(); };
    $('csLibDel').onclick = () => { const i = $('csLib').value; if (i === '') return; const l = lib(); if (!confirm(`Delete “${l[+i].name}” from VoltaSeq?`)) return; l.splice(+i, 1); saveLib(l); fillLib(); };
    $('csLibExp').onclick = () => seq.download('craftsynth-sounds.json', JSON.stringify({ app: 'VoltaSeq', device: 'CRAFTsynth 2.0', sounds: lib() }, null, 1), 'application/json');
    $('csLibImp').onclick = () => $('csFile').click();
    $('csFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const d = JSON.parse(await f.text()); const l = lib(); (d.sounds || []).forEach(x => { if (x && x.name && x.params) l.push(x); }); saveLib(l); fillLib(); seq.toast(`${(d.sounds || []).length} sounds imported`); } catch (err) { seq.toast('That file has no CRAFTsynth sounds'); } };
    $('csSend').onclick = () => { if (!outPort()) return seq.toast('Choose the CRAFTsynth as MIDI output'); sendAll(); seq.toast('Sound sent'); };
    $('csInit').onclick = () => { seq.pushUndo(); trk.inst.params = Object.fromEntries(ALL.map(p => [p.cc, p.sw ? 0 : p.def])); trk.inst.name = 'Init'; sendAll(); render(); };
    $('csRand').onclick = () => { seq.pushUndo(); randomize(1); };
    $('csMut').onclick = () => { seq.pushUndo(); randomize(0.15); };
    render();
  }
  function sendAll() { const ps = cur.trk.inst.params; Object.keys(ps).forEach(cc => sendCC(+cc, ps[cc])); }
  function randomize(amount) {
    const ps = cur.trk.inst.params, r = () => Math.random();
    ALL.forEach(p => {
      if (p.cc === 7 || p.cc === 79 || p.cc === 73 || p.cc === 58) return;            // keep volume, root, scale, arp
      const now = ps[p.cc] ?? p.def;
      let v;
      if (amount >= 1) {
        if (p.sw) v = r() < 0.2 ? 127 : 0;
        else if (p.e) v = p.e.vals[Math.floor(r() * p.e.vals.length)];
        else if (p.dest) v = Math.floor(r() * 37);
        else if (p.depth) v = r() < 0.6 ? 64 : 64 + Math.round((r() * 2 - 1) * 50);
        else v = Math.floor(r() * 128);
      } else {
        if (p.sw || p.dest || p.e) { if (r() > amount) return; v = p.sw ? (now >= 64 ? 0 : 127) : p.dest ? Math.floor(r() * 37) : p.e.vals[Math.floor(r() * p.e.vals.length)]; }
        else v = now + Math.round((r() * 2 - 1) * 127 * amount);
      }
      ps[p.cc] = Math.max(0, Math.min(127, v));
    });
    // keep random sounds playable: audible amp envelope, cutoff not closed, little delay feedback
    if (amount >= 1) { ps[28] = Math.max(ps[28], 60); ps[51] = Math.max(ps[51], 100); ps[34] = Math.max(ps[34], 40); ps[15] = Math.min(ps[15], 90); ps[26] = Math.min(ps[26], 60); }
    sendAll(); render();
  }
  function onIncoming(data, inputId) {
    const t = cur.trk; if (!t || cur.seq.active !== t || ui.host == null) return;
    if ((data[0] & 0xF0) !== 0xB0 || (data[0] & 15) !== (t.channel & 15) || !BY[data[1]]) return;
    if (t.inputId && t.inputId !== inputId) return;
    const name = (cur.seq.inputs.get(inputId) || {}).name || '';
    if (!t.inputId && !/craft/i.test(name)) return;
    t.inst.params[data[1]] = data[2]; showParam(data[1]);
    const e = ui.els[data[1]]; if (e && e.k) { e.k.classList.add('flash'); clearTimeout(e.k._t); e.k._t = setTimeout(() => e.k.classList.remove('flash'), 300); }
    const dot = ui.host.querySelector('#csInDot'); if (dot) { dot.classList.add('on'); clearTimeout(lastIn); lastIn = setTimeout(() => dot.classList.remove('on'), 400); }
  }
  function render() { ALL.forEach(p => showParam(p.cc)); }

  window.VoltaInstruments = window.VoltaInstruments || {};
  VoltaInstruments.craft = {
    id: 'craft', name: 'Modal CRAFTsynth 2.0', short: 'CRAFT', editor: 'both', hideChannel: false, portMatch: /craft/i,
    create(trk) { trk.name = 'CRAFTsynth'; trk.view = 'sound'; trk.inst = { params: {}, program: 0, name: '' }; },
    trackInfo: trk => `${trk.notes.length} notes · ch${trk.channel + 1}`,
    mount(host, trk, seq) { ui.host = host; mount(host, trk, seq); },
    unmount() { ui.host = null; },
    refresh(trk, seq) { cur.trk = trk; cur.seq = seq; render(); },
    _test: { SECTIONS, BY, fmt }
  };
})();
