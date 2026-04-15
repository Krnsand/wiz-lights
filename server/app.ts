import cors from 'cors'
import express from 'express'

import { apiRouter } from './routes/api'

import type { Request, Response } from 'express'

export const app = express()

app.use(express.json())
app.use(cors({ origin: true }))
app.use('/static', express.static(new URL('./public', import.meta.url).pathname))

app.get('/', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'wiz-api',
    endpoints: {
      health: '/api/health',
    },
  })
})

app.get('/admin/mood-grid', (_req: Request, res: Response) => {
  res.status(200)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>WiZ Mood Grid Admin</title>
    <link rel="stylesheet" href="/static/mood-grid.css" />
  </head>
  <body>
    <main>
      <h1>Mood Grid Admin</h1>
      <p>Edit circle colors</p>

      <div class="row">
        <a href="/api/mood-grid" target="_blank">/api/mood-grid</a>
        <span>·</span>
        <a href="/api/mood-grid/stream" target="_blank">/api/mood-grid/stream</a>
      </div>

      <div id="grid" class="grid"></div>
      <div id="status" class="status"></div>
    </main>

    <script>
      const gridEl = document.getElementById('grid')
      const statusEl = document.getElementById('status')

      function setStatus(text) {
        statusEl.textContent = text
        if (text) setTimeout(() => { if (statusEl.textContent === text) statusEl.textContent = '' }, 4000)
      }

      function normalizeHex(hex) {
        if (typeof hex !== 'string') return ''
        return hex
      }

      function render(colors) {
        gridEl.innerHTML = ''
        for (let i = 0; i < 9; i++) {
          const color = normalizeHex(colors?.[i] ?? '')
          const cell = document.createElement('div')
          cell.className = 'cell'

          const label = document.createElement('strong')
          label.textContent = String(i + 1)
          cell.appendChild(label)

          const input = document.createElement('input')
          input.type = 'color'
          input.value = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#000000'
          input.addEventListener('change', async (e) => {
            const next = e.target.value
            try {
              const res = await fetch('/api/mood-grid/' + (i + 1), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ color: next }),
              })
              if (!res.ok) {
                const t = await res.text().catch(() => '')
                throw new Error(t || 'Request failed (' + res.status + ')')
              }
              setStatus('Set ' + (i + 1) + ' → ' + next)
            } catch (err) {
              setStatus(err && err.message ? err.message : String(err))
            }
          })
          cell.appendChild(input)

          gridEl.appendChild(cell)
        }
      }

      async function load() {
        try {
          const res = await fetch('/api/mood-grid')
          const json = await res.json()
          render(json.colors || [])
        } catch (err) {
          setStatus(err && err.message ? err.message : String(err))
        }
      }

      load()

      const es = new EventSource('/api/mood-grid/stream')
      es.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data)
          render(parsed.colors || [])
        } catch {
        }
      }
      es.onerror = () => {
        setStatus('SSE disconnected. Refresh the page.')
      }
    </script>
  </body>
</html>`)
})

app.use('/api', apiRouter)
