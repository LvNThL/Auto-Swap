# AutoSwap Route Desk

React + Vite PWA for preparing ChangeNOW swap routes. The browser never receives the ChangeNOW API key: authenticated, email-verified clients call the Firebase callable function, which reads the key from Functions Secret Manager. The function also applies a short per-user cooldown to tunnel requests.

## Local setup

1. Install Node.js 22.12 or newer. In PowerShell, install Firebase CLI with `npm.cmd install --global firebase-tools`.
2. Run `npm.cmd ci` at the project root and `npm.cmd ci` in `functions/`.
3. Copy `.env.example` to `.env.local` and add the Firebase web app values. Firebase web configuration is public; access control comes from Firebase Auth and Firestore rules, not from hiding these values.
4. Enable Email/Password sign-in in Firebase Authentication and create a Firestore database. Email verification is required before creating tunnels.
5. Set the server-only exchange key with `firebase.cmd functions:secrets:set CHANGENOW_API_KEY`.
6. Deploy with `firebase.cmd deploy --only functions,firestore:rules`, then start the app with `npm.cmd run dev`.

Cloud Functions deployment requires a Firebase project on the Blaze billing plan.

For WalletConnect, create a WalletConnect Cloud project and set `VITE_WALLETCONNECT_PROJECT_ID`. An injected EIP-1193 wallet is used when available; otherwise WalletConnect opens its connection modal.

## Route behavior and limits

- New routes load non-fiat assets from ChangeNOW's active standard-flow currency catalog. Each option includes its network, so the same ticker on different chains is selected separately. Quote requests validate that the chosen pair is currently available; some listed assets may not be swappable with every other asset.
- A Venmo route creates a ChangeNOW tunnel and displays its pay-in address for manual sending. Venmo asset/network support varies by region and account.
- Assets that require a destination memo/tag prompt for it, and deposit memos returned by ChangeNOW are displayed with the deposit address.
- A Trust Wallet route checks the configured native EVM coin/network pair, creates the tunnel, then asks the connected wallet to send that coin to the returned pay-in address. The user must approve the separate transaction in their wallet. This starter intentionally does not submit ERC-20 token transfers.
- The destination must be a supported cryptocurrency address. A PayPal email/account is not itself a crypto deposit address; use a valid external crypto address only if PayPal supports that asset and network for your account. ChangeNOW availability and payout support must be verified before relying on a route.
- The app checks ChangeNOW's minimum and estimated receive amount before confirmation. The server binds tunnel creation to the authenticated user's exact route and destination quote, expires quotes after one minute, and consumes each quote once. Standard-flow estimates are still indicative, not a guaranteed quote. Confirm the API key's endpoint access and current v2 response schema before handling real funds.

## Static hosting

The GitHub Actions workflow builds the PWA with the repository path as Vite's base URL and deploys `dist` to GitHub Pages. Add the `VITE_FIREBASE_*` values and WalletConnect project ID as repository Actions secrets, then enable GitHub Pages with GitHub Actions as its source. Firebase Functions deploy separately; never add the ChangeNOW secret to Vite environment variables or GitHub Pages.