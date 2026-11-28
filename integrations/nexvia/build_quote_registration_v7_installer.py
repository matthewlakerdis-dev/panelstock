#!/usr/bin/env python3
"""Package the generated-callback registration update into one checksummed NAS installer."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile


ARCHIVE = "releases/install_nexvia_quote_registration_update_v7.py"
ARCHIVE_SHA256 = '82f07ee1def4254a8933509a9237c5aca984d52631f703a6fccd57616662c004'


def build(output, source_root=None):
    root = Path(source_root) if source_root is not None else Path(__file__).resolve().parent
    if source_root is None:
        source = (root / ARCHIVE).read_bytes()
        if hashlib.sha256(source).hexdigest() != ARCHIVE_SHA256:
            raise ValueError("The immutable registration-v7 installer changed.")
        return _publish(output, source.decode())
    template = (root / "install_nexvia_quote_registration_update_v7.py").read_text()
    marker = 'BUNDLE_BASE64 = ""'
    if template.count(marker) != 1:
        raise ValueError("Installer template has an unexpected payload marker.")
    namespace = {"__name__": "quote_registration_v7_installer_packaging_validation"}
    exec(compile(template, "install_nexvia_quote_registration_update_v7.py", "exec"), namespace)
    files = {name: (root / name).read_bytes() for name in namespace["FILES"]}
    bundle = {name: {"sha256": hashlib.sha256(data).hexdigest(),
                     "contentBase64": base64.b64encode(data).decode("ascii")}
              for name, data in files.items()}
    encoded = base64.b64encode(json.dumps(bundle, sort_keys=True,
                                          separators=(",", ":")).encode()).decode("ascii")
    source = template.replace(marker, "BUNDLE_BASE64 = " + repr(encoded))
    namespace = {"__name__": "quote_registration_v7_packaged_installer_validation"}
    exec(compile(source, "install_nexvia_quote_registration_update_v7.py", "exec"), namespace)
    try:
        decoded = namespace["decoded_payload"]()
    except namespace["QuotePolicyUpdateError"]:
        raise ValueError("Packaged installer policy pins or contents are invalid.") from None
    if decoded != files:
        raise ValueError("Packaged installer differs from its reviewed sources.")
    return _publish(output, source)


def _publish(output, source):
    output = Path(output)
    if output.is_symlink():
        raise ValueError("The installer destination must not be a symlink.")
    for version, relative in ((3, "releases/install_nexvia_quote_registration_update_v3.py"),
                              (4, "releases/install_nexvia_quote_registration_update_v4.py"),
                              (5, "releases/install_nexvia_quote_registration_update_v5.py"),
                              (6, "releases/install_nexvia_quote_registration_update_v6.py"),
                              (7, ARCHIVE)):
        archive = Path(__file__).resolve().parent / relative
        if output.resolve() == archive.resolve() or (output.exists() and archive.exists()
                                                    and os.path.samefile(output, archive)):
            raise ValueError("The immutable registration-v" + str(version) + " archive must not be overwritten.")
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-quote-registration-v7-release-", dir=output.parent)
    try:
        os.fchmod(descriptor, 0o644)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(source.encode())
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return hashlib.sha256(source.encode()).hexdigest(), len(source.encode())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    checksum, size = build(args.output)
    print("Built:", args.output)
    print("Bytes:", size)
    print("SHA-256:", checksum)


if __name__ == "__main__":
    main()
