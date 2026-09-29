# Site Orders address transition

Preferred address: **https://site.panelstockhq.com/**

Retired addresses: **https://app.panelstockhq.com/site/** and **https://app.panelstockhq.com/site-orders/** now redirect directly to the preferred address. On 29 September 2026 the owner confirmed the new address works and all old pending orders were done, authorizing retirement.

## Moving a phone

1. Open the new address while online and sign in with the same username and PIN. Accounts, permissions and submitted orders use the same backend; no data import is needed.
2. Add the new address to the phone's home screen. Confirm Orders and CNC access match the user's permissions, then remove the old shortcut.
3. Old links redirect directly. Old installed shortcuts redirect after receiving the retirement service-worker update online. An offline device may display its cached old screen until it reconnects.

Sessions, saved project lists and unsent requests are stored per browser origin. They do not automatically transfer to the new address. Retirement does not delete local storage, sessions or queues, or modify any order records. Only old `panelstock-site-` asset caches are removed; factory caches are retained. If an unexpected unsent request is discovered, preserve browser storage and arrange recovery before recreating it. Never copy authentication tokens between domains.

## Deployment

- The production workflow tests the backend and new public asset package, deploys the API origin allowance first, then deploys the assets-only `panelstock-site-orders` Worker and custom domain.
- Build from `worker/` with `npm run build:site`; validate with `npx wrangler deploy --config wrangler.site-orders.jsonc --dry-run`.
- Only explicitly listed public assets are included. No Worker API source, credentials, private backups, or stock records are hosted with the site.
- The new deployment serves Site Orders at `/` with its own manifest and offline cache. Its active HTML and service-worker sources are in `worker/templates/site-orders/`, separate from the retired GitHub Pages entry pages.
- The mobile app's CNAME and root app remain unchanged. The old page, legacy entry and cached-page loader redirect to the new domain without forwarding old query strings or fragments. The retired `/site/sw.js` handles old shortcuts only.
- API `/site/cnc` remains unchanged. API responses and authenticated requests are not cached by the service worker.

## Verification and rollback

Check HTTPS, the rendered sign-in screen, all manifest icons, root service-worker registration, API preflight permission, and a 401 response to an unauthenticated order request. Verify an authenticated user's order list and a phone installation without submitting test production orders.

Verify both retired paths redirect to the new sign-in screen while the main `app.panelstockhq.com/` still loads normally. Keep both mobile and desktop API origins allowed.

If the new address needs a fix, roll back the standalone static deployment to its prior working version. Restoring the old UI requires reverting the retirement entry pages, loader and service worker together and deploying GitHub Pages; simply changing DNS will not restore it. Do not clear browser storage during recovery. No inventory database rollback or migration is required.
