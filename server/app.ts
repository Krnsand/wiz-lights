import cors from 'cors'
import express from 'express'

import { apiRouter } from './routes/api'

export const app = express()

app.use(express.json())
app.use(cors({ origin: true }))

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'wiz-api',
    endpoints: {
      health: '/api/health',
    },
  })
})

app.use('/api', apiRouter)
