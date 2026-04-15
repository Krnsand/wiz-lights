import dgram from 'node:dgram'
import os from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'

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

export type KnownBulb = {
  mac: string
  ip: string
  model?: string
  lastSeenAt: number
  rssi?: number
  online: boolean
  networkId?: string
}

const bulbCache = new Map<string, KnownBulb>()

const registryFilePath = new URL('./bulb-registry.json', import.meta.url).pathname
let persistTimer: NodeJS.Timeout | null = null

function getNetworkIdFromIp(ip: string) {
  const parts = ip.split('.').map((x) => Number(x))
  if (parts.length !== 4) return undefined
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return undefined
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
}

async function loadRegistryFromDisk() {
  try {
    const raw = await readFile(registryFilePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const mac = typeof (item as any).mac === 'string' ? (item as any).mac : ''
      const ip = typeof (item as any).ip === 'string' ? (item as any).ip : ''
      if (!mac || !ip) continue
      const key = normalizeMac(mac)
      bulbCache.set(key, {
        mac,
        ip,
        model: typeof (item as any).model === 'string' ? (item as any).model : undefined,
        rssi: typeof (item as any).rssi === 'number' ? (item as any).rssi : undefined,
        lastSeenAt: typeof (item as any).lastSeenAt === 'number' ? (item as any).lastSeenAt : 0,
        online: typeof (item as any).online === 'boolean' ? (item as any).online : false,
        networkId: typeof (item as any).networkId === 'string' ? (item as any).networkId : undefined,
      })
    }
  } catch {
    // ignore
  }
}

void loadRegistryFromDisk()

function schedulePersistRegistry() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    const snapshot = Array.from(bulbCache.values())
    void writeFile(registryFilePath, JSON.stringify(snapshot, null, 2), 'utf8').catch(() => undefined)
  }, 200)
}

function normalizeMac(mac: string) {
  return mac.toLowerCase().replace(/[^a-f0-9]/g, '')
}

export function getKnownBulbs(): KnownBulb[] {
  return Array.from(bulbCache.values())
}

export async function probeKnownBulbs(options?: { timeoutMs?: number }) {
  const timeoutMs = options?.timeoutMs ?? 700
  const now = Date.now()

  const bulbs = Array.from(bulbCache.values())
  const tasks = bulbs
    .filter((b) => b.ip)
    .map(async (b) => {
      const key = normalizeMac(b.mac)
      const ok = await getPilotUnicast({ ip: b.ip, timeoutMs })
      const current = bulbCache.get(key)
      if (!current) return
      if (ok) {
        bulbCache.set(key, {
          ...current,
          online: true,
          lastSeenAt: now,
          networkId: getNetworkIdFromIp(current.ip) ?? current.networkId,
        })
      } else {
        bulbCache.set(key, { ...current, online: false })
      }
    })

  await Promise.allSettled(tasks)
  schedulePersistRegistry()
}

function getKnownBulbByMac(mac: string) {
  const key = normalizeMac(mac)
  return { key, bulb: bulbCache.get(key) ?? null }
}

function markKnownBulbOffline(mac: string) {
  const { key, bulb } = getKnownBulbByMac(mac)
  if (!bulb) return
  bulbCache.set(key, { ...bulb, online: false })
  schedulePersistRegistry()
}

function markKnownBulbOnline(mac: string, patch: { ip: string; model?: string; rssi?: number }) {
  const { key, bulb } = getKnownBulbByMac(mac)
  const now = Date.now()
  const networkId = getNetworkIdFromIp(patch.ip)
  if (!bulb) {
    bulbCache.set(key, {
      mac,
      ip: patch.ip,
      model: patch.model,
      rssi: patch.rssi,
      lastSeenAt: now,
      online: true,
      networkId,
    })
    schedulePersistRegistry()
    return
  }
  bulbCache.set(key, {
    ...bulb,
    ip: patch.ip,
    model: patch.model ?? bulb.model,
    rssi: patch.rssi ?? bulb.rssi,
    lastSeenAt: now,
    online: true,
    networkId: networkId ?? bulb.networkId,
  })
  schedulePersistRegistry()
}

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
    bindAddress,
    port,
    timeoutMs,
    broadcast,
  }: {
    target: string
    bindAddress?: string
    port: number
    timeoutMs: number
    broadcast?: boolean
  },
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

    const onBound = () => {
      if (broadcast) sock.setBroadcast(true)
      const buf = Buffer.from(message)
      sock.send(buf, port, target)

      setTimeout(done, timeoutMs)
    }

    if (bindAddress) sock.bind(0, bindAddress, onBound)
    else sock.bind(0, onBound)
  })
}

