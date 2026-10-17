import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };
export function useResource<T>(path: string | null, poll = false) {
  const [data, setData] = useState<T | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const refresh = () => setAttempt(n => n + 1);
    const visibleRefresh = () => { if (!document.hidden) refresh(); };
    window.addEventListener('splitmate-ledger-updated', refresh); window.addEventListener('splitmate-collaboration-updated', refresh);
    const timer = poll ? window.setInterval(visibleRefresh, 30000) : undefined;
    if (poll) document.addEventListener('visibilitychange', visibleRefresh);
    return () => { window.removeEventListener('splitmate-ledger-updated', refresh); window.removeEventListener('splitmate-collaboration-updated', refresh); if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', visibleRefresh); };
  }, [poll]);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController(); setLoading(true); setError('');
    void api<T>(path, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, attempt]);
  return { data, loading, error, retry: () => setAttempt(n => n + 1) };
}
export const collaborationUpdated = () => window.dispatchEvent(new Event('splitmate-collaboration-updated'));
