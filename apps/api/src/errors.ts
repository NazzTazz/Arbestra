export class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    /** Extra fields of the JSON body (e.g. the refused gesture of a batch). */
    public readonly details?: Readonly<Record<string, string | number | boolean>>,
  ) {
    super(message);
  }
}
/** The JSON body of a refusal: code and message, then the details, which
 * never override them. */
export const httpErrorBody = (error: HttpError) => ({ ...error.details, code: error.code, message: error.message });
