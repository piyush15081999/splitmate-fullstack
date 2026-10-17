import { formatDate, formatDateTime, splitLabel } from './presentation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus, ReceiptText, RefreshCw } from 'lucide-react';
import { api, errorMessage, type AuthSession, type GroupDetail, type GroupSummary } from './api';
import { Modal } from './Modal';
import { decimalUnits, money } from './money';
import { SettlementPanel, type Settlement, type Debt } from './Settlements';
import { ExpenseExplorer } from './Collaboration';

type Split = 'EQUAL' | 'EXACT' | 'PERCENTAGE';
export type Expense = {
  id: string; groupId: string; description: string; amountMinor: number; paidById: string; occurredAt: string;
  category: string; splitType: string; currency?: string; groupName?: string; canEdit: boolean; version: number; editedAt: string | null;
  paidBy: { user: { id: string; displayName: string } };
  shares: { userId: string; amountMinor: number; percentageBps: number | null; member: { user: { id: string; displayName: string } } }[];
};
type GroupLedgerData = {
  group: { id: string; name: string; currency: string; members: { userId: string; user: { displayName: string } }[] };
  expenses: Expense[];
  balances: { userId: string; paidMinor: number; owedMinor: number; netMinor: number; sentMinor: number; receivedMinor: number }[];
  debts: Debt[]; simplifiedDebts: Debt[]; settlements: Settlement[];
};
type Overview = { totals: { currency: string; owedToMeMinor: number; iOweMinor: number; netMinor: number }[]; expenses: Expense[] };
const categoryNames = { FOOD: 'Food & drink', TRANSPORT: 'Transport', HOUSING: 'Housing', UTILITIES: 'Utilities', ENTERTAINMENT: 'Entertainment', OTHER: 'Other' };
function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function useLedger<T>(path: string, refreshKey = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { const update = () => setAttempt(value => value + 1); window.addEventListener('splitmate-ledger-updated', update); return () => window.removeEventListener('splitmate-ledger-updated', update); }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void api<T>(path, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, refreshKey, attempt]);
  return { data, error, loading, retry: () => setAttempt(value => value + 1) };
}
export function ExpenseLauncher({ session, group, onSaved }: { session: AuthSession; group?: GroupDetail; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selected, setSelected] = useState<GroupDetail | undefined>(group);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open || group) return;
    const controller = new AbortController(); setLoading(true); setError('');
    void api<{ groups: GroupSummary[] }>('/groups', { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setGroups(result.groups); }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, group, attempt]);
  async function choose(id: string) {
    setLoading(true); setError('');
    try { const result = await api<{ group: GroupDetail }>(`/groups/${id}`); setSelected(result.group); }
    catch (error) { setError(errorMessage(error)); } finally { setLoading(false); }
  }
  return <><button className="add-button expense-launcher" onClick={() => { setSelected(group); setOpen(true); }}><Plus size={18} />Add expense</button>
    {open && (selected ? <ExpenseForm key={selected.id} session={session} group={selected} close={() => setOpen(false)} saved={() => { setOpen(false); window.dispatchEvent(new Event('splitmate-ledger-updated')); onSaved?.(); }} /> : <Modal title="Where does this moment belong?" close={() => setOpen(false)} busy={loading}><p>Choose one of your groups. Its currency and members define the expense.</p>{loading ? <p role="status">Loading groups…</p> : error ? <><p className="form-error" role="alert">{error}</p><button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button></> : groups.length ? <div className="choose-group">{groups.map(item => <button key={item.id} className="secondary-button" onClick={() => void choose(item.id)}>{item.name}<span>{item.currency}</span></button>)}</div> : <p>Create a group before adding your first expense.</p>}</Modal>)}
  </>;
}
function inputAmount(value: number) { return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`; }
function ExpenseForm({ session, group, expense, close, saved }: { session: AuthSession; group: GroupDetail; expense?: Expense; close: () => void; saved: () => void }) {
  const [mode, setMode] = useState<Split>(expense ? expense.splitType === 'LEGACY' ? 'EXACT' : expense.splitType as Split : 'EQUAL');
  const [participants, setParticipants] = useState(expense ? expense.shares.map(share => share.userId) : group.members.map(member => member.user.id));
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(expense?.shares.map(share => [share.userId, inputAmount(expense.splitType === 'PERCENTAGE' ? share.percentageBps ?? 0 : share.amountMinor)]) ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const key = useRef(crypto.randomUUID());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    const data = new FormData(event.currentTarget); setError('');
    try {
      const amountMinor = decimalUnits(String(data.get('amount')));
      if (!amountMinor) throw new Error('The expense amount must be positive.');
      if (!participants.length) throw new Error('Choose at least one participant.');
      const shares: { userId: string; amountMinor?: number; percentageBps?: number }[] = [...participants].sort().map(userId => ({ userId, ...(mode === 'EXACT' ? { amountMinor: decimalUnits(values[userId] ?? '0') } : mode === 'PERCENTAGE' ? { percentageBps: decimalUnits(values[userId] ?? '0', 10000) } : {}) }));
      const sum = shares.reduce((sum, share) => sum + (share.amountMinor ?? share.percentageBps ?? 0), 0);
      if (mode === 'EXACT' && sum !== amountMinor) throw new Error('Exact shares must total the expense amount.');
      if (mode === 'PERCENTAGE' && sum !== 10000) throw new Error('Percentages must total exactly 100.00%.');
      inFlight.current = true; setBusy(true);
      await api(`/groups/${group.id}/expenses${expense ? `/${expense.id}` : ''}`, { method: expense ? 'PATCH' : 'POST', csrfToken: session.csrfToken, idempotencyKey: expense ? undefined : key.current, body: { ...(expense ? { expectedVersion: expense.version } : {}), description: data.get('description'), amountMinor, currency: group.currency, paidById: data.get('paidById'), date: data.get('date'), category: data.get('category'), splitType: mode, participants: shares } });
      saved();
    } catch (error) { setError(`${errorMessage(error)} ${expense ? 'If the response was uncertain, close this form and refresh the ledger to check the saved bill.' : 'Retry this form with unchanged details if the response was uncertain; its request key is retained.'}`); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <Modal title={expense ? 'Edit shared expense.' : 'Add a shared expense.'} close={close} busy={busy}><p>{group.name} · {group.currency}</p>{error && <p className="form-error" role="alert">{error}</p>}
    <form className="expense-form" onSubmit={submit} aria-busy={busy}><label>Description<input name="description" defaultValue={expense?.description} required maxLength={200} disabled={busy} placeholder="Dinner with the crew" /></label>
      <div className="form-columns"><label>Amount<input name="amount" defaultValue={expense ? inputAmount(expense.amountMinor) : undefined} inputMode="decimal" required disabled={busy} placeholder="0.00" /></label><label>Currency (from group)<input value={group.currency} readOnly /></label></div>
      <div className="form-columns"><label>Paid by<select name="paidById" defaultValue={expense?.paidById ?? session.user.id} disabled={busy}>{group.members.map(member => <option key={member.user.id} value={member.user.id}>{member.user.displayName}</option>)}</select></label><label>Date<input name="date" type="date" required defaultValue={expense?.occurredAt.slice(0, 10) ?? today()} disabled={busy} /></label></div>
      <div className="form-columns"><label>Category<select name="category" defaultValue={expense?.category ?? 'OTHER'} disabled={busy}>{Object.entries(categoryNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Split method<select name="splitType" value={mode} disabled={busy} onChange={event => { setMode(event.target.value as Split); setValues({}); }}><option value="EQUAL">Equal split</option><option value="EXACT">Exact amounts</option><option value="PERCENTAGE">Percentages</option></select></label></div>
      <fieldset disabled={busy} className="participant-fieldset"><legend>Split between · {participants.length} selected</legend>{group.members.map(member => <div className="participant-row" key={member.user.id}><label className="check-label"><input type="checkbox" name="participant" value={member.user.id} checked={participants.includes(member.user.id)} onChange={event => setParticipants(ids => event.target.checked ? [...ids, member.user.id] : ids.filter(id => id !== member.user.id))} /><span>{member.user.displayName}</span></label>{mode !== 'EQUAL' && participants.includes(member.user.id) && <label className="allocation-label"><span className="sr-only">{member.user.displayName} {mode === 'EXACT' ? 'amount' : 'percentage'}</span><input name={`allocation-${member.user.id}`} inputMode="decimal" value={values[member.user.id] ?? ''} placeholder={mode === 'EXACT' ? '0.00' : '0.00%'} onChange={event => setValues(current => ({ ...current, [member.user.id]: event.target.value }))} /></label>}</div>)}</fieldset>
      <p className="field-hint">{mode === 'EQUAL' ? 'Any spare minor units go to participants in ascending user ID order.' : mode === 'EXACT' ? 'Enter each participant’s amount. The sum must equal the expense.' : 'Enter percentages with up to two decimals, totalling 100%. Remainders use largest fractional share, then user ID.'} The payer can be excluded from the split.</p>
      <button className="primary-button full-width" disabled={busy}>{busy ? 'Saving expense…' : expense ? 'Save changes' : 'Save expense'}</button>
    </form>
  </Modal>;
}
function EditExpense({ expense, session, group }: { expense: Expense; session: AuthSession; group?: GroupDetail }) {
  const [selected, setSelected] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function open() {
    setLoading(true); setError(''); setSuccess('');
    try { setSelected(group ?? (await api<{ group: GroupDetail }>(`/groups/${expense.groupId}`)).group); }
    catch (error) { setError(errorMessage(error)); } finally { setLoading(false); }
  }
  return <div className="expense-edit-actions"><button className="secondary-button" disabled={loading} onClick={() => void open()}>{loading ? 'Loading bill…' : 'Edit expense'}</button>{error && <p className="form-error" role="alert">{error}</p>}{success && <p className="notice" role="status">{success}</p>}{selected && <ExpenseForm session={session} group={selected} expense={expense} close={() => setSelected(null)} saved={() => { setSelected(null); setSuccess('Expense updated. Balances recalculated.'); window.dispatchEvent(new Event('splitmate-ledger-updated')); }} />}</div>;
}
function History({ expenses, currency, session, group }: { expenses: Expense[]; currency?: string; session: AuthSession; group?: GroupDetail }) {
  if (!expenses.length) return <div className="empty-state compact"><span className="tile-icon sand"><ReceiptText size={24} /></span><h3>No expenses yet.</h3><p>Add the first shared expense to start your real ledger.</p></div>;
  return <div className="ledger-history">{expenses.map(expense => <details key={expense.id} className="ledger-expense"><summary><span><strong>{expense.description}</strong><small>{expense.groupName ? `${expense.groupName} · ` : ''}{formatDate(expense.occurredAt)} · {categoryNames[expense.category as keyof typeof categoryNames] ?? expense.category}</small><small>{expense.paidBy.user.displayName} paid · {splitLabel(expense.splitType)}</small></span><strong>{money(expense.amountMinor, currency ?? expense.currency!)}</strong></summary><ul>{expense.shares.map(share => <li key={share.userId}><span>{share.member.user.displayName}{share.percentageBps !== null ? ` (${(share.percentageBps / 100).toFixed(2)}%)` : ''}</span><strong>{money(share.amountMinor, currency ?? expense.currency!)}</strong></li>)}</ul>{expense.editedAt && <p className="field-hint">Edited {formatDateTime(expense.editedAt)}</p>}{expense.canEdit && <EditExpense expense={expense} session={session} group={group} />}</details>)}</div>;
}
export function GroupLedger({ group, session, refreshKey }: { group: GroupDetail; session: AuthSession; refreshKey: number }) {
  const { data, error, loading, retry } = useLedger<GroupLedgerData>(`/groups/${group.id}/ledger`, refreshKey);
  const [success, setSuccess] = useState('');
  const names = new Map(data?.group.members.map(member => [member.userId, member.user.displayName]) ?? []);
  return <section className="group-ledger"><div className="section-heading"><div><h2>Group ledger</h2><p>{group.currency} only · Expenses, recorded repayments and net balances.</p></div><ExpenseLauncher session={session} group={group} onSaved={() => setSuccess('Expense saved. The ledger has been refreshed.')} /></div>{success && <p className="notice" role="status">{success}</p>}
    {loading ? <div className="empty-state" role="status">Loading ledger…</div> : error || !data ? <div className="empty-state"><p className="form-error" role="alert">{error}</p><button className="secondary-button" onClick={retry}>Retry ledger</button></div> : <>
      <div className="balance-list"><div className="section-heading"><h2>Member balances</h2><span className="role-pill">SUM = {money(Number(data.balances.reduce((sum, b) => sum + BigInt(b.netMinor), 0n)), group.currency)}</span></div>{data.balances.map(balance => <div className="balance-row" key={balance.userId}><div><strong>{names.get(balance.userId)}{balance.userId === session.user.id ? ' (you)' : ''}</strong><small>Paid {money(balance.paidMinor, group.currency)} · Share {money(balance.owedMinor, group.currency)} · Repaid {money(balance.sentMinor, group.currency)} · Received {money(balance.receivedMinor, group.currency)}</small></div><strong className={balance.netMinor >= 0 ? 'positive-text' : 'negative-text'}>{balance.netMinor > 0 ? '+' : ''}{money(balance.netMinor, group.currency)}</strong></div>)}</div>
      <SettlementPanel group={group} session={session} balances={data.balances} debts={data.debts} simplifiedDebts={data.simplifiedDebts} settlements={data.settlements} updated={setSuccess} />
      <ExpenseExplorer group={group} renderExpenses={items => <History expenses={items} currency={group.currency} session={session} group={group} />} />
    </>}
  </section>;
}
export function DashboardLedger({ children, session }: { children: ReactNode; session: AuthSession }) {
  const { data, error, loading, retry } = useLedger<Overview>('/ledger');
  return <>{loading ? <div className="empty-state" role="status">Loading your balances…</div> : error || !data ? <div className="empty-state"><p className="form-error" role="alert">{error}</p><button className="secondary-button" onClick={retry}>Retry balances</button></div> : <section className="stats-grid" aria-label="Real balances by currency">{[{ title: 'Total owed to you', field: 'owedToMeMinor' as const, icon: ArrowDownLeft }, { title: 'Total you owe', field: 'iOweMinor' as const, icon: ArrowUpRight }, { title: 'Your net balance', field: 'netMinor' as const, icon: ReceiptText }].map(({ title, field, icon: Icon }, index) => <article className={`stat-card ${index === 2 ? 'net-card' : ''}`} key={field}><div className="stat-label">{title}<Icon size={19} /></div>{data.totals.length ? data.totals.map(total => <div className="currency-total" key={total.currency}><strong>{money(total[field], total.currency)}</strong><span>{total.currency}</span></div>) : <p className="no-currency">No groups yet</p>}<div className="stat-foot">{index === 2 ? 'Paid − share + repayments sent − received' : 'Bilateral debts after repayments'}</div></article>)}</section>}
    {children}
    <section id="expenses" className="expenses-section"><div className="section-heading"><div><h2>Recent expenses</h2><p>Latest 10 across your groups. Full history is inside each group.</p></div><button className="secondary-button" onClick={retry} aria-label="Refresh dashboard"><RefreshCw size={14} /></button></div>{loading ? <div className="empty-state" role="status">Loading expenses…</div> : error ? <p className="form-error" role="alert">{error}</p> : <History expenses={data?.expenses ?? []} session={session} />}</section>
  </>;
}
