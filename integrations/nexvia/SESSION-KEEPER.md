# Keep the NAS Nexvia browser signed in

The session keeper is an optional companion to the existing purchase-request
bridge. It checks Nexvia's authenticated project page every five minutes,
uses the native email/password sign-in form when the session expires, and
keeps one dedicated staff tab open in Chromium's persistent context. It
selects Nexvia's native Remember Me option when available.

It restores the browser session only. It never retries a purchase request,
resubmits a PO, uploads a quote or edits existing request journals. Failed
requests still follow the existing review workflow. The reference-data cache
keeps its existing daily refresh schedule.

## Install and configure

Run the published checksum-verified `install_nexvia_session_keeper_v1.py`
release in the existing `nexvia-browser` container with `--configure`. The
installer adds only:

- `/config/nexvia_session_keeper.py`
- `/config/nexvia_session_browser.py`

Existing bridge modules, connection settings and request records are not
replaced. The installation preflight imports reviewed local contracts only;
it does not connect to Chromium or sign into Nexvia. Interactive setup then
checks the actual native login form and current session without forcing a
sign-out.

Use an HTTPS-, SSH- or VPN-protected NAS terminal for credential setup. Enter
the Nexvia username and password there when prompted. The password prompt is
hidden and uses `/dev/tty`, including when the verified
installer itself was streamed on standard input. Do not put credentials in a
command, chat message or Git file.

Credentials stay in `/config/nexvia-session/credentials.json`, mode `600`,
inside a private directory with mode `700`. The session state and keeper log
are also private. The code does not print passwords, cookie values, CSRF
tokens or usernames in its status output. Configuring an already signed-in
browser preserves the current login; the next real expiry exercises automatic
sign-in.

The keeper uses the same work lock as the PO bridge and waits while a request
is being handled. Incorrect credentials, a changed or unsupported sign-in
form, MFA or CAPTCHA can require a manual sign-in. It does not bypass those
challenges or keep rapidly submitting a failed password. Its local status
explains when attention is needed. After a rejected password or challenge,
run `--configure` again before expecting another automatic sign-in; signing
in manually restores access without silently re-enabling a paused password.

## Resume after a NAS or container restart

In Synology **Control Panel → Task Scheduler**, create a **Scheduled Task →
User-defined script**:

- Task: `Nexvia session keeper`
- User: `root`
- Schedule: every day, repeat every five minutes
- Script:

```sh
/usr/local/bin/docker exec -d nexvia-browser /config/nexvia-tools/bin/python -B /config/nexvia_session_keeper.py --watch
```

The installer starts the first watcher immediately after successful setup.
The scheduled command makes it available again after a container restart.
The keeper's private lifetime lock makes repeated starts harmless; an
existing watcher is reused. This task is separate from the existing
PanelStock Nexvia request-bridge task.

The container's `/config` folder must remain mounted to persistent NAS storage.
Setup reports whether the Chromium profile itself appears to be under
`/config`; an unknown result is not a persistence guarantee. Saved credentials
remain local to the mounted configuration folder.

## Status and changes

From the NAS container terminal:

```sh
/config/nexvia-tools/bin/python -B /config/nexvia_session_keeper.py --status
```

Update saved credentials by running `--configure` again. To disable automatic
sign-in, run:

```sh
/config/nexvia-tools/bin/python -B /config/nexvia_session_keeper.py --disable
```

The keeper will no longer submit a sign-in form while disabled. The existing
Nexvia session and request bridge continue independently.
