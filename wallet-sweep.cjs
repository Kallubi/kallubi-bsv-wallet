const fs = require('fs')
const path = require('path')
const os = require('os')
const derive = require('./wallet-derive.cjs')
const core = require('./wallet-core.cjs')
const DIR = path.join(os.homedir(), '.kallubi-bsv-wallet')
const GAP = 20
const FULL_RECV = 149
const FULL_CHANGE = 29

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }
function netOf(s) { return (s === 'main' || s === 'mainnet') ? 'main' : 'test' }
function fileOf(id) {
  return path.join(DIR, 'hdcache-' + String(id || 'x').replace(/[^a-zA-Z0-9_-]/g, '') + '.json')
}
function loadDisk(id) {
  try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')).rows || [] } catch (e) { return [] }
}
function saveDisk(id, rows) {
  try {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(fileOf(id), JSON.stringify({
      t: Date.now(),
      rows: rows.map(function (r) { return { address: r.address, path: r.path, sats: r.sats } })
    }))
  } catch (e) {}
}
function sumRows(rows) {
  return (rows || []).reduce(function (s, r) { return s + Number(r.sats || 0) }, 0)
}
function mergeRows() {
  const m = new Map()
  for (let a = 0; a < arguments.length; a++) {
    (arguments[a] || []).forEach(function (r) {
      if (!r || !r.address) return
      const prev = m.get(r.address)
      if (!prev || Number(r.sats || 0) > Number(prev.sats || 0)) m.set(r.address, r)
    })
  }
  return Array.from(m.values()).filter(function (r) { return Number(r.sats || 0) > 0 })
}
function idxOf(p, chain) {
  const re = new RegExp("^m/44'/0'/0'/" + chain + "/(\\d+)$")
  const m = String(p || '').match(re)
  return m ? Number(m[1]) : -1
}
function scanPaths(disk) {
  let max0 = -1
  let max1 = -1
  ;(disk || []).forEach(function (r) {
    const a = idxOf(r.path, 0)
    const b = idxOf(r.path, 1)
    if (a > max0) max0 = a
    if (b > max1) max1 = b
  })
  const deep = !(disk && disk.length)
  const last0 = deep ? FULL_RECV : Math.min(FULL_RECV, Math.max(max0, 0) + GAP)
  const last1 = deep ? FULL_CHANGE : Math.min(FULL_CHANGE, Math.max(max1, 0) + GAP)
  const out = []
  for (let i = 0; i <= last0; i++) out.push("m/44'/0'/0'/0/" + i)
  for (let i = 0; i <= last1; i++) out.push("m/44'/0'/0'/1/" + i)
  return out
}
async function listUtxosRetry(address, net) {
  let last = null
  for (let t = 0; t < 4; t++) {
    try { return await core.listUtxos(address, net) }
    catch (e) {
      last = e
      await sleep(400 * (t + 1))
    }
  }
  if (last) throw last
  return []
}

async function fundsForSession(session) {
  if (!session) return []
  const net = netOf(session.network)
  const id = session.id || session.address || 'none'
  const disk = loadDisk(id)
  const seen = new Set()
  const live = []

  async function add(label, priv, address) {
    if (!address || seen.has(address)) return
    seen.add(address)
    let utxos = null
    try {
      utxos = await listUtxosRetry(address, net)
    } catch (e) {
      const cached = disk.filter(function (r) { return r.address === address })
      if (cached.length && Number(cached[0].sats) > 0 && priv) {
        live.push({ address: address, path: label, priv: priv, utxos: [], sats: Number(cached[0].sats) })
      }
      return
    }
    const sats = (utxos || []).reduce(function (s, u) { return s + Number(u.value || 0) }, 0)
    if (sats > 0 && priv) live.push({ address: address, path: label, priv: priv, utxos: utxos, sats: sats })
  }

  if (session.priv && session.address) {
    await add(session.derivationPath || 'session', session.priv, session.address)
  }
  if (session.mnemonic) {
    try {
      const k = derive.deriveKallubi(session.mnemonic, session.passphrase || '', net)
      await add('kallubi', k.priv, k.address)
    } catch (e) {}
    const mode = String(session.derivationMode || session.derivationPath || '')
    const hasBipDisk = disk.some(function (r) { return String(r.path || '').indexOf('m/') === 0 })
    const kallubiOnly = (mode === 'kallubi' || mode === '') && !hasBipDisk
    if (!kallubiOnly) {
      const paths = scanPaths(disk)
      for (let i = 0; i < paths.length; i++) {
        const pth = paths[i]
        try {
          const d = derive.deriveBip32(session.mnemonic, session.passphrase || '', pth, net)
          await add(pth, d.priv, d.address)
        } catch (e) {}
      }
    }
  }

  const merged = mergeRows(disk, live)
  if (sumRows(merged) >= sumRows(disk)) saveDisk(id, merged)
  return merged.map(function (r) {
    if (r.priv) return r
    try {
      if (r.path === 'kallubi' && session.mnemonic) {
        const d = derive.deriveKallubi(session.mnemonic, session.passphrase || '', net)
        return { address: d.address, path: r.path, priv: d.priv, utxos: r.utxos || [], sats: r.sats }
      }
      if (String(r.path || '').indexOf('m/') === 0 && session.mnemonic) {
        const d = derive.deriveBip32(session.mnemonic, session.passphrase || '', r.path, net)
        return { address: d.address, path: r.path, priv: d.priv, utxos: r.utxos || [], sats: r.sats }
      }
    } catch (e) {}
    return r
  }).filter(function (r) { return r.priv && r.sats > 0 })
}

function sumSources(sources) {
  return {
    addresses: (sources || []).length,
    sats: (sources || []).reduce(function (s, x) { return s + (x.sats || 0) }, 0)
  }
}
function peekSession(session) {
  if (!session) return { sats: 0, addresses: 0 }
  const ids = [session.id, session.address].filter(Boolean)
  var best = { sats: 0, addresses: 0, address: session.address }
  ids.forEach(function (id) {
    const disk = loadDisk(id)
    const sats = sumRows(disk)
    if (sats > best.sats) best = { sats: sats, addresses: disk.length, address: session.address }
  })
  return best
}
module.exports = {
  peekSession,
  fundsForSession,
  collectSources: fundsForSession,
  sumSources,
  electrumPaths: function () { return scanPaths([]) },
  resetCache: function () {}
}
