import { FormatRegistry } from '@sinclair/typebox';

/** String formats used by the schemas. Every contract module that declares
 * `format: 'uuid'` or `format: 'date-time'` imports this module, so validation
 * never depends on which other module happened to be loaded first. */
if (!FormatRegistry.Has('uuid'))
  FormatRegistry.Set('uuid', (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
if (!FormatRegistry.Has('date-time'))
  FormatRegistry.Set('date-time', (value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
