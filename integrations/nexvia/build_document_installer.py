#!/usr/bin/env python3
"""Build the single-file NAS release from reviewed sources and a pinned parser wheel."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import os


def build(wheel, output):
    root = Path(__file__).resolve().parent
    template = (root / 'install_nexvia_document_update.py').read_text()
    marker = 'BUNDLE_BASE64 = ""'
    if template.count(marker) != 1:
        raise ValueError('Installer template has an unexpected payload marker.')
    files = {
        'nexvia_requests.py': (root / 'nexvia_requests.py').read_bytes(),
        'nexvia_po_document.py': (root / 'nexvia_po_document.py').read_bytes(),
        'nexvia-po-vendor/pypdf.whl': Path(wheel).read_bytes(),
    }
    bundle = {name: {'sha256': hashlib.sha256(data).hexdigest(),
                     'contentBase64': base64.b64encode(data).decode('ascii')}
              for name, data in files.items()}
    encoded = base64.b64encode(json.dumps(bundle, sort_keys=True,
                                          separators=(',', ':')).encode()).decode('ascii')
    source = template.replace(marker, 'BUNDLE_BASE64 = ' + repr(encoded))
    namespace = {'__name__': 'packaged_installer_validation'}
    exec(compile(source, 'install_nexvia_document_update.py', 'exec'), namespace)
    if namespace['decoded_payload']() != files:
        raise ValueError('Packaged installer does not reproduce the reviewed source files.')
    output = Path(output)
    descriptor, temporary = tempfile.mkstemp(prefix='.nexvia-document-release-', dir=output.parent)
    try:
        os.fchmod(descriptor, 0o644)
        with os.fdopen(descriptor, 'wb') as stream:
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
    parser.add_argument('--wheel', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    digest, size = build(args.wheel, args.output)
    print('Built:', args.output)
    print('Bytes:', size)
    print('SHA-256:', digest)


if __name__ == '__main__':
    main()
