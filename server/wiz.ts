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

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.round(n)))
}
