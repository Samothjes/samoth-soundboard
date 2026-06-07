# 🔊 Samoth Soundboard

A desktop soundboard app built with Electron + React: part soundboard, part instrument, part jam-session recorder.

## Download

Grab the latest portable build from the [Releases page](https://github.com/Samothjes/samoth-soundboard/releases). It's a single `.exe`, no installation needed. Windows x64 only for now.

## Features

**Soundboard**
- 24 customizable slots with icons, colors, and per-sound volume
- Drag-and-drop audio import, with automatic loudness normalization so everything plays back at a consistent level
- Hotkeys/macros to trigger sounds instantly
- Waveform preview + trim editor to pick exactly which part of a sound plays
- Scenes: save and instantly switch between named layouts (e.g. "Stream night", "D&D session")

**Piano**
- Realistic multi-octave piano you can play with your keyboard or mouse
- Sustain pedal: hold Space for momentary sustain (like a real foot pedal), or click the on-screen pedal to lock it on
- Chord mode: play full chords from a single key
- Record your own playing back as a song

**Drums**
- Step sequencer with per-row volume/mute/solo, velocity & accents, swing/groove, pattern copy/paste, and WAV export
- Drum pads for live triggering

**Jam Session Recording**
- Capture everything playing across the whole app (drum loop, piano, and soundboard hits) mixed together live, and export the take as a single WAV file

## Development

```bash
npm install
npm run start   # launches Vite + Electron together for development
```

To build a portable Windows executable:

```bash
npm run dist
```

The output lands in `release/`.

## Tech stack

Electron, React, Vite, Web Audio API.
