import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, DoorOpen, Plus, Users } from 'lucide-react';
import { api, errorMessage, type AuthSession, type GroupDetail, type GroupSummary } from './api';

import { Modal } from './Modal';
import { GroupLedger } from './Ledger';
import { GroupInsights, InviteMember } from './Collaboration';
export { Modal } from './Modal';
function CreateGroup({ session, close, created }: { session: AuthSession; close: () => void; created: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError('');
    try {
      const result = await api<{ group: GroupDetail }>('/groups', { method: 'POST', csrfToken: session.csrfToken, body: { name: data.get('name'), currency: data.get('currency') } });
      created(result.group.id);
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <Modal title="A new place for your people." close={close} busy={busy}><p>Create a group. You’ll be its owner and first member.</p>{error && <p role="alert" className="form-error">{error}</p>}<form onSubmit={submit} aria-busy={busy}><label>Group name<input name="name" required maxLength={100} placeholder="The Green House" disabled={busy} /></label><label>Group currency<select name="currency" defaultValue="EUR" disabled={busy}><option value="EUR">EUR · Euro</option><option value="GBP">GBP · Pound sterling</option><option value="USD">USD · US dollar</option></select></label><p className="field-hint">One currency per group. All expenses use this currency.</p><button className="primary-button full-width" disabled={busy}>{busy ? 'Creating…' : 'Create group'}</button></form></Modal>;
}
export function GroupList({ session, navigate }: { session: AuthSession; navigate: (path: string) => void }) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  useEffect(() => { const refresh = () => setAttempt(n => n + 1); window.addEventListener('splitmate-collaboration-updated', refresh); return () => window.removeEventListener('splitmate-collaboration-updated', refresh); }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void api<{ groups: GroupSummary[] }>('/groups', { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setGroups(result.groups); }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  return <section id="groups" className="groups-section"><div className="section-heading"><div><h2>My groups {!loading && !error && <span className="count-pill">{groups.length}</span>}</h2><p>The people you share a little life with.</p></div><button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} />Create group</button></div>
    {loading ? <div className="empty-state" role="status">Loading your groups…</div> : error ? <div className="empty-state"><p className="form-error" role="alert">{error}</p><button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div> : groups.length === 0 ? <div className="empty-state"><span className="tile-icon sage"><Users size={24} /></span><h3>Your first group starts here.</h3><p>Create a group for your home, your next trip, or your favourite people.</p><button className="secondary-button" onClick={() => setCreating(true)}>Create your first group<Plus size={15} /></button></div> : <div className="group-grid">{groups.map(group => <a className="group-card real-group-card" href={`/groups/${group.id}`} onClick={event => { event.preventDefault(); navigate(`/groups/${group.id}`); }} key={group.id}><div className="group-top"><span className="tile-icon sage"><Users size={23} strokeWidth={1.7} /></span><span className="role-pill">{group.role === 'OWNER' ? 'OWNER' : 'MEMBER'}</span></div><h3>{group.name}</h3><p>{group.memberCount} {group.memberCount === 1 ? 'member' : 'members'} · {group.currency}</p><div className="group-bottom"><span>View group</span><ArrowUpRight size={17} /></div></a>)}</div>}
    {creating && <CreateGroup session={session} close={() => setCreating(false)} created={id => navigate(`/groups/${id}?created=1`)} />}
  </section>;
}
export function GroupPage({ id, session, navigate }: { id: string; session: AuthSession; navigate: (path: string) => void }) {
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [success] = useState(new URLSearchParams(window.location.search).has('created') ? 'Your group is ready. Invite registered friends below.' : '');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void api<{ group: GroupDetail }>(`/groups/${id}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setGroup(result.group); }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, attempt]);
  const isOwner = group?.members.some(member => member.user.id === session.user.id && member.role === 'OWNER');
  async function leave() {
    setBusy(true); setActionError('');
    try { await api(`/groups/${id}/leave`, { method: 'POST', body: {}, csrfToken: session.csrfToken }); navigate('/?left=1'); }
    catch (error) { setActionError(errorMessage(error)); setLeaving(false); } finally { setBusy(false); }
  }
  return <><button className="back-button" onClick={() => navigate('/')}><ArrowLeft size={16} />Back to my groups</button>
    {loading ? <div className="empty-state" role="status">Loading group…</div> : error || !group ? <div className="empty-state"><p role="alert" className="form-error">{error || 'Group not found.'}</p><button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div> : <>
      <div className="page-heading"><div><div className="eyebrow">YOUR SHARED SPACE</div><h1>{group.name}</h1><p>{group.members.length} {group.members.length === 1 ? 'member' : 'members'} · {group.currency} · You are {isOwner ? 'the owner' : 'a member'}</p></div><span className="tile-icon sage"><Users size={25} /></span></div>
      {success && <p className="notice" role="status">{success}</p>}{actionError && <p className="form-error" role="alert">{actionError}</p>}
      <GroupLedger group={group} session={session} refreshKey={attempt} /><GroupInsights group={group} />
      <section className="members-card"><div className="section-heading"><div><h2>Group members <span className="count-pill">{group.members.length}</span></h2><button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>Refresh members</button><p>Only members can see this group and its people.</p></div></div><ul className="member-list">{group.members.map(member => <li key={member.user.id}><span className="avatar">{member.user.displayName.slice(0, 2).toUpperCase()}</span><div><strong>{member.user.displayName}{member.user.id === session.user.id && <span className="you-label"> (you)</span>}</strong><small>{member.user.email}</small></div><span className="role-pill">{member.role === 'OWNER' ? 'OWNER' : 'MEMBER'}</span></li>)}</ul>
        {isOwner ? <InviteMember groupId={id} session={session} /> : <p className="member-note">The group owner can invite registered users. Membership requires acceptance.</p>}
      </section><section className="leave-card"><div><h2>Leave this group</h2><p>{isOwner && group.members.length > 1 ? 'As the owner, you can leave only after the other members have left.' : isOwner ? 'You are the last member. Leaving will permanently delete this empty group.' : 'Leaving removes this group from your dashboard. Invitation acceptance is required to join.'} Financial history prevents leaving.</p></div><button className="danger-button" disabled={busy || (isOwner && group.members.length > 1)} onClick={() => setLeaving(true)}><DoorOpen size={16} />Leave group</button></section>
    </>}
    {leaving && <Modal title="Leave this group?" close={() => setLeaving(false)} busy={busy}><p>{isOwner ? 'You are the last member. This will delete the empty group. This action cannot be undone.' : 'You will lose access to this group and its member list.'}</p><div className="dialog-actions"><button className="secondary-button" disabled={busy} onClick={() => setLeaving(false)}>Stay in group</button><button className="danger-button" disabled={busy} onClick={() => void leave()}>{busy ? 'Leaving…' : 'Confirm leave'}</button></div></Modal>}
  </>;
}
