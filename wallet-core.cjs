const { P2PKH, Transaction } = require('@bsv/sdk')
const settings = require('./wallet-settings.cjs')

function wocBase(network) {
  return network === 'main'
    ? 'https://api.whatsonchain.com/v1/bsv/main'
    : 'https://api.whatsonchain.com/v1/bsv/test'
}

const KALLUBI_BROADCAST = 'https://status.kallubi-bsv-explorer.de/broadcast'

async function getJson(url) {
  const res = await fetch(url)
  const text = await res.text()
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + text.slice(0, 120))
  try { return JSON.parse(text) }
  catch (e) { throw new Error('JSON: ' + text.slice(0, 80)) }
}

async function getBalance(address, network) {
  if (!address) throw new Error('No address')
  const WOC = wocBase(network || 'test')
  const conf = await getJson(WOC + '/address/' + address + '/confirmed/balance')
  const unconf = await getJson(WOC + '/address/' + address + '/unconfirmed/balance')
  return {
    confirmed: Number(conf && conf.confirmed) || 0,
    unconfirmed: Number(unconf && unconf.unconfirmed) || 0
  }
}

async function listUtxos(address, network) {
  if (!address) throw new Error('No address')
  const WOC = wocBase(network || 'test')
  const data = await getJson(WOC + '/address/' + address + '/unspent/all')
  const list = Array.isArray(data) ? data : (Array.isArray(data && data.result) ? data.result : [])
  return list.filter(function (u) { return u && !u.isSpentInMempoolTx })
}

async function broadcastKallubi(raw) {
  const res = await fetch(KALLUBI_BROADCAST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: raw })
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (e) { json = null }
  if (!res.ok) throw new Error((json && json.error) || text.slice(0, 160) || ('HTTP ' + res.status))
  return {
    via: 'kallubi',
    txid: (json && (json.txid || json.result)) || String(text).replace(/^"|"$/g, ''),
    body: text
  }
}

async function broadcastWoc(raw, network) {
  const WOC = wocBase(network)
  const res = await fetch(WOC + '/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: raw })
  })
  const body = await res.text()
  if (!res.ok) throw new Error('Broadcast fehlgeschlagen: ' + body)
  return { via: 'woc', txid: body.replace(/^"|"$/g, ''), body: body }
}

async function broadcastRaw(raw, network) {
  const src = (settings.load().source || 'auto')
  if (network === 'main' && src === 'node') {
    const nodeMod = require('./wallet-node.cjs')
    return nodeMod.sendRaw(raw)
  }
  if (network === 'main' && src === 'auto') {
    try {
      const nodeMod = require('./wallet-node.cjs')
      return await nodeMod.sendRaw(raw)
    } catch (e) { /* explorer / WOC */ }
  }
  if (network === 'main') {
    try { return await broadcastKallubi(raw) } catch (e) { /* WOC fallback */ }
  }
  return broadcastWoc(raw, network)
}

function normRecipients(opts) {
  const list = []
  if (Array.isArray(opts.recipients)) {
    opts.recipients.forEach(function (r) {
      const addr = r.address || r.addr || r.toAddr
      const sats = Number(r.satoshis != null ? r.satoshis : (r.sats != null ? r.sats : r.sendSats))
      if (addr && sats > 0) list.push({ address: addr, satoshis: sats })
    })
  }
  if (!list.length && opts.toAddr) {
    const sats = Number(opts.sendSats || opts.satoshis || 0)
    if (sats > 0) list.push({ address: opts.toAddr, satoshis: sats })
  }
  return list
}

async function send(opts) {
  opts = opts || {}
  const priv = opts.priv
  const fromAddr = opts.fromAddr
  const network = opts.network || 'main'
  const feeSats = Number(opts.feeSats != null ? opts.feeSats : (opts.fee != null ? opts.fee : 500))
  const recs = normRecipients(opts)
  if (!priv || !fromAddr) throw new Error('Send: missing wallet')
  if (!recs.length) throw new Error('Send: no recipients')
  const sendSats = recs.reduce(function (s, r) { return s + r.satoshis }, 0)
  const WOC = wocBase(network)
  const utxos = await listUtxos(fromAddr, network)
  if (!utxos.length) throw new Error('Keine UTXOs')

  // Gather the coins this spend needs. Only the first UTXO used to be read, so a wallet whose
  // balance sat across several coins reported 'Zu wenig Guthaben' while the funds were present.
  // Largest first keeps the input count, and so the size and the fee, as small as the amount allows.
  const usable = []
  utxos.forEach(function (u) {
    const txidIn = u.tx_hash || u.txid || u.txHash
    const vout = (u.tx_pos != null) ? u.tx_pos : u.vout
    const value = Number(u.value)
    if (txidIn && vout != null && value > 0) {
      usable.push({ txid: txidIn, vout: vout, value: value })
    }
  })
  if (!usable.length) throw new Error('UTXO unlesbar')
  usable.sort(function (a, b) { return b.value - a.value })

  const target = sendSats + feeSats
  const picked = []
  let selected = 0
  for (let i = 0; i < usable.length && selected < target; i++) {
    picked.push(usable[i])
    selected += usable[i].value
  }
  const change = selected - sendSats - feeSats
  if (change < 0) {
    // Name the shortfall. A caller cannot act on 'not enough' without knowing by how much.
    throw new Error('Zu wenig Guthaben: ' + selected + ' sat verfuegbar, ' + target + ' sat benoetigt')
  }

  const tx = new Transaction()
  for (let i = 0; i < picked.length; i++) {
    const coin = picked[i]
    const hexRes = await fetch(WOC + '/tx/' + coin.txid + '/hex')
    const txHex = (await hexRes.text()).trim().replace(/^"|"$/g, '')
    if (!hexRes.ok || !txHex || txHex.length < 20) {
      throw new Error('Source-TX fehlt: ' + coin.txid)
    }
    tx.addInput({
      sourceTransaction: Transaction.fromHex(txHex),
      sourceOutputIndex: coin.vout,
      unlockingScriptTemplate: new P2PKH().unlock(priv),
      sequence: 0xffffffff
    })
  }
  recs.forEach(function (r) {
    tx.addOutput({
      satoshis: r.satoshis,
      lockingScript: new P2PKH().lock(r.address)
    })
  })
  if (change >= 546) {
    tx.addOutput({
      satoshis: change,
      lockingScript: new P2PKH().lock(fromAddr)
    })
  }
  await tx.sign()
  const raw = tx.toHex()
  const signedId = tx.id('hex')
  const br = await broadcastRaw(raw, network)
  return { txid: br.txid || signedId, body: br.body || '', via: br.via || 'unknown' }
}

module.exports = { getBalance, listUtxos, send, wocBase, broadcastRaw }
