const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const store = require('./wallet-store.cjs')
const hd = require('./wallet-hd.cjs')
const coreHd = require('./wallet-core.cjs')
const core = require('./wallet-core.cjs')
const sweep = require('./wallet-sweep.cjs')
const timelock = require('./wallet-timelock.cjs')
const nodeMod = require('./wallet-node.cjs')
const settings = require('./wallet-settings.cjs')

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'x11')
}

const IDLE_MS = 5 * 60 * 1000
const LOCKOUT_AFTER = 5
const LOCKOUT_MS = 30 * 1000

let mainWindow = null
let session = null
let idleTimer = null
const failCount = {}
const lockedUntil = {}

function publicSession(s) {
  if (!s) return null
  return {
    id: s.id,
    name: s.name,
    note: s.note || '',
    address: s.address,
    network: s.network,
    derivationMode: s.derivationMode || 'kallubi',
    derivationPath: s.derivationPath || 'kallubi',
    hasMnemonic: !!(s && s.mnemonic)
  }
}

function dropSession() {
  session = null
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('session:locked')
  }
}

function touchIdle() {
  if (idleTimer) clearTimeout(idleTimer)
  if (!session) return
  idleTimer = setTimeout(dropSession, IDLE_MS)
}

function checkLockout(id) {
  const until = lockedUntil[id] || 0
  if (Date.now() < until) {
    const sec = Math.ceil((until - Date.now()) / 1000)
    throw new Error('Locked ' + sec + 's')
  }
}

function noteFail(id) {
  failCount[id] = (failCount[id] || 0) + 1
  if (failCount[id] >= LOCKOUT_AFTER) {
    lockedUntil[id] = Date.now() + LOCKOUT_MS
    failCount[id] = 0
    throw new Error('Too many tries — wait 30s')
  }
}

function noteOk(id) {
  failCount[id] = 0
  lockedUntil[id] = 0
}

function wrap(fn) {
  return async function (_evt, payload) {
    try {
      touchIdle()
      const result = await fn(payload || {})
      return { ok: true, result: result }
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) }
    }
  }
}

function createWindow() {
  const win = new BrowserWindow({
    icon: require('path').join(__dirname, 'logo.png'),
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#050508',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    },
    title: 'Kallubi BSV Wallet'
  })
  mainWindow = win
  win.setMenuBarVisibility(false)
  if (app.isPackaged) {
    win.webContents.on('devtools-opened', function () {
      win.webContents.closeDevTools()
    })
  }
  win.webContents.setWindowOpenHandler(function (details) {
    try {
      const u = new URL(details.url)
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        shell.openExternal(details.url)
      }
    } catch (e) {}
    return { action: 'deny' }
  })
  function allowNav(url) {
    if (url === 'about:blank') return true
    if (url.startsWith('file://')) {
      const p = decodeURIComponent(url.replace('file://', '').split('?')[0])
      return path.basename(p) === 'index.html'
    }
    return false
  }
  win.webContents.on('will-navigate', function (e, url) {
    if (!allowNav(url)) e.preventDefault()
  })
  win.webContents.on('will-frame-navigate', function (e, url) {
    if (!allowNav(url)) e.preventDefault()
  })
  win.webContents.on('before-input-event', function () {
    touchIdle()
  })
  win.loadFile(path.join(__dirname, 'index.html'))
}

ipcMain.handle('wallets:list', wrap(function (p) {
  return store.listWallets(p.network || 'main')
}))

ipcMain.handle('wallets:generate', wrap(function (p) {
  const g = store.generateNewSeedWallet(p.passphrase || '', p.network || 'main', p.mode, p.path, p.words)
  return {
    mnemonic: g.mnemonic,
    address: g.address,
    derivationMode: g.derivationMode,
    derivationPath: g.derivationPath
  }
}))

ipcMain.handle('wallets:saveNew', wrap(function (p) {
  const r = store.saveNewWallet(p.name, p.password, p.mnemonic, p.passphrase || '', p.network, p.mode, p.path)
  return { id: r.id, name: r.name, address: r.address, network: r.network, derivationMode: r.derivationMode, derivationPath: r.derivationPath }
}))

ipcMain.handle('wallets:restore', wrap(function (p) {
  const r = store.restoreFromMnemonic(p.name, p.password, p.mnemonic, p.passphrase || '', p.network, p.mode, p.path)
  return { id: r.id, name: r.name, address: r.address, network: r.network, derivationMode: r.derivationMode, derivationPath: r.derivationPath }
}))

ipcMain.handle('wallets:importWif', wrap(function (p) {
  return store.importFromWif(p.name, p.password, p.rawKey, p.network)
}))

