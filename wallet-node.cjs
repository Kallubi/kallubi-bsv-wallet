const fs = require('fs')
const http = require('http')
const settings = require('./wallet-settings.cjs')

function parseConf(file) {
  const out = {}
  if (!file || !fs.existsSync(file)) return out
  String(fs.readFileSync(file, 'utf8')).split(/\r?\n/).forEach(function (line) {
    const s = line.replace(/#.*$/, '').trim()
    const i = s.indexOf('=')
    if (i < 1) return
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim()
  })
  return out
}

function rpcCfg() {
  const s = settings.load()
  const conf = parseConf(s.rpcConf)
  return {
    host: s.rpcHost || '127.0.0.1',
    port: Number(s.rpcPort || conf.rpcport || 8332),
    user: s.rpcUser || conf.rpcuser || '',
    pass: s.rpcPassword || conf.rpcpassword || ''
  }
}

function rpc(method, params) {
  const cfg = rpcCfg()
  if (!cfg.user || !cfg.pass) {
    return Promise.reject(new Error('RPC user/password missing – check bitcoin.conf'))
  }
  const body = JSON.stringify({ jsonrpc: '1.0', id: 'kallubi', method: method, params: params || [] })
  const auth = Buffer.from(cfg.user + ':' + cfg.pass).toString('base64')
  return new Promise(function (resolve, reject) {
    const req = http.request({
      host: cfg.host,
      port: cfg.port,
      method: 'POST',
      path: '/',
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + auth,
        'Content-Length': Buffer.byteLength(body)
      }
    }, function (res) {
      let data = ''
      res.on('data', function (c) { data += c })
      res.on('end', function () {
        let json
        try { json = JSON.parse(data) } catch (e) {
          reject(new Error('RPC JSON: ' + data.slice(0, 80)))
          return
        }
        if (json.error) reject(new Error(json.error.message || JSON.stringify(json.error)))
        else resolve(json.result)
      })
    })
    req.on('error', reject)
    req.on('timeout', function () { req.destroy(); reject(new Error('RPC timeout')) })
    req.write(body)
    req.end()
  })
}

function available() {
  try {
    const cfg = rpcCfg()
    return !!(cfg.user && cfg.pass)
  } catch (e) { return false }
}

async function getStatus() {
  if (!available()) return { available: false, reason: 'no-rpc-config' }
  try {
    const info = await rpc('getblockchaininfo')
    return {
      available: true,
      blocks: info.blocks,
      headers: info.headers,
      pruned: !!info.pruned,
      chain: info.chain,
      verificationprogress: info.verificationprogress
    }
  } catch (e) {
    return { available: false, reason: e.message }
  }
}

function getBlockCount() {
  return 0
}

async function scanAddress(address) {
  const result = await rpc('scantxoutset', ['start', ['addr(' + address + ')']])
  const unspents = (result && result.unspents) || []
  const sats = Math.round(Number(result && result.total_amount || 0) * 1e8)
  const utxos = unspents.map(function (u) {
    return {
      tx_hash: u.txid,
      tx_pos: u.vout,
      value: Math.round(Number(u.amount) * 1e8),
      height: u.height
    }
  })
  return { confirmed: sats, unconfirmed: 0, utxos: utxos, via: 'node' }
}

async function sendRaw(hex) {
  const txid = await rpc('sendrawtransaction', [hex])
  return { via: 'node', txid: String(txid), body: String(txid) }
}

module.exports = {
  available,
  getStatus,
  getBlockCount,
  scanAddress,
  sendRaw,
  rpc
}