export async function discoverBulbs(options?: { timeoutMs?: number }) {
  const timeoutMs = options?.timeoutMs ?? 1500
  const payload = JSON.stringify({ method: 'getPilot', params: {} })

  const targets = getDiscoveryTargets()
  const packets = (
    await Promise.all(
      targets.map((target) =>
        sendAndCollect(payload, {
          target: target.target,
          bindAddress: target.bindAddress,
          port: WIZ_PORT,
          timeoutMs,
          broadcast: true,
        }),
      ),
    )
  ).flat()

  const bulbs: WizBulb[] = []
  const seen = new Set<string>()

  for (const p of packets) {
    try {
      const json = JSON.parse(p.msg.toString('utf8')) as any
      const ip = p.rinfo.address

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

  const validated: WizBulb[] = []
  for (const bulb of bulbs) {
    const ok = await getPilotUnicast({ ip: bulb.ip, timeoutMs: 900 })
    if (ok) validated.push(bulb)
  }

  const finalBulbs = validated.length > 0 ? validated : bulbs

  const now = Date.now()
  const seenThisRun = new Set<string>()

  for (const bulb of finalBulbs) {
    if (!bulb.mac) continue
    const key = normalizeMac(bulb.mac)
    seenThisRun.add(key)

    const existing = bulbCache.get(key)
    bulbCache.set(key, {
      mac: bulb.mac,
      ip: bulb.ip,
      model: bulb.model ?? existing?.model,
      rssi: bulb.rssi ?? existing?.rssi,
      lastSeenAt: now,
      online: true,
      networkId: getNetworkIdFromIp(bulb.ip) ?? existing?.networkId,
    })
  }

  for (const [key, entry] of bulbCache.entries()) {
    if (seenThisRun.has(key)) continue
    bulbCache.set(key, { ...entry, online: false })
  }

  schedulePersistRegistry()

  return finalBulbs
}

type DiscoveryTarget = {
  target: string
  bindAddress?: string
}

export function getDiscoveryDebugInfo() {
  const ifaces = os.networkInterfaces()
  const targets = getDiscoveryTargets()
  return { ifaces, targets }
}

function getDiscoveryTargets(): DiscoveryTarget[] {
  const results: DiscoveryTarget[] = []
  const seen = new Set<string>()

  const add = (t: DiscoveryTarget) => {
    const key = `${t.bindAddress ?? ''}|${t.target}`
    if (seen.has(key)) return
    seen.add(key)
    results.push(t)
  }

  add({ target: '255.255.255.255' })

  const ifaces = os.networkInterfaces()
  for (const infos of Object.values(ifaces)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4') continue
      if (info.internal) continue
      if (!info.address || !info.netmask) continue

      const b = ipv4Broadcast(info.address, info.netmask)
      if (!b) continue

      // Bind to the interface address so replies come back on the right interface.
      add({ target: b, bindAddress: info.address })
    }
  }

  return results
}

function ipv4Broadcast(ip: string, netmask: string) {
  const ipInt = ipv4ToInt(ip)
  const maskInt = ipv4ToInt(netmask)
  if (ipInt === null || maskInt === null) return null
  const bcast = (ipInt | (~maskInt >>> 0)) >>> 0
  return intToIpv4(bcast)
}

function ipv4ToInt(ip: string) {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4) return null
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function intToIpv4(n: number) {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`
}

function pickBindAddressForTargetIp(targetIp: string) {
  const dest = ipv4ToInt(targetIp)
  if (dest === null) return undefined

  const ifaces = os.networkInterfaces()
  for (const infos of Object.values(ifaces)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4') continue
      if (info.internal) continue
      if (!info.address || !info.netmask) continue

      const ipInt = ipv4ToInt(info.address)
      const maskInt = ipv4ToInt(info.netmask)
      if (ipInt === null || maskInt === null) continue

      if (((ipInt & maskInt) >>> 0) === ((dest & maskInt) >>> 0)) {
        return info.address
      }
    }
  }

  return undefined
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
  const bindAddress = pickBindAddressForTargetIp(options.ip)

  await new Promise<void>((resolve, reject) => {
    sock.on('error', (err: Error) => {
      try {
        sock.close()
      } catch {
        // ignore
      }
      reject(err)
    })

    const sendNow = () => {
      sock.send(Buffer.from(message), WIZ_PORT, options.ip, (err?: Error | null) => {
        try {
          sock.close()
        } catch {
          // ignore
        }
        if (err) {
          const e = err as Error & { code?: string }
          reject(
            new Error(
              `send ${e.code ?? 'ERROR'} ${options.ip}:${WIZ_PORT} (bind ${bindAddress ?? 'default'}): ${e.message}`,
            ),
          )
          return
        }
        else resolve()
      })
    }

    sock.bind(0, bindAddress ?? '0.0.0.0', sendNow)
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
  const bindAddress = pickBindAddressForTargetIp(options.ip)

  await new Promise<void>((resolve, reject) => {
    sock.on('error', (err: Error) => {
      try {
        sock.close()
      } catch {
        // ignore
      }
      reject(err)
    })

    const sendNow = () => {
      sock.send(Buffer.from(message), WIZ_PORT, options.ip, (err?: Error | null) => {
        try {
          sock.close()
        } catch {
          // ignore
        }
        if (err) {
          const e = err as Error & { code?: string }
          reject(
            new Error(
              `send ${e.code ?? 'ERROR'} ${options.ip}:${WIZ_PORT} (bind ${bindAddress ?? 'default'}): ${e.message}`,
            ),
          )
          return
        }
        else resolve()
      })
    }

    sock.bind(0, bindAddress ?? '0.0.0.0', sendNow)
  })
}

export async function getPilotUnicast(options: { ip: string; timeoutMs?: number }) {
  const timeoutMs = options.timeoutMs ?? 800
  const payload = JSON.stringify({ method: 'getPilot', params: {} })
  const bindAddress = pickBindAddressForTargetIp(options.ip)

  let packets: Awaited<ReturnType<typeof sendAndCollect>>
  try {
    packets = await sendAndCollect(payload, {
      target: options.ip,
      bindAddress,
      port: WIZ_PORT,
      timeoutMs,
      broadcast: false,
    })
  } catch {
    return null
  }

  for (const p of packets) {
    try {
      return JSON.parse(p.msg.toString('utf8')) as unknown
    } catch {
      // ignore
    }
  }

  return null
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

export async function setPowerByMac(options: {
  mac: string
  on: boolean
  timeoutMs?: number
}) {
  const timeoutMs = options.timeoutMs ?? 3000
  const cached = getKnownBulbByMac(options.mac).bulb

  if (cached?.ip) {
    try {
      await setPower({ ip: cached.ip, on: options.on })
      markKnownBulbOnline(options.mac, { ip: cached.ip, model: cached.model, rssi: cached.rssi })
      return { ip: cached.ip, port: WIZ_PORT, mac: cached.mac, model: cached.model, rssi: cached.rssi } satisfies WizBulb
    } catch {
      // fall through to discovery retry
    }
  }

  await discoverBulbs({ timeoutMs })
  const refreshed = getKnownBulbByMac(options.mac).bulb
  if (!refreshed?.ip || !refreshed.online) {
    markKnownBulbOffline(options.mac)
    throw new Error(`No online WiZ bulb found for MAC ${options.mac}`)
  }

  try {
    await setPower({ ip: refreshed.ip, on: options.on })
    markKnownBulbOnline(options.mac, { ip: refreshed.ip, model: refreshed.model, rssi: refreshed.rssi })
    return { ip: refreshed.ip, port: WIZ_PORT, mac: refreshed.mac, model: refreshed.model, rssi: refreshed.rssi } satisfies WizBulb
  } catch (err) {
    markKnownBulbOffline(options.mac)
    throw err
  }
}

export async function setColorByMac(options: {
  mac: string
  r: number
  g: number
  b: number
  brightness?: number
  timeoutMs?: number
}) {
  const timeoutMs = options.timeoutMs ?? 3000
  const cached = getKnownBulbByMac(options.mac).bulb

  if (cached?.ip) {
    try {
      await setColor({
        ip: cached.ip,
        r: options.r,
        g: options.g,
        b: options.b,
        brightness: options.brightness,
      })
      markKnownBulbOnline(options.mac, { ip: cached.ip, model: cached.model, rssi: cached.rssi })
      return { ip: cached.ip, port: WIZ_PORT, mac: cached.mac, model: cached.model, rssi: cached.rssi } satisfies WizBulb
    } catch {
      // fall through to discovery retry
    }
  }

  await discoverBulbs({ timeoutMs })
  const refreshed = getKnownBulbByMac(options.mac).bulb
  if (!refreshed?.ip || !refreshed.online) {
    markKnownBulbOffline(options.mac)
    throw new Error(`No online WiZ bulb found for MAC ${options.mac}`)
  }

  try {
    await setColor({
      ip: refreshed.ip,
      r: options.r,
      g: options.g,
      b: options.b,
      brightness: options.brightness,
    })
    markKnownBulbOnline(options.mac, { ip: refreshed.ip, model: refreshed.model, rssi: refreshed.rssi })
    return { ip: refreshed.ip, port: WIZ_PORT, mac: refreshed.mac, model: refreshed.model, rssi: refreshed.rssi } satisfies WizBulb
  } catch (err) {
    markKnownBulbOffline(options.mac)
    throw err
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


