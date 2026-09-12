const { execFileSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = process.env.KALLUBI_SVNODE || path.join(os.homedir(), 'svnode-quickstart')
const CLI_SH = path.join(ROOT, 'cli.sh')

function available() {
  return fs.existsSync(CLI_SH)
}

function nodeCli(args, timeoutMs) {
  if (!available()) throw new Error('SVNode cli.sh not found')
  const out = execFileSync('/bin/bash', [CLI_SH].concat(args), {
    encoding: 'utf8',
    timeout: timeoutMs || 20000,
    maxBuffer: 8 * 1024 * 1024
  })
  return String(out).trim()
}

function getBlockCount() {
  return parseInt(nodeCli(['getblockcount'], 10000), 10)
}

function getRawTx(txid) {
  const hex = nodeCli(['getrawtransaction', String(txid)], 20000)
  return String(hex).replace(/^"|"$/g, '').trim()
}

function sendRawTx(hex) {
  const id = nodeCli(['sendrawtransaction', String(hex)], 30000)
  return String(id).replace(/^"|"$/g, '').trim()
}

module.exports = {
  available,
  nodeCli,
  getBlockCount,
  getRawTx,
  sendRawTx,
  ROOT
}
