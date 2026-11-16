#!/usr/bin/env python3
"""Package the passive DONE probe with its frozen, previously reviewed runtime."""
import argparse
import base64
import hashlib
from pathlib import Path
import zlib


def build(root=None):
    root = Path(__file__).parent if root is None else Path(root)
    frozen = (root / "releases/check_nexvia_quote_policy_v2.py").read_bytes()
    if hashlib.sha256(frozen).hexdigest() != "bfa5c5f5afebd7033a09fd61f66b00e8222f1e0689118ad6281ce7b4686d35a4":
        raise ValueError("Frozen runtime release changed")
    template = (root / "nexvia_inspect_quote_registration.py").read_text()
    marker = 'FROZEN_BASE64 = ""'
    if template.count(marker) != 1: raise ValueError("Unexpected payload marker")
    result = template.replace(marker, "FROZEN_BASE64 = " + repr(base64.b64encode(zlib.compress(frozen, 9)).decode())).encode()
    if len(result) > 1024 * 1024: raise ValueError("Probe exceeds loader limit")
    compile(result, "passive_registration_probe", "exec")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "releases/inspect_nexvia_quote_registration_v1.py")
    args = parser.parse_args()
    result = build()
    args.output.write_bytes(result)
    print("SHA256:", hashlib.sha256(result).hexdigest(), "Bytes:", len(result))


if __name__ == "__main__": main()
