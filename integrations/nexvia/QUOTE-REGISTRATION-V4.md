# Nexvia quote registration update v4

The native quote uploader generates UI identifiers in its completion callback.
A single global callback-text hash therefore rejected otherwise supported pages.
Protocol 2 accepts only the captured anonymous syntax profile, verifies the raw
registration route and data mapping, and binds each owned page to that page’s
actual callback hash before any upload starts. The fixed SEND callback, one
policy lookup, one storage upload, one exact registration request and original
PDF-byte verification still apply.

The self-contained NAS release contains exactly:

- `nexvia_quote_attachment.py`
- `nexvia_quote_registration.py`
- `nexvia_generated_callback.py`

It accepts the exact deployed policy-v2 bridge or an exact rerun of this release.
The creator, watcher, configuration, daily caches, existing request records,
quotes and confirmation records are preserved. The v3 release remains immutable.

Run the release using the original Sydney Tools request as read-only evidence:

```sh
/config/nexvia-tools/bin/python -B /config/install_nexvia_quote_registration_update_v4.py --check-request 56d29505-f653-45fe-9dbd-f3bc9f5d4654
```

The script must first be copied into `/config`, or loaded from the published
immutable commit using its verified checksum. Source repository templates do
not contain a payload; use `releases/install_nexvia_quote_registration_update_v4.py`.

Before replacing any module, the installer takes the existing bridge lock and
loads all three candidate modules into an isolated Python process. It opens an
owned read-only draft, validates the supported profile, controller mapping,
renderer ownership and exact page hash, and exercises request matchers using
synthetic metadata. File selection, policy requests, storage uploads, registration
and PO submissions are blocked throughout this check. A compatibility failure
installs nothing and leaves the existing watcher running.

A new `/config/nexvia-registration-v4-checks` directory is made private even if
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
python -B integrations/nexvia/build_quote_registration_v4_installer.py --output /tmp/install_nexvia_quote_registration_update_v4.py
python -B -m unittest discover -s integrations/nexvia -p test_install_nexvia_quote_registration_update_v4.py
```

Frozen release: **343,306 bytes**. SHA-256:
`c496ebc746ff3366bbab3f752869f0ef2e83f60dd8e6f9575551fb53e650e4a7`.
