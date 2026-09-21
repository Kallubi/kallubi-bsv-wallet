const fs = require('fs')
const path = require('path')
const os = require('os')
const FILE = path.join(os.homedir(), '.kallubi-bsv-wallet', 'settings.json')
const DEFAULT_API = 'https://node.kallubi-bsv-explorer.de'
function load() {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch (e) {}
  return { source: 'auto' }
}
function save(patch) {
  const cur = Object.assign(load(), patch || {})
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(cur, null, 2))
  return cur
}
function getPreferredApi() { return load().apiUrl || DEFAULT_API }
function setPreferredApi(url) { save({ apiUrl: url }); return url }
module.exports = { load, save, getPreferredApi, setPreferredApi, DEFAULT_API }
