import { useEffect, useRef, useState } from 'react'

import './App.css'

export default function App() {
  const [bulbs, setBulbs] = useState<Array<{ ip: string; model?: string }>>([])
  const [selectedIp, setSelectedIp] = useState<string>('')
  const [moodColors, setMoodColors] = useState<string[]>(() => Array.from({ length: 9 }, () => ''))
  const [moodIndex, setMoodIndex] = useState<number>(1)
  const [moodHighlightedIndex, setMoodHighlightedIndex] = useState<number | null>(null)
  const [moodHex, setMoodHex] = useState<string>('#22c55e')
  const [h, setH] = useState<number>(0)
  const [s, setS] = useState<number>(100)
  const [v, setV] = useState<number>(100)
  const [fromH, setFromH] = useState<number>(0)
  const [fromS, setFromS] = useState<number>(100)
  const [fromV, setFromV] = useState<number>(100)
  const [toH, setToH] = useState<number>(120)
  const [toS, setToS] = useState<number>(100)
  const [toV, setToV] = useState<number>(100)
  const [brightness, setBrightness] = useState<number>(255)
  const [durationMs, setDurationMs] = useState<number>(1000)
  const [status, setStatus] = useState<string>('')
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isTogglingPower, setIsTogglingPower] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isDisco, setIsDisco] = useState(false)
  const [isOn, setIsOn] = useState(true)
  const [isHydrated, setIsHydrated] = useState(false)

  const discoIntervalRef = useRef<number | null>(null)
  const moodGridRef = useRef<HTMLDivElement | null>(null)
  const moodControlsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      const savedIp = localStorage.getItem('wiz.selectedIp')
      const savedH = localStorage.getItem('wiz.h')
      const savedS = localStorage.getItem('wiz.s')
      const savedV = localStorage.getItem('wiz.v')
      const savedBrightness = localStorage.getItem('wiz.brightness')

      if (savedIp) setSelectedIp(savedIp)
      if (savedH) {
        const n = Number(savedH)
        if (Number.isFinite(n)) {
          const hh = clamp(n, 0, 360)
          setH(hh)
          setFromH(hh)
        }
      }
      if (savedS) {
        const n = Number(savedS)
        if (Number.isFinite(n)) {
          const ss = clamp(n, 0, 100)
          setS(ss)
          setFromS(ss)
        }
      }
      if (savedV) {
        const n = Number(savedV)
        if (Number.isFinite(n)) {
          const vv = clamp(n, 0, 100)
          setV(vv)
          setFromV(vv)
        }
      }
      if (savedBrightness) {
        const n = Number(savedBrightness)
        if (Number.isFinite(n)) setBrightness(n)
      }
    } catch {
      // ignore
    } finally {
      setIsHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!isHydrated) return
    try {
      localStorage.setItem('wiz.selectedIp', selectedIp)
    } catch {
      // ignore
    }
  }, [isHydrated, selectedIp])

  useEffect(() => {
    if (!isHydrated) return
    if (isDisco) return
    try {
      localStorage.setItem('wiz.h', String(h))
      localStorage.setItem('wiz.s', String(s))
      localStorage.setItem('wiz.v', String(v))
    } catch {
      // ignore
    }
  }, [isHydrated, isDisco, h, s, v])

  useEffect(() => {
    if (!isHydrated) return
    if (isDisco) return
    try {
      localStorage.setItem('wiz.brightness', String(brightness))
    } catch {
      // ignore
    }
  }, [isHydrated, isDisco, brightness])

  useEffect(() => {
    return () => {
      if (discoIntervalRef.current !== null) {
        window.clearInterval(discoIntervalRef.current)
        discoIntervalRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!status) return
    const t = setTimeout(() => {
      setStatus('')
    }, 5000)
    return () => clearTimeout(t)
  }, [status])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const grid = moodGridRef.current
      const controls = moodControlsRef.current
      const target = e.target

      if (target instanceof Node) {
        if (grid && grid.contains(target)) return
        if (controls && controls.contains(target)) return
      }

      setMoodHighlightedIndex(null)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const discover = async () => {
    setIsDiscovering(true)
    setStatus('Discovering bulbs on LAN...')
    try {
      const res = await fetch('/api/bulbs?timeoutMs=900')

      const bodyText = await res.text()
      const contentType = res.headers.get('content-type') ?? ''
      const parsed =
        bodyText && contentType.includes('application/json')
          ? (JSON.parse(bodyText) as unknown)
          : undefined

      if (!res.ok) {
        const errorFromJson =
          parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)
            ? String((parsed as Record<string, unknown>).error)
            : undefined
        throw new Error(errorFromJson ?? (bodyText ? bodyText : `Request failed (${res.status})`))
      }

      const json = (parsed ?? {}) as { bulbs?: Array<{ ip: string; model?: string }> }
      const list = json.bulbs ?? []
      setBulbs(list)
      if (!selectedIp && list[0]?.ip) setSelectedIp(list[0].ip)
      setStatus(list.length ? `Found ${list.length} bulb(s).` : 'No bulbs found. Ensure bulb is on and on same Wi-Fi.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setIsDiscovering(false)
    }
  }

  const sendColor = async (next: { h: number; s: number; v: number }, nextBrightness = brightness) => {
    if (!selectedIp) return
    try {
      const { r, g, b } = hsbToRgb(next)
      await fetch('/api/color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: selectedIp, r, g, b, brightness: nextBrightness }),
      })
    } catch {
      // ignore
    }
  }

  const togglePower = async () => {
    if (!selectedIp) {
      setStatus('Select a bulb first.')
      return
    }
    const next = !isOn
    setIsTogglingPower(true)
    try {
      const res = await fetch('/api/power', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: selectedIp, on: next }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `Request failed (${res.status})`)
      }
      setIsOn(next)
      setStatus(next ? 'Turned on.' : 'Turned off.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setIsTogglingPower(false)
    }
  }

  const apply = async (
    next: { h: number; s: number; v: number },
    nextBrightness = brightness,
    options?: { silent?: boolean },
  ) => {
    if (!selectedIp) {
      setStatus('Select a bulb first.')
      return
    }
    setIsApplying(true)
    try {
      const { r, g, b } = hsbToRgb(next)
      const res = await fetch('/api/color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: selectedIp, r, g, b, brightness: nextBrightness }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `Request failed (${res.status})`)
      }
      if (!options?.silent) setStatus('Applied.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setIsApplying(false)
    }
  }

  const startDisco = () => {
    if (!selectedIp) {
      setStatus('Select a bulb first.')
      return
    }
    if (discoIntervalRef.current !== null) return

    setIsDisco(true)
    setStatus('Disco mode on.')

    let lastHue: number | null = null

    discoIntervalRef.current = window.setInterval(() => {
      let nextHue = Math.floor(Math.random() * 360)
      if (lastHue !== null) {
        let guard = 0
        while (Math.abs(nextHue - lastHue) < 25 && guard < 10) {
          nextHue = Math.floor(Math.random() * 360)
          guard++
        }
      }
      lastHue = nextHue

      const next = {
        h: nextHue,
        s: 70 + Math.floor(Math.random() * 31),
        v: 85 + Math.floor(Math.random() * 16),
      }

      void sendColor(next, brightness)
    }, 500)
  }

  const stopDisco = () => {
    if (discoIntervalRef.current !== null) {
      window.clearInterval(discoIntervalRef.current)
      discoIntervalRef.current = null
    }
    setIsDisco(false)
    setStatus('Disco mode off.')
  }

  const animate = async () => {
    if (!selectedIp) {
      setStatus('Select a bulb first.')
      return
    }
    setIsAnimating(true)
    setStatus('Animating…')
    try {
      const from = hsbToRgb({ h: fromH, s: fromS, v: fromV })
      const to = hsbToRgb({ h: toH, s: toS, v: toV })
      const res = await fetch('/api/animate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: selectedIp, from, to, durationMs, brightness }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `Request failed (${res.status})`)
      }
      setH(toH)
      setS(toS)
      setV(toV)
      setFromH(toH)
      setFromS(toS)
      setFromV(toV)
      setStatus('Animated.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setIsAnimating(false)
    }
  }

  return (
    <div className="app">
      <h1 className="title">WiZ Lights Controller</h1>

      <div className="controlsRow">
        <button onClick={discover} disabled={isDiscovering}>
          {isDiscovering ? 'Discovering…' : 'Discover bulbs'}
        </button>

        <label className="field">
          Bulb
          <select
            value={selectedIp}
            onChange={(e) => setSelectedIp(e.target.value)}
            className="select"
          >
            <option value="">Select…</option>
            {bulbs.map((b) => (
              <option key={b.ip} value={b.ip}>
                {b.ip}{b.model ? ` (${b.model})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          IP
          <input
            value={selectedIp}
            placeholder="e.g. 192.168.1.42"
            onChange={(e) => setSelectedIp(e.target.value)}
            className="ipInput"
          />
        </label>
      </div>

      <div className="panel">
        <label className="fieldWide">
          Hue
          <span
            className="colorPreview"
            style={{ backgroundColor: rgbToCss(hsbToRgb({ h, s, v })) }}
          />
          <input
            type="range"
            min={0}
            max={360}
            value={h}
            onChange={(e) => {
              const nextH = clamp(Number(e.target.value), 0, 360)
              setH(nextH)
              setFromH(nextH)
              void apply({ h: nextH, s, v }, brightness)
            }}
          />
          <code>{h}</code>
        </label>

        <label className="fieldWide">
          Saturation
          <input
            type="range"
            min={0}
            max={100}
            value={s}
            onChange={(e) => {
              const nextS = clamp(Number(e.target.value), 0, 100)
              setS(nextS)
              setFromS(nextS)
              void apply({ h, s: nextS, v }, brightness)
            }}
          />
          <code>{s}</code>
        </label>

        <label className="fieldWide">
          Brightness (HSB)
          <input
            type="range"
            min={0}
            max={100}
            value={v}
            onChange={(e) => {
              const nextV = clamp(Number(e.target.value), 0, 100)
              setV(nextV)
              setFromV(nextV)
              void apply({ h, s, v: nextV }, brightness)
            }}
          />
          <code>{v}</code>
        </label>

        <label className="fieldWide">
          Dimming
          <input
            type="range"
            min={1}
            max={255}
            value={brightness}
            onChange={(e) => {
              const v = Number(e.target.value)
              setBrightness(v)
            }}
            onMouseUp={() => void apply({ h, s, v }, brightness)}
            onTouchEnd={() => void apply({ h, s, v }, brightness)}
          />
          <code>{brightness}</code>

        </label>

        {/* <label className="fieldWide">
          Current color
          <span
            className="colorPreview"
            style={{ backgroundColor: rgbToCss(hsbToRgb({ h: fromH, s: fromS, v: fromV })) }}
          />
          <code>
            {fromH} / {fromS} / {fromV}
          </code>
        </label>

        <label className="fieldWide">
          Current hue
          <input
            type="range"
            min={0}
            max={360}
            value={fromH}
            onChange={(e) => setFromH(clamp(Number(e.target.value), 0, 360))}
          />
          <code>{fromH}</code>
        </label>

        <label className="fieldWide">
          Current saturation
          <input
            type="range"
            min={0}
            max={100}
            value={fromS}
            onChange={(e) => setFromS(clamp(Number(e.target.value), 0, 100))}
          />
          <code>{fromS}</code>
        </label>

        <label className="fieldWide">
          Current brightness
          <input
            type="range"
            min={0}
            max={100}
            value={fromV}
            onChange={(e) => setFromV(clamp(Number(e.target.value), 0, 100))}
          />
          <code>{fromV}</code>
        </label> */}

        <label className="fieldWide">
          New color
          <span
            className="colorPreview"
            style={{ backgroundColor: rgbToCss(hsbToRgb({ h: toH, s: toS, v: toV })) }}
          />
          <code>
            {toH} / {toS} / {toV}
          </code>
        </label>

        <label className="fieldWide">
          New hue
          <input
            type="range"
            min={0}
            max={360}
            value={toH}
            onChange={(e) => setToH(clamp(Number(e.target.value), 0, 360))}
          />
          <code>{toH}</code>
        </label>

        <label className="fieldWide">
          New saturation
          <input
            type="range"
            min={0}
            max={100}
            value={toS}
            onChange={(e) => setToS(clamp(Number(e.target.value), 0, 100))}
          />
          <code>{toS}</code>
        </label>

        <label className="fieldWide">
          New brightness
          <input
            type="range"
            min={0}
            max={100}
            value={toV}
            onChange={(e) => setToV(clamp(Number(e.target.value), 0, 100))}
          />
          <code>{toV}</code>
        </label>

        <label className="fieldWide">
          Animation time (ms)
          <input
            type="text"
            value={String(durationMs)}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setDurationMs(n)
            }}
          />
          <code>{durationMs}</code>
        </label>

        <div className="statusRow">
          <button onClick={togglePower} disabled={isTogglingPower || isApplying}>
            {isTogglingPower ? 'Working…' : isOn ? 'Turn off' : 'Turn on'}
          </button>
          <button onClick={animate} disabled={isAnimating || isApplying || isTogglingPower}>
            {isAnimating ? 'Animating…' : 'Animate'}
          </button>
          {!isDisco ? (
            <button onClick={startDisco} disabled={isApplying || isAnimating || isTogglingPower}>
              Disco
            </button>
          ) : (
            <button onClick={stopDisco} disabled={isApplying || isAnimating || isTogglingPower}>
              Stop Disco
            </button>
          )}
          <span className="status">{status}</span>
        </div>

        <div>
          <div className="moodGrid" ref={moodGridRef}>
            {Array.from({ length: 9 }).map((_, i) => (
              <button
                key={i}
                type="button"
                className={i + 1 === moodHighlightedIndex ? 'moodCircle moodCircleSelected' : 'moodCircle'}
                style={{ backgroundColor: moodColors[i] || undefined }}
                onClick={() => {
                  setMoodIndex(i + 1)
                  setMoodHighlightedIndex(i + 1)
                }}
              >
                {i + 1}
              </button>
            ))}
          </div>

          <div className="controlsRow moodControlsRow" ref={moodControlsRef}>
            <label className="field">
              Circle
              <select
                className="select"
                value={String(moodIndex)}
                onChange={(e) => setMoodIndex(clamp(Number(e.target.value), 1, 9))}
              >
                {Array.from({ length: 9 }).map((_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              Color
              <input
                type="color"
                className="colorInput"
                value={moodHex}
                onChange={(e) => {
                  const next = e.target.value
                  setMoodHex(next)
                  setMoodColors((prev) => {
                    const copy = prev.slice()
                    copy[moodIndex - 1] = next
                    return copy
                  })
                }}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.round(n)))
}

function hsbToRgb(hsb: { h: number; s: number; v: number }) {
  const h = ((hsb.h % 360) + 360) % 360
  const s = clamp(hsb.s, 0, 100) / 100
  const v = clamp(hsb.v, 0, 100) / 100

  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

  let rp = 0
  let gp = 0
  let bp = 0

  if (h < 60) {
    rp = c
    gp = x
  } else if (h < 120) {
    rp = x
    gp = c
  } else if (h < 180) {
    gp = c
    bp = x
  } else if (h < 240) {
    gp = x
    bp = c
  } else if (h < 300) {
    rp = x
    bp = c
  } else {
    rp = c
    bp = x
  }

  return {
    r: clamp((rp + m) * 255, 0, 255),
    g: clamp((gp + m) * 255, 0, 255),
    b: clamp((bp + m) * 255, 0, 255),
  }
}

function rgbToCss(rgb: { r: number; g: number; b: number }) {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
}
