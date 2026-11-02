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
/** The JSON body of a refusal: code and message, then the details, which
 * never override them. */
export const httpErrorBody = (error: HttpError) => ({ ...error.details, code: error.code, message: error.message });