ipcMain.handle('wallets:unlock', wrap(function (p) {
  const key = String(p.id || '') + ':' + String(p.network || 'main')
  checkLockout(key)
  try {
    session = store.unlockWallet(p.id, p.password, p.network)
    try {
      const fs = require('fs')
      const path = require('path')
      const os = require('os')
      const f = path.join(os.homedir(), '.kallubi-bsv-wallet', 'last-hd-scan.json')
      if ((!session.hdAddresses || !session.hdAddresses.length) && fs.existsSync(f)) {
        const last = JSON.parse(fs.readFileSync(f, 'utf8'))
        const rows = (last && last.rows) || []
        const hit = rows.some(function (r) { return r && r.address === session.address })
        if (hit && rows.length) {
          store.attachRockHd(p.id, p.password, p.network, rows)
          session = store.unlockWallet(p.id, p.password, p.network)
        }
      }
    } catch (e2) {}
    noteOk(key)
    touchIdle()
    return publicSession(session)
  } catch (e) {
    noteFail(key)
    throw e
  }
}))

ipcMain.handle('wallets:delete', wrap(function (p) {
  store.deleteWallet(p.id, p.password, p.network)
  if (session && session.id === p.id) dropSession()
  return true
}))

ipcMain.handle('wallets:revealMnemonic', wrap(function (p) {
  return store.revealMnemonic(p.id, p.password, p.network)
}))

ipcMain.handle('wallets:updateMeta', wrap(function (p) {
  return store.updateWalletMeta(p.id, p.patch || {}, p.network)
}))

ipcMain.handle('wallets:scan', wrap(async function (p) {
  return store.scanMnemonic(p.mnemonic, p.passphrase || '', p.network, function (addr, net) {
    return core.getBalance(addr, net)
  })
}))

ipcMain.handle('wallets:logout', wrap(function () {
  dropSession()
  return true
}))

ipcMain.handle('wallets:session', wrap(function () {
  return publicSession(session)
}))

ipcMain.handle('chain:balance', wrap(async function (p) {
  const net = (p && p.network) || (session && session.network) || 'main'
  const hd = session && session.hdAddresses
  if (hd && hd.length && !(p && p.address && p.address !== session.address)) {
    var cached = 0
    hd.forEach(function (h) { cached += Number(h.total || 0) })
    if (cached > 0) return { confirmed: cached, unconfirmed: 0 }
  }
  const addr = (p && p.address) || (session && session.address)
  if (!addr) throw new Error('No address')
  return core.getBalance(addr, net)
}))

ipcMain.handle('chain:utxos', wrap(async function (p) {
  const addr = (p && p.address) || (session && session.address)
  const net = (p && p.network) || (session && session.network) || 'main'
  if (!addr) throw new Error('No address')
  return core.listUtxos(addr, net)
}))

ipcMain.handle('chain:send', wrap(async function (p) {
  if (!session || !session.priv) throw new Error('Locked')
  let sources = null
  const net = (session.network === 'test' || session.network === 'testnet') ? 'test' : 'main'
  if (session.mnemonic) {
    sources = await sweep.collectSources(session.mnemonic, session.passphrase || '', net)
  }
  return core.send({
    priv: session.priv,
    fromAddr: session.address,
    network: net,
    recipients: p.recipients,
    toAddr: p.toAddr,
    sendSats: p.sendSats,
    feeSats: p.feeSats,
    preferWoc: p.preferWoc,
    sources: sources
  })
}))

let lastSweepId = ''
ipcMain.handle('chain:seedPeek', wrap(function () {
  return sweep.peekSession(session)
}))
ipcMain.handle('chain:seedFunds', wrap(async function () {
  if (!session) return { addresses: 0, sats: 0, hasMnemonic: false, rows: [] }
  const sources = await sweep.fundsForSession(session)
  const sum = sweep.sumSources(sources)
  console.log('SEEDFUNDS', session.address, sum.addresses, sum.sats)
  return {
    addresses: sum.addresses,
    sats: sum.sats,
    hasMnemonic: !!session.mnemonic,
    address: session.address,
    rows: sources.map(function (x) { return { path: x.path, address: x.address, total: x.sats } })
  }
}))


ipcMain.handle('timelock:list', wrap(function () {
  if (!session) throw new Error('Locked')
  return timelock.loadLocks().filter(function (l) { return l.address === session.address })
}))

ipcMain.handle('timelock:create', wrap(function (p) {
  if (!session) throw new Error('Locked')
  return timelock.createTimelock({
    address: session.address,
    lockSats: p.lockSats,
    hours: p.hours
  })
}))

ipcMain.handle('timelock:unlock', wrap(function (p) {
  if (!session) throw new Error('Locked')
  return timelock.unlockTimelock({ lockEntry: p.lockEntry })
}))

ipcMain.handle('timelock:lockedSats', wrap(function () {
  if (!session) throw new Error('Locked')
  return timelock.getLockedSats(session.address)
}))

