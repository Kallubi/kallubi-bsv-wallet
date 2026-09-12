const fs = require('fs')
const path = require('path')
const os = require('os')
const FILE = path.join(os.homedir(), '.kallubi-bsv-wallet', 'settings.json')
const DEFAULTS = {
  source: 'auto',
  rpcHost: '127.0.0.1',
  rpcPort: 8332,
  rpcUser: '',
  rpcPassword: '',
  rpcConf: '/data/bsv/bitcoin.conf'
}
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return Object.assign({}, DEFAULTS, raw)
  } catch (e) {
    return Object.assign({}, DEFAULTS)
  }
}
function save(patch) {
  const next = Object.assign(load(), patch || {})
  const dir = path.dirname(FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}
module.exports = { load, save, DEFAULTS, FILE }
