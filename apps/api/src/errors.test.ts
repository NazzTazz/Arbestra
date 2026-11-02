import { expect, it } from 'vitest';
import { HttpError, httpErrorBody } from './errors.js';

it('sends the details of a refusal beside its code and message, never over them', () => {
  expect(httpErrorBody(new HttpError(409, 'CELL_OCCUPIED', 'Occupée.'))).toEqual({
    code: 'CELL_OCCUPIED',
    message: 'Occupée.',
  });
  expect(httpErrorBody(new HttpError(409, 'CELL_OCCUPIED', 'Occupée.', { gesture: 1, code: 'X' }))).toEqual({
    gesture: 1,
    code: 'CELL_OCCUPIED',
    message: 'Occupée.',
  });
});
