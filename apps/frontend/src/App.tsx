import { useEffect, useState } from 'react';
import { CircleHelp, LayoutDashboard, Leaf, LogOut, Menu, RefreshCw, Users, X } from 'lucide-react';
import { api, ApiError, errorMessage, type AuthSession } from './api';
import { AuthPage } from './AuthPage';
import { DashboardLedger, ExpenseLauncher } from './Ledger';
import { GroupList, GroupPage, Modal } from './Groups';
import { NotificationCenter } from './Collaboration';

function useHealth() {
  const [connection, setConnection] = useState('checking');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let active = true; setConnection('checking');
    const timeout = setTimeout(() => controller.abort(), 5000);
    void fetch('/api/health', { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (active) setConnection(response.ok && body.status === 'ok' && body.database === 'up' ? 'online' : 'offline');
    }).catch(() => { if (active) setConnection('offline'); }).finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [attempt]);
  return { connection, retry: () => setAttempt(value => value + 1) };
}
function useNavigation() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  function navigate(next: string, replace = false) {
    if (replace) window.history.replaceState({}, '', next); else window.history.pushState({}, '', next);
    setPath(window.location.pathname); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo({ top: 0 });
  }
  return { path, navigate };
}
export default function App() {
  const { path, navigate } = useNavigation();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setBootError('');
    void api<AuthSession>('/auth/me', { signal: controller.signal }).then(auth => { if (!controller.signal.aborted) setSession(auth); }).catch(error => {
      if (!controller.signal.aborted && !(error instanceof ApiError && error.status === 401)) setBootError(errorMessage(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const expire = () => { setSession(null); setNotice('Your session expired. Please sign in again.'); };
    window.addEventListener('splitmate-session-expired', expire);
    return () => window.removeEventListener('splitmate-session-expired', expire);
  }, []);
  useEffect(() => {
    if (loading || bootError) return;
    if (!session && path !== '/login' && path !== '/register') navigate('/login', true);
    if (session && (path === '/login' || path === '/register')) navigate('/', true);
  });
  if (loading || bootError) return <div className="boot-screen"><span className="brand-mark"><Leaf /></span>{loading ? <p role="status">Checking your session…</p> : <><p role="alert">{bootError}</p><button className="primary-button" onClick={() => setAttempt(value => value + 1)}>Retry connection</button></>}</div>;
  if (!session) return <AuthPage key={path} register={path === '/register'} navigate={navigate} notice={notice} onAuth={auth => { setSession(auth); setNotice(''); navigate('/'); }} />;
  return <Workspace session={session} path={path} navigate={navigate} onLogout={() => { setSession(null); setNotice('You have signed out.'); navigate('/login'); }} />;
}
function Workspace({ session, path, navigate, onLogout }: { session: AuthSession; path: string; navigate: (path: string) => void; onLogout: () => void }) {
  const { connection, retry } = useHealth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  const detail = /^\/groups\/([^/]+)$/.exec(path)?.[1];
  function go(next: string) { setMenuOpen(false); setError(''); navigate(next); }
  async function logout() {
    setSigningOut(true); setError('');
    try { await api('/auth/logout', { method: 'POST', body: {}, csrfToken: session.csrfToken }); onLogout(); }
    catch (error) { if (error instanceof ApiError && error.status === 401) onLogout(); else setError(errorMessage(error)); }
    finally { setSigningOut(false); }
  }
  return <div className="app-shell"><a href="#main" className="skip-link">Skip to content</a><aside className={`sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation"><a className="brand" href="/" onClick={event => { event.preventDefault(); go('/'); }}><span className="brand-mark"><Leaf size={23} /></span>splitmate<span className="brand-dot">.</span></a><div className="workspace-label">YOUR WORKSPACE <span>LOCAL</span></div><nav><a className={`nav-item ${path === '/' ? 'selected' : ''}`} href="/" onClick={event => { event.preventDefault(); go('/'); }} aria-current={path === '/' ? 'page' : undefined}><LayoutDashboard size={19} />Overview</a><a className={`nav-item ${detail ? 'selected' : ''}`} href="/#groups" onClick={event => { event.preventDefault(); go('/'); requestAnimationFrame(() => document.getElementById('groups')?.scrollIntoView({ behavior: 'smooth' })); }}><Users size={19} />My groups</a><a className={`nav-item ${path === '/profile' ? 'selected' : ''}`} href="/profile" onClick={event => { event.preventDefault(); go('/profile'); }}><Leaf size={19} />My profile</a></nav><div className="sidebar-note"><div className="note-art"><Leaf size={27} /><span>↗</span></div><strong>Good times.<br />Shared fairly.</strong><p>A little less money talk.<br />A little more living.</p></div><div className="sidebar-bottom"><button className="help-button" onClick={() => setHelpOpen(true)}><CircleHelp size={18} />About Phase 6</button><button className="help-button logout-button" disabled={signingOut} onClick={() => void logout()}><LogOut size={18} />{signingOut ? 'Signing out…' : 'Sign out'}</button><a className="profile" href="/profile" onClick={event => { event.preventDefault(); go('/profile'); }}><span className="avatar">{session.user.displayName.slice(0, 2).toUpperCase()}</span><div><strong>{session.user.displayName}</strong><small>Local account</small></div><span className="profile-dot" /></a></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button><span>Your workspace</span><span className="slash">/</span><strong>{detail ? 'Group details' : path === '/profile' ? 'My profile' : 'Overview'}</strong></div><NotificationCenter session={session} navigate={go} /><span className="local-tag"><span />Local development</span></header><main id="main" tabIndex={-1}>{error && <p className="form-error" role="alert">{error}</p>}
      {detail ? <GroupPage key={detail} id={detail} session={session} navigate={go} /> : path === '/profile' ? <><div className="page-heading"><div><div className="eyebrow">YOUR LOCAL ACCOUNT</div><h1>My profile</h1><p>Your identity, shared only with your group members.</p></div></div><section className="members-card profile-card"><dl><dt>Name</dt><dd>{session.user.displayName}</dd><dt>Email</dt><dd>{session.user.email}</dd></dl><p className="field-hint">Profile editing and password recovery are outside this phase.</p></section></> : <>
        <div className="page-heading"><div><div className="eyebrow">A LITTLE CLARITY GOES A LONG WAY</div><h1>More moments. Less maths.</h1><p>Welcome, {session.user.displayName}. Make room for your people.</p></div><ExpenseLauncher session={session} /></div>
        {new URLSearchParams(window.location.search).has('left') && <p className="notice" role="status">You have left the group.</p>}
        <div className="preview-banner"><span className="preview-badge">PHASE 6</span><p>Activity, invitations and notifications keep your group in sync. Search expenses and explore insights from your real ledger.</p></div>
        <DashboardLedger session={session}><GroupList session={session} navigate={go} /></DashboardLedger>
      </>}
      <footer className="page-footer"><span>Made for shared moments. <span className="footer-leaf">✳</span></span><div className="health-status" role="status"><span className={`mini-dot ${connection === 'online' ? 'green' : 'orange'}`} />{connection === 'online' ? 'API & database connected' : connection === 'offline' ? 'API or database unavailable' : 'Checking API & database…'}<button onClick={retry} disabled={connection === 'checking'} aria-label="Recheck API and database connection"><RefreshCw size={14} /></button></div></footer>
    </main></div>
    {helpOpen && <Modal title="Your people, in one place." close={() => setHelpOpen(false)}><p>SplitMate includes activity history, consent-based invitations, notifications, expense search and group insights alongside your ledger. Amounts use integer minor units; creation and shares are committed together.</p><p>Opposite debts are netted; an optional group-wide plan preserves net balances. Repayments can be reversed with an audit trail. Expense deletion and payment processing are not implemented. No sample financial data is shown.</p><button className="dismiss-button" onClick={() => setHelpOpen(false)}>Got it</button></Modal>}
  </div>;
}
