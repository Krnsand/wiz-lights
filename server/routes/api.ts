import { Router } from 'express'

import {
  animateColor,
  discoverBulbs,
  getKnownBulbs,
  getDiscoveryDebugInfo,
  getPilotUnicast,
  probeKnownBulbs,
  setColorByMac,
  setPowerByMac,
} from '../wiz'

import type { Request, Response } from 'express'

export const apiRouter = Router()

let showTimer: NodeJS.Timeout | null = null
let showState:
  | null
  | {
      running: boolean
      mode: 'solid' | 'chase' | 'wave' | 'pulse' | 'solar' | 'aurora' | 'sparkle'
      macs: string[]
      colors: string[]
      intervalMs: number
      step: number
      brightness?: number
    } = null

const moodGrid = Array.from({ length: 9 }, () => '') as string[]
const moodAssignments = Array.from({ length: 9 }, () => null) as Array<
  null | { mac?: string; ip?: string; model?: string }
>
const moodGridStreams = new Set<Response>()

function broadcastMoodGrid() {
  const payload = `data: ${JSON.stringify({ colors: moodGrid })}\n\n`
  for (const res of moodGridStreams) {
    try {
      res.write(payload)
    } catch {
      moodGridStreams.delete(res)
    }
  }
}

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true })
})

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return null
  const n = Number.parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function hslToRgb(h: number, s: number, l: number) {
  const hh = ((h % 360) + 360) % 360
  const ss = Math.max(0, Math.min(1, s))
  const ll = Math.max(0, Math.min(1, l))

  const c = (1 - Math.abs(2 * ll - 1)) * ss
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = ll - c / 2

  let rr = 0
  let gg = 0
  let bb = 0

  if (hh < 60) {
    rr = c
    gg = x
  } else if (hh < 120) {
    rr = x
    gg = c
  } else if (hh < 180) {
    gg = c
    bb = x
  } else if (hh < 240) {
    gg = x
    bb = c
  } else if (hh < 300) {
    rr = x
    bb = c
  } else {
    rr = c
    bb = x
  }

  return {
    r: Math.round((rr + m) * 255),
    g: Math.round((gg + m) * 255),
    b: Math.round((bb + m) * 255),
  }
}

function stopShow() {
  if (showTimer) {
    clearInterval(showTimer)
    showTimer = null
  }
  if (showState) showState.running = false
}

apiRouter.get('/show/status', (_req: Request, res: Response) => {
  res.json({ ok: true, show: showState })
})

apiRouter.post('/show/stop', (_req: Request, res: Response) => {
  stopShow()
  res.json({ ok: true, show: showState })
})

