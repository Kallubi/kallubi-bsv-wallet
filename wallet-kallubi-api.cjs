const API = "https://node.kallubi-bsv-explorer.de"
async function kallubiHealth() {
  const res = await fetch(API + "/health")
  const text = await res.text()
  if (!res.ok) throw new Error("Kallubi API HTTP " + res.status)
  return JSON.parse(text)
}
async function kallubiBroadcast(rawHex) {
  const res = await fetch(API + "/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "sendrawtransaction", params: [String(rawHex)] })
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch (e) { body = { error: text } }
  if (!res.ok || body.error) throw new Error(body.error || ("HTTP " + res.status))
  return String(body.result || "").replace(/^"|"$/g, "")
}
module.exports = { API, kallubiHealth, kallubiBroadcast }
