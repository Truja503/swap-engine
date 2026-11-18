export class RgbAssetModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RgbAssetModelError';
  }
}

export const RGB_NETWORKS = [
  'bitcoin-mainnet',
  'bitcoin-testnet',
  'bitcoin-signet',
  'bitcoin-regtest',
  'liquid-mainnet',
  'liquid-testnet',
  'liquid-regtest',
] as const;

export type RgbNetwork = (typeof RGB_NETWORKS)[number];

export const RGB_ASSET_KINDS = ['fungible', 'non-fungible'] as const;

export type RgbAssetKind = (typeof RGB_ASSET_KINDS)[number];

export type ContractId = string & { readonly __brand: 'RgbContractId' };

export type QuantityPrecision = number & { readonly __brand: 'RgbQuantityPrecision' };

export type AssetIdentity = {
  readonly network: RgbNetwork;
  readonly contractId: ContractId;
  readonly kind: RgbAssetKind;
  readonly precision: QuantityPrecision;
};

export type AssetQuantity = { readonly atomic: bigint };

export type VerificationStatus = 'unknown' | 'unverified' | 'verified';

export type UnknownVerification = { readonly status: 'unknown' };

export type UnverifiedVerification = {
  readonly status: 'unverified';
  readonly method: string;
  readonly reason: string;
  readonly checkedAt: number;
};

export type VerifiedVerification = {
  readonly status: 'verified';
  readonly method: string;
  readonly evidence: string;
  readonly verifiedAt: number;
};

export type AssetVerification =
  | UnknownVerification
  | UnverifiedVerification
  | VerifiedVerification;

export type AssetCapability = {
  readonly identity: AssetIdentity;
  readonly quantity: AssetQuantity;
  readonly verification: AssetVerification;
};

export const RGB_ASSET_IDENTITY_SCHEMA = 'satoshi-math/rgb-asset-identity';
export const RGB_ASSET_CAPABILITY_SCHEMA = 'satoshi-math/rgb-asset-capability';
export const RGB_ASSET_MODEL_VERSION = 1;

const MAX_QUANTITY_PRECISION = 18;

