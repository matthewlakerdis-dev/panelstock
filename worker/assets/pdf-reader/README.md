PDF.js legacy browser build, version 6.4.299, from the `pdfjs-dist` npm package.

The core, worker, standard fonts and non-WASM image decoders are compressed into `src/safety-reader-assets.js` and served as public, versioned assets. Uploaded documents remain behind the existing authenticated file API and are not stored in these assets. Dynamic evaluation and WASM are disabled in the reader.

Upstream: https://github.com/mozilla/pdf.js
Package SHA-256: 86269b40170eb41740ea05ad2102d71d33de4f122b34eb2f478be0ea7779c415
