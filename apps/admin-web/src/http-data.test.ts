import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request } from './api';
import { assertDiagnosticInstance } from './http-data';

afterEach(() => vi.unstubAllGlobals());
describe('diagnostic identity and transport', () => {
  it('refuses to accept another instance into an existing view', () => {
    expect(() => assertDiagnosticInstance('old-instance', 'new-instance')).toThrow(ApiError);
    try {
      assertDiagnosticInstance('old-instance', 'new-instance');
    } catch (error) {
      expect(error).toMatchObject({ status: 409, code: 'INSTANCE_MISMATCH', instanceId: 'new-instance' });
    }
    expect(() => assertDiagnosticInstance('same', 'same')).not.toThrow();
  });
  it('preserves the explicit instance-mismatch facts from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ code: 'INSTANCE_MISMATCH', message: 'Instance changed', instanceId: 'current' }),
            { status: 409 },
          ),
      ),
    );
    await expect(request('/api/admin/http-requests?instanceId=old')).rejects.toMatchObject({
      status: 409,
      code: 'INSTANCE_MISMATCH',
      instanceId: 'current',
    });
  });
  it('keeps not-retained distinct from session expiry or a fabricated eviction cause', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'HTTP_OBSERVATION_NOT_RETAINED', message: 'Observation absente' }), {
            status: 404,
          }),
      ),
    );
    await expect(request('/api/admin/http-requests/missing?instanceId=current')).rejects.toMatchObject({
      status: 404,
      code: 'HTTP_OBSERVATION_NOT_RETAINED',
      instanceId: null,
    });
  });
});
