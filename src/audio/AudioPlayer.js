export class AudioPlayer {
  constructor() {
    this.ctx = null
    this.outputDeviceId = 'default'
    this.masterVolume = 0.8
    this.masterGain = null
    // slotId -> { source, gainNode, buffer, startTime, offset, paused, pausedAt, volume, loop }
    this.slots = new Map()
  }

  async init() {
    if (this.ctx) return
    this.ctx = new AudioContext({ sampleRate: 48000 })
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = this.masterVolume
    this.masterGain.connect(this.ctx.destination)

    if (this.outputDeviceId !== 'default' && this.ctx.setSinkId) {
      try { await this.ctx.setSinkId(this.outputDeviceId) } catch {}
    }
  }

  async setOutputDevice(deviceId) {
    this.outputDeviceId = deviceId
    if (this.ctx?.setSinkId) {
      try { await this.ctx.setSinkId(deviceId === 'default' ? '' : deviceId) } catch {}
    }
  }

  setMasterVolume(v) {
    this.masterVolume = v
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01)
    }
  }

  _startSource(slotId, buffer, offset, volume, loop) {
    const gainNode = this.ctx.createGain()
    gainNode.gain.value = volume
    gainNode.connect(this.masterGain)

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = loop
    source.connect(gainNode)
    source.start(0, offset)

    const startTime = this.ctx.currentTime - offset

    source.onended = () => {
      const entry = this.slots.get(slotId)
      if (entry?.source === source && !entry.paused) {
        this.slots.delete(slotId)
      }
    }

    return { source, gainNode, startTime }
  }

  async playBuffer(slotId, buffer, volume = 1.0, loop = false, offset = 0) {
    if (!this.ctx) await this.init()
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    this._killSource(slotId)

    const { source, gainNode, startTime } = this._startSource(slotId, buffer, offset, volume, loop)

    this.slots.set(slotId, {
      source, gainNode, buffer,
      startTime, offset,
      paused: false, pausedAt: 0,
      volume, loop,
    })
  }

  async playDataUrl(slotId, dataUrl, volume = 1.0, loop = false) {
    if (!this.ctx) await this.init()

    const resp = await fetch(dataUrl)
    const arrayBuf = await resp.arrayBuffer()
    const audioBuf = await this.ctx.decodeAudioData(arrayBuf)
    await this.playBuffer(slotId, audioBuf, volume, loop)
    // Store buffer for future seek/decode
    const entry = this.slots.get(slotId)
    if (entry) entry.buffer = audioBuf
  }

  pauseSlot(slotId) {
    const entry = this.slots.get(slotId)
    if (!entry || entry.paused) return

    const position = this.getPosition(slotId)
    this._killSource(slotId)

    this.slots.set(slotId, {
      ...entry,
      source: null,
      gainNode: null,
      paused: true,
      pausedAt: position,
    })
  }

  resumeSlot(slotId) {
    const entry = this.slots.get(slotId)
    if (!entry || !entry.paused || !entry.buffer) return

    const offset = Math.min(entry.pausedAt, entry.buffer.duration - 0.001)
    const { source, gainNode, startTime } = this._startSource(slotId, entry.buffer, offset, entry.volume, entry.loop)

    this.slots.set(slotId, {
      ...entry,
      source, gainNode,
      startTime,
      paused: false,
      pausedAt: 0,
    })
  }

  seekSlot(slotId, seconds) {
    const entry = this.slots.get(slotId)
    if (!entry || !entry.buffer) return

    const offset = Math.max(0, Math.min(seconds, entry.buffer.duration - 0.001))

    if (entry.paused) {
      this.slots.set(slotId, { ...entry, pausedAt: offset })
      return
    }

    this._killSource(slotId)
    const { source, gainNode, startTime } = this._startSource(slotId, entry.buffer, offset, entry.volume, entry.loop)
    this.slots.set(slotId, { ...entry, source, gainNode, startTime, offset })
  }

  getPosition(slotId) {
    const entry = this.slots.get(slotId)
    if (!entry) return 0
    if (entry.paused) return entry.pausedAt
    const pos = this.ctx.currentTime - entry.startTime
    return Math.max(0, Math.min(pos, entry.buffer?.duration ?? 0))
  }

  getDuration(slotId) {
    return this.slots.get(slotId)?.buffer?.duration ?? 0
  }

  isPaused(slotId) {
    return this.slots.get(slotId)?.paused ?? false
  }

  isActive(slotId) {
    return this.slots.has(slotId)
  }

  isPlaying(slotId) {
    const entry = this.slots.get(slotId)
    return !!entry && !entry.paused
  }

  _killSource(slotId) {
    const entry = this.slots.get(slotId)
    if (entry?.source) {
      try { entry.source.stop() } catch {}
    }
  }

  stopSlot(slotId) {
    this._killSource(slotId)
    this.slots.delete(slotId)
  }

  stopAll() {
    for (const [id] of this.slots) this.stopSlot(id)
  }

  destroy() {
    this.stopAll()
    this.ctx?.close()
    this.ctx = null
  }
}
