const derive = require('./wallet-derive.cjs')

const PRESETS = {
  rock:     { label: 'RockWallet', prefixes: ["m/0'/0/", "m/0'/1/"] },
  handcash: { label: 'HandCash 1.x', prefixes: ["m/0'/0/", "m/0'/1/"] },
  centbee:  { label: 'Centbee',    prefixes: ["m/44'/0/0/", "m/44'/0/1/"] },
  centi:    { label: 'Centi',      prefixes: ["m/44'/0'/0'/0/", "m/44'/0'/0'/1/"] },
  electrum: { label: 'ElectrumSV', prefixes: ["m/44'/236'/0'/0/", "m/44'/236'/0'/1/"] },
  ellipal:  { label: 'Ellipal',    prefixes: ["m/44'/236'/0'/0/", "m/44'/236'/0'/1/"] },
  relayx:   { label: 'RelayX',     prefixes: ["m/44'/236'/0'/0/", "m/44'/236'/0'/1/"] },
  simply:   { label: 'simply.cash', prefixes: ["m/44'/145'/0'/0/", "m/44'/145'/0'/1/"] }
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms) })
}

function isRetryable(e) {
  var m = String(e && e.message || e)
  return /429|500|502|503|504|Too Many|Internal Server|timeout|ECONNRESET|fetch/i.test(m)
}

async function getBalanceRetry(getBalance, address, network) {
  var last
  for (var i = 0; i < 6; i++) {
    try {
      return await getBalance(address, network)
    } catch (e) {
      last = e
      if (!isRetryable(e)) throw e
      await sleep(1200 * (i + 1))
    }
  }
  throw last
}

function resolvePreset(name) {
  var key = String(name || 'rock').toLowerCase()
  if (key === 'simplycash') key = 'simply'
  return PRESETS[key] || PRESETS.rock
}

function listHdAddresses(mnemonic, passphrase, network, count, prefixes) {
  var n = count || 130
  var rows = []
  prefixes.forEach(function (pre) {
    for (var i = 0; i < n; i++) {
      rows.push(derive.deriveBip32(mnemonic, passphrase || '', pre + i, network))
    }
  })
  return rows
}

async function scanHd(opts) {
  var mnemonic = opts.mnemonic
  var passphrase = opts.passphrase || ''
  var network = opts.network || 'main'
  var gap = opts.gap || 130
  var getBalance = opts.getBalance
  var preset = resolvePreset(opts.preset)
  if (!mnemonic) throw new Error('mnemonic required')
  if (typeof getBalance !== 'function') throw new Error('getBalance required')
  var rows = listHdAddresses(mnemonic, passphrase, network, gap, preset.prefixes)
  var out = []
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]
    await sleep(550)
    var confirmed = 0
    var unconfirmed = 0
    var err = ''
    try {
      var bal = await getBalanceRetry(getBalance, r.address, network)
      confirmed = Number((bal && (bal.confirmed != null ? bal.confirmed : 0)) || 0)
      unconfirmed = Number((bal && bal.unconfirmed) || 0)
    } catch (e) {
      err = String(e && e.message || e).slice(0, 80)
    }
    out.push({
      path: r.path,
      address: r.address,
      wif: r.wif,
      confirmed: confirmed,
      unconfirmed: unconfirmed,
      total: confirmed + unconfirmed,
      error: err
    })
  }
  return out
}

function scanRockWallet(opts) {
  opts = opts || {}
  opts.preset = 'rock'
  return scanHd(opts)
}

module.exports = {
  PRESETS,
  listHdAddresses,
  scanHd,
  scanRockWallet,
  listRockAddresses: function (m, p, n, c) {
    return listHdAddresses(m, p, n, c, PRESETS.rock.prefixes)
  }
}
