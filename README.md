# Kallubi BSV Wallet

Non-custodial **desktop** wallet for Bitcoin SV (BSV).

**v1.0.3** — Linux AppImage · Windows portable EXE · macOS Apple Silicon (M1+)

Independent project under the Kallubi name. **Not** affiliated with WhatsOnChain or the BSV Association. Unofficial client. Test with a small amount first.

Downloads + SHA256: [kallubi-bsv-explorer.de](https://kallubi-bsv-explorer.de)

## Changelog 1.0.3

- Fix: `inner is not defined` on unlock / restore (storage)
- HD scan: Electrum SV / Centi-style paths (receive + change)
- Wallet switch no longer shows the last wallet’s balance
- Scan runs once, then stops (no loop)
- Fresh builds for Linux, Windows and Mac M1+

## Features

- BIP39 12-word seed, optional 13th-word passphrase
- Kallubi derivation **or** BIP44 path (incl. Centi / Electrum-style scan)
- Mainnet / testnet
- Send / receive, QR, history
- Multiple saved wallets (encrypted locally)
- App-level hold (“timelock”) — **not** an on-chain lock
- DE / EN UI
- Broadcast via own node, lookups via WhatsOnChain

## Verify downloads (SHA256)

```
31c373342ff9c6d647e0ec0aaa3cfe7879efddcfefb23b586080ec4c118ddcc0  Kallubi-BSV-Wallet-1.0.3-linux-x64.AppImage
380e4e830d6bc516727310d5e75cd64bf1ac4921018af901aa72b6aa62162d72  Kallubi-BSV-Wallet-1.0.3-win-x64.exe
f9f09ecac3215cc9165e655278c9a20d3ba6aad2ad8133ef898d5303c1c1b3fd  Kallubi-BSV-Wallet-1.0.3-mac-arm64.zip
```

## Build from source

Needs Node.js 20+ and npm.

```bash
git clone https://github.com/Kallubi/kallubi-bsv-wallet.git
cd kallubi-bsv-wallet
npm install
npm start
```

On some Linux setups Electron needs `--no-sandbox` (SUID sandbox).

```bash
npm run pack:linux    # AppImage (Linux)
npm run pack:win      # portable EXE (Windows)
npm run pack:mac      # zip arm64 (macOS Apple Silicon)
```

## Network

- WhatsOnChain REST for balance, UTXOs, history, FX
- Own node for broadcast when available
- Keys never leave the device

## Do not commit

Seeds, `*.enc.json`, `wallets/`, `timelocks.json`, `node_modules/`, `dist/`.

## License

MIT — see `LICENSE`.
