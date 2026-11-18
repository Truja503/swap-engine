# RGB asset capability model — status

## Status

Experimental model only. `src/rgb/AssetCapability.ts` is not imported by the swap
runner, API, Bitcoin, Liquid or persistence code. This is **not** RGB support and
must not be described as RGB support. No wallet, node, consignment, Lightning,
signing, broadcasting, payment or network behavior is added.

The only new code is `src/rgb/AssetCapability.ts`, its unit tests
`tests/rgb-asset-capability.test.ts`, and this note. No production wiring and no
new dependencies.

## What the model covers

- Asset identity: network, 32-byte contract ID, asset kind, quantity precision.
- Quantities in integer atomic asset units using `bigint`; safe integer numbers
  are accepted and converted; unsafe numbers, fractions, negatives and
  non-canonical strings are rejected.
- Verification state: `unknown`, `unverified` or `verified`. Only `verified`
  counts as verified. `unknown` means no information was supplied; `unverified`
  means a check was explicitly recorded as unsuccessful.
- Strict, versioned JSON serialization with exact key sets and canonical
  quantity strings. Bigint quantities are serialized as decimal strings so they
  never pass through JavaScript number precision.

Bitcoin satoshis are deliberately absent. Asset quantities are atomic units of
an RGB asset and are never interpreted, converted or compared as sats.

## Data-format references and explicit assumptions

Reference names are cited from public RGB protocol documentation; no RGB code is
vendored here, no revision is pinned, and no external source was fetched while
writing this model. Treat the encoding details below as assumptions and pin the
RGB Core and RGB Schemata revisions before any production use.

- **Contract ID:** RGB Core defines contract IDs as 256-bit (32-byte) contract
  identifiers. Assumption: this model transports the identifier as 64
  hexadecimal characters and canonicalizes it to lowercase. RGB tooling may
  display the same bytes in another encoding (for example base64); that display
  encoding is not modeled here.
- **Asset kind:** Assumption: `fungible` corresponds to RGB20-style fungible
  assets and `non-fungible` corresponds to RGB21-style collectible assets. The
  model records only the kind, not the schema name or schema validation.
  Non-fungible assets are required to have precision `0`.
- **Precision:** Assumption: precision is an integer from `0` to `18`, matching
  the decimal precision range used for fungible asset display. This is a model
  bound, not a claim that every RGB schema uses the same bound.
- **Networks:** `bitcoin-mainnet`, `bitcoin-testnet`, `bitcoin-signet`,
  `bitcoin-regtest`, `liquid-mainnet`, `liquid-testnet`, `liquid-regtest` are
  internal identifiers. They are not claimed to be the canonical network names
  used by RGB consensus or by any specific RGB implementation.
- **Verification:** Assumption: `verified` means a caller supplied non-empty
  method and evidence plus a non-negative timestamp. This is an attestation
  record, not cryptographic consignment validation and not proof of issuance,
  ownership, supply, inflation control or transferability.
- **Quantities:** Assumption: quantities are non-negative integer atomic units
  with no upper bound in this model. Decimal formatting is exact bigint string
  math; no floating-point conversion is used.

Consequently, syntactic validation of an identity or capability is not RGB
consensus validation, not a proof that a contract exists on any network, and not
evidence that an asset can be swapped.

## Tests

Run:

```sh
npm run build
npm test
```

The added tests are pure unit tests with mocked verification evidence; they do
not contact any node, registry, indexer, wallet or network.
