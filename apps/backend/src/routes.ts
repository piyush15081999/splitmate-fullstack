import { Router, type CookieOptions, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from './generated/prisma/client.js';
import { HttpError } from './errors.js';
import { bodyObject, currency, email, groupId, password, text } from './validation.js';
import { createAuthLimiter, hashPassword, randomToken, sameToken, sessionCookie, tokenHash, verifyPassword } from './security.js';
import { createLedgerRoutes } from './ledger.js';
import { createCollaborationRoutes } from './collaboration.js';
import { recordActivity } from './activity.js';

export const publicUser = { id: true, email: true, displayName: true } as const;
type UserProfile = { id: string; email: string; displayName: string };
type Auth = { user: UserProfile; tokenHash: string; csrfToken: string };
type Transaction = Prisma.TransactionClient;
export function createRoutes(prisma: PrismaClient, webOrigin: string, secureCookies: boolean) {
  const router = Router();
  const attempts = createAuthLimiter();
  const writes = createAuthLimiter(120, 60_000, 'write');
  const cookies: CookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/' };
  const lifetime = 7 * 24 * 60 * 60_000;
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // JSON-only mutations and exact configured Origin prevent login/registration CSRF too.
  router.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('Origin') !== webOrigin) throw new HttpError(403, 'Request origin is not allowed.');
      if (!req.is('application/json')) throw new HttpError(415, 'Content-Type must be application/json.');
    }
    next();
  });
  const resolveAuth = async (req: Request): Promise<Auth> => {
    const token = sessionCookie(req.headers.cookie);
    if (!token) throw new HttpError(401, 'Please sign in.');
    const session = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: { select: publicUser } } });
    if (!session || session.expiresAt.getTime() <= Date.now()) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    return { user: session.user, tokenHash: session.tokenHash, csrfToken: session.csrfToken };
  };
  async function authenticate(req: Request, res: Response, next: NextFunction) {
    try {
      const auth = await resolveAuth(req);
      if (!['GET', 'HEAD'].includes(req.method) && !sameToken(req.get('X-CSRF-Token'), auth.csrfToken)) throw new HttpError(403, 'Invalid CSRF token. Refresh and try again.');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path !== '/auth/logout') writes(auth.user.id);
      res.locals.auth = auth;
      next();
    } catch (error) { next(error); }
  }
  async function issueSession(tx: Transaction, userId: string, req: Request) {
    const token = randomToken();
    const csrfToken = randomToken();
    const old = sessionCookie(req.headers.cookie);
    if (old) await tx.session.deleteMany({ where: { tokenHash: tokenHash(old) } });
    // Opportunistic expiry cleanup; no background service is needed locally.
    await tx.session.deleteMany({ where: { userId, expiresAt: { lte: new Date() } } });
    await tx.session.create({ data: { tokenHash: tokenHash(token), csrfToken, userId, expiresAt: new Date(Date.now() + lifetime) } });
    return { token, csrfToken };
  }
  function respondAuth(res: Response, user: UserProfile, session: { token: string; csrfToken: string }, status = 200) {
    res.cookie('splitmate_session', session.token, { ...cookies, maxAge: lifetime });
    res.status(status).json({ user, csrfToken: session.csrfToken });
  }
  router.post('/auth/register', async (req, res) => {
    attempts(req.ip ?? 'local');
    const body = bodyObject(req.body, ['displayName', 'email', 'password']);
    const data = { displayName: text(body.displayName, 'Name', 100), email: email(body.email), passwordHash: await hashPassword(password(body.password)) };
    const result = await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data, select: publicUser });
      const session = await issueSession(tx, user.id, req);
      return { user, session };
    });
    respondAuth(res, result.user, result.session, 201);
  });
  router.post('/auth/login', async (req, res) => {
    attempts(req.ip ?? 'local');
    const body = bodyObject(req.body, ['email', 'password']);
    const normalized = email(body.email);
    const candidate = password(body.password);
    const account = await prisma.user.findUnique({ where: { email: normalized }, select: { ...publicUser, passwordHash: true } });
    const valid = await verifyPassword(candidate, account?.passwordHash ?? null);
    if (!account || !valid) throw new HttpError(401, 'Email or password is incorrect.');
    const session = await prisma.$transaction(tx => issueSession(tx, account.id, req));
    respondAuth(res, { id: account.id, email: account.email, displayName: account.displayName }, session);
  });
  router.get('/auth/me', authenticate, (_req, res) => {
    const auth = res.locals.auth as Auth;
    res.json({ user: auth.user, csrfToken: auth.csrfToken });
  });
  router.post('/auth/logout', authenticate, async (_req, res) => {
    await prisma.session.deleteMany({ where: { tokenHash: (res.locals.auth as Auth).tokenHash } });
    res.clearCookie('splitmate_session', cookies);
    res.status(204).end();
  });

  router.use('/groups', authenticate);
  router.use('/ledger', authenticate);
  router.use('/notifications', authenticate);
  router.use('/invitations', authenticate);
  router.use(createLedgerRoutes(prisma));
  router.use(createCollaborationRoutes(prisma));
  async function member(tx: Transaction, id: string, userId: string) {
    const membership = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: id, userId } } });
    if (!membership) throw new HttpError(404, 'Group not found.');
    return membership;
  }
  const summarySelect = { id: true, name: true, currency: true, createdAt: true, _count: { select: { members: true } } } as const;
  const detailSelect = { ...summarySelect, members: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }], select: { role: true, joinedAt: true, user: { select: publicUser } } } } satisfies Prisma.GroupSelect;
  router.get('/groups', async (_req, res) => {
    const userId = (res.locals.auth as Auth).user.id;
    const memberships = await prisma.groupMember.findMany({ where: { userId }, orderBy: { joinedAt: 'desc' }, select: { role: true, group: { select: summarySelect } } });
    res.json({ groups: memberships.map(({ role, group }) => ({ id: group.id, name: group.name, currency: group.currency, createdAt: group.createdAt, memberCount: group._count.members, role })) });
  });
  router.post('/groups', async (req, res) => {
    const userId = (res.locals.auth as Auth).user.id;
    const body = bodyObject(req.body, ['name', 'currency']);
    const group = await prisma.$transaction(async tx => {
      const group = await tx.group.create({ data: { name: text(body.name, 'Group name', 100), currency: currency(body.currency), members: { create: { userId, role: 'OWNER' } } }, select: detailSelect });
      await recordActivity(tx, { groupId: group.id, actorId: userId, action: 'GROUP_CREATED', referenceId: group.id, referenceType: 'GROUP', eventKey: `GROUP_CREATED:${group.id}`, data: { name: group.name, currency: group.currency } });
      return group;
    });
    res.status(201).json({ group });
  });
  for (const path of ['/groups/:id', '/groups/:id/members']) {
    router.get(path, async (req, res) => {
      const id = groupId(req.params.id);
      const userId = (res.locals.auth as Auth).user.id;
      // One query scopes both existence and returned fields to membership.
      const group = await prisma.group.findFirst({ where: { id, members: { some: { userId } } }, select: detailSelect });
      if (!group) throw new HttpError(404, 'Group not found.');
      res.json(path.endsWith('/members') ? { members: group.members } : { group });
    });
  }
  // Retired: membership must be granted by the invitee's explicit acceptance.
  router.post('/groups/:id/members', async (req, res) => {
    bodyObject(req.body, ['email']);
    const actor = await member(prisma, groupId(req.params.id), (res.locals.auth as Auth).user.id);
    if (actor.role !== 'OWNER') throw new HttpError(403, 'Only the group owner can invite members.');
    throw new HttpError(410, 'Direct membership creation has been retired. Send an invitation; the recipient must accept it.');
  });
  router.post('/groups/:id/leave', async (req, res) => {
    bodyObject(req.body, []);
    const id = groupId(req.params.id);
    const userId = (res.locals.auth as Auth).user.id;
    const deleted = await prisma.$transaction(async tx => {
      const actor = await member(tx, id, userId);
      if (actor.role === 'OWNER' && await tx.groupMember.count({ where: { groupId: id } }) > 1) throw new HttpError(409, 'The owner cannot leave while other members remain. Ask members to leave first.');
      const history = await tx.groupMember.findUniqueOrThrow({ where: { groupId_userId: { groupId: id, userId } }, select: { _count: { select: { paidExpenses: true, shares: true, outgoingSettlements: true, incomingSettlements: true } } } });
      if (Object.values(history._count).some(count => count > 0)) throw new HttpError(409, 'You cannot leave a group with financial history, including reversed repayments. Membership is retained to preserve the ledger.');
      if (actor.role === 'OWNER') {
        const groupHistory = await tx.group.findUniqueOrThrow({ where: { id }, select: { _count: { select: { expenses: true, settlements: true } } } });
        if (groupHistory._count.expenses || groupHistory._count.settlements) throw new HttpError(409, 'A group with financial history cannot be deleted.');
      }
      await tx.groupMember.delete({ where: { groupId_userId: { groupId: id, userId } } });
      await recordActivity(tx, { groupId: id, actorId: userId, action: 'MEMBER_LEFT', referenceId: userId, referenceType: 'USER', eventKey: `MEMBER_LEFT:${randomUUID()}`, data: { userId } });
      if (actor.role === 'OWNER') await tx.group.delete({ where: { id } });
      return actor.role === 'OWNER';
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ message: deleted ? 'You left and the empty group was deleted.' : 'You left the group.' });
  });
  return router;
}