apiRouter.post('/show/start', async (req: Request, res: Response) => {
  const { macs, colors, intervalMs, brightness, mode } = req.body as {
    macs?: unknown
    colors?: unknown
    intervalMs?: unknown
    brightness?: unknown
    mode?: unknown
  }

  if (!Array.isArray(macs) || !macs.every((x) => typeof x === 'string' && x)) {
    res.status(400).json({ error: 'macs must be string[]' })
    return
  }

  const ms = typeof intervalMs === 'number' && Number.isFinite(intervalMs) ? intervalMs : 800
  const safeMs = Math.max(100, Math.min(60_000, Math.round(ms)))
  const bright = typeof brightness === 'number' && Number.isFinite(brightness) ? brightness : undefined
  const showMode: 'solid' | 'chase' | 'wave' | 'pulse' | 'solar' | 'aurora' | 'sparkle' =
    mode === 'solid' ||
    mode === 'chase' ||
    mode === 'wave' ||
    mode === 'pulse' ||
    mode === 'solar' ||
    mode === 'aurora' ||
    mode === 'sparkle'
      ? mode
      : 'chase'

  const rawColors = Array.isArray(colors) ? colors : []
  const usableColors = rawColors
    .filter((c) => typeof c === 'string')
    .map((c) => c.trim())
    .filter((c) => c && hexToRgb(c))

  if ((showMode === 'solid' || showMode === 'chase' || showMode === 'pulse') && usableColors.length === 0) {
    res.status(400).json({ error: 'No valid hex colors provided' })
    return
  }

  const finalColors =
    showMode === 'wave'
      ? ['#0047ff']
      : showMode === 'solar'
        ? ['#ff4500']
        : showMode === 'aurora'
          ? ['#00ff99']
          : showMode === 'sparkle'
            ? usableColors.length
              ? usableColors
              : ['#0033ff', '#ffffff']
      : usableColors.length
        ? usableColors
        : ['#ffffff']

  stopShow()

  showState = {
    running: true,
    mode: showMode,
    macs: macs.slice(),
    colors: finalColors.slice(),
    intervalMs: safeMs,
    step: 0,
    brightness: bright,
  }

  const tick = async () => {
    if (!showState?.running) return
    const step = showState.step
    showState.step++
    const palette = showState.colors
    if (palette.length === 0) return

    if (showState.mode === 'pulse') {
      const base = hexToRgb(palette[0]) ?? { r: 255, g: 255, b: 255 }
      const phase = (step % 64) / 64
      const v = (Math.sin(phase * Math.PI * 2) + 1) / 2
      const dim = 10 + v * 245
      const nextBrightness = Math.round(dim)

      await Promise.allSettled(
        showState.macs.map((mac) =>
          setColorByMac({
            mac,
            r: base.r,
            g: base.g,
            b: base.b,
            brightness: nextBrightness,
          }),
        ),
      )
      return
    }

    if (showState.mode === 'aurora') {
      const waveSpeed = 12
      const waveWidth = Math.max(1, showState.macs.length)

      await Promise.allSettled(
        showState.macs.map((mac, i) => {
          const phase = (step / waveSpeed + i / waveWidth) * Math.PI * 2
          const a = (Math.sin(phase) + 1) / 2
          const b = (Math.sin(phase * 0.5 + 1.3) + 1) / 2

          const baseHue = 135
          const hueSwing = 170
          const hue = baseHue + a * hueSwing
          const sat = 0.85 + b * 0.15
          const light = 0.28 + a * 0.22

          const rgb = hslToRgb(hue, sat, light)
          return setColorByMac({
            mac,
            r: rgb.r,
            g: rgb.g,
            b: rgb.b,
            brightness: showState?.brightness,
          })
        }),
      )
      return
    }

    if (showState.mode === 'sparkle') {
      const baseHex = palette[0] ?? '#0033ff'
      const sparkleHex = palette[1] ?? '#ffffff'
      const base = hexToRgb(baseHex) ?? { r: 0, g: 51, b: 255 }
      const sparkle = hexToRgb(sparkleHex) ?? { r: 255, g: 255, b: 255 }

      const len = showState.macs.length
      if (len === 0) return

      const idx = ((step * 1103515245 + 12345) >>> 0) % len
      const baseBrightness = typeof showState.brightness === 'number' ? showState.brightness : 90

      await Promise.allSettled(
        showState.macs.map((mac, i) =>
          setColorByMac({
            mac,
            r: i === idx ? sparkle.r : base.r,
            g: i === idx ? sparkle.g : base.g,
            b: i === idx ? sparkle.b : base.b,
            brightness: i === idx ? 255 : baseBrightness,
          }),
        ),
      )
      return
    }

    if (showState.mode === 'solar') {
      const waveSpeed = 10
      const waveWidth = Math.max(1, showState.macs.length)

      await Promise.allSettled(
        showState.macs.map((mac, i) => {
          const phase = (step / waveSpeed + i / waveWidth) * Math.PI * 2
          const v = (Math.sin(phase) + 1) / 2

          const hue = 5 + v * 50
          const sat = 1
          const light = 0.35 + v * 0.25

          const rgb = hslToRgb(hue, sat, light)
          return setColorByMac({
            mac,
            r: rgb.r,
            g: rgb.g,
            b: rgb.b,
            brightness: showState?.brightness,
          })
        }),
      )
      return
    }

    if (showState.mode === 'wave') {
      const hue = 210
      const sat = 1
      const waveSpeed = 10
      const waveWidth = Math.max(1, showState.macs.length)

      await Promise.allSettled(
        showState.macs.map((mac, i) => {
          const phase = (step / waveSpeed + i / waveWidth) * Math.PI * 2
          const light = 0.25 + ((Math.sin(phase) + 1) / 2) * 0.35
          const rgb = hslToRgb(hue, sat, light)
          return setColorByMac({
            mac,
            r: rgb.r,
            g: rgb.g,
            b: rgb.b,
            brightness: showState?.brightness,
          })
        }),
      )
      return
    }

    if (showState.mode === 'solid') {
      const rgb = hexToRgb(palette[step % palette.length])
      if (!rgb) return
      await Promise.allSettled(
        showState.macs.map((mac) =>
          setColorByMac({
            mac,
            r: rgb.r,
            g: rgb.g,
            b: rgb.b,
            brightness: showState?.brightness,
          }),
        ),
      )
      return
    }

    await Promise.allSettled(
      showState.macs.map((mac, i) => {
        const hex = palette[(step + i) % palette.length]
        const rgb = hexToRgb(hex)
        if (!rgb) return Promise.resolve()
        return setColorByMac({
          mac,
          r: rgb.r,
          g: rgb.g,
          b: rgb.b,
          brightness: showState?.brightness,
        })
      }),
    )
  }

  await tick()
  showTimer = setInterval(() => {
    void tick()
  }, safeMs)

  res.json({ ok: true, show: showState })
})

