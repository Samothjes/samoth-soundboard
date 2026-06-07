import { useState, useEffect, useRef, useCallback } from 'react'
import { decodeDataUrl, computeWaveformPeaks } from '../audio/trim'

const ICONS = ['🔊','📯','💥','💨','🎺','🥁','😬','🚨','😮','🎵','🎶','🔔','💣','🤣','👻','🐸','🦆','🎸','🎹','🎤','🔥','⚡','🌊','🌪️','👏','🐱','🐶','🤖','💀','🍕']
const COLORS = ['#7c6af7','#e05c7a','#3d9e6e','#e08c3a','#4a9fd4','#c45ce0','#e0c43a','#4ac4c4','#e06060','#60e0a0']

const isElectron = !!window.electronAPI

export default function EditModal({ slot, ctx, onSave, onClose, onClear }) {
  const [label, setLabel] = useState(slot.label || '')
  const [icon, setIcon] = useState(slot.icon || '🔊')
  const [hotkey, setHotkey] = useState(slot.hotkey || '')
  const [volume, setVolume] = useState(slot.volume ?? 1.0)
  const [color, setColor] = useState(slot.color || '#7c6af7')
  const [loop, setLoop] = useState(slot.loop || false)
  const [recording, setRecording] = useState(false)
  const [hotkeyError, setHotkeyError] = useState('')

  // Waveform preview + trim — lets users visually pick the playback region
  // for sounds loaded from an audio file (data URL).
  const [waveform, setWaveform] = useState(null) // { peaks, duration }
  const [waveformError, setWaveformError] = useState('')
  const [trimStart, setTrimStart] = useState(slot.trimStart ?? 0)
  const [trimEnd, setTrimEnd] = useState(slot.trimEnd ?? 1)
  const [normalizeEnabled, setNormalizeEnabled] = useState(slot.normalizeEnabled ?? true)
  const canvasRef = useRef(null)
  const dragRef = useRef(null) // 'start' | 'end' | null

  useEffect(() => {
    let cancelled = false
    setWaveform(null)
    setWaveformError('')
    if (!slot.dataUrl || !ctx) return
    decodeDataUrl(ctx, slot.dataUrl)
      .then(buf => {
        if (cancelled) return
        setWaveform({ peaks: computeWaveformPeaks(buf, 400), duration: buf.duration })
      })
      .catch(() => { if (!cancelled) setWaveformError('Could not decode audio for waveform preview') })
    return () => { cancelled = true }
  }, [slot.dataUrl, ctx])

  // Draw the waveform + trim overlay whenever data or the trim range changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !waveform) return
    const { peaks } = waveform
    const w = canvas.width, h = canvas.height
    const c2 = canvas.getContext('2d')
    c2.clearRect(0, 0, w, h)

    // Background
    c2.fillStyle = 'rgba(255,255,255,0.03)'
    c2.fillRect(0, 0, w, h)

    // Dimmed (trimmed-out) regions
    c2.fillStyle = 'rgba(0,0,0,0.45)'
    c2.fillRect(0, 0, trimStart * w, h)
    c2.fillRect(trimEnd * w, 0, w - trimEnd * w, h)

    // Waveform bars
    const mid = h / 2
    const barW = w / peaks.length
    for (let i = 0; i < peaks.length; i++) {
      const [min, max] = peaks[i]
      const x = i * barW
      const frac = i / peaks.length
      const inRange = frac >= trimStart && frac <= trimEnd
      c2.fillStyle = inRange ? '#9d8cf9' : 'rgba(157,140,249,0.35)'
      const y1 = mid + min * mid
      const y2 = mid + max * mid
      c2.fillRect(x, y1, Math.max(1, barW - 0.5), Math.max(1, y2 - y1))
    }

    // Trim handles
    c2.fillStyle = '#7c6af7'
    c2.fillRect(trimStart * w - 1.5, 0, 3, h)
    c2.fillRect(trimEnd * w - 1.5, 0, 3, h)
  }, [waveform, trimStart, trimEnd])

  const fracFromEvent = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return 0
    const rect = canvas.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }, [])

  const onWaveformMouseDown = (e) => {
    if (!waveform) return
    const frac = fracFromEvent(e)
    // Grab whichever handle is closer (within a small threshold), else move
    // the nearer edge of the trim region to the click point
    const distStart = Math.abs(frac - trimStart)
    const distEnd = Math.abs(frac - trimEnd)
    if (distStart < 0.03 || (distStart <= distEnd && frac < trimEnd)) {
      dragRef.current = 'start'
      setTrimStart(Math.min(frac, trimEnd - 0.01))
    } else {
      dragRef.current = 'end'
      setTrimEnd(Math.max(frac, trimStart + 0.01))
    }
  }

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return
      const frac = fracFromEvent(e)
      if (dragRef.current === 'start') setTrimStart(prev => Math.min(frac, trimEnd - 0.01))
      else setTrimEnd(prev => Math.max(frac, trimStart + 0.01))
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [trimStart, trimEnd, fracFromEvent])

  const resetTrim = () => { setTrimStart(0); setTrimEnd(1) }

  const handleKeyDown = (e) => {
    if (!recording) return
    e.preventDefault()
    const parts = []
    if (e.ctrlKey) parts.push('Control')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')
    const key = e.key
    if (!['Control','Alt','Shift','Meta'].includes(key)) {
      parts.push(key.length === 1 ? key.toUpperCase() : key)
      setHotkey(parts.join('+'))
      setRecording(false)
    }
  }

  const handlePickFile = async () => {
    if (!isElectron) return
    const result = await window.electronAPI.pickAudioFile()
    if (result) {
      if (!label) setLabel(result.name)
      onSave({ label: label || result.name, icon, hotkey, volume, color, loop, dataUrl: result.dataUrl, trimStart: 0, trimEnd: 1 })
      onClose()
    }
  }

  const handleSave = () => {
    onSave({ label, icon, hotkey, volume, color, loop, trimStart, trimEnd, normalizeEnabled })
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h3>Edit Sound</h3>

        <div className="modal-row">
          <label>Name</label>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Sound name..." />
        </div>

        <div className="modal-row">
          <label>Icon</label>
          <div className="icon-grid">
            {ICONS.map(ic => (
              <button
                key={ic}
                className={`icon-btn ${icon === ic ? 'active' : ''}`}
                onClick={() => setIcon(ic)}
              >{ic}</button>
            ))}
          </div>
        </div>

        <div className="modal-row">
          <label>Color</label>
          <div className="color-grid">
            {COLORS.map(c => (
              <button
                key={c}
                className={`color-btn ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="modal-row">
          <label>Hotkey</label>
          <div className="hotkey-row">
            <div
              className={`hotkey-input ${recording ? 'recording' : ''}`}
              tabIndex={0}
              onClick={() => setRecording(true)}
            >
              {recording ? 'Press a key...' : hotkey || 'Click to set'}
            </div>
            {hotkey && <button className="clear-btn" onClick={() => setHotkey('')}>Clear</button>}
          </div>
          {hotkeyError && <div className="hotkey-error">{hotkeyError}</div>}
        </div>

        {slot.dataUrl && (
          <div className="modal-row waveform-row">
            <label>Trim</label>
            <div className="waveform-block">
              {waveform && (
                <>
                  <canvas
                    ref={canvasRef}
                    className="waveform-canvas"
                    width={520}
                    height={72}
                    onMouseDown={onWaveformMouseDown}
                  />
                  <div className="waveform-meta">
                    <span>
                      {fmtSec(trimStart * waveform.duration)} – {fmtSec(trimEnd * waveform.duration)}
                      {' '}({fmtSec((trimEnd - trimStart) * waveform.duration)} of {fmtSec(waveform.duration)})
                    </span>
                    {(trimStart > 0 || trimEnd < 1) && (
                      <button className="clear-btn" onClick={resetTrim}>Reset</button>
                    )}
                  </div>
                  <div className="waveform-hint">Drag the handles to select what plays · only the highlighted region will be heard</div>
                </>
              )}
              {!waveform && !waveformError && <div className="waveform-loading">Decoding waveform…</div>}
              {waveformError && <div className="waveform-error">{waveformError}</div>}
            </div>
          </div>
        )}

        <div className="modal-row">
          <label>Volume</label>
          <div className="vol-row">
            <input type="range" min={0} max={1} step={0.01} value={volume} onChange={e => setVolume(parseFloat(e.target.value))} />
            <span>{Math.round(volume * 100)}%</span>
          </div>
        </div>

        {slot.dataUrl && slot.normalizedGain != null && (
          <div className="modal-row">
            <label>Volume Normalization</label>
            <div className="normalize-row">
              <label className="normalize-checkbox">
                <input type="checkbox" checked={normalizeEnabled} onChange={e => setNormalizeEnabled(e.target.checked)} />
                Auto-level this sound
              </label>
              <span className="normalize-detail">
                {normalizeEnabled
                  ? `Gain ${slot.normalizedGain >= 1 ? '+' : ''}${Math.round((slot.normalizedGain - 1) * 100)}% applied so it matches everything else`
                  : 'Normalization off — playing at the source recording\'s original loudness'}
              </span>
            </div>
          </div>
        )}

        <div className="modal-row">
          <label>Loop</label>
          <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />
        </div>

        {isElectron && (
          <div className="modal-row">
            <label>Audio file</label>
            <button className="file-btn" onClick={handlePickFile}>
              📁 {slot.dataUrl ? 'Replace file...' : 'Load file...'}
            </button>
          </div>
        )}

        <div className="modal-actions">
          <button className="modal-clear" onClick={() => { onClear(); onClose() }}>Clear slot</button>
          <div style={{ flex: 1 }} />
          <button className="modal-cancel" onClick={onClose}>Cancel</button>
          <button className="modal-save" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}

function fmtSec(s) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
