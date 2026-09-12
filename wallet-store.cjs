const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const bip39 = require('bip39')
const { PrivateKey } = require('@bsv/sdk')
const deriveMod = require('./wallet-derive.cjs')

const DATA_ROOT = path.join(os.homedir(), '.kallubi-bsv-wallet')
const WALLETS_ROOT = path.join(DATA_ROOT, 'wallets')

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}
function netKey(network) {
  return network === 'main' ? 'main' : 'test'
}
function networkDir(network) {
  const dir = path.join(WALLETS_ROOT, netKey(network))
  ensureDir(dir)
  return dir
}
function indexFile(network) {
  return path.join(networkDir(network), 'index.json')
}
function walletFile(network, id) {
  return path.join(networkDir(network), id + '.enc.json')
}
function readIndex(network) {
  const f = indexFile(network)
  if (!fs.existsSync(f)) return []
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'))
    return Array.isArray(data) ? data : (data.wallets || [])
  } catch (e) {
    return []
  }
}
function writeIndex(network, list) {
  ensureDir(networkDir(network))
  fs.writeFileSync(indexFile(network), JSON.stringify(list, null, 2))
}

function addressFromPriv(priv, network) {
  try {
    return String(priv.toPublicKey().toAddress(network === 'main' ? 'mainnet' : 'testnet'))
  } catch (e) {
    return String(priv.toPublicKey().toAddress())
  }
}

/** mode: 'kallubi' | 'bip44', path z.B. m/44'/0'/0'/0/0 */
function deriveKey(mnemonic, passphrase, network, mode, derivPath) {
  const m = mode === 'bip44' ? 'bip44' : 'kallubi'
  const p = m === 'bip44' ? (derivPath || "m/44'/0'/0'/0/0") : 'kallubi'
  const d = deriveMod.derive(mnemonic, passphrase || '', network, m, p)
  return {
    priv: d.priv,
    address: d.address,
    derivationMode: d.mode,
    derivationPath: d.path
  }
}

function encryptJson(obj, password) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(password, salt, 32)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plain = Buffer.from(JSON.stringify(obj), 'utf8')
  const enc = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    v: 1,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: enc.toString('hex')
  }
}
function decryptJson(payload, password) {
  const salt = Buffer.from(payload.salt, 'hex')
  const iv = Buffer.from(payload.iv, 'hex')
  const tag = Buffer.from(payload.tag, 'hex')
  const data = Buffer.from(payload.data, 'hex')
  const key = crypto.scryptSync(password, salt, 32)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(data), decipher.final()])
  return JSON.parse(plain.toString('utf8'))
}

function listWallets(network) {
  return readIndex(network).map(function (w) {
    return {
      id: w.id,
      name: w.name,
      note: w.note || '',
      address: w.address,
      hasPassphrase: !!w.hasPassphrase,
      network: netKey(network),
      derivationMode: w.derivationMode || 'kallubi',
      derivationPath: w.derivationPath || 'kallubi'
    }
  })
}

function generateNewSeedWallet(passphrase, network, mode, derivPath) {
  const mnemonic = bip39.generateMnemonic(128)
  const d = deriveKey(mnemonic, passphrase || '', network, mode || 'kallubi', derivPath)
  return {
    mnemonic: mnemonic,
    address: d.address,
    priv: d.priv,
    derivationMode: d.derivationMode,
    derivationPath: d.derivationPath
  }
}

function saveNewWallet(name, password, mnemonic, passphrase, network, mode, derivPath) {
  if (!name || !password || !mnemonic) throw new Error('Missing data')
  if (password.length < 8) throw new Error('Password min. 8')
  if (!bip39.validateMnemonic(mnemonic.trim())) throw new Error('Invalid mnemonic')
  const d = deriveKey(mnemonic.trim(), passphrase || '', network, mode || 'kallubi', derivPath)
  const id = 'w_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex')
  const payload = encryptJson({
    mnemonic: mnemonic.trim(),
    passphrase: passphrase || '',
    wif: d.priv.toWif(),
    address: d.address,
    network: netKey(network),
    derivationMode: d.derivationMode,
    derivationPath: d.derivationPath
  }, password)
  fs.writeFileSync(walletFile(network, id), JSON.stringify(payload, null, 2))
  const list = readIndex(network)
  list.push({
    id: id,
    name: name,
    note: '',
    address: d.address,
    hasPassphrase: !!(passphrase && String(passphrase).length),
    derivationMode: d.derivationMode,
    derivationPath: d.derivationPath,
    createdAt: new Date().toISOString()
  })
  writeIndex(network, list)
  return {
    id: id,
    name: name,
    address: d.address,
    priv: d.priv,
    network: netKey(network),
    derivationMode: d.derivationMode,
    derivationPath: d.derivationPath
  }
}

