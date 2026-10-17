import { useState, type FormEvent } from 'react';
import { ArrowRight, Leaf, ShieldCheck } from 'lucide-react';
import { api, errorMessage, type AuthSession } from './api';

export function AuthPage({ register, navigate, onAuth, notice }: { register: boolean; navigate: (path: string) => void; onAuth: (session: AuthSession) => void; notice: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const body = { email: data.get('email'), password: data.get('password'), ...(register ? { displayName: data.get('displayName') } : {}) };
      const session = await api<AuthSession>(`/auth/${register ? 'register' : 'login'}`, { method: 'POST', body });
      onAuth(session);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="auth-layout">
    <section className="auth-story"><a className="brand" href="/login" onClick={event => { event.preventDefault(); navigate('/login'); }}><span className="brand-mark"><Leaf size={23} /></span>splitmate<span className="brand-dot">.</span></a><div><div className="eyebrow">GOOD COMPANY. CLEARER MONEY.</div><h1>Life is better<br />when it’s shared.</h1><p>A home, a holiday, a table of friends.<br />Bring your people together in one place.</p><span className="auth-art" aria-hidden="true"><Leaf size={95} strokeWidth={.8} /><span>✳</span></span></div><p className="auth-local"><ShieldCheck size={17} /> Free, local, and built for your shared moments.</p></section>
    <main className="auth-main"><div className="auth-card"><span className="preview-badge">SPLITMATE · PHASE 6</span><h2>{register ? 'Make yourself at home.' : 'Welcome back.'}</h2><p>{register ? 'Create your local account and start your first group.' : 'Sign in to find your people and your groups.'}</p>
      {notice && <p className="notice" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      <form onSubmit={submit} aria-busy={busy}>
        {register && <label>Your name<input name="displayName" autoComplete="name" maxLength={100} required disabled={busy} placeholder="Alex Morgan" /></label>}
        <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy} placeholder="you@example.com" /></label>
        <label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required disabled={busy} aria-describedby="password-hint" /></label>
        <p className="field-hint" id="password-hint">Use 12–128 characters. A unique passphrase works well.</p><button className="primary-button full-width" disabled={busy} type="submit">{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}{!busy && <ArrowRight size={16} />}</button>
      </form><p className="auth-switch">{register ? 'Already have an account?' : 'New to SplitMate?'} <a href={register ? '/login' : '/register'} onClick={event => { event.preventDefault(); navigate(register ? '/login' : '/register'); }}>{register ? 'Sign in' : 'Create an account'}</a></p><div className="auth-scope">Groups, expenses and balances. All in your local database.<br />Accounts stay in your local PostgreSQL database.</div>
    </div></main>
  </div>;
}
