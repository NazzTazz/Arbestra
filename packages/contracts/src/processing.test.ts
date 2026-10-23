import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { FormatRegistry } from '@sinclair/typebox';
import { ProcessingCommandSchema, processingLotsForDuration } from './processing.js';
FormatRegistry.Set('uuid', (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));

describe('duration-based production', () => {
  it('keeps the selected duration while more workers increase the output', () => {
    expect([1, 2, 3].map((n) => processingLotsForDuration(3600, 600000, n))).toEqual([6, 12, 18]);
    expect([1, 2, 3].map((n) => processingLotsForDuration(43200, 600000, n))).toEqual([72, 144, 216]);
  });
  it('accepts long finite orders and supported duration commands, rejecting ambiguous requests', () => {
    const base = {
      commandId: '10000000-0000-4000-8000-000000000001',
      buildingId: '10000000-0000-4000-8000-000000000002',
      action: 'start',
      workerCount: 3,
    };
    expect(Value.Check(ProcessingCommandSchema, { ...base, lots: 216 })).toBe(true);
    expect(Value.Check(ProcessingCommandSchema, { ...base, durationSeconds: 43200 })).toBe(true);
    expect(Value.Check(ProcessingCommandSchema, { ...base, durationSeconds: 60 })).toBe(false);
    expect(Value.Check(ProcessingCommandSchema, { ...base, durationSeconds: 43200, lots: 1 })).toBe(false);
    expect(Value.Check(ProcessingCommandSchema, { ...base, lots: 0 })).toBe(false);
  });
});
