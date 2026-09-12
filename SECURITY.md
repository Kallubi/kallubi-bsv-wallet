# Security

## What this wallet does

- Non-custodial desktop wallet for Bitcoin SV (BSV).
- Keys are derived on the device (BIP39 seed, optional 13th-word passphrase).
- The encrypted wallet file stays on the local machine (`~/.kallubi-bsv-wallet` on Linux).
- Balance and broadcast use public WhatsOnChain HTTP APIs. There is no Kallubi key server.

## What this wallet does not do

- It does not send your seed, WIF, or password to any server.
- It is **not** an official BSV Association product.
- A public repo is not a paid audit. Read the code and build it yourself if you need that bar.

## How to review

1. Clone this repository.
2. Read `package.json` (dependencies only).
3. Search the source for `fetch(`, `http`, `eval(`, `child_process`, `WebSocket`.
4. Build with the README commands. Prefer that binary over a prebuilt AppImage/ZIP if you do not trust the build machine.

## Reporting a problem

Email **Kallubi@proton.me**. Do not open a public issue that contains a seed, WIF, or screenshot of a funded wallet.
