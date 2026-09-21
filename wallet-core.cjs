const { P2PKH, Transaction } = require('@bsv/sdk')
const settings = require('./wallet-settings.cjs')

function wocBase(network) {
  const n = String(network || '')
  if (n === 'test' || n === 'testnet') return 'https://api.whatsonchain.com/v1/bsv/test'
  return 'https://api.whatsonchain.com/v1/bsv/main'
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

function utxoValue(u) {
  return Number(u && u.value) || 0
}

function utxoId(u) {
  return {
    txid: u.tx_hash || u.txid || u.txHash,
    vout: (u.tx_pos != null) ? u.tx_pos : u.vout,
    value: utxoValue(u)
  }
}

/** Largest first until amount+fee is covered. */
function selectCoins(utxos, need) {
  const list = (utxos || []).slice().sort(function (a, b) {
    return utxoValue(b) - utxoValue(a)
  })
  const chosen = []
  let sum = 0
  for (let i = 0; i < list.length; i++) {
    const id = utxoId(list[i])
    if (!id.txid || id.vout == null || !id.value) continue
    chosen.push(list[i])
    sum += id.value
    if (sum >= need) return { chosen: chosen, sum: sum }
  }
  return { chosen: chosen, sum: sum }
}

function coinKey(u) {
  const id = utxoId(u)
  return id.txid + ':' + id.vout
}

function gatherWork(opts, network) {
  const work = []
  if (Array.isArray(opts.sources) && opts.sources.length) {
    opts.sources.forEach(function (s) {
      const list = s.utxos || []
      list.forEach(function (u) {
        if (!s.priv) return
        work.push({ u: u, priv: s.priv, address: s.address })
      })
    })
  }
  if (!work.length && opts.priv && opts.fromAddr && Array.isArray(opts._utxos)) {
    opts._utxos.forEach(function (u) {
      work.push({ u: u, priv: opts.priv, address: opts.fromAddr })
    })
  }
  return work
}

async function send(opts) {
  opts = opts || {}
  const priv = opts.priv
  const fromAddr = opts.fromAddr
  const network = opts.network || 'main'
  const recs = normRecipients(opts)
  if (!recs.length) throw new Error('Send: no recipients')
  const sendSats = recs.reduce(function (s, r) { return s + r.satoshis }, 0)
  const WOC = wocBase(network)

  let work = gatherWork(opts, network)
  if (!work.length) {
    if (!priv || !fromAddr) throw new Error('Send: missing wallet')
    const utxos = await listUtxos(fromAddr, network)
    utxos.forEach(function (u) {
      work.push({ u: u, priv: priv, address: fromAddr })
    })
  }
  if (!work.length) throw new Error('Keine UTXOs')

  const nGuess = Math.min(work.length, 40)
  const feeSats = Number(opts.feeSats != null ? opts.feeSats : (opts.fee != null ? opts.fee : (500 + nGuess * 80)))
  if (!(feeSats >= 0)) throw new Error('Send: bad fee')
  const need = sendSats + feeSats
  const picked = selectCoins(work.map(function (w) { return w.u }), need)
  if (picked.sum < need) throw new Error('Insufficient funds')

  const used = {}
  const chosenWork = []
  picked.chosen.forEach(function (u) {
    const k = coinKey(u)
    const hit = work.find(function (w) { return !used[coinKey(w.u)] && coinKey(w.u) === k })
    if (hit) {
      used[k] = true
      chosenWork.push(hit)
    }
  })
  if (chosenWork.length !== picked.chosen.length) throw new Error('UTXO/key mismatch')

  const tx = new Transaction()
  for (let i = 0; i < chosenWork.length; i++) {
    const id = utxoId(chosenWork[i].u)
    const hexRes = await fetch(WOC + '/tx/' + id.txid + '/hex')
    const txHex = (await hexRes.text()).trim().replace(/^"|"$/g, '')
    if (!hexRes.ok || !txHex || txHex.length < 20) throw new Error('Source-TX fehlt')
    const sourceTransaction = Transaction.fromHex(txHex)
    tx.addInput({
      sourceTransaction: sourceTransaction,
      sourceOutputIndex: id.vout,
      unlockingScriptTemplate: new P2PKH().unlock(chosenWork[i].priv),
      sequence: 0xffffffff
    })
  }
  recs.forEach(function (r) {
    tx.addOutput({
      satoshis: r.satoshis,
      lockingScript: new P2PKH().lock(r.address)
    })
  })
  const change = picked.sum - sendSats - feeSats
  const changeAddr = fromAddr || (chosenWork[0] && chosenWork[0].address)
  if (change >= 546 && changeAddr) {
    tx.addOutput({
      satoshis: change,
      lockingScript: new P2PKH().lock(changeAddr)
    })
  }
  await tx.sign()
  const raw = tx.toHex()
  const signedId = tx.id('hex')
  const br = await broadcastRaw(raw, network)
  return {
    txid: br.txid || signedId,
    body: br.body || '',
    via: br.via || 'unknown',
    inputs: chosenWork.length,
    fromAddresses: chosenWork.map(function (w) { return w.address }).filter(function (a, i, arr) { return arr.indexOf(a) === i })
  }
}

module.exports = { getBalance, listUtxos, send, wocBase, broadcastRaw, selectCoins }
