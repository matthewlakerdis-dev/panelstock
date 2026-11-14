#!/usr/bin/env python3
"""Package reviewed quote bridge modules into one checksummed NAS installer."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile


def build(output, source_root=None):
    root = Path(source_root) if source_root is not None else Path(__file__).resolve().parent
    template = (root / "install_nexvia_quote_update.py").read_text()
    marker = 'BUNDLE_BASE64 = ""'
    if template.count(marker) != 1:
        raise ValueError("Installer template has an unexpected payload marker.")
    namespace = {"__name__": "quote_installer_packaging_validation"}
    exec(compile(template, "install_nexvia_quote_update.py", "exec"), namespace)
    files = {name: (root / name).read_bytes() for name in namespace["FILES"]}
    bundle = {name: {"sha256": hashlib.sha256(data).hexdigest(),
                     "contentBase64": base64.b64encode(data).decode("ascii")}
              for name, data in files.items()}
    encoded = base64.b64encode(json.dumps(bundle, sort_keys=True,
                                          separators=(",", ":")).encode()).decode("ascii")
    source = template.replace(marker, "BUNDLE_BASE64 = " + repr(encoded))
    namespace = {"__name__": "quote_packaged_installer_validation"}
    exec(compile(source, "install_nexvia_quote_update.py", "exec"), namespace)
    if namespace["decoded_payload"]() != files:
        raise ValueError("Packaged installer differs from its reviewed sources.")
    output = Path(output)
    if output.is_symlink():
        raise ValueError("The installer destination must not be a symlink.")
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-quote-release-", dir=output.parent)
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
