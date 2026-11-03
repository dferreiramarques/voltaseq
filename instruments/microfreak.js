/* VoltaSeq instrument: Arturia MicroFreak — sound editor over MIDI CC, preset recall. MIT, see LICENSE.
   CC map from the MicroFreak manual (MIDI CC overview) and the community MIDI database (midi.guide). */
(() => {
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // Oscillator types and their CC 9 ranges (firmware 5)
  const TYPES = [['Basic Waves', 0, 11], ['SuperWave', 12, 16], ['Wavetable', 17, 22], ['Harmo', 23, 27], ['KarplusStr', 28, 33], ['V. Analog', 34, 38], ['Waveshaper', 39, 44], ['Two Op FM', 45, 49], ['Formant', 50, 55], ['Chords', 56, 60], ['Speech', 61, 66], ['Modal', 67, 71], ['Noise', 72, 77], ['Bass', 78, 82], ['SawX', 83, 88], ['Harm', 89, 93], ['WaveUser', 94, 99], ['Sample', 100, 104], ['ScanGrains', 105, 110], ['CloudGrains', 111, 115], ['HitGrains', 116, 121], ['Vocoder', 122, 127]];
  const DESTS = [];
  const E = (labels, vals) => ({ labels, vals });
  const P = (cc, label, o = {}) => Object.assign({ cc, label, def: 0 }, o);
  const SECTIONS = [
    { t: 'Oscillator', osc: true, p: [P(9, 'Type', { e: E(TYPES.map(t => t[0]), TYPES.map(t => Math.round((t[1] + t[2]) / 2))), def: 5 }), P(10, 'Wave', { def: 64 }), P(12, 'Timbre', { def: 64 }), P(13, 'Shape', { def: 0 })] },
    { t: 'Filter', p: [P(23, 'Cutoff', { def: 100 }), P(83, 'Resonance', { def: 20 })] },
    { t: 'Envelope', p: [P(105, 'Attack', { def: 0 }), P(106, 'Decay / rel', { def: 50 }), P(29, 'Sustain', { def: 90 })] },
    { t: 'Cycling envelope', p: [P(102, 'Rise', { def: 30 }), P(103, 'Fall', { def: 50 }), P(28, 'Hold', { def: 0 }), P(24, 'Amount', { def: 0 })] },
    { t: 'LFO', p: [P(93, 'Rate (free)', { def: 50 }), P(94, 'Rate (sync)', { def: 64 })] },
    { t: 'Arp / seq', p: [P(91, 'Rate (free)', { def: 64 }), P(92, 'Rate (sync)', { def: 64 })] },
    { t: 'Play', p: [P(5, 'Glide', { def: 0 }), P(2, 'Spice', { def: 0 }), P(64, 'Hold', { sw: 1 })] }
  ];
  const ALL = SECTIONS.flatMap(s => s.p), BY = Object.fromEntries(ALL.map(p => [p.cc, p]));
  const LIB_KEY = 'voltaseq-microfreak-library';
  const lib = () => { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch (e) { return []; } };
  const saveLib = l => { try { localStorage.setItem(LIB_KEY, JSON.stringify(l)); } catch (e) {} };

  const CSS = `
  .cs { padding: 14px; min-width: 860px; }
  .mf-unit { background: linear-gradient(180deg, #1b1c1f, #121315); border: 1px solid #2c2e33; border-radius: 12px; padding: 14px 16px 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); color: #f1f3f5; }
  .mf-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .mf-name { font: 800 22px/1 Inter, sans-serif; letter-spacing: -0.5px; }
  .mf-name small { display: block; font: 600 9px/1.4 Inter, sans-serif; letter-spacing: 1.4px; text-transform: uppercase; color: #ff7a1a; }
  .mf-top select, .mf-top input { width: auto; background: #0c0d0f; border-color: #33363c; }
  .mf-top button { flex: none; background: #24262b; border-color: #3a3d44; padding: 6px 10px; font-size: 11px; }
  .mf-top button:hover { border-color: #ff7a1a; background: #2c2f35; }
  .mf-top .pri { background: #ff7a1a; border-color: #ff7a1a; color: #1a0a00; font-weight: 700; }
  .mf-sep { width: 1px; align-self: stretch; background: #2c2e33; }
  .mf-in { font-size: 10px; color: #8b929b; display: flex; align-items: center; gap: 6px; margin-left: auto; }
  .mf-in i { width: 7px; height: 7px; border-radius: 50%; background: #233; }
  .mf-in i.on { background: #ff7a1a; box-shadow: 0 0 6px #ff7a1a; }
  .mf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
  .mf-sec { background: #0e0f11; border: 1px solid #24262b; border-radius: 8px; padding: 10px 10px 12px; }
  .mf-sec.wide { grid-column: span 2; }
  .mf-sec h4 { font: 700 9px/1 Inter, sans-serif; letter-spacing: 1.4px; text-transform: uppercase; color: #8b929b; margin-bottom: 10px; }
  .mf-knobs { display: flex; flex-wrap: wrap; gap: 10px 6px; }
  .mf-k { width: 58px; display: flex; flex-direction: column; align-items: center; gap: 3px; user-select: none; touch-action: none; }
  .mf-k svg { width: 40px; height: 40px; cursor: ns-resize; }
  .mf-k b { font: 600 9px/1.15 Inter, sans-serif; color: #f1f3f5; text-align: center; min-height: 2.3em; display: flex; align-items: flex-end; }
  .mf-k span { font: 10px 'JetBrains Mono', monospace; color: #ff7a1a; min-height: 12px; text-align: center; white-space: nowrap; max-width: 64px; overflow: hidden; text-overflow: ellipsis; }
  .mf-k.unset span { color: #5b616a; }
  .mf-sec.osc .mf-k svg circle { fill: #3a2410; stroke: #ff7a1a; }
  .mf-k.flash svg { filter: drop-shadow(0 0 6px #ff7a1a); }
  .mf-sw { flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; width: 58px; padding: 0; background: none; border: 0; color: #f1f3f5; font: 600 9px Inter, sans-serif; }
  .mf-sw:hover { background: none; border: 0; }
  .mf-sw i { width: 30px; height: 16px; border-radius: 3px; background: #24262b; border: 1px solid #3a3d44; margin-top: 12px; }
  .mf-sw.on i { background: #ff7a1a; border-color: #ff7a1a; box-shadow: 0 0 8px rgba(255,122,26,0.6); }
  .mf-mod { display: grid; grid-template-columns: 90px 1fr 54px; gap: 6px 10px; align-items: center; font-size: 11px; }
  .mf-mod select { background: #0c0d0f; border-color: #33363c; padding: 3px 6px; font-size: 11px; }
  .mf-mod input[type=range] { accent-color: #ff7a1a; }
  .mf-mod output { font: 10px 'JetBrains Mono', monospace; color: #ff7a1a; text-align: right; }
  .mf-note { font-size: 10px; color: #8b929b; margin-top: 10px; line-height: 1.5; }
  `;
  const injectCSS = () => { if (document.getElementById('mf-css')) return; const s = document.createElement('style'); s.id = 'mf-css'; s.textContent = CSS; document.head.appendChild(s); };

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
      (v == null ? '' : `<path d="${path(Math.min(start, end), Math.max(start, end) + 0.01)}" fill="none" stroke="#ff7a1a" stroke-width="3" stroke-linecap="round"/>`) +
      `<line x1="20" y1="20" x2="${(20 + (px - 20) * 0.6).toFixed(2)}" y2="${(20 + (py - 20) * 0.6).toFixed(2)}" stroke="#f1f3f5" stroke-width="2" stroke-linecap="round"/>`;
  }
  function knob(p) {
    if (p.sw) {
      const b = document.createElement('button'); b.className = 'mf-sw'; b.innerHTML = `<i></i>${p.label}`; b.title = 'CC ' + p.cc;
      b.onclick = () => { cur.seq.pushUndo(); setParam(p.cc, (get(p.cc) || 0) >= 64 ? 0 : 127); };
      ui.els[p.cc] = { sw: b }; return b;
    }
    const k = document.createElement('div'); k.className = 'mf-k'; k.title = `${p.hint ? p.hint + ' · ' : ''}CC ${p.cc} · drag up/down, double-click for init value`;
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
    const g = document.createElement('div'); g.className = 'mf-mod';
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
    host.innerHTML = `<div class="cs"><div class="mf-unit">
      <div class="mf-top">
        <div class="mf-name">MicroFreak<small>Sound · VoltaSeq</small></div>
        <span class="mf-sep"></span>
        <label style="font-size:10px;color:#8b929b">Preset <select id="mfPc"></select></label><button id="mfPcGo" title="Bank select + program change: the MicroFreak loads this preset from its memory">Load preset</button>
        <span class="mf-sep"></span>
        <select id="mfLib" title="Sounds saved in VoltaSeq"></select><button id="mfLibLoad">Use</button><button id="mfLibSave">Save as…</button><button id="mfLibDel">Delete</button><button id="mfLibExp" title="Export your saved sounds">Export</button><button id="mfLibImp">Import</button>
        <span class="mf-sep"></span>
        <button class="pri" id="mfSend" title="Send every parameter of this sound to the MicroFreak">Send sound</button><button id="mfInit">Init</button><button id="mfRand">Random</button><button id="mfMut">Mutate</button>
        <span class="mf-in" title="Turning a knob on the MicroFreak updates this panel (Utility › MIDI › Knob send CCs must be On)"><i id="mfInDot"></i>Knobs on the synth</span>
      </div>
      <div class="mf-grid" id="mfGrid"></div>
      <p class="mf-note">Every change goes to the MicroFreak on this track's MIDI channel. For knobs on the synth to show up here, set Utility › MIDI › Knob send CCs to On. Only these parameters can be reached over MIDI; the mod matrix, LFO shape, filter type, paraphonic mode and volume stay as set in the synth's preset. So a sound here is a layer on top of a preset: load the preset, then press Send sound. A dash means VoltaSeq doesn't know that value yet.</p>
      <input type="file" id="mfFile" accept=".json" hidden>
    </div></div>`;
    const $ = id => host.querySelector('#' + id);
    for (let i = 0; i < 512; i++) $('mfPc').add(new Option((i < 128 ? 'Factory ' : 'User ') + (i + 1), i));
    $('mfPc').value = trk.inst.program || 0;
    $('mfPcGo').onclick = () => { const o = outPort(); if (!o) return seq.toast('Choose the MicroFreak as MIDI output'); trk.inst.program = +$('mfPc').value; const ch = trk.channel & 15, n = trk.inst.program;
      if (n >= 128) { o.send([0xB0 | ch, 0, 0]); o.send([0xB0 | ch, 32, n >> 7]); }   // bank select for presets 129–512 (check on your unit)
      o.send([0xC0 | ch, n & 127]); seq.pushUndo(); trk.inst.params = {}; render(); seq.toast('Preset ' + (n + 1) + ' loaded on the MicroFreak'); };
    const grid = $('mfGrid');
    SECTIONS.forEach(sec => {
      const box = document.createElement('div'); box.className = 'mf-sec' + (sec.mod ? ' wide' : '') + (sec.osc ? ' osc' : '');
      box.innerHTML = `<h4>${sec.t}</h4>`;
      if (sec.mod) box.appendChild(modMatrix());
      else { const kn = document.createElement('div'); kn.className = 'mf-knobs'; sec.p.forEach(p => kn.appendChild(knob(p))); box.appendChild(kn); }
      grid.appendChild(box);
    });
    const fillLib = () => { const s = $('mfLib'), l = lib(); s.innerHTML = ''; s.add(new Option(l.length ? 'Saved sounds…' : 'No saved sounds', '')); l.forEach((x, i) => s.add(new Option(x.name, i))); };
    fillLib();
    $('mfLibSave').onclick = () => { const name = prompt('Name for this sound', trk.inst.name || 'My sound'); if (!name) return; const l = lib(); const i = l.findIndex(x => x.name === name); const item = { name, params: { ...trk.inst.params }, date: new Date().toISOString() }; if (i >= 0) l[i] = item; else l.push(item); saveLib(l); trk.inst.name = name; fillLib(); seq.toast('Saved in VoltaSeq'); };
    $('mfLibLoad').onclick = () => { const i = $('mfLib').value; if (i === '') return; const x = lib()[+i]; seq.pushUndo(); trk.inst.params = { ...x.params }; trk.inst.name = x.name; sendAll(); render(); };
    $('mfLibDel').onclick = () => { const i = $('mfLib').value; if (i === '') return; const l = lib(); if (!confirm(`Delete “${l[+i].name}” from VoltaSeq?`)) return; l.splice(+i, 1); saveLib(l); fillLib(); };
    $('mfLibExp').onclick = () => seq.download('microfreak-sounds.json', JSON.stringify({ app: 'VoltaSeq', device: 'MicroFreak', sounds: lib() }, null, 1), 'application/json');
    $('mfLibImp').onclick = () => $('mfFile').click();
    $('mfFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const d = JSON.parse(await f.text()); const l = lib(); (d.sounds || []).forEach(x => { if (x && x.name && x.params) l.push(x); }); saveLib(l); fillLib(); seq.toast(`${(d.sounds || []).length} sounds imported`); } catch (err) { seq.toast('That file has no MicroFreak sounds'); } };
    $('mfSend').onclick = () => { if (!outPort()) return seq.toast('Choose the MicroFreak as MIDI output'); sendAll(); seq.toast('Sound sent'); };
    $('mfInit').onclick = () => { seq.pushUndo(); trk.inst.params = Object.fromEntries(ALL.map(p => [p.cc, p.sw ? 0 : p.def])); trk.inst.name = 'Init'; sendAll(); render(); };
    $('mfRand').onclick = () => { seq.pushUndo(); randomize(1); };
    $('mfMut').onclick = () => { seq.pushUndo(); randomize(0.15); };
    render();
  }
  function sendAll() { const ps = cur.trk.inst.params; Object.keys(ps).forEach(cc => sendCC(+cc, ps[cc])); }
  function randomize(amount) {
    const ps = cur.trk.inst.params, r = () => Math.random();
    ALL.forEach(p => {
      if (p.cc === 64 || p.cc === 91 || p.cc === 92) return;                          // keep hold and arp rate
      const now = ps[p.cc] ?? p.def;
      let v;
      if (amount >= 1) v = p.e ? p.e.vals[Math.floor(r() * p.e.vals.length)] : Math.floor(r() * 128);
      else if (p.e) { if (r() > amount) return; v = p.e.vals[Math.floor(r() * p.e.vals.length)]; }
      else v = now + Math.round((r() * 2 - 1) * 127 * amount);
      ps[p.cc] = Math.max(0, Math.min(127, v));
    });
    if (amount >= 1) { ps[23] = Math.max(ps[23], 45); ps[29] = Math.max(ps[29], 50); ps[105] = Math.min(ps[105], 70); ps[83] = Math.min(ps[83], 100); }
    sendAll(); render();
  }
  function onIncoming(data, inputId) {
    const t = cur.trk; if (!t || cur.seq.active !== t || ui.host == null) return;
    if ((data[0] & 0xF0) !== 0xB0 || (data[0] & 15) !== (t.channel & 15) || !BY[data[1]]) return;
    if (t.inputId && t.inputId !== inputId) return;
    const name = (cur.seq.inputs.get(inputId) || {}).name || '';
    if (!t.inputId && !/freak/i.test(name)) return;
    t.inst.params[data[1]] = data[2]; showParam(data[1]);
    const e = ui.els[data[1]]; if (e && e.k) { e.k.classList.add('flash'); clearTimeout(e.k._t); e.k._t = setTimeout(() => e.k.classList.remove('flash'), 300); }
    const dot = ui.host.querySelector('#mfInDot'); if (dot) { dot.classList.add('on'); clearTimeout(lastIn); lastIn = setTimeout(() => dot.classList.remove('on'), 400); }
  }
  function render() { ALL.forEach(p => showParam(p.cc)); }

  window.VoltaInstruments = window.VoltaInstruments || {};
  VoltaInstruments.microfreak = {
    id: 'microfreak', name: 'Arturia MicroFreak', short: 'FREAK', editor: 'both', hideChannel: false, portMatch: /freak/i,
    create(trk) { trk.name = 'MicroFreak'; trk.view = 'sound'; trk.inst = { params: {}, program: 0, name: '' }; },
    trackInfo: trk => `${trk.notes.length} notes · ch${trk.channel + 1}`,
    mount(host, trk, seq) { ui.host = host; mount(host, trk, seq); },
    unmount() { ui.host = null; },
    refresh(trk, seq) { cur.trk = trk; cur.seq = seq; render(); },
    _test: { SECTIONS, BY, fmt }
  };
})();
