import { useState } from 'react'

export default function App() {
  const [bulbs, setBulbs] = useState<Array<{ ip: string; model?: string }>>([])
  const [selectedIp, setSelectedIp] = useState<string>('')
  const [hex, setHex] = useState<string>('#ff0000')
  const [brightness, setBrightness] = useState<number>(255)
  const [status, setStatus] = useState<string>('')
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [isApplying, setIsApplying] = useState(false)

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
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>WiZ Bulb Controller</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={discover} disabled={isDiscovering}>
          {isDiscovering ? 'Discovering…' : 'Discover bulbs'}
        </button>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          Bulb
          <select
            value={selectedIp}
            onChange={(e) => setSelectedIp(e.target.value)}
            style={{ minWidth: 220 }}
          >
            <option value="">Select…</option>
            {bulbs.map((b) => (
              <option key={b.ip} value={b.ip}>
                {b.ip}{b.model ? ` (${b.model})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          IP
          <input
            value={selectedIp}
            placeholder="e.g. 192.168.1.42"
            onChange={(e) => setSelectedIp(e.target.value)}
            style={{ width: 160 }}
          />
        </label>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
        <label style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          Color
          <input
            type="color"
            value={hex}
            onChange={(e) => {
              const v = e.target.value
              setHex(v)
              void apply(v, brightness)
            }}
          />
          <code>{hex}</code>
        </label>

        <label style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => void apply()} disabled={isApplying}>
            {isApplying ? 'Applying…' : 'Apply'}
          </button>
          <span style={{ opacity: 0.85 }}>{status}</span>
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
