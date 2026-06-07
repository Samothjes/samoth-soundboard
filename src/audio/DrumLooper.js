import { playDrum } from './InstrumentEngine'

export class DrumLooper {
  constructor(ctx, masterGain) {
    this.ctx = ctx
    this.masterGain = masterGain
    this.bpm = 120
    this.bars = 2
    this.hits = []        // { drumId, time } - time in seconds from loop start
    this.recording = false
    this.playing = false
    this.recordStart = null
    this.loopTimeout = null
    this.onUpdate = null  // callback for UI updates
  }

  get loopLength() {
    return (this.bars * 4 * 60) / this.bpm
  }

  startRecording() {
    this.hits = []
    this.recording = true
    this.playing = false
    this.recordStart = this.ctx.currentTime
    this._clearLoop()

    // Auto-stop after loopLength
    this._recordTimeout = setTimeout(() => {
      this.stopRecording()
    }, this.loopLength * 1000)

    this.onUpdate?.()
  }

  stopRecording() {
    clearTimeout(this._recordTimeout)
    this.recording = false
    this.recordStart = null
    if (this.hits.length > 0) {
      this.startPlaying()
    }
    this.onUpdate?.()
  }

  recordHit(drumId) {
    if (!this.recording || this.recordStart === null) return
    const time = this.ctx.currentTime - this.recordStart
    if (time <= this.loopLength) {
      this.hits.push({ drumId, time })
    }
  }

  startPlaying() {
    if (this.hits.length === 0) return
    this.playing = true
    this._scheduleLoop(this.ctx.currentTime)
    this.onUpdate?.()
  }

  stopPlaying() {
    this.playing = false
    this._clearLoop()
    this.onUpdate?.()
  }

  clear() {
    this.stopPlaying()
    if (this.recording) this.stopRecording()
    this.hits = []
    this.onUpdate?.()
  }

  _scheduleLoop(startTime) {
    if (!this.playing) return
    const len = this.loopLength

    // Schedule all hits for this loop iteration using the audio context clock
    this.hits.forEach(hit => {
      const t = startTime + hit.time
      if (t >= this.ctx.currentTime) {
        setTimeout(() => {
          if (this.playing) playDrum(this.ctx, this.masterGain, hit.drumId)
        }, Math.max(0, (t - this.ctx.currentTime) * 1000))
      }
    })

    // Schedule next loop
    const nextStart = startTime + len
    const delay = (nextStart - this.ctx.currentTime) * 1000
    this.loopTimeout = setTimeout(() => {
      this._scheduleLoop(nextStart)
    }, Math.max(0, delay - 20)) // 20ms lookahead
  }

  _clearLoop() {
    clearTimeout(this.loopTimeout)
    this.loopTimeout = null
  }
}
