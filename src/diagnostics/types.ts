export const diagnosticCategories = [
  'BITCOIN_CONFIG_UNAVAILABLE',
  'BITCOIN_RPC_UNREACHABLE',
  'BITCOIN_RPC_ERROR',
  'BITCOIN_MALFORMED_RESPONSE',
  'BITCOIN_WRONG_NETWORK',
  'BITCOIN_INVALID_HEIGHT',
  'BITCOIN_IN_IBD',
  'BITCOIN_TIP_UNAVAILABLE',
  'BITCOIN_WALLET_UNAVAILABLE',
  'LND_CONFIG_UNAVAILABLE',
  'LND_UNREACHABLE',
  'LND_RPC_ERROR',
  'LND_MALFORMED_RESPONSE',
  'LND_WRONG_NETWORK',
  'LND_NOT_SYNCHRONIZED',
  'LND_NO_ACTIVE_CHANNELS',
] as const;

export type DiagnosticCategory = (typeof diagnosticCategories)[number];

export type DiagnosticStatus = 'ok' | 'error';

export type DiagnosticDetailValue = string | number | boolean | null;

export type DiagnosticDetails = Record<string, DiagnosticDetailValue>;

export type DiagnosticCheck = {
  id: string;
  status: DiagnosticStatus;
  message: string;
  category?: DiagnosticCategory;
  details?: DiagnosticDetails;
};

export type ComponentDiagnostics = {
  status: DiagnosticStatus;
  checks: DiagnosticCheck[];
};

export type PreflightReport = {
  ok: boolean;
  mode: 'read-only';
  checkedAt: string;
  bitcoin: ComponentDiagnostics;
  lnd: ComponentDiagnostics;
};

/** Read-only surface needed from the existing Bitcoin RPC client. */
export type BitcoinPreflightClient = {
  call<T>(method: string, params?: unknown[], wallet?: boolean): Promise<T>;
};

/** Read-only surface needed from the existing LND REST client. */
export type LndPreflightClient = {
  call<T>(path: string, body?: unknown): Promise<T>;
};

export type PreflightClients = {
  bitcoin: BitcoinPreflightClient;
  lnd: LndPreflightClient;
};
