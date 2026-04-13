import { useEffect, useState } from 'react'

import './App.css'

export default function AppHex() {
  const [bulbs, setBulbs] = useState<Array<{ ip: string; model?: string }>>([])
  const [selectedIp, setSelectedIp] = useState<string>('')
  const [hex, setHex] = useState<string>('#ff0000')
  const [brightness, setBrightness] = useState<number>(255)
  const [fromHex, setFromHex] = useState<string>('#ff0000')
  const [toHex, setToHex] = useState<string>('#00ff00')
  const [durationMs, setDurationMs] = useState<number>(1000)
  const [status, setStatus] = useState<string>('')
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isTogglingPower, setIsTogglingPower] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isOn, setIsOn] = useState(true)
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    try {
      const savedIp = localStorage.getItem('wiz.selectedIp')
      const savedHex = localStorage.getItem('wiz.hex')
      const savedBrightness = localStorage.getItem('wiz.brightness')

      if (savedIp) setSelectedIp(savedIp)
      if (savedHex) setHex(savedHex)
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
    try {
      localStorage.setItem('wiz.hex', hex)
    } catch {
      // ignore
    }
  }, [isHydrated, hex])

  useEffect(() => {
    if (!isHydrated) return
    try {
      localStorage.setItem('wiz.brightness', String(brightness))
    } catch {
      // ignore
    }
  }, [isHydrated, brightness])

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
      setStatus(
        list.length
          ? `Found ${list.length} bulb(s).`
          : 'No bulbs found. Ensure bulb is on and on same Wi-Fi.',
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setIsDiscovering(false)
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

  const apply = async (nextHex = hex, nextBrightness = brightness) => {
    if (!selectedIp) {
      setStatus('Select a bulb first.')
      return
    }
    setIsApplying(true)
    try {
      const { r, g, b } = hexToRgb(nextHex)
      const res = await fetch('/api/color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: selectedIp, r, g, b, brightness: nextBrightness }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `Request failed (${res.status})`)
      }
      setStatus('Applied.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setIsApplying(false)
    }
  }

  const animate = async () => {
    if (!selectedIp) {
      setStatus('Select a bulb first.')
      return
    }
    setIsAnimating(true)
    try {
      const from = hexToRgb(fromHex)
      const to = hexToRgb(toHex)
      const res = await fetch('/api/animate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: selectedIp, from, to, durationMs, brightness }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `Request failed (${res.status})`)
      }
      setHex(toHex)
      setFromHex(toHex)
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
                {b.ip}
                {b.model ? ` (${b.model})` : ''}
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
          Color
          <input
            type="color"
            className="colorInput"
            value={hex}
            onChange={(e) => {
              const v = e.target.value
              setHex(v)
              setFromHex(v)
              void apply(v, brightness)
            }}
          />
          <code>{hex}</code>
        </label>

        <label className="fieldWide">
          Brightness
          <input
            type="range"
            min={1}
            max={255}
            value={brightness}
            onChange={(e) => {
              const v = Number(e.target.value)
              setBrightness(v)
            }}
            onMouseUp={() => void apply(hex, brightness)}
            onTouchEnd={() => void apply(hex, brightness)}
          />
          <code>{brightness}</code>
        </label>

        <label className="fieldWide">
          Current color
          <input
            type="color"
            className="colorInput"
            value={fromHex}
            onChange={(e) => setFromHex(e.target.value)}
          />
          <code>{fromHex}</code>
        </label>

        <label className="fieldWide">
          New color
          <input
            type="color"
            className="colorInput"
            value={toHex}
            onChange={(e) => setToHex(e.target.value)}
          />
          <code>{toHex}</code>
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
          <span className="status">{status}</span>
        </div>
      </div>
    </div>
  )
}

function hexToRgb(hex: string) {
  const cleaned = hex.replace('#', '').trim()
  const full = cleaned.length === 3 ? cleaned.split('').map((c) => c + c).join('') : cleaned
  const n = Number.parseInt(full, 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return { r, g, b }
}
