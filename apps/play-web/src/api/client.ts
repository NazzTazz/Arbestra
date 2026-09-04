import type { LoginRequest, SessionResponse } from '@arbestra/contracts';

export class ApiError extends Error {
  public constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Une erreur est survenue.' })) as { message?: string };
    throw new ApiError(error.message ?? 'Une erreur est survenue.', response.status);
  }
  return response.json() as Promise<T>;
}

export async function getSession(): Promise<SessionResponse | null> {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
  if (response.status === 401) return null;
  return parseResponse<SessionResponse>(response);
}

export async function login(credentials: LoginRequest): Promise<SessionResponse> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  return parseResponse<SessionResponse>(response);
}

export async function logout(): Promise<void> {
  const response = await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' });
  if (!response.ok) throw new ApiError('Impossible de fermer la session.', response.status);
}
