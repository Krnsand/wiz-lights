import dgram from 'node:dgram'

import type { RemoteInfo } from 'node:dgram'

export type WizBulb = {
  ip: string
  port: number
  mac?: string
  model?: string
  fwVersion?: string
  rssi?: number
}

const WIZ_PORT = 38899

function createSocket() {
  const sock = dgram.createSocket('udp4')
  sock.unref()
  return sock
}

type UdpResponse = {
  msg: Buffer
  rinfo: RemoteInfo
}

function sendAndCollect(
  message: string,
  {
    target,
    port,
    timeoutMs,
    broadcast,
  }: { target: string; port: number; timeoutMs: number; broadcast?: boolean },
) {
  return new Promise<UdpResponse[]>((resolve, reject) => {
    const sock = createSocket()
    const responses: UdpResponse[] = []

    const done = () => {
      try {
        sock.close()
      } catch {
        // ignore
      }
      resolve(responses)
    }

    sock.on('error', (err: Error) => {
      try {
        sock.close()
      } catch {
        // ignore
      }
      reject(err)
    })

    sock.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
      responses.push({ msg, rinfo })
    })

    sock.bind(0, () => {
      if (broadcast) sock.setBroadcast(true)
      const buf = Buffer.from(message)
      sock.send(buf, port, target)

      setTimeout(done, timeoutMs)
    })
  })
}

export async function discoverBulbs(options?: { timeoutMs?: number }) {
  const timeoutMs = options?.timeoutMs ?? 700
  const payload = JSON.stringify({ method: 'getPilot', params: {} })

  const packets = await sendAndCollect(payload, {
    target: '255.255.255.255',
    port: WIZ_PORT,
    timeoutMs,
    broadcast: true,
  })

  const bulbs: WizBulb[] = []
  const seen = new Set<string>()

  for (const p of packets) {
    try {
      const json = JSON.parse(p.msg.toString('utf8')) as any
      const ip =
        (typeof json?.result?.ip === 'string' ? (json.result.ip as string) : undefined) ??
        (typeof json?.params?.ip === 'string' ? (json.params.ip as string) : undefined) ??
        p.rinfo.address

      if (seen.has(ip)) continue
      seen.add(ip)

      bulbs.push({
        ip,
        port: WIZ_PORT,
        mac: json?.result?.mac,
        model: json?.result?.moduleName,
        fwVersion: json?.result?.fwVersion,
        rssi: json?.result?.rssi,
      })
    } catch {
      // ignore malformed
    }
  }

  return bulbs
}

export async function setColor(options: {
  ip: string
  r: number
  g: number
  b: number
  brightness?: number
}) {
  const brightness = options.brightness ?? 255
  const message = JSON.stringify({
    method: 'setPilot',
    params: {
      state: true,
      r: clampInt(options.r, 0, 255),
      g: clampInt(options.g, 0, 255),
      b: clampInt(options.b, 0, 255),
      dimming: Math.round((clampInt(brightness, 0, 255) / 255) * 100),
    },
  })

  const sock = createSocket()

  await new Promise<void>((resolve, reject) => {
    sock.on('error', (err: Error) => {
      try {
        sock.close()
      } catch {
        // ignore
      }
      reject(err)
    })

    sock.send(Buffer.from(message), WIZ_PORT, options.ip, (err?: Error | null) => {
      try {
        sock.close()
      } catch {
        // ignore
      }
      if (err) reject(err)
      else resolve()
    })
  })
}

export async function setPower(options: { ip: string; on: boolean }) {
  const message = JSON.stringify({
    method: 'setPilot',
    params: {
      state: Boolean(options.on),
    },
  })

  const sock = createSocket()

  await new Promise<void>((resolve, reject) => {
    sock.on('error', (err: Error) => {
      try {
        sock.close()
      } catch {
        // ignore
      }
      reject(err)
    })

    sock.send(Buffer.from(message), WIZ_PORT, options.ip, (err?: Error | null) => {
      try {
        sock.close()
      } catch {
        // ignore
      }
      if (err) reject(err)
      else resolve()
    })
  })
}

export async function animateColor(options: {
  ip: string
  from: { r: number; g: number; b: number }
  to: { r: number; g: number; b: number }
  durationMs: number
  brightness?: number
}) {
  const durationMs = clampInt(options.durationMs, 0, 60_000)
  const tickMs = 50
  const steps = durationMs <= 0 ? 1 : Math.max(1, Math.round(durationMs / tickMs))

  const fromHsv = rgbToHsv(options.from)
  const toHsv = rgbToHsv(options.to)
  const hueDelta = shortestHueDelta(fromHsv.h, toHsv.h)

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 1 : i / steps

    // Match the "Hue" slider behavior:
    // - only interpolate hue (on the shortest arc)
    // - keep S/V stable during the transition to avoid washing out toward white
    // - apply the target S/V only at the final step
    const h = normalizeHue(fromHsv.h + hueDelta * t)
    const s = i === steps ? toHsv.s : fromHsv.s
    const v = i === steps ? toHsv.v : fromHsv.v
    const { r, g, b } = hsvToRgb({ h, s, v })
    await setColor({ ip: options.ip, r, g, b, brightness: options.brightness })

    if (i < steps) {
      await sleep(Math.floor(durationMs / steps))
    }
  }
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.round(n)))
}

function lerpInt(a: number, b: number, t: number) {
  const aa = clampInt(a, 0, 255)
  const bb = clampInt(b, 0, 255)
  const tt = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0
  return Math.round(aa + (bb - aa) * tt)
}

function normalizeHue(h: number) {
  if (!Number.isFinite(h)) return 0
  const x = h % 360
  return x < 0 ? x + 360 : x
}

function shortestHueDelta(from: number, to: number) {
  const a = normalizeHue(from)
  const b = normalizeHue(to)
  // (-180, 180]
  return ((b - a + 540) % 360) - 180
}

function rgbToHsv(rgb: { r: number; g: number; b: number }) {
  const r = clampInt(rgb.r, 0, 255) / 255
  const g = clampInt(rgb.g, 0, 255) / 255
  const b = clampInt(rgb.b, 0, 255) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min

  let h = 0
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  h = normalizeHue(h)

  const s = max === 0 ? 0 : d / max
  const v = max
  return { h, s, v }
}

function hsvToRgb(hsv: { h: number; s: number; v: number }) {
  const h = normalizeHue(hsv.h)
  const s = Number.isFinite(hsv.s) ? Math.max(0, Math.min(1, hsv.s)) : 0
  const v = Number.isFinite(hsv.v) ? Math.max(0, Math.min(1, hsv.v)) : 0

  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

  let rp = 0
  let gp = 0
  let bp = 0

  if (h < 60) {
    rp = c
    gp = x
  } else if (h < 120) {
    rp = x
    gp = c
  } else if (h < 180) {
    gp = c
    bp = x
  } else if (h < 240) {
    gp = x
    bp = c
  } else if (h < 300) {
    rp = x
    bp = c
  } else {
    rp = c
    bp = x
  }

  return {
    r: clampInt((rp + m) * 255, 0, 255),
    g: clampInt((gp + m) * 255, 0, 255),
    b: clampInt((bp + m) * 255, 0, 255),
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
