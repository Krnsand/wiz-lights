import { useEffect, useState } from 'react'

import './App.css'

export default function App() {
  const [bulbs, setBulbs] = useState<Array<{ ip: string; model?: string }>>([])
  const [selectedIp, setSelectedIp] = useState<string>('')
  const [hex, setHex] = useState<string>('#ff0000')
  const [brightness, setBrightness] = useState<number>(255)
  const [status, setStatus] = useState<string>('')
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
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
      const json = (await res.json()) as { bulbs?: Array<{ ip: string; model?: string }> }
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
          Color
          <input
            type="color"
            className="colorInput"
            value={hex}
            onChange={(e) => {
              const v = e.target.value
              setHex(v)
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

        <div className="statusRow">
          <button onClick={() => void apply()} disabled={isApplying}>
            {isApplying ? 'Applying…' : 'Apply'}
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
