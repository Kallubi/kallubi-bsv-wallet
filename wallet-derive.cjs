'use strict'
const crypto = require('crypto')
const bip39 = require('bip39')
const { HDKey } = require('@scure/bip32')
const { PrivateKey } = require('@bsv/sdk')

function netName(network) {
  return network === 'main' ? 'mainnet' : 'testnet'
}

/** Alte Kallubi-Ableitung (bestehende Wallets) */
function deriveKallubi(mnemonic, passphrase, network) {
  const seed = bip39.mnemonicToSeedSync(String(mnemonic).trim(), passphrase || '')
  const hash = crypto.createHash('sha256').update(seed).digest('hex')
  const priv = PrivateKey.fromHex(hash)
  const address = String(priv.toPublicKey().toAddress(netName(network)))
  return { priv, address, path: 'kallubi', mode: 'kallubi' }
}

/** BIP32/BIP44 Path */
function deriveBip32(mnemonic, passphrase, path, network) {
  if (!path || path === 'kallubi') {
    return deriveKallubi(mnemonic, passphrase, network)
  }
  const seed = bip39.mnemonicToSeedSync(String(mnemonic).trim(), passphrase || '')
  const root = HDKey.fromMasterSeed(seed)
  const child = root.derive(path)
  if (!child.privateKey) {
    throw new Error('Path liefert keinen Private Key: ' + path)
  }
  const hex = Buffer.from(child.privateKey).toString('hex')
  const priv = PrivateKey.fromHex(hex)
  const address = String(priv.toPublicKey().toAddress(netName(network)))
  return { priv, address, path, mode: 'bip44' }
}

/** Scan-Liste Modus 1 */
const SCAN_PATHS = [
  /* CENTI_BSV */
  "m/44'/0'/0'/0/0",
  "m/44'/0'/0'/0/1",
  "m/44'/0'/0'/0/2",
  "m/44'/0'/0'/0/3",
  "m/44'/0'/0'/0/4",
  "m/44'/0'/0'/0/5",
  "m/44'/0'/0'/0/6",
  "m/44'/0'/0'/0/7",
  "m/44'/0'/0'/0/8",
  "m/44'/0'/0'/0/9",
  "m/44'/0'/0'/0/10",
  "m/44'/0'/0'/0/11",
  "m/44'/0'/0'/0/12",
  "m/44'/0'/0'/0/13",
  "m/44'/0'/0'/0/14",
  "m/44'/0'/0'/0/15",
  "m/44'/0'/0'/0/16",
  "m/44'/0'/0'/0/17",
  "m/44'/0'/0'/0/18",
  "m/44'/0'/0'/0/19",
  "m/44'/0'/0'/0/20",
  "m/44'/0'/0'/0/21",
  "m/44'/0'/0'/0/22",
  "m/44'/0'/0'/0/23",
  "m/44'/0'/0'/0/24",
  "m/44'/0'/0'/0/25",
  "m/44'/0'/0'/0/26",
  "m/44'/0'/0'/0/27",
  "m/44'/0'/0'/0/28",
  "m/44'/0'/0'/0/29",
  /* END_CENTI */
  'kallubi',
  "m/44'/236'/0'/0/0",
  "m/44'/236'/0'/0/1",
  "m/44'/236'/0'/0/2",
  "m/44'/0'/0'/0'/0'",
  "m/44'/0'/0'",
  "m/44'/236'/0'",
  "m/0'/0'/0'",
  "m/0'/0/0",
  "m/0'/0/1",
  "m/44'/145'/0'/0/0",
  "m/44'/145'/0'/0/1",
  "m/44'/236'/0'/0/3",
  "m/44'/236'/0'/0/4",
  "m/44'/236'/0'/0/5",
  "m/44'/0'/1'/0/0",
  "m/44'/0'/0'/1/0"
]

function listScanPaths() {
  const seen = new Set()
  const out = []
  for (const p of SCAN_PATHS) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

function derive(mnemonic, passphrase, network, mode, path) {
  if (mode === 'bip44' || (path && path !== 'kallubi')) {
    return deriveBip32(mnemonic, passphrase, path || "m/44'/0'/0'/0/0", network)
  }
  return deriveKallubi(mnemonic, passphrase, network)
}

/**
 * Auto-Scan: getBalanceFn(address, network) => { confirmed, unconfirmed }
 * Failed lookups set error and leave totals null — they are not treated as empty wallets.
 */
async function autoScan(mnemonic, passphrase, network, getBalanceFn) {
  const phrase = String(mnemonic).trim()
  if (!bip39.validateMnemonic(phrase)) {
    throw new Error('Invalid mnemonic')
  }
  const out = []
  const seen = new Set()
  for (const path of listScanPaths()) {
    let d
    try {
      d = path === 'kallubi'
        ? deriveKallubi(phrase, passphrase, network)
        : deriveBip32(phrase, passphrase, path, network)
    } catch (e) {
      out.push({
        path: path,
        mode: path === 'kallubi' ? 'kallubi' : 'bip44',
        address: '',
        confirmed: null,
        unconfirmed: null,
        total: null,
        error: (e && e.message) ? e.message : 'derive failed'
      })
      continue
    }
    if (seen.has(d.address)) continue
    seen.add(d.address)
    let confirmed = 0
    let unconfirmed = 0
    let error = ''
    if (typeof getBalanceFn === 'function') {
      try {
        const b = await getBalanceFn(d.address, network)
        confirmed = Number(b.confirmed || 0)
        unconfirmed = Number(b.unconfirmed || 0)
      } catch (e) {
        confirmed = null
        unconfirmed = null
        error = (e && e.message) ? e.message : 'balance lookup failed'
      }
    }
    out.push({
      path: d.path,
      mode: d.mode,
      address: d.address,
      confirmed: confirmed,
      unconfirmed: unconfirmed,
      total: error ? null : (Number(confirmed) + Number(unconfirmed)),
      error: error
    })
  }
  out.sort(function (a, b) {
    const ae = a.error ? 1 : 0
    const be = b.error ? 1 : 0
    if (ae !== be) return ae - be
    return (Number(b.total) || 0) - (Number(a.total) || 0)
  })
  return out
}

module.exports = {
  deriveKallubi,
  deriveBip32,
  derive,
  autoScan,
  listScanPaths,
  SCAN_PATHS
}
