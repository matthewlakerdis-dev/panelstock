The `nexvia-done-syntax-profile-v1.txt` fixture is the complete anonymous syntax
program from the passive NAS inspection. It contains no private links, file
identities, raw Nexvia source or access tokens. Its independently captured SHA-256
is `6f44c66a5ad9719ae1707edabf79724d3cc04fd6ebbdb36ae6a8b5cab317e9b7`.

The companion JavaScript is synthetic test input reconstructed from that anonymous
program, using inert fixture paths and placeholder names/values. It is never
executed. It exercises the exact supported profile and independently checked raw
registration roles. The anonymous fingerprint alone makes no claim of JavaScript
semantic equivalence: raw role checks and runtime request/byte bindings remain
mandatory.
