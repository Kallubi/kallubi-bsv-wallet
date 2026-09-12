# Kallubi BSV Wallet

Non-custodial **desktop** wallet for Bitcoin SV (BSV). Linux (AppImage) and Windows (portable ZIP).

Independent project under the Kallubi name. **Not** affiliated with WhatsOnChain or the BSV Association.  
Unofficial client. Test with a small amount first.

Site / downloads: [kallubi-bsv-explorer.de](https://kallubi-bsv-explorer.de/?tool=wallet)

**Source application files** (`index.html`, `main.js`, `*.cjs`, `package.json`) will be published from a clean tree without seeds or encrypted wallets. This first commit is the public project shell.

## Features (current)

- BIP39 12-word seed, optional 13th-word passphrase
- Kallubi derivation **or** BIP44 path (incl. Centi-style `m/44'/0'/0'/0/n` scan)
- Mainnet / testnet
- Send / receive, QR, history
- Multiple saved wallets (encrypted locally)
- App-level hold (“timelock”) — **not** an on-chain lock
- DE / EN UI

## Build from source

Needs Node.js 20+ and npm.

```bash
git clone https://github.com/Kallubi/kallubi-bsv-wallet.git
cd kallubi-bsv-wallet
npm install
npm start
```

`npm start` runs Electron with `--no-sandbox` on some Linux setups (documented Electron SUID-sandbox issue).

### Packages

```bash
npm run pack:linux    # AppImage
npm run pack:win      # Windows (on Windows)
```

## Network

- WhatsOnChain REST (`api.whatsonchain.com`) for balance, UTXOs, broadcast, FX rate
- No custom backend for keys

## Threat model (short)

| Item | Where it lives |
| --- | --- |
| Seed / WIF | Encrypted on disk, unlocked with your wallet password |
| 13th word | Part of BIP39 passphrase at derive time |
| Prebuilt AppImage/ZIP | Convenience only — verify source if you need assurance |

If you did not build the binary yourself, you are trusting the person who did.

## License

MIT — see `LICENSE`.