ipcMain.handle('node:status', wrap(async function () {
  const st = settings.load()
  const n = await nodeMod.getStatus()
  return Object.assign({ source: st.source || 'auto' }, n)
}))
ipcMain.handle('node:setSource', wrap(function (p) {
  const src = (p && p.source) || 'auto'
  if (['auto', 'woc', 'node'].indexOf(src) < 0) throw new Error('Bad source')
  return settings.save({ source: src })
}))

ipcMain.handle('ui:copy', wrap(function (p) {
  const { clipboard } = require('electron')
  clipboard.writeText(String((p && p.text) || ''))
  return true
}))

ipcMain.handle('ui:openExternal', wrap(function (p) {
  const url = String((p && p.url) || '')
  if (!/^https?:\/\//i.test(url)) throw new Error('Blocked URL')
  shell.openExternal(url)
  return true
}))

ipcMain.handle('ui:exportFile', wrap(async function (p) {
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: p.defaultName || 'kallubi-export.json'
  })
  if (res.canceled || !res.filePath) return false
  fs.writeFileSync(res.filePath, String(p.content || ''), { encoding: 'utf8', mode: 0o600 })
  return true
}))

ipcMain.handle('ui:importFile', wrap(async function () {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return null
  return fs.readFileSync(res.filePaths[0], 'utf8')
}))


ipcMain.handle('ui:qr', wrap(async function (p) {
  const QRCode = require('qrcode')
  return QRCode.toDataURL(String((p && p.text) || ''), { width: Number((p && p.width) || 180), margin: 2 })
}))

ipcMain.handle('ui:decodeQr', wrap(async function (p) {
  const jsQR = require('jsqr')
  const width = Number(p.width)
  const height = Number(p.height)
  const data = Uint8ClampedArray.from(p.data || [])
  const code = jsQR(data, width, height)
  return code ? { data: code.data } : null
}))

ipcMain.handle('wallets:exportEncrypted', wrap(async function () {
  if (!session) throw new Error('Locked')
  const src = require('path').join(require('os').homedir(), '.kallubi-bsv-wallet', 'wallets', session.network === 'main' ? 'main' : 'test', session.id + '.enc.json')
  if (!fs.existsSync(src)) throw new Error('Wallet file not found')
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'kallubi-' + session.id + '-export.json'
  })
  if (res.canceled || !res.filePath) return false
  const payload = {
    type: 'kallubi-wallet-export',
    v: 1,
    network: session.network,
    id: session.id,
    name: session.name || '',
    address: session.address,
    exportedAt: new Date().toISOString(),
    encrypted: JSON.parse(fs.readFileSync(src, 'utf8'))
  }
  fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), { mode: 0o600 })
  return true
}))

ipcMain.handle('wallets:importEncrypted', wrap(async function (p) {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePaths || !res.filePaths[0]) throw new Error('No file')
  const data = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'))
  let encObj = null
  let id = 'imp_' + Date.now().toString(36)
  if (data.type === 'kallubi-wallet-export' && data.encrypted) {
    encObj = data.encrypted
    id = data.id || id
    if (data.network && data.network !== (p.network || 'main') && data.network !== 'test' && p.network === 'main') {
      /* allow but keep selected network */
    }
  } else if (data.v && data.salt && data.data) {
    encObj = data
  } else throw new Error('Unknown export format')
  const net = p.network || 'main'
  const destDir = require('path').join(require('os').homedir(), '.kallubi-bsv-wallet', 'wallets', net === 'main' ? 'main' : 'test')
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true, mode: 0o700 })
  const dest = require('path').join(destDir, id + '.enc.json')
  fs.writeFileSync(dest, JSON.stringify(encObj, null, 2), { mode: 0o600 })
  const unlocked = store.unlockWallet(id, p.password, net)
  try { store.updateWalletMeta(id, { name: p.name || 'Imported' }, net) } catch (e) {}
  return unlocked.address
}))

app.whenReady().then(createWindow)
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle('scanHd', async (_e, p) => {
  p = p || {}
  const rows = await hd.scanHd({
    mnemonic: p.mnemonic,
    passphrase: p.passphrase || '',
    network: p.network || 'main',
    preset: p.preset || 'rock',
    gap: p.gap || 130,
    getBalance: coreHd.getBalance
  })
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    const f = path.join(os.homedir(), '.kallubi-bsv-wallet', 'last-hd-scan.json')
    fs.writeFileSync(f, JSON.stringify({ at: Date.now(), rows: rows }))
  } catch (e) {}
  return rows
})
ipcMain.handle('scanRockWallet', async (_e, p) => {
  p = p || {}
  return hd.scanHd({
    mnemonic: p.mnemonic,
    passphrase: p.passphrase || '',
    network: p.network || 'main',
    preset: 'rock',
    gap: p.gap || 130,
    getBalance: coreHd.getBalance
  })
})
ipcMain.handle('attachRockHd', (_e, p) => store.attachRockHd(p.id, p.password, p.network, p.rows))
ipcMain.handle('loadRockHd', (_e, p) => store.loadRockHd(p.id, p.password, p.network))

