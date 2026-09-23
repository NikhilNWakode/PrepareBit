import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { SESSION_COOKIE_NAME } from '../config/cookies.js';
import { hashSessionId } from '../domain/auth/session-token.js';
import { SessionModel } from '../repositories/models/session.model.js';
import {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from '../test-support/database.js';

const database = await connectTestDatabase(import.meta.url);
const app = createApp();

const CREDENTIALS = { email: 'ada@example.com', password: 'a-sufficient-password' };

function sessionCookie(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  const match = header?.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (match === undefined) throw new Error('expected a session cookie to be set');

  const [pair] = match.split(';');
  if (pair === undefined) throw new Error('malformed session cookie');
  return pair;
}

/** Undoes cookie-parser's `s:<id>.<signature>` wrapper to recover the raw id. */
function rawSessionId(cookie: string): string {
  const encoded = cookie.slice(`${SESSION_COOKIE_NAME}=`.length);
  const [id] = decodeURIComponent(encoded).slice(2).split('.');
  if (id === undefined) throw new Error('malformed signed cookie');
  return id;
}

interface RegisteredUser {
  cookie: string;
  body: { user: { id: string; email: string } };
}

async function registerUser(credentials = CREDENTIALS): Promise<RegisteredUser> {
  const response = await request(app).post('/api/auth/register').send(credentials);
  expect(response.status).toBe(201);
  return { cookie: sessionCookie(response), body: response.body };
}

describe.skipIf(!database.available)('auth endpoints', () => {
  afterEach(clearTestDatabase);
  afterAll(disconnectTestDatabase);

  describe('register', () => {
    it('creates the user and never exposes the session id in the body', async () => {
      const response = await request(app).post('/api/auth/register').send(CREDENTIALS);

      expect(response.status).toBe(201);
      expect(response.body.user.email).toBe(CREDENTIALS.email);
      expect(response.body.user).not.toHaveProperty('passwordHash');

      // The id belongs in Set-Cookie and nowhere else.
      const id = rawSessionId(sessionCookie(response));
      expect(JSON.stringify(response.body)).not.toContain(id);
    });

    it('marks the cookie HttpOnly and SameSite=Lax, with no Domain', async () => {
      const response = await request(app).post('/api/auth/register').send(CREDENTIALS);
      const header = (response.headers['set-cookie'] as unknown as string[])[0] ?? '';

      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Lax');
      expect(header).toContain('Path=/');
      expect(header).not.toContain('Domain=');
    });

    it('rejects a duplicate email', async () => {
      await registerUser();
      const second = await request(app).post('/api/auth/register').send(CREDENTIALS);

      expect(second.status).toBe(409);
      expect(second.headers['set-cookie']).toBeUndefined();
    });

    it('normalises the email so case and padding cannot create a second account', async () => {
      await registerUser();
      const second = await request(app)
        .post('/api/auth/register')
        .send({ ...CREDENTIALS, email: '  ADA@Example.COM ' });

      expect(second.status).toBe(409);
    });

    it('reports invalid input as a validation failure', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ email: 'not-an-email', password: 'short' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('login', () => {
    it('answers identically for a wrong password and an unknown email', async () => {
      await registerUser();

      const wrongPassword = await request(app)
        .post('/api/auth/login')
        .send({ ...CREDENTIALS, password: 'not-the-password' });
      const unknownEmail = await request(app)
        .post('/api/auth/login')
        .send({ ...CREDENTIALS, email: 'nobody@example.com' });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      // Identical, so neither response reveals whether the account exists.
      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });

    it('issues a working session for correct credentials', async () => {
      await registerUser();
      const login = await request(app).post('/api/auth/login').send(CREDENTIALS);

      expect(login.status).toBe(200);

      const me = await request(app).get('/api/auth/me').set('Cookie', sessionCookie(login));
      expect(me.body.user.email).toBe(CREDENTIALS.email);
    });
  });

  describe('sessions', () => {
    it('stores only the SHA-256 of the session id', async () => {
      const { cookie } = await registerUser();
      const id = rawSessionId(cookie);

      const stored = await SessionModel.findOne({ sessionHash: hashSessionId(id) })
        .lean()
        .exec();

      expect(stored).not.toBeNull();
      // The raw id appears nowhere in the stored document.
      expect(JSON.stringify(stored)).not.toContain(id);
    });

    it('accepts a valid session', async () => {
      const { cookie, body } = await registerUser();
      const response = await request(app).get('/api/auth/me').set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe(body.user.id);
    });

    it('refuses a protected endpoint with no session', async () => {
      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_REQUIRED');
    });

    it('refuses a forged cookie carrying no valid signature', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `${SESSION_COOKIE_NAME}=not-a-real-session`);

      expect(response.status).toBe(401);
    });

    it('refuses a correctly signed cookie whose session no longer exists', async () => {
      const { cookie } = await registerUser();
      await SessionModel.deleteMany({}).exec();

      const response = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(response.status).toBe(401);
    });

    it('refuses an expired session before the TTL monitor reaps it', async () => {
      const { cookie } = await registerUser();

      // MongoDB sweeps expired rows roughly once a minute, so the row is still
      // present here. requireAuth must judge on expiresAt, not on absence.
      await SessionModel.updateOne(
        { sessionHash: hashSessionId(rawSessionId(cookie)) },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      ).exec();

      const response = await request(app).get('/api/auth/me').set('Cookie', cookie);

      expect(response.status).toBe(401);
      expect(await SessionModel.countDocuments()).toBe(1);
    });

    it('keeps two users apart', async () => {
      const ada = await registerUser();
      const grace = await registerUser({
        email: 'grace@example.com',
        password: 'another-good-password',
      });

      const asAda = await request(app).get('/api/auth/me').set('Cookie', ada.cookie);
      const asGrace = await request(app).get('/api/auth/me').set('Cookie', grace.cookie);

      expect(asAda.body.user.email).toBe('ada@example.com');
      expect(asGrace.body.user.email).toBe('grace@example.com');
      expect(asAda.body.user.id).not.toBe(asGrace.body.user.id);
    });
  });

  describe('logout', () => {
    it('revokes the session server-side, so replaying the cookie fails', async () => {
      const { cookie } = await registerUser();

      const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);
      expect(logout.status).toBe(204);
      expect(await SessionModel.countDocuments()).toBe(0);

      const replay = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(replay.status).toBe(401);
    });

    it('succeeds with no session, so signing out is never stuck', async () => {
      const response = await request(app).post('/api/auth/logout');
      expect(response.status).toBe(204);
    });
  });
});
