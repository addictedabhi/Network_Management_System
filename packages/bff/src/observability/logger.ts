/**
 * Structured JSON logging with redaction applied at the LOGGER layer, not per call site,
 * so no call site can forget it (NFR-15). Tokens, cookies, secrets, SNMP communities and
 * passwords never reach stdout.
 */
import type { Config } from '../config/env.js';

const REDACT_PATTERN =
  /^(authorization|cookie|set-cookie|password|.*token.*|.*secret.*|.*community.*|.*apikey.*|.*api_key.*)$/i;

export const REDACTED = '[REDACTED]';

export function redact(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redact);
  if (input === null || typeof input !== 'object') return input;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = REDACT_PATTERN.test(key) ? REDACTED : redact(value);
  }
  return out;
}

export interface Logger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
  audit(entry: {
    actor: string;
    action: string;
    target: string;
    outcome: 'success' | 'denied' | 'failure';
    correlationId: string;
  }): void;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export function createLogger(config: Pick<Config, 'logLevel'>, service = 'bff'): Logger {
  const threshold = LEVELS[config.logLevel];
  const emit = (level: keyof typeof LEVELS, message: string, context?: unknown) => {
    if (LEVELS[level] < threshold) return;
    process.stdout.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        service,
        message,
        context: context === undefined ? undefined : redact(context)
      }) + '\n'
    );
  };
  return {
    debug: (m, c) => emit('debug', m, c),
    info: (m, c) => emit('info', m, c),
    warn: (m, c) => emit('warn', m, c),
    error: (m, c) => emit('error', m, c),
    audit: (entry) =>
      process.stdout.write(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'INFO',
          service,
          message: 'audit',
          audit: redact(entry)
        }) + '\n'
      )
  };
}
