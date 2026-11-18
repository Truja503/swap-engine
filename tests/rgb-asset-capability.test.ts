import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RGB_ASSET_CAPABILITY_SCHEMA,
  RGB_ASSET_IDENTITY_SCHEMA,
  RGB_ASSET_MODEL_VERSION,
  RgbAssetModelError,
  createAssetCapability,
  deserializeAssetCapability,
  deserializeAssetIdentity,
  formatAtomicQuantity,
  formatDecimalQuantity,
  isVerified,
  parseAssetIdentity,
  parseAtomicQuantity,
  parseDecimalQuantity,
  parseVerification,
  serializeAssetCapability,
  serializeAssetIdentity,
} from '../src/rgb/AssetCapability.js';

const CONTRACT_ID = 'ab'.repeat(32);
const UPPER_CONTRACT_ID = CONTRACT_ID.toUpperCase();
const CHECKED_AT = 1_700_000_000_000;

function identity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    network: 'bitcoin-testnet',
    contractId: CONTRACT_ID,
    kind: 'fungible',
    precision: 8,
    ...overrides,
  };
}

function unknownVerification(): Record<string, unknown> {
  return { status: 'unknown' };
}

function unverifiedVerification(): Record<string, unknown> {
  return {
    status: 'unverified',
    method: 'mock-consignment-check',
    reason: 'mock verifier did not return a valid attestation',
    checkedAt: CHECKED_AT,
  };
}

function verifiedVerification(): Record<string, unknown> {
  return {
    status: 'verified',
    method: 'mock-consignment-check',
    evidence: 'mock-attestation:contract-1',
    verifiedAt: CHECKED_AT,
  };
}

function capability(
  quantity: unknown = '12345678901234567890',
  verification: Record<string, unknown> = verifiedVerification(),
  identityOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    identity: identity(identityOverrides),
    quantity: { atomic: quantity },
    verification,
  };
}

function capabilityDocument(): Record<string, unknown> {
  return {
    schema: RGB_ASSET_CAPABILITY_SCHEMA,
    version: RGB_ASSET_MODEL_VERSION,
    ...capability(),
  };
}

test('parseAssetIdentity accepts a valid identity and canonicalizes the contract ID', () => {
  const parsed = parseAssetIdentity(identity({ contractId: UPPER_CONTRACT_ID }));

  assert.equal(parsed.network, 'bitcoin-testnet');
  assert.equal(parsed.contractId, CONTRACT_ID);
  assert.equal(parsed.kind, 'fungible');
  assert.equal(parsed.precision, 8);
  assert.ok(Object.isFrozen(parsed));
});

test('parseAssetIdentity rejects malformed identities', () => {
  assert.throws(() => parseAssetIdentity(null), RgbAssetModelError);
  assert.throws(() => parseAssetIdentity([]), RgbAssetModelError);
  assert.throws(() => parseAssetIdentity('identity'), RgbAssetModelError);
  assert.throws(
    () => parseAssetIdentity({ network: 'bitcoin-testnet', contractId: CONTRACT_ID, kind: 'fungible' }),
    /exactly these keys/,
  );
  assert.throws(() => parseAssetIdentity(identity({ amountSats: 50_000 })), /exactly these keys/);
  assert.throws(() => parseAssetIdentity(identity({ network: 'bitcoin' })), /Unsupported RGB network/);
  assert.throws(() => parseAssetIdentity(identity({ network: 'Bitcoin-Testnet' })), /Unsupported RGB network/);
  assert.throws(() => parseAssetIdentity(identity({ contractId: 'ab'.repeat(31) })), /contract ID/);
  assert.throws(() => parseAssetIdentity(identity({ contractId: 'zz'.repeat(32) })), /contract ID/);
  assert.throws(() => parseAssetIdentity(identity({ contractId: ` ${CONTRACT_ID}` })), /contract ID/);
  assert.throws(() => parseAssetIdentity(identity({ kind: 'nft' })), /Unsupported RGB asset kind/);
  assert.throws(() => parseAssetIdentity(identity({ precision: -1 })), /precision/);
  assert.throws(() => parseAssetIdentity(identity({ precision: 19 })), /precision/);
  assert.throws(() => parseAssetIdentity(identity({ precision: 1.5 })), /precision/);
  assert.throws(() => parseAssetIdentity(identity({ precision: NaN })), /precision/);
  assert.throws(
    () => parseAssetIdentity(identity({ kind: 'non-fungible', precision: 1 })),
    /Non-fungible/,
  );
});

test('parseAssetIdentity accepts non-fungible identities only at precision zero', () => {
  const parsed = parseAssetIdentity(identity({ kind: 'non-fungible', precision: 0 }));

  assert.equal(parsed.kind, 'non-fungible');
  assert.equal(parsed.precision, 0);
});

