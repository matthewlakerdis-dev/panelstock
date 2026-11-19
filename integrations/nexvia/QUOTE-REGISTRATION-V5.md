# Nexvia quote registration update v5

Nexvia's immutable SEND callback contains three filename-normalization regular
expressions. The previous registration validator rejected those even after the
whole callback matched its approved SHA-256. Version 5 accepts opaque regex tokens
only for that exact pinned SEND source. Default, DONE and generated-profile parsing
remain strict; changed SEND text is still rejected before parsing.

Protocol 2 keeps its captured DONE profile, raw registration route and metadata
checks, per-page callback binding, one policy lookup, one storage upload, one exact
registration request and original PDF-byte verification. No upload or PO retry is
part of installation. The version 3 and version 4 releases remain immutable.

The self-contained NAS release contains exactly:

- `nexvia_quote_attachment.py`
- `nexvia_quote_registration.py`
- `nexvia_generated_callback.py`

It accepts the exact deployed policy-v2 bridge or an exact rerun of this release.
The creator, watcher, configuration, daily caches, existing request records,
quotes and confirmation records are preserved. The v3 and v4 releases remain immutable.

Run the release using the original Sydney Tools request as read-only evidence:

```sh
/config/nexvia-tools/bin/python -B /config/install_nexvia_quote_registration_update_v5.py --check-request 56d29505-f653-45fe-9dbd-f3bc9f5d4654
```

The script must first be copied into `/config`, or loaded from the published
immutable commit using its verified checksum. Source repository templates do
not contain a payload; use `releases/install_nexvia_quote_registration_update_v5.py`.

Before replacing any module, the installer takes the existing bridge lock and
loads all three candidate modules into an isolated Python process. It opens an
owned read-only draft, validates the supported profile, controller mapping,
renderer ownership and exact page hash, and exercises request matchers using
synthetic metadata. File selection, policy requests, storage uploads, registration
and PO submissions are blocked throughout this check. A compatibility failure
installs nothing and leaves the existing watcher running.

A new `/config/nexvia-registration-v5-checks` directory is made private even if
Synology inherits broader permissions at creation. A pre-existing directory
must already be private; the installer does not change an unknown directory’s
permissions. The report contains fixed stages, finite reason codes and known
source hashes, without native URLs, callback source or credentials.

Existing failed requests are never retried by installation. The original Sydney
Tools request has an accepted storage upload but no saved native-file identity;
this update does not infer that identity, register another file, or clear attempt
markers. Review that request separately before preparing any replacement.

Build and verify the release:

```sh
python -B integrations/nexvia/build_quote_registration_v5_installer.py --output /tmp/install_nexvia_quote_registration_update_v5.py
python -B -m unittest discover -s integrations/nexvia -p test_install_nexvia_quote_registration_update_v5.py
```

Frozen release: **344,346 bytes**. SHA-256:
`50083a30e502a36d547bf1771d9094cda38e1f79b375d130cb5a168933ace9c6`.
