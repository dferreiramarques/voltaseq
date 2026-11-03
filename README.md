# VoltaSeq — Loop Sequencer

A multi-track MIDI loop sequencer that runs in the browser. Record from a MIDI keyboard or draw notes with the pencil, then send the loop to your synths over MIDI — or hear it through the built-in preview synth.

Every track belongs to an **instrument**. A generic MIDI track gives you a piano roll for any device; dedicated instrument tracks know a specific machine and bring its own editor, sounds and memory tools.

## Features

- Multi-track loops, each with its own MIDI output, channel and velocity
- Recording with a one-bar pre-count, metronome and quantize
- Pencil and eraser tools to draw and delete notes
- BPM and loop length in bars, transpose, undo and redo (Ctrl+Z / Ctrl+Shift+Z)
- MIDI monitor for incoming notes and SysEx
- Browser preview synth for tracks without a MIDI output; tracks connected to a device are only heard on the device
- Save and load projects (`.zip` with `project.json`), including instrument tracks

## Instruments

Press **Add Track** and choose an instrument.

| Instrument | What you get |
| --- | --- |
| **MIDI (generic)** | Piano roll and velocity lane, any MIDI device, channel visible |
| **Behringer TD-3** | 303-style step editor, acid generator, live writing into the TD-3, pattern library and backups |
| **KORG volca sample 2** | 10-part step grid, sample and sound per part, sample manager over USB |
| **Modal CRAFTsynth 2.0** | Piano roll plus a full sound editor that follows the synth's knobs, and a sound library |
| **Arturia MicroFreak** | Piano roll plus an editor for every MIDI-controllable parameter, preset recall and a sound library |
| **Elektron SidStation** | Piano roll plus a live editor for the whole sound (3 oscillators, filter, 4 LFOs, wavetables), templates and patch dumps |

Use **⚙ Settings** to choose which instruments appear in that menu (generic MIDI is always there). Hiding an instrument doesn't affect tracks or projects that already use it.

Instrument tracks hide the MIDI channel because the instrument sets it (the TD-3 track reads it from the device). Use **show channel** in Track Options to change it by hand.

### Behringer TD-3

- **Step editor:** 16 steps with note, octave (Down/Up), accent, slide and time (note, tie, rest), pattern length and triplets. Select a step and press a key on the on-screen keyboard to set its pitch; the selection moves on, like pitch mode on the TD-3. Scroll on a step to change its pitch, double-click to cycle note / tie / rest.
- **Played by VoltaSeq or by the TD-3.** *VoltaSeq* sends the pattern as notes, in time with your other tracks (accent as velocity, slide as overlapping notes). *TD-3 sequencer* leaves the playing to the machine.
- **Live write:** every edit is written straight into a TD-3 memory slot, so the TD-3's own sequencer always has your latest version. The slot's previous pattern is saved to a `.syx` file first.
- **Acid generator:** root, scale, and amounts of notes, accents, slides, octave jumps and ties. **Generate** makes a new line, **Mutate** changes a few steps.
- **TD-3 memory:** read all 64 patterns (shown as mini previews), load a slot into the track, write the track to a slot (old pattern backed up, write acknowledged and read back), back up everything to one `.syx`, restore from `.syx` or SynthTribe `.sqs` (the current memory is backed up first), import `.seq` / `.syx` / `.sqs` and export `.seq`.
- **Preview voice:** a simple 303-like sketch for listening without the hardware.

The TD-3 only answers SysEx over **USB**, and its knobs (cutoff, resonance, envelope, decay, accent) can't be set or stored over MIDI.

## Use it

Open `index.html` in a browser with Web MIDI (Chrome or Edge), pick your MIDI input and output, and press ▶ PLAY. Keep the `instruments/` folder next to `index.html`: instrument files load from there when you first add one of their tracks. Instruments that need SysEx (like the TD-3) ask for SysEx permission the first time you connect them.

## Adding an instrument

An instrument is a script in `instruments/` that registers itself on `window.VoltaInstruments` and is listed in `INSTRUMENT_CATALOG` in `index.html`. It can define `create`, `mount` / `unmount` / `refresh` for its own editor, `onTimeline` to regenerate notes when the loop changes, `silent`, `synth`, `trackInfo` and `portMatch`. See `instruments/td3.js`.

### KORG volca sample 2

