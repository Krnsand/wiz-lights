import { app } from './app'

const PORT = process.env.PORT ? Number(process.env.PORT) : 5174
app.listen(PORT, () => {
  console.log(`WiZ API server listening on http://localhost:${PORT}`)
})