test('parseAtomicQuantity accepts bigint, safe integer, and canonical string forms', () => {
  assert.equal(parseAtomicQuantity(0n).atomic, 0n);
  assert.equal(parseAtomicQuantity(0).atomic, 0n);
  assert.equal(parseAtomicQuantity('0').atomic, 0n);
  assert.equal(parseAtomicQuantity(Number.MAX_SAFE_INTEGER).atomic, BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(parseAtomicQuantity(2n ** 200n).atomic, 2n ** 200n);
  assert.equal(
    parseAtomicQuantity('123456789012345678901234567890').atomic,
    123456789012345678901234567890n,
  );
  assert.ok(Object.isFrozen(parseAtomicQuantity(1n)));
});

test('parseAtomicQuantity rejects unsafe, negative, fractional, and non-canonical values', () => {
  assert.throws(() => parseAtomicQuantity(-1n), /non-negative/);
  assert.throws(() => parseAtomicQuantity(-1), /non-negative/);
  assert.throws(() => parseAtomicQuantity(Number.MAX_SAFE_INTEGER + 1), /safe integer/);
  assert.throws(() => parseAtomicQuantity(1.5), /safe integer/);
  assert.throws(() => parseAtomicQuantity(NaN), /safe integer/);
  assert.throws(() => parseAtomicQuantity(Infinity), /safe integer/);
  assert.throws(() => parseAtomicQuantity('-1'), /canonical/);
  assert.throws(() => parseAtomicQuantity('+1'), /canonical/);
  assert.throws(() => parseAtomicQuantity('01'), /canonical/);
  assert.throws(() => parseAtomicQuantity(' 1'), /canonical/);
  assert.throws(() => parseAtomicQuantity('1 '), /canonical/);
  assert.throws(() => parseAtomicQuantity('1.0'), /canonical/);
  assert.throws(() => parseAtomicQuantity('1e3'), /canonical/);
  assert.throws(() => parseAtomicQuantity(''), /canonical/);
  assert.throws(() => parseAtomicQuantity(null), /bigint/);
  assert.throws(() => parseAtomicQuantity({}), /bigint/);
});

test('atomic quantity serialization stays exact beyond the safe integer range', () => {
  const huge = 2n ** 96n + 1n;
  const capabilityValue = createAssetCapability(
    identity(),
    { atomic: huge },
    verifiedVerification(),
  );

  const serialized = serializeAssetCapability(capabilityValue);
  const document = JSON.parse(serialized) as {
    quantity: { atomic: string };
  };

  assert.equal(document.quantity.atomic, huge.toString());
  assert.equal(formatAtomicQuantity(huge), huge.toString());
  assert.equal(deserializeAssetCapability(serialized).quantity.atomic, huge);
});

test('decimal quantities convert through bigint atomic units without floating point', () => {
  assert.equal(parseDecimalQuantity('123.45', 8).atomic, 12_345_000_000n);
  assert.equal(parseDecimalQuantity('0.00000001', 8).atomic, 1n);
  assert.equal(parseDecimalQuantity('1', 0).atomic, 1n);
  assert.equal(parseDecimalQuantity('0', 8).atomic, 0n);
  assert.equal(formatDecimalQuantity(12_345_000_000n, 8), '123.45000000');
  assert.equal(formatDecimalQuantity(1n, 8), '0.00000001');
  assert.equal(formatDecimalQuantity(0n, 2), '0.00');
  assert.equal(formatDecimalQuantity(1n, 0), '1');
  assert.equal(formatDecimalQuantity(2n ** 80n, 2), `${(2n ** 80n / 100n)}.${String(2n ** 80n % 100n).padStart(2, '0')}`);
  assert.throws(() => parseDecimalQuantity('1.5', 0), /fractional/);
  assert.throws(() => parseDecimalQuantity('1.123456789', 8), /fractional/);
  assert.throws(() => parseDecimalQuantity('.5', 2), /canonical/);
  assert.throws(() => parseDecimalQuantity('01.0', 2), /canonical/);
  assert.throws(() => parseDecimalQuantity('1.', 2), /canonical/);
  assert.throws(() => parseDecimalQuantity('-1', 2), /canonical/);
  assert.throws(() => parseDecimalQuantity('1', 19), /precision/);
  assert.throws(() => formatDecimalQuantity(1n, 19), /precision/);
});

test('verification distinguishes unknown, unverified, and verified states', () => {
  const unknown = parseVerification(unknownVerification());
  const unverified = parseVerification(unverifiedVerification());
  const verified = parseVerification(verifiedVerification());

  assert.equal(unknown.status, 'unknown');
  assert.equal(unverified.status, 'unverified');
  assert.equal(verified.status, 'verified');
  assert.equal(isVerified(unknown), false);
  assert.equal(isVerified(unverified), false);
  assert.equal(isVerified(verified), true);
  assert.equal(
    isVerified(createAssetCapability(identity(), 1n, unknownVerification())),
    false,
  );
  assert.equal(
    isVerified(createAssetCapability(identity(), 1n, unverifiedVerification())),
    false,
  );
  assert.equal(
    isVerified(createAssetCapability(identity(), 1n, verifiedVerification())),
    true,
  );
});

test('verification rejects unsupported statuses and incomplete evidence', () => {
  assert.throws(() => parseVerification(null), RgbAssetModelError);
  assert.throws(() => parseVerification({ status: 'trusted' }), /status/);
  assert.throws(() => parseVerification({ status: 'unknown', method: 'mock' }), /exactly these keys/);
  assert.throws(
    () => parseVerification({ status: 'unverified', method: 'mock', checkedAt: CHECKED_AT }),
    /exactly these keys/,
  );
  assert.throws(
    () => parseVerification({ status: 'unverified', method: '', reason: 'none', checkedAt: CHECKED_AT }),
    /method/,
  );
  assert.throws(
    () => parseVerification({ status: 'unverified', method: 'mock', reason: '', checkedAt: CHECKED_AT }),
    /reason/,
  );
  assert.throws(
    () => parseVerification({ status: 'unverified', method: 'mock', reason: 'none', checkedAt: -1 }),
    /checkedAt/,
  );
  assert.throws(
    () => parseVerification({ status: 'unverified', method: 'mock', reason: 'none', checkedAt: 1.5 }),
    /checkedAt/,
  );
  assert.throws(
    () => parseVerification({ status: 'verified', method: 'mock', verifiedAt: CHECKED_AT }),
    /exactly these keys/,
  );
  assert.throws(
    () => parseVerification({ status: 'verified', method: 'mock', evidence: '', verifiedAt: CHECKED_AT }),
    /evidence/,
  );
  assert.throws(
    () => parseVerification({ status: 'verified', method: 'mock', evidence: 'e', verifiedAt: -1 }),
    /verifiedAt/,
  );
});

test('createAssetCapability accepts all safe quantity forms and freezes the result', () => {
  const fromNumber = createAssetCapability(identity(), 5, unknownVerification());
  const fromBigInt = createAssetCapability(identity(), 5n, unknownVerification());
  const fromString = createAssetCapability(identity(), '5', unknownVerification());
  const fromObject = createAssetCapability(identity(), { atomic: 5n }, unknownVerification());

  assert.equal(fromNumber.quantity.atomic, 5n);
  assert.equal(fromBigInt.quantity.atomic, 5n);
  assert.equal(fromString.quantity.atomic, 5n);
  assert.equal(fromObject.quantity.atomic, 5n);
  assert.ok(Object.isFrozen(fromNumber));
  assert.ok(Object.isFrozen(fromNumber.identity));
  assert.ok(Object.isFrozen(fromNumber.quantity));
  assert.ok(Object.isFrozen(fromNumber.verification));
});

test('createAssetCapability rejects unknown quantity keys and invalid identity or verification', () => {
  assert.throws(
    () => createAssetCapability(identity(), { atomic: 1n, sats: 1 }, unknownVerification()),
    /exactly these keys/,
  );
  assert.throws(
    () => createAssetCapability(identity({ network: 'unknown' }), 1n, unknownVerification()),
    /Unsupported RGB network/,
  );
  assert.throws(
    () => createAssetCapability(identity(), 1n, { status: 'maybe' }),
    /status/,
  );
});

test('capability serialization is canonical, versioned, and free of BTC satoshi fields', () => {
  const capabilityValue = createAssetCapability(
    identity({ contractId: UPPER_CONTRACT_ID }),
    12_345_000_000n,
    verifiedVerification(),
  );

  const serialized = serializeAssetCapability(capabilityValue);
  const document = JSON.parse(serialized) as Record<string, unknown>;

  assert.deepEqual(Object.keys(document), ['schema', 'version', 'identity', 'quantity', 'verification']);
  assert.equal(document.schema, RGB_ASSET_CAPABILITY_SCHEMA);
  assert.equal(document.version, RGB_ASSET_MODEL_VERSION);
  assert.deepEqual(Object.keys(document.identity as object), ['network', 'contractId', 'kind', 'precision']);
  assert.deepEqual(document.quantity, { atomic: '12345000000' });
  assert.equal((document.identity as { contractId: string }).contractId, CONTRACT_ID);
  assert.equal(serialized.includes('Sats'), false);
  assert.equal(serialized.includes('sats'), false);
  assert.equal(serialized.includes('amountSats'), false);
  assert.equal(serialized, serializeAssetCapability(deserializeAssetCapability(serialized)));
});

test('capability round-trip preserves unknown and unverified states without upgrading them', () => {
  for (const verification of [unknownVerification(), unverifiedVerification()]) {
    const capabilityValue = createAssetCapability(identity(), 0n, verification);
    const serialized = serializeAssetCapability(capabilityValue);
    const deserialized = deserializeAssetCapability(serialized);

    assert.deepEqual(deserialized, capabilityValue);
    assert.equal(isVerified(deserialized), false);
    assert.equal(deserialized.verification.status, verification.status);
  }
});

test('capability round-trip preserves verified evidence', () => {
  const capabilityValue = createAssetCapability(
    identity(),
    987_654_321n,
    verifiedVerification(),
  );
  const deserialized = deserializeAssetCapability(serializeAssetCapability(capabilityValue));

  assert.deepEqual(deserialized, capabilityValue);
  assert.equal(isVerified(deserialized), true);
  assert.equal(deserialized.verification.status, 'verified');
  if (deserialized.verification.status === 'verified') {
    assert.equal(deserialized.verification.evidence, 'mock-attestation:contract-1');
  }
});

test('deserializeAssetCapability rejects malformed, non-canonical, or tampered documents', () => {
  assert.throws(() => deserializeAssetCapability('not json'), /valid JSON/);
  assert.throws(() => deserializeAssetCapability(JSON.stringify(null)), /JSON object/);
  assert.throws(
    () => deserializeAssetCapability(JSON.stringify({ ...capabilityDocument(), schema: 'other' })),
    /schema/,
  );
  assert.throws(
    () => deserializeAssetCapability(JSON.stringify({ ...capabilityDocument(), version: 2 })),
    /version/,
  );
  assert.throws(
    () => deserializeAssetCapability(JSON.stringify({ ...capabilityDocument(), version: '1' })),
    /version/,
  );
  assert.throws(
    () => deserializeAssetCapability(JSON.stringify({ ...capabilityDocument(), extra: true })),
    /exactly these keys/,
  );
  assert.throws(
    () =>
      deserializeAssetCapability(
        JSON.stringify({
          ...capabilityDocument(),
          identity: { ...identity(), amountSats: 1 },
        }),
      ),
    /exactly these keys/,
  );
  assert.throws(
    () =>
      deserializeAssetCapability(
        JSON.stringify({
          ...capabilityDocument(),
          quantity: { atomic: 1 },
        }),
      ),
    /must be a string/,
  );
  assert.throws(
    () =>
      deserializeAssetCapability(
        JSON.stringify({
          ...capabilityDocument(),
          quantity: { atomic: '01' },
        }),
      ),
    /canonical/,
  );
  assert.throws(
    () =>
      deserializeAssetCapability(
        JSON.stringify({
          ...capabilityDocument(),
          quantity: {},
        }),
      ),
    /exactly these keys/,
  );
  assert.throws(
    () =>
      deserializeAssetCapability(
        JSON.stringify({
          ...capabilityDocument(),
          verification: { status: 'unknown', verified: true },
        }),
      ),
    /exactly these keys/,
  );
});

test('identity serialization round-trips and enforces its own schema version', () => {
  const parsed = parseAssetIdentity(identity({ contractId: UPPER_CONTRACT_ID }));
  const serialized = serializeAssetIdentity(parsed);
  const document = JSON.parse(serialized) as Record<string, unknown>;

  assert.equal(document.schema, RGB_ASSET_IDENTITY_SCHEMA);
  assert.equal(document.version, RGB_ASSET_MODEL_VERSION);
  assert.deepEqual(deserializeAssetIdentity(serialized), parsed);
  assert.equal(serialized, serializeAssetIdentity(deserializeAssetIdentity(serialized)));
  assert.throws(
    () => deserializeAssetIdentity(JSON.stringify({ ...document, version: 2 })),
    /version/,
  );
  assert.throws(
    () => deserializeAssetIdentity(JSON.stringify({ ...document, sats: 1 })),
    /exactly these keys/,
  );
  assert.throws(() => deserializeAssetIdentity(''), /valid JSON/);
});

test('serializers reject structurally invalid in-memory values', () => {
  assert.throws(
    () =>
      serializeAssetIdentity({
        ...parseAssetIdentity(identity()),
        precision: 19,
      } as never),
    /precision/,
  );
  assert.throws(
    () =>
      serializeAssetCapability({
        identity: parseAssetIdentity(identity()),
        quantity: { atomic: -1n },
        verification: { status: 'unknown' },
      }),
    /non-negative/,
  );
  assert.throws(
    () =>
      serializeAssetCapability({
        identity: parseAssetIdentity(identity()),
        quantity: { atomic: 1n },
        verification: { status: 'verified', method: 'mock', evidence: '', verifiedAt: CHECKED_AT },
      }),
    /evidence/,
  );
});
