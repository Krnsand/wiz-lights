import { useEffect, useRef, useState } from 'react'

import './App.css'

export default function App() {
  const [bulbs, setBulbs] = useState<
    Array<{ ip: string; model?: string; mac?: string; rssi?: number; online?: boolean; lastSeenAt?: number; networkId?: string }>
  >([])
  const [selectedMac, setSelectedMac] = useState<string>('')
  const [selectedMacs, setSelectedMacs] = useState<string[]>([])
  const [groups, setGroups] = useState<Record<string, string[]>>({})
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  const [newGroupName, setNewGroupName] = useState<string>('')

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

  const [showMode, setShowMode] = useState<'chase' | 'solid' | 'wave' | 'pulse' | 'solar' | 'aurora' | 'sparkle'>('chase')
  const [showIntervalMs, setShowIntervalMs] = useState<number>(250)
  const [showPalette, setShowPalette] = useState<string>('#ff0000,#00ff00,#0000ff')
  const [isShowRunning, setIsShowRunning] = useState(false)

  const discoIntervalRef = useRef<number | null>(null)
  const colorRafRef = useRef<number | null>(null)
  const pendingColorRef = useRef<null | { h: number; s: number; v: number; brightness: number }>(null)
  const refreshBulbsTimerRef = useRef<number | null>(null)
  const refreshBulbsIntervalRef = useRef<number | null>(null)

  const [assignments, setAssignments] = useState<Array<null | { mac?: string; ip?: string; model?: string }>>(
    () => Array.from({ length: 9 }, () => null),
  )
  const [moodColors, setMoodColors] = useState<string[]>(() => Array.from({ length: 9 }, () => ''))
  const [moodIndex, setMoodIndex] = useState<number>(1)
  const [moodHighlightedIndex, setMoodHighlightedIndex] = useState<number | null>(null)
  const [moodHex, setMoodHex] = useState<string>('#22c55e')
  const moodGridRef = useRef<HTMLDivElement | null>(null)
  const moodControlsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      const savedMac = localStorage.getItem('wiz.selectedMac')
      const savedGroups = localStorage.getItem('wiz.groups')
      const savedH = localStorage.getItem('wiz.h')
      const savedS = localStorage.getItem('wiz.s')
      const savedV = localStorage.getItem('wiz.v')
      const savedBrightness = localStorage.getItem('wiz.brightness')

      if (savedMac) setSelectedMac(savedMac)
      if (savedGroups) {
        const parsed = JSON.parse(savedGroups) as unknown
        if (parsed && typeof parsed === 'object') setGroups(parsed as Record<string, string[]>)
      }
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
      localStorage.setItem('wiz.selectedMac', selectedMac)
    } catch {
      // ignore
    }
  }, [isHydrated, selectedMac])

  useEffect(() => {
    if (!isHydrated) return
    try {
      localStorage.setItem('wiz.groups', JSON.stringify(groups))
    } catch {
      // ignore
    }
  }, [isHydrated, groups])

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

  const startShow = async () => {
    const macs = activeMacs
    if (macs.length === 0) {
      setStatus('Select at least one bulb first.')
      return
    }

    const colors =
      showMode === 'wave' || showMode === 'solar' || showMode === 'aurora'
        ? []
        : showPalette
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)

    if (showMode !== 'wave' && showMode !== 'solar' && showMode !== 'aurora' && colors.length === 0) {
      setStatus('Provide at least one hex color in the palette.')
      return
    }

    try {
      const res = await fetch('/api/show/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ macs, colors, intervalMs: showIntervalMs, brightness, mode: showMode }),
      })
      const json = (await res.json().catch(() => null)) as null | { error?: unknown }
      if (!res.ok) {
        throw new Error(typeof json?.error === 'string' ? json.error : `Request failed (${res.status})`)
      }
      setIsShowRunning(true)
      setStatus('Show started.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const stopShow = async () => {
    try {
      const res = await fetch('/api/show/stop', { method: 'POST' })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `Request failed (${res.status})`)
      }
      setIsShowRunning(false)
      setStatus('Show stopped.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/mood-grid')
        if (!res.ok) return
        const json = (await res.json().catch(() => null)) as null | { colors?: unknown }
        const colors = Array.isArray(json?.colors) ? json?.colors : null
        if (!colors) return
        const next = colors.map((c) => (typeof c === 'string' ? c : ''))
        while (next.length < 9) next.push('')
        setMoodColors(next.slice(0, 9))
      } catch {
        // ignore
      }
    }
    void load()
  }, [])

  const refreshBulbs = (options?: { discover?: boolean }) => {
    if (refreshBulbsTimerRef.current !== null) return
    refreshBulbsTimerRef.current = window.setTimeout(async () => {
      refreshBulbsTimerRef.current = null
      try {
        const url = options?.discover ? '/api/bulbs?discover=1&timeoutMs=2500' : '/api/bulbs?probe=1'
        const res = await fetch(url)
        if (!res.ok) return
        const json = (await res.json().catch(() => null)) as null | { bulbs?: unknown }
        const listRaw = Array.isArray(json?.bulbs) ? (json?.bulbs as any[]) : []
        const list = listRaw
          .map((b) => ({
            ip: typeof b?.ip === 'string' ? b.ip : '',
            model: typeof b?.model === 'string' ? b.model : undefined,
            mac: typeof b?.mac === 'string' ? b.mac : undefined,
            rssi: typeof b?.rssi === 'number' ? b.rssi : undefined,
            online: typeof b?.online === 'boolean' ? b.online : undefined,
            lastSeenAt: typeof b?.lastSeenAt === 'number' ? b.lastSeenAt : undefined,
            networkId: typeof b?.networkId === 'string' ? b.networkId : undefined,
          }))
          .filter((b) => b.ip)
          .sort((a, b) => {
            const ao = a.online === false ? 0 : 1
            const bo = b.online === false ? 0 : 1
            if (ao !== bo) return bo - ao
            return (b.rssi ?? -9999) - (a.rssi ?? -9999)
          })

        setBulbs(list)
        if (!selectedMac && list[0]?.mac) setSelectedMac(list[0].mac)
      } catch {
        // ignore
      }
    }, 150)
  }

  useEffect(() => {
    refreshBulbs()
    refreshBulbsIntervalRef.current = window.setInterval(() => {
      refreshBulbs()
    }, 2500)
    return () => {
      if (refreshBulbsTimerRef.current !== null) {
        window.clearTimeout(refreshBulbsTimerRef.current)
        refreshBulbsTimerRef.current = null
      }
      if (refreshBulbsIntervalRef.current !== null) {
        window.clearInterval(refreshBulbsIntervalRef.current)
        refreshBulbsIntervalRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persistAssignments = async (next: Array<null | { mac?: string; ip?: string; model?: string }>) => {
    await Promise.all(
      next.map((a, i) =>
        fetch(`/api/mood-assignments/${i + 1}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(a ?? {}),
        }).catch(() => undefined),
      ),
    )
  }

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/mood-assignments')
        if (!res.ok) return
        const json = (await res.json().catch(() => null)) as null | { assignments?: unknown }
        const list = Array.isArray(json?.assignments) ? (json?.assignments as any[]) : null
        if (!list) return
        const next = list.map((x) =>
          x && typeof x === 'object'
            ? {
                mac: typeof (x as any).mac === 'string' ? (x as any).mac : undefined,
                ip: typeof (x as any).ip === 'string' ? (x as any).ip : undefined,
                model: typeof (x as any).model === 'string' ? (x as any).model : undefined,
              }
            : null,
        )
        while (next.length < 9) next.push(null)
        setAssignments(next.slice(0, 9))
      } catch {
        // ignore
      }
    }

    void load()
  }, [])

  useEffect(() => {
    const es = new EventSource('/api/mood-grid/stream')

    es.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as { colors?: unknown }
        const colors = Array.isArray(parsed?.colors) ? parsed.colors : null
        if (!colors) return
        const next = colors.map((c) => (typeof c === 'string' ? c : ''))
        while (next.length < 9) next.push('')
        setMoodColors(next.slice(0, 9))
      } catch {
        // ignore
      }
    }

    return () => {
      es.close()
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

  const discoverBulbs = async () => {
    setIsDiscovering(true)
    setStatus('Discovering bulbs on LAN...')
    try {
      const res = await fetch('/api/bulbs?discover=1&timeoutMs=2500')
      const json = (await res.json().catch(() => null)) as null | { bulbs?: unknown; error?: unknown }
      if (!res.ok) {
        throw new Error(typeof json?.error === 'string' ? json.error : `Request failed (${res.status})`)
      }

      const listRaw = Array.isArray(json?.bulbs) ? (json?.bulbs as any[]) : []
      const list = listRaw
        .map((b) => ({
          ip: typeof b?.ip === 'string' ? b.ip : '',
          model: typeof b?.model === 'string' ? b.model : undefined,
          mac: typeof b?.mac === 'string' ? b.mac : undefined,
          rssi: typeof b?.rssi === 'number' ? b.rssi : undefined,
          online: typeof b?.online === 'boolean' ? b.online : undefined,
          lastSeenAt: typeof b?.lastSeenAt === 'number' ? b.lastSeenAt : undefined,
          networkId: typeof b?.networkId === 'string' ? b.networkId : undefined,
        }))
        .filter((b) => b.ip)
        .sort((a, b) => {
          const ao = a.online === false ? 0 : 1
          const bo = b.online === false ? 0 : 1
          if (ao !== bo) return bo - ao
          return (b.rssi ?? -9999) - (a.rssi ?? -9999)
        })

      setBulbs(list)
      if (!selectedMac && list[0]?.mac) setSelectedMac(list[0].mac)

      refreshBulbs()

      setAssignments((prev) => {
        let didChange = false
        const next = prev.map((a) => {
          if (!a) return null
          const found = a.mac
            ? list.find((b) => b.mac && b.mac.toLowerCase() === a.mac?.toLowerCase())
            : a.ip
              ? list.find((b) => b.ip === a.ip)
              : undefined

          if (!found) return a

          const updated = {
            mac: a.mac ?? found.mac,
            ip: found.ip,
            model: found.model ?? a.model,
          }

          if (updated.ip !== a.ip || updated.model !== a.model || updated.mac !== a.mac) didChange = true
          return updated
        })

        if (didChange) {
          void persistAssignments(next)
        }

        return didChange ? next : prev
      })

      setStatus(list.length ? `Found ${list.length} bulb(s).` : 'No reachable bulbs found.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setIsDiscovering(false)
    }
  }

  const selectedBulb = selectedMac ? bulbs.find((b) => b.mac === selectedMac) : undefined

  const activeMacs = (selectedMacs.length ? selectedMacs : selectedMac ? [selectedMac] : []).filter(Boolean)

  const sendColor = async (next: { h: number; s: number; v: number }, nextBrightness = brightness) => {
    if (activeMacs.length === 0) return
    try {
      const { r, g, b } = hsbToRgb(next)
      if (activeMacs.length === 1) {
        void fetch('/api/color', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mac: activeMacs[0], r, g, b, brightness: nextBrightness }),
        })
      } else {
        void fetch('/api/color/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ macs: activeMacs, r, g, b, brightness: nextBrightness }),
        })
      }
    } catch {
      // ignore
    }
  }

  const sendColorFast = async (next: { h: number; s: number; v: number }, nextBrightness = brightness) => {
    if (activeMacs.length === 0) return
    try {
      const { r, g, b } = hsbToRgb(next)
      const url = activeMacs.length === 1 ? '/api/color?fast=1' : '/api/color/bulk?fast=1'
      const body =
        activeMacs.length === 1
          ? { mac: activeMacs[0], r, g, b, brightness: nextBrightness }
          : { macs: activeMacs, r, g, b, brightness: nextBrightness }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        setStatus(json.error ?? `Request failed (${res.status})`)
        return
      }

      refreshBulbs()
      window.setTimeout(() => refreshBulbs(), 900)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const queueColor = (next: { h: number; s: number; v: number }, nextBrightness = brightness) => {
    pendingColorRef.current = { ...next, brightness: nextBrightness }
    if (colorRafRef.current !== null) return
    colorRafRef.current = window.requestAnimationFrame(() => {
      colorRafRef.current = null
      const pending = pendingColorRef.current
      pendingColorRef.current = null
      if (!pending) return
      void sendColorFast({ h: pending.h, s: pending.s, v: pending.v }, pending.brightness)
    })
  }

  const togglePower = async () => {
    if (activeMacs.length === 0) {
      setStatus('Select a bulb first.')
      return
    }
    const next = !isOn
    setIsTogglingPower(true)
    try {
      const res = await fetch(activeMacs.length === 1 ? '/api/power' : '/api/power/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeMacs.length === 1 ? { mac: activeMacs[0], on: next } : { macs: activeMacs, on: next }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `Request failed (${res.status})`)
      }
      setIsOn(next)
      refreshBulbs()
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
    if (activeMacs.length === 0) {
      setStatus('Select a bulb first.')
      return
    }
    setIsApplying(true)
    try {
      const { r, g, b } = hsbToRgb(next)
      const res = await fetch(activeMacs.length === 1 ? '/api/color' : '/api/color/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          activeMacs.length === 1
            ? { mac: activeMacs[0], r, g, b, brightness: nextBrightness }
            : { macs: activeMacs, r, g, b, brightness: nextBrightness },
        ),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `Request failed (${res.status})`)
      }
      refreshBulbs()
      if (!options?.silent) setStatus('Applied.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setIsApplying(false)
    }
  }

  const animate = async () => {
    if (activeMacs.length === 0) {
      setStatus('Select a bulb first.')
      return
    }

    setIsAnimating(true)
    try {
      const from = hsbToRgb({ h: fromH, s: fromS, v: fromV })
      const to = hsbToRgb({ h: toH, s: toS, v: toV })
      const ms = clamp(durationMs, 0, 60_000)

      const res =
        activeMacs.length === 1
          ? await fetch('/api/animate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ip: selectedBulb?.ip,
                from,
                to,
                durationMs: ms,
                brightness,
              }),
            })
          : await fetch('/api/animate/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                macs: activeMacs,
                from,
                to,
                durationMs: ms,
                brightness,
              }),
            })

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `Request failed (${res.status})`)
      }
      setStatus('Animated.')
      setFromH(toH)
      setFromS(toS)
      setFromV(toV)
      setH(toH)
      setS(toS)
      setV(toV)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setIsAnimating(false)
    }
  }

  const startDisco = async () => {
    if (!selectedBulb?.ip) {
      setStatus('Select a bulb first.')
      return
    }
    if (discoIntervalRef.current !== null) return

    setIsDisco(true)
    setStatus('Disco started.')

    await apply({ h, s, v }, brightness, { silent: true })

    discoIntervalRef.current = window.setInterval(() => {
      const nextH = Math.floor(Math.random() * 360)
      const nextS = 100
      const nextV = 100
      void sendColor({ h: nextH, s: nextS, v: nextV }, brightness)
    }, 350)
  }

  const stopDisco = () => {
    if (discoIntervalRef.current !== null) {
      window.clearInterval(discoIntervalRef.current)
      discoIntervalRef.current = null
    }
    setIsDisco(false)
    setStatus('Disco stopped.')
  }

  const assignSelectedBulbToCircle = async () => {
    if (!selectedBulb || !selectedBulb.ip) {
      setStatus('Select exactly one bulb to assign.')
      return
    }

    try {
      const res = await fetch(`/api/mood-assignments/${moodIndex}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: selectedBulb.mac, ip: selectedBulb.ip, model: selectedBulb.model }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `Request failed (${res.status})`)
      }
      const json = (await res.json().catch(() => null)) as null | { assignments?: unknown }
      const list = Array.isArray(json?.assignments) ? (json?.assignments as any[]) : null
      if (list) {
        const next = list.map((x) =>
          x && typeof x === 'object'
            ? {
                mac: typeof (x as any).mac === 'string' ? (x as any).mac : undefined,
                ip: typeof (x as any).ip === 'string' ? (x as any).ip : undefined,
                model: typeof (x as any).model === 'string' ? (x as any).model : undefined,
              }
            : null,
        )
        while (next.length < 9) next.push(null)
        setAssignments(next.slice(0, 9))
      }
      setStatus(`Assigned bulb to circle ${moodIndex}.`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const applyCircleToAssignedBulb = async () => {
    const a = assignments[moodIndex - 1]
    const mac = a?.mac
    if (!mac) {
      setStatus(`Circle ${moodIndex} has no bulb assigned.`)
      return
    }

    const rgb = hexToRgb(moodHex)
    if (!rgb) {
      setStatus('Invalid color.')
      return
    }

    try {
      const res = await fetch('/api/color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac, r: rgb.r, g: rgb.g, b: rgb.b }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `Request failed (${res.status})`)
      }
      setStatus(`Applied circle ${moodIndex} to assigned bulb.`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="app">
      <h1 className="title">WiZ Lights Controller</h1>

      <div className="controlsRow">
        <button onClick={discoverBulbs} disabled={isDiscovering}>
          {isDiscovering ? 'Discovering…' : 'Discover bulbs'}
        </button>

        <label className="field">
          Bulb
          <select value={selectedMac} onChange={(e) => setSelectedMac(e.target.value)} className="select">
            <option value="">Select…</option>
            {bulbs.map((b) => (
              <option key={b.mac ?? b.ip} value={b.mac ?? ''}>
                {b.model ? `${b.model} ` : ''}
                {b.ip}
                {b.mac ? ` • ${b.mac}` : ''}
                {b.online === false ? ' (offline)' : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="panel">
          <div className="statusRow">
            <strong>Light show</strong>
            <span className="status">{isShowRunning ? 'Running' : 'Stopped'}</span>
          </div>

          <label className="fieldWide">
            Mode
            <select
              value={showMode}
              onChange={(e) => {
                const next = e.target.value as 'chase' | 'solid' | 'wave' | 'pulse' | 'solar' | 'aurora' | 'sparkle'
                setShowMode(next)
                if (next === 'pulse' && !showPalette.trim()) setShowPalette('#ffffff')
              }}
              className="select"
            >
              <option value="pulse">Pulse (1 color)</option>
              <option value="sparkle">Sparkle (2 colors)</option>
              <option value="solid">Solid (3 colors)</option>
              <option value="chase">Chase (3 colors)</option>
              <option value="wave">Wave</option>
              <option value="solar">Solar Flare</option>
              <option value="aurora">Aurora</option>
            </select>
          </label>

          <label className="fieldWide">
            Interval (ms)
            <input
              type="number"
              min={100}
              max={60000}
              value={showIntervalMs}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) setShowIntervalMs(n)
              }}
            />
          </label>

          <label className="fieldWide">
            Palette (comma-separated hex)
            <input type="text" value={showPalette} onChange={(e) => setShowPalette(e.target.value)} />
          </label>

          {!isShowRunning ? (
            <button type="button" onClick={startShow} disabled={isApplying || isAnimating || isTogglingPower}>
              Start show
            </button>
          ) : (
            <button type="button" onClick={stopShow} disabled={isApplying || isAnimating || isTogglingPower}>
              Stop show
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="statusRow">
          <strong>Selected bulbs</strong>
          <span className="status">{selectedMacs.length ? `${selectedMacs.length} selected` : 'Using dropdown selection'}</span>
          <button
            type="button"
            onClick={() => {
              const allMacs = bulbs.filter((b) => b.mac).map((b) => b.mac as string)
              setSelectedMacs(allMacs)
            }}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => {
              const onlineMacs = bulbs.filter((b) => b.mac && b.online !== false).map((b) => b.mac as string)
              setSelectedMacs(onlineMacs)
            }}
          >
            Select all online
          </button>
          <button type="button" onClick={() => setSelectedMacs([])}>
            Clear
          </button>
        </div>

        <div className="statusRow">
          <strong>Groups</strong>
          <select
            className="select"
            value={selectedGroup}
            onChange={(e) => {
              const name = e.target.value
              setSelectedGroup(name)
              const macs = groups[name]
              if (Array.isArray(macs) && macs.length) setSelectedMacs(macs)
              else setSelectedMacs([])
            }}
          >
            <option value="">Select group…</option>
            {Object.keys(groups)
              .sort((a, b) => a.localeCompare(b))
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>

          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="New group name"
          />

          <button
            type="button"
            onClick={() => {
              const name = newGroupName.trim()
              if (!name) return
              if (selectedMacs.length === 0) return
              setGroups((prev) => ({ ...prev, [name]: selectedMacs.slice() }))
              setSelectedGroup(name)
              setNewGroupName('')
            }}
          >
            Save current selection
          </button>

          <button
            type="button"
            onClick={() => {
              const name = selectedGroup
              if (!name) return
              setGroups((prev) => {
                const copy = { ...prev }
                delete copy[name]
                return copy
              })
              setSelectedGroup('')
            }}
          >
            Delete group
          </button>
        </div>

        <div className="panel">
          {bulbs
            .filter((b) => b.mac)
            .map((b) => {
              const mac = b.mac as string
              const checked = selectedMacs.includes(mac)
              return (
                <label key={mac} className="fieldWide">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? Array.from(new Set([...selectedMacs, mac]))
                        : selectedMacs.filter((m) => m !== mac)
                      setSelectedMacs(next)
                    }}
                  />
                  <span>
                    {b.model ? `${b.model} ` : ''}
                    {b.ip}
                    {` • ${mac}`}
                    {b.online === false ? ' (offline)' : ''}
                  </span>
                </label>
              )
            })}
        </div>
      </div>

      <div className="panel">
        <label className="fieldWide">
          Hue
          <span className="colorPreview" style={{ backgroundColor: rgbToCss(hsbToRgb({ h, s, v })) }} />
          <input
            type="range"
            min={0}
            max={360}
            value={h}
            onChange={(e) => {
              const nextH = clamp(Number(e.target.value), 0, 360)
              setH(nextH)
              setFromH(nextH)
              queueColor({ h: nextH, s, v }, brightness)
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
              queueColor({ h, s: nextS, v }, brightness)
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
              queueColor({ h, s, v: nextV }, brightness)
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
              const vv = Number(e.target.value)
              if (Number.isFinite(vv)) setBrightness(vv)
            }}
            onMouseUp={() => void apply({ h, s, v }, brightness)}
            onTouchEnd={() => void apply({ h, s, v }, brightness)}
          />
          <code>{brightness}</code>
        </label>

        <label className="fieldWide">
          New color
          <span className="colorPreview" style={{ backgroundColor: rgbToCss(hsbToRgb({ h: toH, s: toS, v: toV })) }} />
          <input
            type="color"
            className="colorInput"
            value={rgbToHex(hsbToRgb({ h: toH, s: toS, v: toV }))}
            onChange={(e) => {
              const rgb = hexToRgb(e.target.value)
              if (!rgb) return
              const next = rgbToHsb(rgb)
              setToH(next.h)
              setToS(next.s)
              setToV(next.v)
            }}
          />
          <code>
            {toH} / {toS} / {toV}
          </code>
        </label>

        <label className="fieldWide">
          New hue
          <input type="range" min={0} max={360} value={toH} onChange={(e) => setToH(clamp(Number(e.target.value), 0, 360))} />
          <code>{toH}</code>
        </label>

        <label className="fieldWide">
          New saturation
          <input type="range" min={0} max={100} value={toS} onChange={(e) => setToS(clamp(Number(e.target.value), 0, 100))} />
          <code>{toS}</code>
        </label>

        <label className="fieldWide">
          New brightness
          <input type="range" min={0} max={100} value={toV} onChange={(e) => setToV(clamp(Number(e.target.value), 0, 100))} />
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
      </div>

      <div className="controlsRow" style={{ marginTop: 18 }}>
        <a href="/admin/mood-grid" target="_blank" rel="noreferrer">
          Open admin
        </a>
      </div>

      <h2 style={{ marginTop: 22 }}>Mood Grid</h2>

      <div className="moodGrid" ref={moodGridRef}>
        {Array.from({ length: 9 }).map((_, i) => (
          <button
            key={i}
            type="button"
            className={i + 1 === moodHighlightedIndex ? 'moodCircle moodCircleSelected' : 'moodCircle'}
            style={{
              backgroundColor: moodColors[i] || undefined,
              color: moodColors[i] ? textColorForBg(moodColors[i]) : undefined,
            }}
            onClick={() => {
              setMoodIndex(i + 1)
              setMoodHighlightedIndex(i + 1)
              const current = moodColors[i]
              if (typeof current === 'string' && current) setMoodHex(current)
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
              void fetch(`/api/mood-grid/${moodIndex}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ color: next }),
              }).catch((err) => {
                setStatus(err instanceof Error ? err.message : String(err))
              })
            }}
          />
        </label>

        <button type="button" onClick={assignSelectedBulbToCircle}>
          Assign selected bulb to circle
        </button>

        <button type="button" onClick={applyCircleToAssignedBulb}>
          Apply circle to its bulb
        </button>
      </div>
    </div>
  )
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.round(n)))
}

function hsbToRgb(hsb: { h: number; s: number; v: number }) {
  const hh = ((hsb.h % 360) + 360) % 360
  const ss = clamp(hsb.s, 0, 100) / 100
  const vv = clamp(hsb.v, 0, 100) / 100

  const c = vv * ss
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = vv - c

  let rp = 0
  let gp = 0
  let bp = 0

  if (hh < 60) {
    rp = c
    gp = x
  } else if (hh < 120) {
    rp = x
    gp = c
  } else if (hh < 180) {
    gp = c
    bp = x
  } else if (hh < 240) {
    gp = x
    bp = c
  } else if (hh < 300) {
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

function rgbToHsb(rgb: { r: number; g: number; b: number }) {
  const r = clamp(rgb.r, 0, 255) / 255
  const g = clamp(rgb.g, 0, 255) / 255
  const b = clamp(rgb.b, 0, 255) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }

  const s = max === 0 ? 0 : delta / max
  const v = max

  return {
    h: clamp(h, 0, 360),
    s: clamp(s * 100, 0, 100),
    v: clamp(v * 100, 0, 100),
  }
}

function rgbToCss(rgb: { r: number; g: number; b: number }) {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return null
  const n = Number.parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex(rgb: { r: number; g: number; b: number }) {
  const r = clamp(rgb.r, 0, 255).toString(16).padStart(2, '0')
  const g = clamp(rgb.g, 0, 255).toString(16).padStart(2, '0')
  const b = clamp(rgb.b, 0, 255).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

function textColorForBg(hex: string) {
  const rgb = hexToRgb(hex)
  if (!rgb) return undefined
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255
  return luminance > 0.72 ? '#111827' : undefined
}