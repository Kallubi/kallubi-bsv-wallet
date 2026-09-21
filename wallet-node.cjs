const PUBLIC = 'https://node.kallubi-bsv-explorer.de'
async function getStatus() {
  const r = await fetch(PUBLIC + '/health')
  const j = await r.json()
  if (!r.ok || !j || j.ok !== true) {
    return { available: false, error: 'public node down', via: 'none' }
  }
  return {
    available: true,
    blocks: j.blocks,
    headers: j.headers,
    pruned: !!j.pruned,
    chain: j.chain || 'main',
    via: 'public'
  }
}
module.exports = { getStatus, PUBLIC }
