const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const DATA_DIR = path.join(os.homedir(), '.kallubi-bsv-wallet')
const FILE = path.join(DATA_DIR, 'timelocks.json')

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]')
}

function loadLocks() {
  ensure()
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch (e) {
    return []
  }
}

function saveLocks(list) {
  ensure()
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2))
}

function getLockedSats(address) {
  const now = Math.floor(Date.now() / 1000)
  return loadLocks()
    .filter(function (l) {
      return l.type === 'app' && l.address === address && now < Number(l.lockUnix)
    })
    .reduce(function (s, l) {
      return s + Number(l.lockSats || 0)
    }, 0)
}

function createTimelock(opts) {
  const hours = Number(opts.hours)
  const lockSats = Number(opts.lockSats)
  if (!opts.address) throw new Error('No address')
  if (!lockSats || lockSats < 1) throw new Error('Invalid amount')
  if (!hours || hours <= 0) throw new Error('Invalid duration')
  const lockUnix = Math.floor(Date.now() / 1000) + Math.floor(hours * 3600)
  const entry = {
    id: 'tl_' + Date.now().toString(36) + '_' + crypto.randomBytes(2).toString('hex'),
    type: 'app',
    address: opts.address,
    lockSats: lockSats,
    lockUnix: lockUnix,
    lockDate: new Date(lockUnix * 1000).toISOString()
  }
  const list = loadLocks()
  list.push(entry)
  saveLocks(list)
  return entry
}

function unlockTimelock(opts) {
  const entry = opts.lockEntry
  if (!entry || !entry.id) throw new Error('No lock')
  const list = loadLocks().filter(function (l) {
    return l.id !== entry.id
  })
  saveLocks(list)
  return true
}

/** Kept for old callers. App locks are not chain locks — this does not wipe them. */
function clearChainLocks() {
  return 0
}

module.exports = {
  loadLocks,
  getLockedSats,
  createTimelock,
  unlockTimelock,
  clearChainLocks
}
