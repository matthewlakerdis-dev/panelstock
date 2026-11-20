# Nexvia quote registration update v7

Version 7 accepts the exact native renderer suffix `?`, which contains no query
parameters. For that empty query, the native jQuery `?&_=digits` cache buster is
normalized only when it contains 1–20 decimal digits. Every other renderer suffix
keeps the existing strict query validation. Renderer requests still require the
exact origin, path and native file ID bound to that registration. Registration
protocol remains version 2.

The version 6 NAS preflight stopped before installation. This release accepts the
exact deployed policy-v2 bridge with the registration and generated-profile
helpers absent, or an exact rerun of version 7. It does not accept a mixed release.
The version 3 through version 6 archives remain immutable; their default builders
reproduce the frozen releases independently of current runtime sources.

The self-contained NAS release contains exactly:

- `nexvia_quote_attachment.py`
- `nexvia_quote_registration.py`
- `nexvia_generated_callback.py`

The quote attachment and generated-profile module bytes are unchanged from
version 6. The creator, watcher, preparation diagnostics, configuration, daily
caches, existing request records, quotes and confirmation records are preserved.

Run the release using the original Sydney Tools request as read-only evidence:

```sh
/config/nexvia-tools/bin/python -B /config/install_nexvia_quote_registration_update_v7.py --check-request 56d29505-f653-45fe-9dbd-f3bc9f5d4654
```

Copy the frozen release into `/config` and verify its checksum before running it.
Source repository templates contain no payload; use
`releases/install_nexvia_quote_registration_update_v7.py`.

Before replacing any module, the installer takes the existing bridge lock and
loads all three candidate modules into an isolated Python process. It opens a
fresh owned read-only draft, validates the supported profile, controller mapping,
renderer ownership and exact page hash, and exercises request matchers using
synthetic metadata. File selection, policy requests, storage uploads,
registration and PO submissions are blocked throughout this check. A compatibility
failure installs nothing and leaves the existing watcher running.

The installer verifies unchanged source snapshots, saved request evidence and
configuration around the preflight. Only after it succeeds does the installer
stop an idle watcher, save private backups in
`/config/nexvia-backup-before-quote-registration-v7-update`, and atomically publish
the three modules. A failed contract check restores the known prior modules and
restarts only the known prior watcher when its state remains verified.

A new `/config/nexvia-registration-v7-checks` directory is made private even if
Synology inherits broader permissions at creation. A pre-existing directory must
already be private. The report contains fixed stages, finite reason codes and
known source hashes, without native URLs, callback source or credentials.

Existing failed requests are never retried by installation. The original Sydney
Tools request has an accepted storage upload but no saved native-file identity;
this update does not infer that identity, register another file or clear attempt
markers. Review that request separately before preparing any replacement.

Build and verify the release:

```sh
python -B integrations/nexvia/build_quote_registration_v7_installer.py --output /tmp/install_nexvia_quote_registration_update_v7.py
python -B -m unittest discover -s integrations/nexvia -p test_install_nexvia_quote_registration_update_v7.py
python -B -m unittest discover -s integrations/nexvia -p test_quote_registration_v7_release_archive.py
```

Frozen release: **354,562 bytes**. SHA-256:
`82f07ee1def4254a8933509a9237c5aca984d52631f703a6fccd57616662c004`.

Archived payload SHA-256 values:

| Module | SHA-256 |
| --- | --- |
| `nexvia_quote_attachment.py` | `151efe0705c3257b95c256b93400037fc7c1d4815cd8e282b5e45cc2418a98ac` |
| `nexvia_quote_registration.py` | `202882c5a10cda7f57b2cb3e11f0d3af774e2cd57b654eaf9f9797b820a94596` |
| `nexvia_generated_callback.py` | `3c1458b84858b6b6f6e25f69dbbdc487208684f1379d80778f89d21b292a0be4` |
