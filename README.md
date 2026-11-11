# AutoSwap Route Desk

React + Vite PWA for preparing ChangeNOW swap routes. The browser never receives the ChangeNOW API key: authenticated, email-verified clients call the Firebase callable function, which reads the key from Functions Secret Manager. The function also applies a short per-user cooldown to tunnel requests.

## Local setup

1. Install Node.js 22.12 or newer. The repository and CI pin Node.js 24 in `.nvmrc`; deployed Cloud Functions use Node.js 22. In PowerShell, install Firebase CLI with `npm.cmd install --global firebase-tools`.
2. Run `npm.cmd ci` at the project root and `npm.cmd ci` in `functions/`.
3. Copy `.env.example` to `.env.local` and add the Firebase web app values. Firebase web configuration is public; access control comes from Firebase Auth and Firestore rules, not from hiding these values.
4. Enable Email/Password sign-in in Firebase Authentication, create a Firestore database, and enable a private Cloud Storage bucket. Email verification is required before creating tunnels.
5. Set the server-only exchange key with `firebase.cmd functions:secrets:set CHANGENOW_API_KEY`.
6. Deploy with `firebase.cmd deploy --only functions,firestore:rules,firestore:indexes,storage`, then start the app with `npm.cmd run dev`. Firestore indexes may take several minutes to finish building.

Cloud Functions deployment requires a Firebase project on the Blaze billing plan.

## Validation

Run the slippage validation and backend unit tests and production frontend build from the project root. These are also the checks run by the GitHub Pages workflow.

```powershell
node --test src/services/limit-estimate.test.js
npm.cmd test --prefix functions
npm.cmd run build
```

## Route behavior and limits

- New routes load non-fiat assets from ChangeNOW's active standard-flow currency catalog. Each option includes its network, so the same ticker on different chains is selected separately. Quote requests validate that the chosen pair is currently available; some listed assets may not be swappable with every other asset.
- A route checks the selected pair and amount, then creates a ChangeNOW deposit tunnel. AutoSwap displays the deposit address and any returned deposit memo or tag; the user must send funds separately from a compatible wallet or exchange. AutoSwap does not connect to wallets or submit blockchain transactions. ChangeNOW sends the output to the saved destination address.
- Assets that require a destination memo/tag prompt for it, and deposit memos returned by ChangeNOW are displayed with the deposit address. An optional refund address and refund memo/tag can be supplied for ChangeNOW's refund handling.
- The address book stores labeled destination and refund addresses under the signed-in user's Firestore record. Load choices are filtered by purpose, asset, and network; Firestore rules prevent access across user accounts.
- Asset menus are searchable, show popular assets first, and distinguish same-ticker assets on different networks. Send and receive lists use ChangeNOW's direction-specific catalog flags; a quote still verifies that the selected pair and amount are currently available.
- Destinations must be supported cryptocurrency receiving addresses, not account emails. Confirm that the receiving app supports the selected asset and network before relying on a route.
- The app checks ChangeNOW's minimum and estimated receive amount before confirmation. The server binds tunnel creation to the authenticated user's exact route and destination quote, expires quotes after one minute, and consumes each quote once. Standard-flow estimates are still indicative, not a guaranteed quote. Confirm the API key's endpoint access and current v2 response schema before handling real funds.
- Standard-rate routes can optionally set a minimum payout percentage from 97 to 150, inclusive. AutoSwap derives the target payout amount from the exact live estimate and sends that amount as ChangeNOW's `limitEstimate`. The setting is applied to that swap only, displayed again before tunnel creation, and omitted when left blank; fixed-rate routes do not use it.

## Static hosting

The GitHub Actions workflow builds the PWA with the repository path as Vite's base URL and deploys `dist` to GitHub Pages. Add the `VITE_FIREBASE_*` values as repository Actions secrets, then enable GitHub Pages with GitHub Actions as its source. Firebase Functions deploy separately; never add the ChangeNOW secret to Vite environment variables or GitHub Pages.

## Firebase cost controls

- Callable functions require a signed-in, email-verified account and are capped at five instances each to limit burst scaling.
- Saved records are validated server-side and capped at 25 presets and 50 address-book entries per account. The app-wide ceiling is 250 saved-record creates or edits per UTC day; deletes remain available.
- Firestore TTL is enabled for `swapQuotes.expiresAt`. It cleans up unused quotes and confirmed create failures. Successfully tracked exchanges have that field removed and are reconciled server-side; the reconciler also clears the expiry from existing pending records as it processes them. TTL deletion is asynchronous and cannot be undone, so do not restore an expiry on an active exchange.
- Terminal swap records are archived monthly to private Cloud Storage, grouped by tunnel-open month (UTC), and downloadable as CSV. A reconciliation job runs every 15 minutes, checks up to 100 provider-live history records and up to 20 oldest-updated pending exchanges, and continues tracking processing swaps until terminal status. The CSV separates estimate from provider-reported receive amount and includes opened/completed/status timestamps, assets, networks, and transaction hashes; it does not include fiat values or cost basis. The archive runs at 04:00 UTC on the first day of each month; scheduled functions require Cloud Scheduler and a billing-enabled Firebase project. Downloads are served through authenticated Functions.
- The in-app history view loads saved records in pages of 50 and offers a “Load older swaps” control; pending exchanges are loaded separately (up to 50). Archived months remain separate CSV downloads. Archive files are retained indefinitely unless an operator removes them. Configure billing budget alerts in Google Cloud Billing because alerts notify but do not cap spending.