apiRouter.get('/mood-grid', (_req: Request, res: Response) => {
  res.json({ colors: moodGrid })
})

apiRouter.get('/mood-assignments', (_req: Request, res: Response) => {
  res.json({ assignments: moodAssignments })
})

apiRouter.put('/mood-assignments/:index', (req: Request, res: Response) => {
  const index = Number(req.params.index)
  const { mac, ip, model } = req.body as { mac?: unknown; ip?: unknown; model?: unknown }

  if (!Number.isFinite(index) || index < 1 || index > 9) {
    res.status(400).json({ error: 'index must be 1..9' })
    return
  }

  const next = {
    mac: typeof mac === 'string' && mac ? mac : undefined,
    ip: typeof ip === 'string' && ip ? ip : undefined,
    model: typeof model === 'string' && model ? model : undefined,
  }

  moodAssignments[index - 1] = next.mac || next.ip || next.model ? next : null
  res.json({ ok: true, assignments: moodAssignments })
})

apiRouter.get('/mood-grid/stream', (req: Request, res: Response) => {
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  moodGridStreams.add(res)
  res.write(`data: ${JSON.stringify({ colors: moodGrid })}\n\n`)

  req.on('close', () => {
    moodGridStreams.delete(res)
  })
})

apiRouter.put('/mood-grid/:index', (req: Request, res: Response) => {
  const index = Number(req.params.index)
  const { color } = req.body as { color?: string }

  if (!Number.isFinite(index) || index < 1 || index > 9) {
    res.status(400).json({ error: 'index must be 1..9' })
    return
  }

  if (typeof color !== 'string') {
    res.status(400).json({ error: 'Missing color (string)' })
    return
  }

  moodGrid[index - 1] = color
  broadcastMoodGrid()
  res.json({ ok: true, colors: moodGrid })
})