function unlockWallet(id, password, network) {
  const f = walletFile(network, id)
  if (!fs.existsSync(f)) throw new Error('Wallet not found')
  const payload = JSON.parse(fs.readFileSync(f, 'utf8'))
  let inner
  try {
    inner = decryptJson(payload, password)
  } catch (e) {
    throw new Error('Wrong password')
  }
  const priv = PrivateKey.fromWif(inner.wif)
  const address = addressFromPriv(priv, network)
  const meta = readIndex(network).find(function (w) { return w.id === id })
  return {
    id: id,
    name: (meta && meta.name) || id,
    note: (meta && meta.note) || '',
    address: address,
    priv: priv,
    network: netKey(network),
    derivationMode: inner.derivationMode || (meta && meta.derivationMode) || 'kallubi',
    derivationPath: inner.derivationPath || (meta && meta.derivationPath) || 'kallubi'
  }
}

function restoreFromMnemonic(name, password, mnemonic, passphrase, network, mode, derivPath) {
  if (!bip39.validateMnemonic(String(mnemonic || '').trim())) throw new Error('Invalid mnemonic')
  return saveNewWallet(
    name,
    password,
    String(mnemonic).trim(),
    passphrase || '',
    network,
    mode || 'kallubi',
    derivPath
  )
}

/** Auto-Scan: getBalanceFn von wallet-core übergeben */

function satsFromBal(b) {
  if (typeof b === 'number') return b
  if (!b || typeof b !== 'object') return 0
  return (Number(b.confirmed) || 0) + (Number(b.unconfirmed) || 0)
}
async function scanMnemonic(mnemonic, passphrase, network, getBalanceFn) {
  return deriveMod.autoScan(mnemonic, passphrase || '', network, getBalanceFn)
}

function revealMnemonic(id, password, network) {
  const f = walletFile(network, id)
  if (!fs.existsSync(f)) throw new Error('Wallet not found')
  const payload = JSON.parse(fs.readFileSync(f, 'utf8'))
  let inner
  try {
    inner = decryptJson(payload, password)
  } catch (e) {
    throw new Error('Wrong password')
  }
  if (!inner.mnemonic) throw new Error('No seed in this wallet')
  return inner.mnemonic
}

function updateWalletMeta(id, patch, network) {
  const list = readIndex(network)
  const i = list.findIndex(function (w) { return w.id === id })
  if (i < 0) throw new Error('Wallet not found')
  if (patch.name != null) list[i].name = String(patch.name).trim() || list[i].name
  if (patch.note != null) list[i].note = String(patch.note)
  writeIndex(network, list)
  return list[i]
}

function deleteWallet(id, password, network) {
  unlockWallet(id, password, network)
  const f = walletFile(network, id)
  if (fs.existsSync(f)) fs.unlinkSync(f)
  writeIndex(network, readIndex(network).filter(function (w) { return w.id !== id }))
  return true
}

ensureDir(WALLETS_ROOT)
ensureDir(path.join(WALLETS_ROOT, 'main'))
ensureDir(path.join(WALLETS_ROOT, 'test'))


function parsePrivKey(raw) {
  const t = String(raw || '').trim().replace(/\s+/g, '')
  if (!t) throw new Error('Empty key')
  if (/^[0-9a-fA-F]{64}$/.test(t)) {
    return require('@bsv/sdk').PrivateKey.fromHex(t.toLowerCase())
  }
  try { return require('@bsv/sdk').PrivateKey.fromWif(t) } catch (e) {}
  throw new Error('Not a WIF or 64-char hex key')
}
function importFromWif(name, password, rawKey, network) {
  if (!name || !password) throw new Error('Missing name or password')
  if (password.length < 8) throw new Error('Password min. 8')
  const priv = parsePrivKey(rawKey)
  const address = addressFromPriv(priv, network)
  const id = 'w_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex')
  const payload = encryptJson({
    mnemonic: '',
    passphrase: '',
    wif: priv.toWif(),
    address: address,
    network: netKey(network),
    derivationMode: 'wif',
    derivationPath: 'wif'
  }, password)
  fs.writeFileSync(walletFile(network, id), JSON.stringify(payload, null, 2))
  const list = readIndex(network)
  list.push({
    id: id,
    name: String(name).trim(),
    note: 'WIF / single key',
    address: address,
    hasPassphrase: false,
    derivationMode: 'wif',
    derivationPath: 'wif',
    created: new Date().toISOString()
  })
  writeIndex(network, list)
  return { id: id, name: String(name).trim(), address: address, network: netKey(network) }
}

module.exports = {
  importFromWif,
  listWallets,
  generateNewSeedWallet,
  saveNewWallet,
  unlockWallet,
  restoreFromMnemonic,
  scanMnemonic,
  revealMnemonic,
  updateWalletMeta,
  deleteWallet,
  DATA_ROOT,
  WALLETS_ROOT
}
