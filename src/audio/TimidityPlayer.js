// Thin wrapper around our vendored Timidity (real sampled-instrument MIDI
// playback via WebAssembly + the FreePats General MIDI soundset) that exposes
// an interface similar to our custom MidiPlayer, so the Piano's Song Library
// UI can drive either one interchangeably.
//
// Trade-off vs. our custom MidiPlayer: Timidity plays the raw MIDI bytes
// directly through real sampled instruments (sounds dramatically more
// realistic), but it doesn't expose per-note on/off events — so we can't
// light up individual piano keys while a Timidity-powered song plays.

import { Timidity } from './timidity-vendor/index.js'

// Resolve to an absolute URL up front — Timidity internally does
// `new URL(baseUrl, window.location.origin)`, which breaks for relative paths
// when running from a `file://` URL inside Electron (origin is "null"/"file://").
// Using `document.baseURI` (respects Vite's injected <base> tag) avoids that.
const BASE_URL = new URL('midi-assets/', document.baseURI).href

export class TimidityPlayer {
  // `engine`: the shared InstrumentEngine instance — we reuse its AudioContext
  // (`engine.ctx`) and route output through its `masterGain` node. This makes
  // Timidity respect the app's volume slider and chosen output device, both of
  // which are wired up on that shared context (see AudioPlayer.js / App.jsx).
  constructor(engine) {
    this._engine = engine || null
    this._player = null
    this._ready = false
    this._pendingBuf = null
    this.onPositionUpdate = null
    this.onEnd = null
    this.onPlaying = null
    this.onError = null
    this._rafId = null
    this._destroyed = false
  }

  _ensurePlayer() {
    if (this._player || this._destroyed) return
    const opts = (this._engine?.ctx && this._engine?.masterGain)
      ? { audioContext: this._engine.ctx, destination: this._engine.masterGain }
      : {}
    this._player = new Timidity(BASE_URL, opts)
    this._player.on('ended', () => {
      this._stopTick()
      this.onEnd?.()
    })
    this._player.on('playing', () => {
      this._startTick()
      this.onPlaying?.()
    })
    this._player.on('error', (err) => this.onError?.(err))
    this._ready = true
    if (this._pendingBuf) {
      const buf = this._pendingBuf
      this._pendingBuf = null
      this._player.load(buf)
    }
  }

  // arrayBuffer: ArrayBuffer of raw MIDI file bytes
  load(arrayBuffer) {
    const buf = new Uint8Array(arrayBuffer)
    this._ensurePlayer()
    if (this._player) this._player.load(buf)
    else this._pendingBuf = buf
  }

  play() {
    this._ensurePlayer()
    this._player?.play()
  }

  pause() {
    this._player?.pause()
    this._stopTick()
  }

  resume() {
    this.play()
  }

  seek(seconds) {
    this._player?.seek(seconds)
  }

  stop() {
    this.pause()
    this.seek(0)
  }

  get duration() {
    return this._player?.duration ?? 0
  }

  getPosition() {
    return this._player?.currentTime ?? 0
  }

  _startTick() {
    this._stopTick()
    const tick = () => {
      this.onPositionUpdate?.(this.getPosition())
      this._rafId = requestAnimationFrame(tick)
    }
    this._rafId = requestAnimationFrame(tick)
  }

  _stopTick() {
    if (this._rafId) cancelAnimationFrame(this._rafId)
    this._rafId = null
  }

  destroy() {
    this._destroyed = true
    this._stopTick()
    try { this._player?.destroy() } catch {}
    this._player = null
  }
}
