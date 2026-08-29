/**
 * Ошибки Kadmium — единый формат.
 */

export type ErrorCode =
  'NOT_FOUND' | 'VALIDATION' | 'CONFLICT' | 'SCHEMA' | 'CONFIG';

export class KadmiumError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = `Kadmium${code}`;
  }
}

export function notFound(entity: string, name: string): KadmiumError {
  return new KadmiumError('NOT_FOUND', `${entity} "${name}" not found.`, {
    entity,
    name,
  });
}

export function configError(field: string, message: string): KadmiumError {
  return new KadmiumError('CONFIG', message, { field });
}