- **Sequence:** 10 parts × up to 16 steps. Click a step to add a hit, right-click to change its strength. Parts play on MIDI channels 1–10, KORG's default (change the first channel if you've moved them).
- **Part sound:** choose each part's sample from the volca's 200 slots, and set level, pan, start, length, hi cut, speed, pitch envelope, amp envelope, delay, loop, reverb and reverse. Everything is sent as you turn it, using the CC map from KORG's volca sample 2 MIDI implementation chart. Knobs show a dash until you set them, because the volca doesn't report its current values. **Send sounds to volca** sends every part's settings at once.
- **Samples:** read the 200 slots and memory use, send any audio file to a slot (converted to mono 31.25 kHz 16-bit, optionally normalised and trimmed), listen, save as WAV, delete, back up everything to a `.zip` and restore it. Backups are compatible with the standalone sample loader.

### Modal CRAFTsynth 2.0

- **Two views** in the toolbar: **Notes** (the piano roll) and **Sound**.
- **Sound editor:** oscillators and banks, oscillator modifier, spread, filter, the three envelopes, both LFOs, effects, the 8-slot modulation matrix and play settings, all from the CC chart in the CRAFTsynth 2.0 manual (OS 1.4). Every change is sent on the track's MIDI channel, and knobs turned on the synth update the panel.
- **Sounds live in VoltaSeq:** the CRAFTsynth can't send its whole patch over MIDI, so VoltaSeq keeps the sound: in the project, and in a library of saved sounds (export/import as `.json`). **Send sound** pushes it to the synth. **Load preset** recalls one of the synth's 64 presets by program change. **Init**, **Random** and **Mutate** shape new sounds.
- The modulation destination names follow the order of the manual's table; check them against the synth.

### Arturia MicroFreak

- **Two views**, like the CRAFTsynth: **Notes** and **Sound**.
- **Sound editor:** oscillator type (all 22 engines by name), wave, timbre, shape, cutoff, resonance, envelope, cycling envelope, LFO and arp/seq rates, glide, spice and hold. These are the parameters the MicroFreak accepts over MIDI; the mod matrix, LFO shape, filter type, paraphonic mode and volume can't be reached and stay as set in the synth's preset.
- **Knobs on the synth** update the panel when Utility › MIDI › Knob send CCs is On.
- **Presets:** **Load preset** recalls presets 1–512 (program change, plus bank select above 128; the bank select part needs checking on your unit). Sounds saved in VoltaSeq are a layer on top: load the preset, then **Send sound**.

### Elektron SidStation

- **Two views:** **Notes** and **Sound**. The sound editor covers the whole patch: three oscillators (waveform, sync, ring mod, pitch, envelope, pulse width, vibrato), the filter and its envelope, four LFOs, the wavetables (with presets for drums, Hubbard-style attacks and chord arps) and the front-knob assignments.
- **Live:** every change is written into the SidStation's edit buffer with the manual's Direct Program SysEx messages, like turning its knobs. Press **Connect SidStation** once so the browser allows SysEx.
- **Patches:** start from templates (PWM lead, sync lead, ring-mod bell, acid bass, poly pad, drums), **Send to edit buffer**, **Store on SidStation** (patch dump), open and save `.syx`, and dump a patch from the unit to load it into the track. **Mutate** and **Random** per section, and Undo for everything.
- The sound is saved with the project. For bank management (receiving and sending all 100 patches), use the standalone SidStation editor.

## Design

The interface follows the [Ableton Live design system](https://github.com/rengwu/ableton-live-ds) (dense, flat and square, 1px dividers, Title Case labels, colour only for state, IBM Plex Sans and Mono), applied with VoltaSeq's own colour palette. Instrument editors keep the look of their hardware.

## Credits

volca sample 2 USB sample transfer from [volsa2](https://github.com/00nktk/volsa2) by 00nktk (MIT), reimplemented; part CCs from KORG's MIDI implementation chart. SidStation messages from the SidStation owner's manual (rev 2.2b). CRAFTsynth 2.0 parameters from the Modal Electronics user manual. MicroFreak CCs from the MicroFreak manual's CC overview and the midi.guide database. TD-3 SysEx and pattern format from community documentation by [303patterns.com](https://303patterns.com/td3-midi.html) and the [td3-tool](https://github.com/erikdevos/td3-tool) project; the codec here is an independent implementation, checked against a pattern read from a real TD-3.

## License

MIT — see [LICENSE](LICENSE).

Made by David Marques · [monco.io](https://monco.io) · [Ko-fi](https://ko-fi.com/dferreiramarques)
