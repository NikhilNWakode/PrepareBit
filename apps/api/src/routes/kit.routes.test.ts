import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { SESSION_COOKIE_NAME } from '../config/cookies.js';
import { EMPTY_ID_COUNTERS } from '../domain/kit/ids.js';
import { generatedEntry } from '../domain/kit/provenance.js';
import { kitRepository } from '../repositories/kit.repository.js';
import {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from '../test-support/database.js';
import { validKit } from '../test-support/kit-fixture.js';

const database = await connectTestDatabase(import.meta.url);
const app = createApp();

const INPUT = {
  jd: 'Senior Backend Engineer, 5+ years Node.js',
  company_url: 'https://acme.example',
  days: 5,
};

/** Registers a user and returns the session cookie plus their id. */
async function signUp(email: string): Promise<{ cookie: string; userId: string }> {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'a-sufficient-password' });

  expect(response.status).toBe(201);

  const header = response.headers['set-cookie'] as unknown as string[];
  const [cookie] = (
    header.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? ''
  ).split(';');
  if (!cookie) throw new Error('expected a session cookie');

  return { cookie, userId: response.body.user.id };
}

describe.skipIf(!database.available)('kit endpoints', () => {
  afterEach(clearTestDatabase);
  afterAll(disconnectTestDatabase);

  describe('authentication', () => {
    it('refuses the list without a session', async () => {
      const response = await request(app).get('/api/kits');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_REQUIRED');
    });

    it('refuses a single kit without a session', async () => {
      const { userId } = await signUp('ada@example.com');
      const created = await kitRepository.create(userId, INPUT, 'fp-1');

      const response = await request(app).get(`/api/kits/${created.id}`);
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/kits', () => {
    it('returns an empty list rather than an error when there are no kits', async () => {
      const { cookie } = await signUp('ada@example.com');

      const response = await request(app).get('/api/kits').set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body.kits).toEqual([]);
    });

    it('returns only the caller’s own kits', async () => {
      const ada = await signUp('ada@example.com');
      const grace = await signUp('grace@example.com');

      await kitRepository.create(ada.userId, INPUT, 'fp-ada');
      await kitRepository.create(grace.userId, INPUT, 'fp-grace-1');
      await kitRepository.create(grace.userId, INPUT, 'fp-grace-2');

      const asAda = await request(app).get('/api/kits').set('Cookie', ada.cookie);
      const asGrace = await request(app).get('/api/kits').set('Cookie', grace.cookie);

      expect(asAda.body.kits).toHaveLength(1);
      expect(asGrace.body.kits).toHaveLength(2);
    });

    it('lists newest first', async () => {
      const { cookie, userId } = await signUp('ada@example.com');

      const older = await kitRepository.create(userId, INPUT, 'fp-1');
      const newer = await kitRepository.create(userId, { ...INPUT, days: 7 }, 'fp-2');

      const response = await request(app).get('/api/kits').set('Cookie', cookie);

      expect(response.body.kits.map((kit: { id: string }) => kit.id)).toEqual([newer.id, older.id]);
    });
  });

  describe('GET /api/kits/:id', () => {
    it('returns a kit the caller owns', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const created = await kitRepository.create(userId, INPUT, 'fp-1');

      const response = await request(app).get(`/api/kits/${created.id}`).set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body.kit.id).toBe(created.id);
      expect(response.body.kit.input.company_url).toBe(INPUT.company_url);
    });

    /**
     * The test deferred from Phase 2, now that there is a resource to own.
     *
     * The answer is 404 and not 403 deliberately: a 403 would confirm the id
     * exists, which is exactly what someone probing for other people's kits
     * wants to learn.
     */
    it('hides another user’s kit behind a 404, not a 403', async () => {
      const ada = await signUp('ada@example.com');
      const grace = await signUp('grace@example.com');

      const gracesKit = await kitRepository.create(grace.userId, INPUT, 'fp-grace');

      const response = await request(app)
        .get(`/api/kits/${gracesKit.id}`)
        .set('Cookie', ada.cookie);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('KIT_NOT_FOUND');

      // The owner still sees it, so the 404 is about ownership, not existence.
      const owner = await request(app).get(`/api/kits/${gracesKit.id}`).set('Cookie', grace.cookie);
      expect(owner.status).toBe(200);
    });

    it('answers 404 for an id that does not exist', async () => {
      const { cookie } = await signUp('ada@example.com');

      const response = await request(app)
        .get('/api/kits/6ab41dc0cc4069c489f03e7d')
        .set('Cookie', cookie);

      expect(response.status).toBe(404);
    });

    it('answers 404 for a malformed id rather than failing with a cast error', async () => {
      const { cookie } = await signUp('ada@example.com');

      const response = await request(app).get('/api/kits/not-an-object-id').set('Cookie', cookie);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('KIT_NOT_FOUND');
    });
  });

  describe('persistence of the contract object', () => {
    it('round-trips a kit structurally through the Mixed field', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const created = await kitRepository.create(userId, INPUT, 'fp-1');
      const kit = validKit();

      await kitRepository.replaceKitContent(userId, created.id, {
        kit,
        provenance: { q1: generatedEntry() },
        idCounters: { ...EMPTY_ID_COUNTERS, requirement: 2, question: 2, flashcard: 1 },
      });

      const response = await request(app).get(`/api/kits/${created.id}`).set('Cookie', cookie);

      // Structural, not byte-for-byte: JSON transport is free to reorder keys.
      expect(response.body.kit.kit).toEqual(kit);
      expect(response.body.kit.idCounters).toEqual({ requirement: 2, question: 2, flashcard: 1 });
    });

    /**
     * `kit` is a Mixed field, and Mongoose cannot see mutations inside one. The
     * repository calls markModified for exactly this reason; without it the
     * write below is silently dropped.
     */
    it('persists an edit made inside the nested contract object', async () => {
      const { userId } = await signUp('ada@example.com');
      const created = await kitRepository.create(userId, INPUT, 'fp-1');

      const kit = validKit();
      await kitRepository.replaceKitContent(userId, created.id, {
        kit,
        provenance: {},
        idCounters: EMPTY_ID_COUNTERS,
      });

      kit.questions[0]!.prompt = 'Edited by hand';
      await kitRepository.replaceKitContent(userId, created.id, {
        kit,
        provenance: { q1: { ...generatedEntry(), edited: true } },
        idCounters: EMPTY_ID_COUNTERS,
      });

      const reloaded = await kitRepository.findOwned(userId, created.id);

      expect(reloaded?.kit?.questions[0]?.prompt).toBe('Edited by hand');
      expect(reloaded?.provenance['q1']?.edited).toBe(true);
    });

    it('refuses to write to a kit owned by someone else', async () => {
      const ada = await signUp('ada@example.com');
      const grace = await signUp('grace@example.com');
      const gracesKit = await kitRepository.create(grace.userId, INPUT, 'fp-grace');

      const result = await kitRepository.replaceKitContent(ada.userId, gracesKit.id, {
        kit: validKit(),
        provenance: {},
        idCounters: EMPTY_ID_COUNTERS,
      });

      expect(result).toBeNull();

      // Grace's kit is untouched.
      const reloaded = await kitRepository.findOwned(grace.userId, gracesKit.id);
      expect(reloaded?.kit).toBeNull();
    });

    it('does not find a kit when the owner id is wrong, at the repository level', async () => {
      const ada = await signUp('ada@example.com');
      const grace = await signUp('grace@example.com');
      const gracesKit = await kitRepository.create(grace.userId, INPUT, 'fp-grace');

      expect(await kitRepository.findOwned(ada.userId, gracesKit.id)).toBeNull();
      expect(await kitRepository.findOwned(grace.userId, gracesKit.id)).not.toBeNull();
    });
  });
});
