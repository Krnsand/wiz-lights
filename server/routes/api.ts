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
  const { macs, colors, intervalMs, brightness } = req.body as {
    macs?: unknown
    colors?: unknown
    intervalMs?: unknown
    brightness?: unknown
  }

  if (!Array.isArray(macs) || !macs.every((x) => typeof x === 'string' && x)) {
    res.status(400).json({ error: 'macs must be string[]' })
    return
  }
  if (!Array.isArray(colors) || !colors.every((x) => typeof x === 'string')) {
    res.status(400).json({ error: 'colors must be string[]' })
    return
  }

  const ms = typeof intervalMs === 'number' && Number.isFinite(intervalMs) ? intervalMs : 800
  const safeMs = Math.max(100, Math.min(60_000, Math.round(ms)))
  const bright = typeof brightness === 'number' && Number.isFinite(brightness) ? brightness : undefined

  const usableColors = colors.filter((c) => typeof c === 'string' && c.trim() && hexToRgb(c.trim()))
  if (usableColors.length === 0) {
    res.status(400).json({ error: 'No valid hex colors provided' })
    return
  }

  stopShow()

  showState = {
    running: true,
    macs: macs.slice(),
    colors: usableColors.slice(),
    intervalMs: safeMs,
    step: 0,
    brightness: bright,
  }

  const tick = async () => {
    if (!showState?.running) return
    const color = showState.colors[showState.step % showState.colors.length]
    showState.step++
    const rgb = hexToRgb(color)
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