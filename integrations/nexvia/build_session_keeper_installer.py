#!/usr/bin/env python3
"""Build the standalone, checksum-bound NAS session-keeper installer."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile


ARCHIVE_SHA256 = "bb75bd30aff0af1d04122dcc213c94b93a05dc94b56e2faf274dee648ee29990"

def build(output, source_root=None):
    root = Path(source_root) if source_root is not None else Path(__file__).resolve().parent
    if source_root is None:
        archive = root / "releases/install_nexvia_session_keeper_v1.py"
        release = archive.read_bytes()
        if hashlib.sha256(release).hexdigest() != ARCHIVE_SHA256:
            raise ValueError("The immutable v1 session release changed.")
        return _publish(output, release)
    template = (root / "install_nexvia_session_keeper.py").read_text()
    marker = 'BUNDLE_BASE64 = ""'
    if template.count(marker) != 1:
        raise ValueError("The session installer payload marker differs.")
    namespace = {"__name__": "session_installer_packaging"}
    exec(compile(template, "install_nexvia_session_keeper.py", "exec"), namespace)
    files = {name: (root / name).read_bytes() for name in sorted(namespace["FILES"])}
    manifest = {"format": "nexvia-session-keeper-release", "version": 1,
        "files": {name: {"sha256": hashlib.sha256(data).hexdigest(),
                         "contentBase64": base64.b64encode(data).decode("ascii")}
                  for name, data in files.items()}}
    encoded = base64.b64encode(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).decode()
    release = template.replace(marker, "BUNDLE_BASE64 = " + repr(encoded)).encode()
    if len(release) > 1048576:
        raise ValueError("The session keeper installer exceeds its release limit.")
    namespace = {"__name__": "session_installer_release_check"}
    exec(compile(release, "session_installer_release", "exec"), namespace)
    if namespace["decoded_payload"]() != files:
        raise ValueError("The session keeper payload differs from its sources.")
    return _publish(output, release)


def _publish(output, release):
    output = Path(output)
    if output.is_symlink():
        raise ValueError("The release destination must not be a symlink.")
    archive = Path(__file__).resolve().parent / "releases/install_nexvia_session_keeper_v1.py"
    if output.resolve() == archive.resolve() or (output.exists() and archive.exists() and os.path.samefile(output, archive)):
        raise ValueError("The immutable v1 session release must not be overwritten.")
    descriptor, temporary = tempfile.mkstemp(prefix=".nexvia-session-release-", dir=output.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o644)
            stream.write(release)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return hashlib.sha256(release).hexdigest(), len(release)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    checksum, size = build(args.output)
    print("Bytes:", size)
    print("SHA-256:", checksum)


if __name__ == "__main__":
    main()
