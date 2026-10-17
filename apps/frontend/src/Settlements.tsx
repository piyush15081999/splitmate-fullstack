import { formatDate, formatDateTime } from './presentation';
import { useRef, useState, type FormEvent } from 'react';
import { api, errorMessage, type AuthSession, type GroupDetail } from './api';
import { Modal } from './Modal';
import { decimalUnits, money } from './money';

export type Debt = { fromUserId: string; toUserId: string; amountMinor: number };
export type Settlement = Debt & {
  id: string; settledAt: string; createdAt: string; mode: string; canReverse: boolean;
  from: { user: { displayName: string } }; to: { user: { displayName: string } };
  createdBy: { displayName: string } | null;
  reversal: { reason: string; createdAt: string; createdBy: { displayName: string } } | null;
};
type Balance = { userId: string; netMinor: number };
type Mode = 'DIRECT' | 'SIMPLIFIED';
const decimal = (value: number) => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function SettlementPanel({ group, session, balances, debts, simplifiedDebts, settlements, updated }: { group: GroupDetail; session: AuthSession; balances: Balance[]; debts: Debt[]; simplifiedDebts: Debt[]; settlements: Settlement[]; updated: (message: string) => void }) {
  const preferenceKey = `splitmate-repayment-view:${group.id}`;
  const [simplified, setSimplified] = useState(() => { try { return sessionStorage.getItem(preferenceKey) === 'SIMPLIFIED'; } catch { return false; } });
  function chooseView(value: boolean) { setSimplified(value); try { sessionStorage.setItem(preferenceKey, value ? 'SIMPLIFIED' : 'DIRECT'); } catch { /* View preferences are optional; ledger data always comes from the API. */ } }
  const [draft, setDraft] = useState<{ debt: Debt; mode: Mode } | null>(null);
  const [reversing, setReversing] = useState<Settlement | null>(null);
  const names = new Map(group.members.map(m => [m.user.id, m.user.displayName]));
  const owner = group.members.some(m => m.user.id === session.user.id && m.role === 'OWNER');
  const allowed = (debt: Debt) => owner || debt.fromUserId === session.user.id || debt.toUserId === session.user.id;
  const plan = simplified ? simplifiedDebts : debts, mode = simplified ? 'SIMPLIFIED' : 'DIRECT';
  const first = plan.find(allowed);
  const saved = (message: string) => { setDraft(null); setReversing(null); updated(message); window.dispatchEvent(new Event('splitmate-ledger-updated')); };
  return <section className="settlement-panel">
    <div className="section-heading"><div><h2>Suggested repayments</h2><p>Record money already transferred outside SplitMate. No payments are sent.</p></div><button className="primary-button settle-up-button" disabled={!first} onClick={() => first && setDraft({ debt: first, mode })}>Settle Up</button></div>
    <label className="check-label simplification-toggle"><input type="checkbox" checked={simplified} onChange={e => chooseView(e.target.checked)} />Simplify across the whole group</label>
    <p className="field-hint">{simplified ? 'An optional plan from net balances. It can suggest paying someone who did not originally pay your bill. Zero-balance people are excluded. Agree the plan with your group first.' : 'Opposite-direction debts are netted for each pair. No third-party rerouting in this view. After group-wide repayments, this view may retain balanced cycles; the group-wide view shows remaining net repayments.'}</p>
    {balances.every(b => b.netMinor === 0) && <p className="notice">All member net balances are zero.</p>}
    <div className="repayment-suggestions">{plan.length ? plan.map(debt => <div className="repayment-row" key={`${debt.fromUserId}:${debt.toUserId}`}><span>{names.get(debt.fromUserId)} pays {names.get(debt.toUserId)}</span><strong>{money(debt.amountMinor, group.currency)}</strong>{allowed(debt) && <button className="secondary-button" onClick={() => setDraft({ debt, mode })}>Record repayment</button>}</div>) : <p className="empty-state compact">No repayments suggested in this view.</p>}</div>
    <div className="section-heading"><div><h2>Settlement history <span className="count-pill">{settlements.length}</span></h2><p>Repayments and their reversal records stay in the ledger.</p></div></div>
    <div className="settlement-history">{settlements.length ? settlements.map(s => <article className="settlement-record" key={s.id}><div className="repayment-row"><strong>{s.from.user.displayName} paid {s.to.user.displayName}</strong><strong>{money(s.amountMinor, group.currency)}</strong><span className="role-pill">{s.reversal ? 'REVERSED' : 'RECORDED'}</span></div><p>{formatDate(s.settledAt)} · {s.mode === 'SIMPLIFIED' ? 'Group-wide repayment' : 'Bilateral repayment'}</p><small>Recorded by {s.createdBy?.displayName ?? 'an earlier account'} · {formatDateTime(s.createdAt)}</small>{s.reversal ? <div className="reversal-audit"><strong>Reversed by {s.reversal.createdBy.displayName}</strong><p>{s.reversal.reason}</p><small>{formatDateTime(s.reversal.createdAt)} · Original repayment retained; excluded from balances.</small></div> : s.canReverse && <button className="secondary-button reverse-settlement-button" onClick={() => setReversing(s)}>Reverse repayment</button>}</article>) : <p className="empty-state compact">No repayments recorded yet.</p>}</div>
    {draft && <SettlementForm key={`${draft.debt.fromUserId}:${draft.debt.toUserId}`} group={group} session={session} initial={draft.debt} mode={draft.mode} balances={balances} debts={debts} close={() => setDraft(null)} saved={() => saved('Repayment recorded. Balances and suggestions refreshed.')} />}
    {reversing && <ReversalForm group={group} session={session} settlement={reversing} close={() => setReversing(null)} saved={() => saved('Repayment reversed. Audit history retained and balances refreshed.')} />}
  </section>;
}
function SettlementForm({ group, session, initial, mode, balances, debts, close, saved }: { group: GroupDetail; session: AuthSession; initial: Debt; mode: Mode; balances: Balance[]; debts: Debt[]; close: () => void; saved: () => void }) {
  const [from, setFrom] = useState(initial.fromUserId), [to, setTo] = useState(initial.toUserId);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const key = useRef(crypto.randomUUID()), pending = useRef(false);
  const maximum = mode === 'DIRECT' ? debts.find(d => d.fromUserId === from && d.toUserId === to)?.amountMinor ?? 0 : Math.min(Math.max(0, -(balances.find(b => b.userId === from)?.netMinor ?? 0)), Math.max(0, balances.find(b => b.userId === to)?.netMinor ?? 0));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (pending.current) return; setError('');
    const data = new FormData(e.currentTarget);
    try {
      const amountMinor = decimalUnits(String(data.get('amount')));
      if (!amountMinor || amountMinor > maximum || from === to) throw new Error('Choose different people and a positive amount within the current repayable total.');
      pending.current = true; setBusy(true);
      await api(`/groups/${group.id}/settlements`, { method: 'POST', csrfToken: session.csrfToken, idempotencyKey: key.current, body: { fromUserId: from, toUserId: to, amountMinor, currency: group.currency, date: data.get('date'), mode } }); saved();
    } catch (error) { setError(`${errorMessage(error)} If the result was uncertain, retry unchanged details here with the same request key, or close and refresh history before starting again.`); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Modal title="Record a repayment." close={close} busy={busy}><p>{group.name} · {mode === 'DIRECT' ? 'Bilateral' : 'Group-wide'} · This records an external repayment; it does not transfer money.</p>{error && <p role="alert" className="form-error">{error}</p>}<form className="expense-form settlement-form" onSubmit={submit} aria-busy={busy}><div className="form-columns"><label>Payer<select name="fromUserId" value={from} disabled={busy} onChange={e => setFrom(e.target.value)}>{group.members.map(m => <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>)}</select></label><label>Receiver<select name="toUserId" value={to} disabled={busy} onChange={e => setTo(e.target.value)}>{group.members.map(m => <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>)}</select></label></div><div className="form-columns"><label>Amount<input name="amount" required inputMode="decimal" defaultValue={decimal(Math.min(initial.amountMinor, 2147483647))} disabled={busy} /></label><label>Currency<input value={group.currency} readOnly /></label></div><label>Repayment date<input type="date" name="date" required defaultValue={today()} disabled={busy} /></label><p className="field-hint">Currently repayable: {money(maximum, group.currency)}. Partial repayments are supported. The server checks this again when saving.</p><button className="primary-button full-width" disabled={busy}>{busy ? 'Recording…' : 'Record repayment'}</button></form></Modal>;
}
function ReversalForm({ group, session, settlement, close, saved }: { group: GroupDetail; session: AuthSession; settlement: Settlement; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''); const pending = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (pending.current) return; const data = new FormData(e.currentTarget); pending.current = true; setBusy(true); setError('');
    try { await api(`/groups/${group.id}/settlements/${settlement.id}/reverse`, { method: 'POST', csrfToken: session.csrfToken, body: { reason: data.get('reason') } }); saved(); }
    catch (error) { setError(`${errorMessage(error)} If uncertain, retry the same reason or refresh history.`); } finally { pending.current = false; setBusy(false); }
  }
  return <Modal title="Reverse recorded repayment?" close={close} busy={busy}><p>{settlement.from.user.displayName} → {settlement.to.user.displayName} · {money(settlement.amountMinor, group.currency)}</p><p>This removes its effect on balances and retains an audit record. It does not refund money. Later repayments remain recorded.</p>{error && <p className="form-error" role="alert">{error}</p>}<form className="expense-form reversal-form" onSubmit={submit}><label>Reason<input name="reason" required maxLength={300} disabled={busy} placeholder="Explain why this record is incorrect" /></label><button className="primary-button" disabled={busy}>{busy ? 'Reversing…' : 'Confirm reversal'}</button></form></Modal>;
}
