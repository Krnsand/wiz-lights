import cors from 'cors'
import express from 'express'
import { discoverBulbs, setColor } from './wiz'

import type { Request, Response } from 'express'

const app = express()
app.use(express.json())
app.use(cors({ origin: true }))

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true })
})

app.get('/api/bulbs', async (req: Request, res: Response) => {
  const timeoutMs = req.query.timeoutMs ? Number(req.query.timeoutMs) : undefined
  try {
    const bulbs = await discoverBulbs({ timeoutMs })
    res.json({ bulbs })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/color', async (req: Request, res: Response) => {
  const { ip, r, g, b, brightness } = req.body as {
    ip?: string
    r?: number
    g?: number
    b?: number
    brightness?: number
  }

  if (!ip || typeof ip !== 'string') {
    res.status(400).json({ error: 'Missing ip' })
    return
  }

  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') {
    res.status(400).json({ error: 'Missing r/g/b (numbers)' })
    return
  }

  try {
    await setColor({ ip, r, g, b, brightness })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

const PORT = process.env.PORT ? Number(process.env.PORT) : 5174
app.listen(PORT, () => {
  console.log(`WiZ API server listening on http://localhost:${PORT}`)
})
