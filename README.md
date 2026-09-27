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
- A Venmo → Trust Wallet route creates a ChangeNOW tunnel, then displays its pay-in address for the user to send from Venmo manually. ChangeNOW pays the swap output to the saved Trust Wallet address. Venmo asset/network support varies by region and account.
- Assets that require a destination memo/tag prompt for it, and deposit memos returned by ChangeNOW are displayed with the deposit address. An optional refund address and refund memo/tag can be supplied for ChangeNOW's refund handling.
- The address book stores labeled destination and refund addresses under the signed-in user's Firestore record. Load choices are filtered by purpose, asset, and network; Firestore rules prevent access across user accounts.
- A Trust Wallet → Venmo route creates the tunnel, then asks the connected wallet to send the selected native EVM coin to the returned pay-in address. The user must approve the separate transaction in their wallet. ChangeNOW sends the output to the saved Venmo crypto receiving address. This starter intentionally does not submit ERC-20 token transfers.
- Asset menus are searchable, show popular assets first, and distinguish same-ticker assets on different networks. Send and receive lists use ChangeNOW's direction-specific catalog flags; a quote still verifies that the selected pair and amount are currently available.
- Destinations must be supported cryptocurrency receiving addresses, not account emails. Confirm that the receiving app supports the selected asset and network before relying on a route.
- The app checks ChangeNOW's minimum and estimated receive amount before confirmation. The server binds tunnel creation to the authenticated user's exact route and destination quote, expires quotes after one minute, and consumes each quote once. Standard-flow estimates are still indicative, not a guaranteed quote. Confirm the API key's endpoint access and current v2 response schema before handling real funds.

## Static hosting

The GitHub Actions workflow builds the PWA with the repository path as Vite's base URL and deploys `dist` to GitHub Pages. Add the `VITE_FIREBASE_*` values and WalletConnect project ID as repository Actions secrets, then enable GitHub Pages with GitHub Actions as its source. Firebase Functions deploy separately; never add the ChangeNOW secret to Vite environment variables or GitHub Pages.

## Firebase cost controls

- Callable functions require a signed-in, email-verified account and are capped at five instances each to limit burst scaling.
- Saved records are validated server-side and capped at 25 presets and 50 address-book entries per account. The app-wide ceiling is 250 saved-record creates or edits per UTC day; deletes remain available.
- Quote documents include an `expiresAt` timestamp, but Firestore does not delete them automatically until a TTL policy is enabled. In Google Cloud Console, open Firestore's Time-to-live page and create a policy for collection group `swapQuotes` using field `expiresAt`. TTL deletion is asynchronous (typically within 24 hours) and billed as document deletes.
- Swap history is retained to preserve user history; each history read is limited to the latest 50 records. Configure billing budget alerts in Google Cloud Billing because alerts notify but do not cap spending.