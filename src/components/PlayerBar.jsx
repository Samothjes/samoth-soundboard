import { useEffect, useRef, useState } from 'react'

function formatTime(secs) {
  const s = Math.floor(secs)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const COLORS = [
  '#7c6af7', '#e05c7a', '#3d9e6e', '#e08c3a',
  '#4a9fd4', '#c45ce0', '#e0c43a', '#4ac4c4',
]

export default function PlayerBar({ activeSlots, pausedSlots, slots, player, onPause, onResume, onStop, onStopAll }) {
  const [states, setStates] = useState({})
  const rafRef = useRef(null)
  const progressBarRefs = useRef({})

  const activeIds = [...activeSlots]

  useEffect(() => {
    if (activeIds.length === 0) {
      cancelAnimationFrame(rafRef.current)
      return
    }
    const tick = () => {
      const next = {}
      for (const id of activeIds) {
        next[id] = {
          position: player.getPosition(id),
          duration: player.getDuration(id),
        }
      }
      setStates(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [activeIds.join(',')])

  if (activeIds.length === 0) return null

  const handleSeek = (e, slotId) => {
    const bar = progressBarRefs.current[slotId]
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const dur = player.getDuration(slotId)
    player.seekSlot(slotId, ratio * dur)
  }

  return (
    <div className="player-bar">
      <div className="player-bar-tracks">
        {activeIds.map(id => {
          const slot = slots[id]
          if (!slot) return null
          const isPaused = pausedSlots.has(id)
          const color = slot.color || COLORS[id % COLORS.length]
          const pos = states[id]?.position ?? 0
          const dur = states[id]?.duration ?? 0
          const progress = dur > 0 ? pos / dur : 0

          return (
            <div key={id} className="player-track">
              <div className="player-track-info">
                <span className="player-track-icon">{slot.icon || '🔊'}</span>
                <span className="player-track-name">{slot.label}</span>
              </div>

              <button
                className="pb-btn"
                onClick={isPaused ? () => onResume(id) : () => onPause(id)}
                title={isPaused ? 'Resume' : 'Pause'}
              >
                {isPaused ? '▶' : '⏸'}
              </button>

              <div
                className="pb-timeline"
                ref={el => progressBarRefs.current[id] = el}
                onClick={e => handleSeek(e, id)}
              >
                <div className="pb-track">
                  <div className="pb-fill" style={{ width: `${progress * 100}%`, background: color }} />
                  <div className="pb-thumb" style={{ left: `${progress * 100}%`, background: color }} />
                </div>
              </div>

              <span className="pb-time">
                {formatTime(pos)} <span className="pb-dur">/ {formatTime(dur)}</span>
              </span>

              <button className="pb-btn pb-stop" onClick={() => onStop(id)} title="Stop">■</button>
            </div>
          )
        })}
      </div>

      {activeIds.length > 1 && (
        <button className="stop-all-small" onClick={onStopAll}>Stop All</button>
      )}
    </div>
  )
}
