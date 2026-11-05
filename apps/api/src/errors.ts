export class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    /** Extra JSON fields of the body (e.g. the refused gesture and units of a batch). */
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}
/** PostgreSQL `lock_not_available`: a lock wait exceeded `lock_timeout`. */
export const LOCK_NOT_AVAILABLE = '55P03';
/** Seconds a client waits before retrying an `ECONOMY_BUSY` command. */
export const ECONOMY_BUSY_RETRY_AFTER_S = 2;
/** A command whose village or zone stayed held beyond its lock delay: nothing
 * was written (the transaction rolled back), the same UUID can be retried. */
export const economyBusy = () => new HttpError(503, 'ECONOMY_BUSY', 'Village occupé. Réessayez dans un instant.');
/** A lock wait that timed out, raw (PostgreSQL) or already answered as `ECONOMY_BUSY`. */
export function isLockTimeout(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === LOCK_NOT_AVAILABLE || (error instanceof HttpError && code === 'ECONOMY_BUSY');
}
/** The JSON body of a refusal: code and message, then the details, which
 * never override them. */
export const httpErrorBody = (error: HttpError) => ({ ...error.details, code: error.code, message: error.message });
