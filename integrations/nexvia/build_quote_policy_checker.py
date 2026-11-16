#!/usr/bin/env python3
"""Build the deterministic standalone policy-only diagnostic, never run it."""
import argparse
import ast
import base64
import hashlib
import json
from pathlib import Path
import zlib


FILES = ("nexvia_quote_attachment.py", "nexvia_preparation_diagnostics.py", "nexvia_inspect_failed_quote_upload.py")


def bundle(root):
    manifest = {}
    for name in FILES:
        source = (root / name).read_bytes()
        compile(source, name, "exec")
        manifest[name] = {"sha256": hashlib.sha256(source).hexdigest(), "source": base64.b64encode(source).decode()}
    raw = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return zlib.compress(raw, 9)


def build(root=None):
    root = Path(__file__).parent if root is None else Path(root)
    template = (root / "nexvia_check_quote_policy.py").read_text()
    compressed = bundle(root)
    source = template.replace('BUNDLE_BASE64 = ""', 'BUNDLE_BASE64 = ' + repr(base64.b64encode(compressed).decode()), 1)
    source = source.replace('BUNDLE_SHA256 = ""', 'BUNDLE_SHA256 = ' + repr(hashlib.sha256(compressed).hexdigest()), 1)
    if len(source.encode()) > 1024 * 1024:
        raise ValueError("Diagnostic release exceeds one MiB")
    ast.parse(source)
    return source.encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "releases/check_nexvia_quote_policy_v2.py")
    args = parser.parse_args()
    result = build()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(result)
    print(hashlib.sha256(result).hexdigest(), str(args.output), len(result))


if __name__ == "__main__":
    main()
