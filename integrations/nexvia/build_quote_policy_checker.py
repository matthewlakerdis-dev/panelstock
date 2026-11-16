#!/usr/bin/env python3
"""Build the deterministic standalone policy-only diagnostic, never run it."""
import argparse
import ast
import base64
import hashlib
from pathlib import Path


SNAPSHOT = "releases/check_nexvia_quote_policy_v1.py"
SNAPSHOT_SHA256 = "f9f64d8c01b92c0aa6f24b2ebcf84d64c99af7e2389d938ae796fe4e05800ece"


def bundle(root):
    # A diagnostic must keep the validator that observed the failure, even
    # after the installed upload validator is corrected. Extract literals from
    # the immutable release without executing it or reading current modules.
    source = (root / SNAPSHOT).read_bytes()
    if len(source) > 1024 * 1024 or hashlib.sha256(source).hexdigest() != SNAPSHOT_SHA256:
        raise ValueError("The immutable diagnostic snapshot changed.")
    values = {}
    for statement in ast.parse(source).body:
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1 \
                and isinstance(statement.targets[0], ast.Name) \
                and statement.targets[0].id in {"BUNDLE_BASE64", "BUNDLE_SHA256"}:
            name = statement.targets[0].id
            if name in values:
                raise ValueError("Duplicate diagnostic snapshot marker.")
            values[name] = ast.literal_eval(statement.value)
    if set(values) != {"BUNDLE_BASE64", "BUNDLE_SHA256"}:
        raise ValueError("Diagnostic snapshot markers are missing.")
    compressed = base64.b64decode(values["BUNDLE_BASE64"], validate=True)
    if hashlib.sha256(compressed).hexdigest() != values["BUNDLE_SHA256"]:
        raise ValueError("Diagnostic snapshot payload changed.")
    return compressed


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
