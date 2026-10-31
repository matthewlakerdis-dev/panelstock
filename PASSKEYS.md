# Optional passkey sign-in

Users can keep signing in with their username and PIN. Passkeys add device verification through Face ID, fingerprint, device unlock, or a FIDO2 security key; PanelStock does not receive biometric data. A passkey works across Web, Mobile and Site under the `panelstockhq.com` relying-party ID. Each sign-in still checks the user's current account status, app access and permissions.

## Setup and use

After the first successful PIN sign-in in a supported browser, users are offered **Enable fingerprint or Face ID?**. Enrollment is optional and requests the device’s built-in authenticator. **Not now** dismisses future automatic offers for that account in this browser; **This is a shared device** suppresses automatic offers for all accounts in this browser. Only the preference and credential ID are stored locally, never the PIN or biometric data. Once enabled, the sign-in button opens the device unlock prompt directly. A compatible browser, credential provider and configured device unlock are required; the website cannot bypass missing platform support.

For later setup, open **My Profile** on Web/Mobile or **Settings** on Site, then **Set up or manage passkeys**. Choose the device type, name the passkey, and confirm the current PIN. Personal devices may store their own passkey. On shared devices, setup requests an external authenticator: choose a personal phone or security key rather than a shared device account. Browser support for cross-device sign-in prompts varies. Always sign out after using a shared device.

The sign-in screen's **Sign in with passkey** button opens the browser's account/device chooser; entering a username first is not required. PIN sign-in remains available, including on older browsers without passkey support.

Users can remove their own passkeys. Administrators can remove a user's passkeys from **User Access → Manage user passkeys**, but cannot enroll on behalf of that user. Removing a passkey signs that user out. Resetting or changing a PIN revokes all of the user's passkeys; the user can then enroll again after recovering the account. Username changes preserve passkeys, while account deactivation or removal blocks them.

## Implementation and release

The Worker uses pinned `@simplewebauthn/server` verification, user-verification-required credentials and five-minute, one-use challenges bound to their purpose, origin, and (for enrollment) authenticated session. Enrollment requires the current PIN. Credentials store only public verification data, counters and labels. Existing account/session and stock outbox protections apply to passkey sign-in.

The Site asset `site/passkeys.js` and the desktop asset `passkeys.js` are identical and must be updated together. The Site build explicitly packages this asset; Mobile loads it from `site/`. Deploy the Worker before the frontends for initial rollout, and preserve the existing production audience and origin allowlist. No external identity service or biometric-secret configuration is required.

`worker/test/passkeys.test.mjs` exercises real WebAuthn registration and signed assertions using synthetic ES256 authenticators against the local Worker, including rejection, app permissions, reset, removal, and rename cases. `test/passkeys-ui.test.cjs` checks shared-device choices, browser cancellation, unsupported-browser fallback and registration data. Session tests verify passkey sign-in does not discard pending changes or accept stale account responses. Physical Face ID/fingerprint and cross-device prompts need a check on the actual devices used by the team.

## Staging

The `codex/passkeys-20261031` branch deploys only the existing staging Worker. Its Web, Mobile and Site test apps use the staging Worker domain as a separate relying-party ID. Passkeys enrolled there cannot be used to sign in to the live apps. Staging email delivery remains disabled, and the staging script does not enable migration or modify production bindings.
