// Helpers for the sound-editor "waveform preview + trim" feature: decoding
// audio for peak-drawing, and slicing an AudioBuffer down to a chosen region
// (start/end given as fractions 0..1 of the total duration) before playback.

export async function decodeDataUrl(ctx, dataUrl) {
  const resp = await fetch(dataUrl)
  const arrayBuf = await resp.arrayBuffer()
  return ctx.decodeAudioData(arrayBuf.slice(0))
}

export function sliceAudioBuffer(ctx, buffer, startFrac = 0, endFrac = 1) {
  const start = Math.max(0, Math.min(startFrac, 1))
  const end = Math.max(start, Math.min(endFrac, 1))
  if (start <= 0.0001 && end >= 0.9999) return buffer

  const startSample = Math.floor(start * buffer.length)
  const endSample = Math.max(startSample + 1, Math.floor(end * buffer.length))
  const length = endSample - startSample

  const sliced = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    sliced.copyToChannel(buffer.getChannelData(ch).subarray(startSample, endSample), ch)
  }
  return sliced
}

// Volume normalization: measure an AudioBuffer's RMS loudness and compute a
// gain multiplier that brings it toward a consistent target level, so newly
// imported sounds don't blast or whisper relative to everything else on the
// board. Clamped to a sane range so quiet recordings don't get over-amplified
// into noise and loud ones don't get crushed to silence.
const NORMALIZE_TARGET_RMS = 0.2
const NORMALIZE_MIN_GAIN = 0.4
const NORMALIZE_MAX_GAIN = 2.5

export function analyzeLoudness(buffer) {
  const channels = buffer.numberOfChannels
  const len = buffer.length
  if (!len) return { rms: 0, gain: 1 }

  // Sample at most ~200k frames for speed on long files
  const stride = Math.max(1, Math.floor(len / 200000))
  let sumSquares = 0
  let count = 0
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < len; i += stride) {
      const v = data[i]
      sumSquares += v * v
      count++
    }
  }
  const rms = count ? Math.sqrt(sumSquares / count) : 0
  let gain = rms > 0.0001 ? NORMALIZE_TARGET_RMS / rms : 1
  gain = Math.max(NORMALIZE_MIN_GAIN, Math.min(NORMALIZE_MAX_GAIN, gain))
  return { rms, gain }
}

// Downsample an AudioBuffer into `bucketCount` min/max peak pairs for fast
// canvas waveform drawing (averages across all channels).
export function computeWaveformPeaks(buffer, bucketCount = 400) {
  const channels = buffer.numberOfChannels
  const len = buffer.length
  const bucketSize = Math.max(1, Math.floor(len / bucketCount))
  const peaks = new Array(bucketCount)

  const datas = []
  for (let ch = 0; ch < channels; ch++) datas.push(buffer.getChannelData(ch))

  for (let i = 0; i < bucketCount; i++) {
    const start = i * bucketSize
    const end = Math.min(len, start + bucketSize)
    let min = 0, max = 0
    for (let j = start; j < end; j++) {
      for (let ch = 0; ch < channels; ch++) {
        const v = datas[ch][j]
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    peaks[i] = [min, max]
  }
  return peaks
}
