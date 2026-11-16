import { z } from 'zod';
import type { ComponentDiagnostics, DiagnosticCategory, DiagnosticCheck, DiagnosticDetails } from './types.js';

const transportCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

export function isTransportFailure(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  if (typeof code === 'string' && transportCodes.has(code)) return true;
  return /fetch failed|timeout|timed out/i.test(errorMessage(error));
}

export function isMalformedFailure(error: unknown): boolean {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return true;
  const message = errorMessage(error);
  return message === 'Invalid LND JSON' || message === 'Oversized LND response' || message === 'Invalid LND stream event';
}

export function isMissingConfiguration(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

export function bitcoinFailureCategory(error: unknown, wallet = false): DiagnosticCategory {
  if (isMalformedFailure(error)) return 'BITCOIN_MALFORMED_RESPONSE';
  if (isMissingConfiguration(error)) return 'BITCOIN_CONFIG_UNAVAILABLE';
  if (isTransportFailure(error)) return 'BITCOIN_RPC_UNREACHABLE';
  return wallet ? 'BITCOIN_WALLET_UNAVAILABLE' : 'BITCOIN_RPC_ERROR';
}

export function lndFailureCategory(error: unknown): DiagnosticCategory {
  if (isMalformedFailure(error)) return 'LND_MALFORMED_RESPONSE';
  if (isMissingConfiguration(error)) return 'LND_CONFIG_UNAVAILABLE';
  if (isTransportFailure(error)) return 'LND_UNREACHABLE';
  return 'LND_RPC_ERROR';
}

export function ok(id: string, message: string, details?: DiagnosticDetails): DiagnosticCheck {
  return { id, status: 'ok', message, ...(details ? { details } : {}) };
}

export function failed(id: string, category: DiagnosticCategory, message: string, details?: DiagnosticDetails): DiagnosticCheck {
  return { id, status: 'error', category, message, ...(details ? { details } : {}) };
}

export function bitcoinFailureMessage(category: DiagnosticCategory): string {
  switch (category) {
    case 'BITCOIN_CONFIG_UNAVAILABLE': return 'Bitcoin Core configuration or credentials are unavailable';
    case 'BITCOIN_RPC_UNREACHABLE': return 'Bitcoin Core RPC is unreachable';
    case 'BITCOIN_MALFORMED_RESPONSE': return 'Bitcoin Core returned a malformed response';
    case 'BITCOIN_WALLET_UNAVAILABLE': return 'Configured Bitcoin wallet is unavailable';
    default: return 'Bitcoin Core RPC request failed';
  }
}

export function lndFailureMessage(category: DiagnosticCategory): string {
  switch (category) {
    case 'LND_CONFIG_UNAVAILABLE': return 'LND configuration or credentials are unavailable';
    case 'LND_UNREACHABLE': return 'LND REST API is unreachable';
    case 'LND_MALFORMED_RESPONSE': return 'LND returned a malformed response';
    default: return 'LND REST request failed';
  }
}

export function component(checks: DiagnosticCheck[]): ComponentDiagnostics {
  return { status: checks.every(check => check.status === 'ok') ? 'ok' : 'error', checks };
}
