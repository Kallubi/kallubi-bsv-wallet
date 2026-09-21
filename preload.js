const { contextBridge, ipcRenderer } = require('electron')

function call(channel, payload) {
  return ipcRenderer.invoke(channel, payload || {}).then(function (res) {
    if (!res || !res.ok) throw new Error((res && res.error) || 'IPC error')
    return res.result
  })
}

contextBridge.exposeInMainWorld('kallubi', {
  listWallets: function (network) { return call('wallets:list', { network: network }) },
  generateSeed: function (opts) { return call('wallets:generate', opts) },
  saveNewWallet: function (opts) { return call('wallets:saveNew', opts) },
  restoreWallet: function (opts) { return call('wallets:restore', opts) },
  importWif: function (opts) { return call('wallets:importWif', opts) },
  unlockWallet: function (opts) { return call('wallets:unlock', opts) },
  deleteWallet: function (opts) { return call('wallets:delete', opts) },
  revealMnemonic: function (opts) { return call('wallets:revealMnemonic', opts) },
  updateMeta: function (opts) { return call('wallets:updateMeta', opts) },
  scanRockWallet: (p) => ipcRenderer.invoke("scanRockWallet", p),
  scanHd: (p) => ipcRenderer.invoke("scanHd", p),
  attachRockHd: (p) => ipcRenderer.invoke("attachRockHd", p),
  loadRockHd: (p) => ipcRenderer.invoke("loadRockHd", p),
  scanMnemonic: function (opts) { return call('wallets:scan', opts) },
  logout: function () { return call('wallets:logout') },
  session: function () { return call('wallets:session') },
  getBalance: function (opts) { return call('chain:balance', opts) },
  listUtxos: function (opts) { return call('chain:utxos', opts) },
  send: function (opts) { return call('chain:send', opts) },
  seedPeek: function () { return ipcRenderer.invoke('chain:seedPeek') },
    seedFunds: function () { return call('chain:seedFunds') },
  locks: function () { return call('timelock:list') },
  createLock: function (opts) { return call('timelock:create', opts) },
  unlockLock: function (opts) { return call('timelock:unlock', opts) },
  lockedSats: function () { return call('timelock:lockedSats') },
  nodeStatus: function () { return call('node:status') },
  nodeSetSource: function (opts) { return call('node:setSource', opts) },
  copy: function (text) { return call('ui:copy', { text: text }) },
  openExternal: function (url) { return call('ui:openExternal', { url: url }) },
  exportFile: function (opts) { return call('ui:exportFile', opts) },
  importFile: function () { return call('ui:importFile') },
  qrDataUrl: function (opts) { return call('ui:qr', opts) },
  decodeQr: function (opts) { return call('ui:decodeQr', opts) },
  exportEncrypted: function () { return call('wallets:exportEncrypted') },
  importEncrypted: function (opts) { return call('wallets:importEncrypted', opts) },
  onLocked: function (fn) {
    ipcRenderer.on('session:locked', function () { fn() })
  }
})
