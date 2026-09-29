# Site Orders address transition

Preferred address: **https://site.panelstockhq.com/**

Existing address: **https://app.panelstockhq.com/site/** — keep this available; do not force a redirect during the transition.

## Moving a phone

1. Open the existing Site Orders shortcut while online and sign in as the owner of any pending orders.
2. Confirm the old app shows no requests waiting to sync. Check the submitted orders are visible before switching. Do not clear browser storage or uninstall the old shortcut while requests are pending.
3. Open the new address and sign in with the same username and PIN. Accounts, permissions and submitted orders use the same backend; no data import is needed.
4. Add the new address to the phone's home screen. Open that new shortcut and confirm Orders and CNC access match the user's permissions.
5. Remove the old shortcut only after confirming all pending requests were submitted. The old address remains available if another device still needs to sync.

Sessions, saved project lists and unsent requests are stored per browser origin. They do not automatically transfer to the new address. Do not copy authentication tokens or local queues between domains, and do not recreate pending requests before checking the originals.

## Deployment

- The production workflow tests the backend and new public asset package, deploys the API origin allowance first, then deploys the assets-only `panelstock-site-orders` Worker and custom domain.
- Build from `worker/` with `npm run build:site`; validate with `npx wrangler deploy --config wrangler.site-orders.jsonc --dry-run`.
- Only explicitly listed public assets are included. No Worker API source, credentials, private backups, or stock records are hosted with the site.
- The new deployment serves Site Orders at `/` with its own manifest and offline cache. It does not change GitHub Pages, the mobile app's CNAME, existing `/site/` files, or inventory storage.
- API `/site/cnc` remains unchanged. API responses and authenticated requests are not cached by the service worker.

## Verification and rollback

Check HTTPS, the rendered sign-in screen, all manifest icons, root service-worker registration, API preflight permission, and a 401 response to an unauthenticated order request. Verify an authenticated user's order list and a phone installation without submitting test production orders.

If the new address needs a fix, users can continue at the old address after syncing any pending requests at the address where they were created. Do not remove either origin from the API allowlist or redirect it while devices may have pending requests there. Revert only the new static deployment if necessary; no inventory database rollback or migration is required.