apiRouter.get('/bulbs', async (req: Request, res: Response) => {
  const timeoutMs = req.query.timeoutMs ? Number(req.query.timeoutMs) : undefined
  const discover = String(req.query.discover ?? '') === '1'
  const probe = String(req.query.probe ?? '') === '1'
  try {
    if (discover) {
      await discoverBulbs({ timeoutMs })
    }
    if (probe) {
      await probeKnownBulbs({ timeoutMs })
    }
    const bulbs = getKnownBulbs()
    res.json({ bulbs })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

apiRouter.post('/color/bulk', async (req: Request, res: Response) => {
  const { macs, r, g, b, brightness } = req.body as {
    macs?: unknown
    r?: number
    g?: number
    b?: number
    brightness?: number
  }

  const fast = String(req.query.fast ?? '') === '1'

  if (!Array.isArray(macs) || !macs.every((x) => typeof x === 'string' && x)) {
    res.status(400).json({ error: 'macs must be string[]' })
    return
  }

  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') {
    res.status(400).json({ error: 'Missing r/g/b (numbers)' })
    return
  }

  if (fast) {
    void Promise.allSettled(macs.map((mac) => setColorByMac({ mac, r, g, b, brightness })))
    res.json({ ok: true })
    return
  }

  const results = await Promise.allSettled(macs.map((mac) => setColorByMac({ mac, r, g, b, brightness })))

  res.json({
    ok: true,
    results: results.map((r, i) => ({
      mac: macs[i],
      ok: r.status === 'fulfilled',
      error: r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : undefined,
    })),
  })
})

apiRouter.get('/bulbs/debug', (_req: Request, res: Response) => {
  res.json(getDiscoveryDebugInfo())
})

apiRouter.get('/bulbs/pilot', async (req: Request, res: Response) => {
  const ip = String(req.query.ip ?? '')
  if (!ip) {
    res.status(400).json({ error: 'Missing ip query param' })
    return
  }

  try {
    const result = await getPilotUnicast({ ip })
    res.json({ ip, result })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

apiRouter.post('/color', async (req: Request, res: Response) => {
  const { mac, r, g, b, brightness } = req.body as {
    mac?: string
    r?: number
    g?: number
    b?: number
    brightness?: number
  }

  const fast = String(req.query.fast ?? '') === '1'

  if (!mac || typeof mac !== 'string') {
    res.status(400).json({ error: 'Missing mac' })
    return
  }

  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') {
    res.status(400).json({ error: 'Missing r/g/b (numbers)' })
    return
  }

  try {
    if (fast) {
      void setColorByMac({ mac, r, g, b, brightness }).catch(() => undefined)
      res.json({ ok: true })
      return
    }

    await setColorByMac({ mac, r, g, b, brightness })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

apiRouter.post('/power', async (req: Request, res: Response) => {
  const { mac, on } = req.body as {
    mac?: string
    on?: boolean
  }

  if (!mac || typeof mac !== 'string') {
    res.status(400).json({ error: 'Missing mac' })
    return
  }

  if (typeof on !== 'boolean') {
    res.status(400).json({ error: 'Missing on (boolean)' })
    return
  }

  try {
    await setPowerByMac({ mac, on })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

apiRouter.post('/power/bulk', async (req: Request, res: Response) => {
  const { macs, on } = req.body as {
    macs?: unknown
    on?: unknown
  }

  if (!Array.isArray(macs) || !macs.every((x) => typeof x === 'string' && x)) {
    res.status(400).json({ error: 'macs must be string[]' })
    return
  }

  if (typeof on !== 'boolean') {
    res.status(400).json({ error: 'Missing on (boolean)' })
    return
  }

  const results = await Promise.allSettled(macs.map((mac) => setPowerByMac({ mac, on })))

  res.json({
    ok: true,
    results: results.map((r, i) => ({
      mac: macs[i],
      ok: r.status === 'fulfilled',
      error: r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : undefined,
    })),
  })
})

apiRouter.post('/animate/bulk', async (req: Request, res: Response) => {
  const { macs, from, to, durationMs, brightness } = req.body as {
    macs?: unknown
    from?: { r?: number; g?: number; b?: number }
    to?: { r?: number; g?: number; b?: number }
    durationMs?: number
    brightness?: number
  }

  if (!Array.isArray(macs) || !macs.every((x) => typeof x === 'string' && x)) {
    res.status(400).json({ error: 'macs must be string[]' })
    return
  }

  if (!from || !to) {
    res.status(400).json({ error: 'Missing from/to' })
    return
  }

  if (typeof from.r !== 'number' || typeof from.g !== 'number' || typeof from.b !== 'number') {
    res.status(400).json({ error: 'Missing from r/g/b (numbers)' })
    return
  }

  if (typeof to.r !== 'number' || typeof to.g !== 'number' || typeof to.b !== 'number') {
    res.status(400).json({ error: 'Missing to r/g/b (numbers)' })
    return
  }

  if (typeof durationMs !== 'number') {
    res.status(400).json({ error: 'Missing durationMs (number)' })
    return
  }

  const bulbByMac = new Map(getKnownBulbs().map((b) => [b.mac.toLowerCase(), b]))

  const tasks = macs.map(async (mac) => {
    const bulb = bulbByMac.get(mac.toLowerCase())
    if (!bulb?.ip || bulb.online === false) {
      throw new Error(`No online bulb found for MAC ${mac}`)
    }
    await animateColor({
      ip: bulb.ip,
      from: { r: from.r as number, g: from.g as number, b: from.b as number },
      to: { r: to.r as number, g: to.g as number, b: to.b as number },
      durationMs,
      brightness,
    })
  })

  const results = await Promise.allSettled(tasks)

  res.json({
    ok: true,
    results: results.map((r, i) => ({
      mac: macs[i],
      ok: r.status === 'fulfilled',
      error: r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : undefined,
    })),
  })
})

apiRouter.post('/animate', async (req: Request, res: Response) => {
  const { ip, from, to, durationMs, brightness } = req.body as {
    ip?: string
    from?: { r?: number; g?: number; b?: number }
    to?: { r?: number; g?: number; b?: number }
    durationMs?: number
    brightness?: number
  }

  if (!ip || typeof ip !== 'string') {
    res.status(400).json({ error: 'Missing ip' })
    return
  }

  if (!from || !to) {
    res.status(400).json({ error: 'Missing from/to' })
    return
  }

  if (typeof from.r !== 'number' || typeof from.g !== 'number' || typeof from.b !== 'number') {
    res.status(400).json({ error: 'Missing from r/g/b (numbers)' })
    return
  }

  if (typeof to.r !== 'number' || typeof to.g !== 'number' || typeof to.b !== 'number') {
    res.status(400).json({ error: 'Missing to r/g/b (numbers)' })
    return
  }

  if (typeof durationMs !== 'number') {
    res.status(400).json({ error: 'Missing durationMs (number)' })
    return
  }

  try {
    await animateColor({
      ip,
      from: { r: from.r, g: from.g, b: from.b },
      to: { r: to.r, g: to.g, b: to.b },
      durationMs,
      brightness,
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})