function fail(message: string): never {
  throw new RgbAssetModelError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly these keys: ${expected.join(', ')}`);
  }
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function readNonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function freezeQuantity(atomic: bigint): AssetQuantity {
  if (atomic < 0n) {
    fail('Asset quantity must be non-negative');
  }
  return Object.freeze({ atomic });
}

export function parseRgbNetwork(value: unknown): RgbNetwork {
  if (typeof value !== 'string' || !(RGB_NETWORKS as readonly string[]).includes(value)) {
    fail(`Unsupported RGB network: ${String(value)}`);
  }
  return value as RgbNetwork;
}

export function parseAssetKind(value: unknown): RgbAssetKind {
  if (typeof value !== 'string' || !(RGB_ASSET_KINDS as readonly string[]).includes(value)) {
    fail(`Unsupported RGB asset kind: ${String(value)}`);
  }
  return value as RgbAssetKind;
}

export function parseContractId(value: unknown): ContractId {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) {
    fail('RGB contract ID must be 32 bytes encoded as 64 hexadecimal characters');
  }
  return value.toLowerCase() as ContractId;
}

export function parseQuantityPrecision(value: unknown): QuantityPrecision {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_QUANTITY_PRECISION
  ) {
    fail(`Asset quantity precision must be an integer between 0 and ${MAX_QUANTITY_PRECISION}`);
  }
  return value as QuantityPrecision;
}

export function parseAssetIdentity(value: unknown): AssetIdentity {
  if (!isRecord(value)) {
    fail('Asset identity must be an object');
  }
  assertExactKeys(value, ['network', 'contractId', 'kind', 'precision'], 'Asset identity');
  const network = parseRgbNetwork(value.network);
  const contractId = parseContractId(value.contractId);
  const kind = parseAssetKind(value.kind);
  const precision = parseQuantityPrecision(value.precision);
  if (kind === 'non-fungible' && precision !== 0) {
    fail('Non-fungible asset quantity precision must be 0');
  }
  return Object.freeze({ network, contractId, kind, precision });
}

export function parseAtomicQuantity(value: unknown): AssetQuantity {
  if (typeof value === 'bigint') {
    return freezeQuantity(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      fail('Asset quantity number must be a non-negative safe integer');
    }
    return freezeQuantity(BigInt(value));
  }
  if (typeof value === 'string') {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      fail('Asset quantity string must be a canonical non-negative integer');
    }
    return freezeQuantity(BigInt(value));
  }
  fail('Asset quantity must be a bigint, a safe integer number, or a canonical integer string');
}

export function formatAtomicQuantity(quantity: AssetQuantity | bigint): string {
  const atomic = typeof quantity === 'bigint' ? quantity : quantity.atomic;
  if (typeof atomic !== 'bigint' || atomic < 0n) {
    fail('Asset quantity must be a non-negative bigint');
  }
  return atomic.toString();
}

export function parseDecimalQuantity(value: unknown, precision: unknown): AssetQuantity {
  const parsedPrecision = parseQuantityPrecision(precision);
  if (typeof value !== 'string') {
    fail('Decimal asset quantity must be a string');
  }
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match) {
    fail('Decimal asset quantity must be a canonical non-negative decimal string');
  }
  const whole = BigInt(match[1]!);
  const fraction = match[2] ?? '';
  if (fraction.length > parsedPrecision) {
    fail(`Decimal asset quantity cannot have more than ${parsedPrecision} fractional digits`);
  }
  const paddedFraction = fraction.padEnd(parsedPrecision, '0');
  const scale = 10n ** BigInt(parsedPrecision);
  const fractionalPart = paddedFraction.length === 0 ? 0n : BigInt(paddedFraction);
  return freezeQuantity(whole * scale + fractionalPart);
}

export function formatDecimalQuantity(
  quantity: AssetQuantity | bigint,
  precision: unknown,
): string {
  const parsedPrecision = parseQuantityPrecision(precision);
  const atomic = typeof quantity === 'bigint' ? quantity : quantity.atomic;
  if (typeof atomic !== 'bigint' || atomic < 0n) {
    fail('Asset quantity must be a non-negative bigint');
  }
  const text = atomic.toString();
  if (parsedPrecision === 0) {
    return text;
  }
  const padded = text.padStart(parsedPrecision + 1, '0');
  return `${padded.slice(0, -parsedPrecision)}.${padded.slice(-parsedPrecision)}`;
}

export function parseVerification(value: unknown): AssetVerification {
  if (!isRecord(value)) {
    fail('Asset verification must be an object');
  }
  if (value.status === 'unknown') {
    assertExactKeys(value, ['status'], 'Unknown verification');
    return Object.freeze({ status: 'unknown' });
  }
  if (value.status === 'unverified') {
    assertExactKeys(
      value,
      ['status', 'method', 'reason', 'checkedAt'],
      'Unverified verification',
    );
    return Object.freeze({
      status: 'unverified',
      method: readNonEmptyString(value.method, 'Verification method'),
      reason: readNonEmptyString(value.reason, 'Unverified reason'),
      checkedAt: readNonNegativeSafeInteger(value.checkedAt, 'Verification checkedAt'),
    });
  }
  if (value.status === 'verified') {
    assertExactKeys(
      value,
      ['status', 'method', 'evidence', 'verifiedAt'],
      'Verified verification',
    );
    return Object.freeze({
      status: 'verified',
      method: readNonEmptyString(value.method, 'Verification method'),
      evidence: readNonEmptyString(value.evidence, 'Verification evidence'),
      verifiedAt: readNonNegativeSafeInteger(value.verifiedAt, 'Verification verifiedAt'),
    });
  }
  fail('Asset verification status must be unknown, unverified, or verified');
}

function coerceQuantity(value: unknown): AssetQuantity {
  if (isRecord(value)) {
    assertExactKeys(value, ['atomic'], 'Asset quantity');
    return parseAtomicQuantity(value.atomic);
  }
  return parseAtomicQuantity(value);
}

export function createAssetCapability(
  identity: unknown,
  quantity: unknown,
  verification: unknown,
): AssetCapability {
  return Object.freeze({
    identity: parseAssetIdentity(identity),
    quantity: coerceQuantity(quantity),
    verification: parseVerification(verification),
  });
}

export function isVerified(value: AssetCapability | AssetVerification): boolean {
  return 'verification' in value
    ? value.verification.status === 'verified'
    : value.status === 'verified';
}

function serializeIdentityFields(identity: AssetIdentity): Record<string, unknown> {
  return {
    network: identity.network,
    contractId: identity.contractId,
    kind: identity.kind,
    precision: identity.precision,
  };
}

function serializeVerificationFields(verification: AssetVerification): Record<string, unknown> {
  if (verification.status === 'unknown') {
    return { status: 'unknown' };
  }
  if (verification.status === 'unverified') {
    return {
      status: 'unverified',
      method: verification.method,
      reason: verification.reason,
      checkedAt: verification.checkedAt,
    };
  }
  return {
    status: 'verified',
    method: verification.method,
    evidence: verification.evidence,
    verifiedAt: verification.verifiedAt,
  };
}

export function serializeAssetIdentity(identity: AssetIdentity): string {
  const parsed = parseAssetIdentity(identity);
  return JSON.stringify({
    schema: RGB_ASSET_IDENTITY_SCHEMA,
    version: RGB_ASSET_MODEL_VERSION,
    ...serializeIdentityFields(parsed),
  });
}

export function serializeAssetCapability(capability: AssetCapability): string {
  const identity = parseAssetIdentity(capability.identity);
  const quantity = coerceQuantity(capability.quantity);
  const verification = parseVerification(capability.verification);
  return JSON.stringify({
    schema: RGB_ASSET_CAPABILITY_SCHEMA,
    version: RGB_ASSET_MODEL_VERSION,
    identity: serializeIdentityFields(identity),
    quantity: { atomic: formatAtomicQuantity(quantity) },
    verification: serializeVerificationFields(verification),
  });
}

function parseJsonDocument(json: unknown, label: string): unknown {
  if (typeof json !== 'string') {
    fail(`${label} must be a JSON string`);
  }
  try {
    return JSON.parse(json);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

function readSchemaDocument(
  value: unknown,
  schema: string,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(`${label} must be a JSON object`);
  }
  if (value.schema !== schema) {
    fail(`${label} has an unsupported schema`);
  }
  if (value.version !== RGB_ASSET_MODEL_VERSION) {
    fail(`${label} has an unsupported version`);
  }
  return value;
}

export function deserializeAssetIdentity(json: unknown): AssetIdentity {
  const document = readSchemaDocument(
    parseJsonDocument(json, 'RGB asset identity'),
    RGB_ASSET_IDENTITY_SCHEMA,
    'RGB asset identity',
  );
  assertExactKeys(
    document,
    ['schema', 'version', 'network', 'contractId', 'kind', 'precision'],
    'RGB asset identity document',
  );
  return parseAssetIdentity({
    network: document.network,
    contractId: document.contractId,
    kind: document.kind,
    precision: document.precision,
  });
}

export function deserializeAssetCapability(json: unknown): AssetCapability {
  const document = readSchemaDocument(
    parseJsonDocument(json, 'RGB asset capability'),
    RGB_ASSET_CAPABILITY_SCHEMA,
    'RGB asset capability',
  );
  assertExactKeys(
    document,
    ['schema', 'version', 'identity', 'quantity', 'verification'],
    'RGB asset capability document',
  );
  const quantityDocument = document.quantity;
  if (!isRecord(quantityDocument)) {
    fail('Serialized asset quantity must be an object');
  }
  assertExactKeys(quantityDocument, ['atomic'], 'Serialized asset quantity');
  if (typeof quantityDocument.atomic !== 'string') {
    fail('Serialized asset quantity atomic value must be a string');
  }
  return Object.freeze({
    identity: parseAssetIdentity(document.identity),
    quantity: parseAtomicQuantity(quantityDocument.atomic),
    verification: parseVerification(document.verification),
  });
}
