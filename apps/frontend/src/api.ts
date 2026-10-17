export type User = { id: string; email: string; displayName: string };
export type AuthSession = { user: User; csrfToken: string };
export type GroupSummary = { id: string; name: string; currency: string; role: 'OWNER' | 'MEMBER'; memberCount: number; createdAt: string };
export type Member = { user: User; role: 'OWNER' | 'MEMBER'; joinedAt: string };
export type GroupDetail = { id: string; name: string; currency: string; createdAt: string; members: Member[] };
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type Options = { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown; csrfToken?: string; signal?: AbortSignal; idempotencyKey?: string };
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET', credentials: 'same-origin',
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}), ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}) },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, 'Cannot reach SplitMate. The service may be waking up. Please try again shortly.');
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('splitmate-session-expired'));
    throw new ApiError(response.status, typeof body?.error === 'string' ? body.error : 'Something went wrong. Please try again.');
  }
  return body as T;
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
