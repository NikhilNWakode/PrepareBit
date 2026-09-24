import type { Kit } from '@prep/shared';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { SESSION_COOKIE_NAME } from '../config/cookies.js';
import { emptyDigest } from '../pipeline/research-digest.js';
import { kitRepository } from '../repositories/kit.repository.js';
import {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from '../test-support/database.js';
import { validKit } from '../test-support/kit-fixture.js';

/**
 * The practice and briefing endpoints.
 *
 * The ordering and composition rules are covered without a database in
 * `domain/practice`. What is tested here is the boundary: ownership, and the
 * promise that a rating is not an edit — it must not touch the kit, and it must
 * not move the version an editor in another tab is holding.
 */

const database = await connectTestDatabase(import.meta.url);
const app = createApp();

const INPUT = { jd: 'a'.repeat(40), company_url: 'https://acme.example/', days: 3 };

async function signUp(email: string): Promise<{ cookie: string; userId: string }> {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'a-sufficient-password' });

  expect(response.status).toBe(201);

  const header = response.headers['set-cookie'] as unknown as string[];
  const [cookie] = (header.find((v) => v.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? '').split(';');
  if (!cookie) throw new Error('expected a session cookie');

  return { cookie, userId: response.body.user.id };
}

async function seedKit(userId: string, fingerprint = 'fp-1'): Promise<string> {
  const created = await kitRepository.create(userId, INPUT, fingerprint);

  await kitRepository.completeKit(created.id, {
    kit: validKit(),
    provenance: {},
    idCounters: { requirement: 2, question: 2, flashcard: 1 },
    context: { digest: { ...emptyDigest(), industry: 'logistics' } },
    research: { pagesUsed: [], pagesFailed: [], searchUsed: '', notes: [] },
  });

  return created.id;
}

describe.skipIf(!database.available)('practice endpoints', () => {
  afterEach(clearTestDatabase);
  afterAll(disconnectTestDatabase);

  describe('GET /api/kits/:id/practice', () => {
    it('returns the queue and what has been covered', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const id = await seedKit(userId);

      const response = await request(app).get(`/api/kits/${id}/practice`).set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body.cards).toHaveLength(1);
      expect(response.body.cards[0].id).toBe('f1');
      expect(response.body.cards[0].confidence).toBeNull();
      expect(response.body.progress).toEqual({ reviewed: 0, total: 1 });
    });

    it('refuses an anonymous request', async () => {
      const { userId } = await signUp('ada@example.com');
      const id = await seedKit(userId);

      expect((await request(app).get(`/api/kits/${id}/practice`)).status).toBe(401);
    });

    it("cannot reach another user's kit", async () => {
      const ada = await signUp('ada@example.com');
      const grace = await signUp('grace@example.com');
      const id = await seedKit(grace.userId);

      const response = await request(app).get(`/api/kits/${id}/practice`).set('Cookie', ada.cookie);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/kits/:id/practice/:cardId', () => {
    it('records a rating and reports the new progress', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const id = await seedKit(userId);

      const response = await request(app)
        .post(`/api/kits/${id}/practice/f1`)
        .set('Cookie', cookie)
        .send({ confidence: 2 });

      expect(response.status).toBe(200);
      expect(response.body.progress).toEqual({ reviewed: 1, total: 1 });

      const stored = await kitRepository.findOwned(userId, id);
      expect(stored?.practice['f1']).toMatchObject({ confidence: 2, timesReviewed: 1 });
    });

    it('replaces the confidence and counts the review on a second rating', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const id = await seedKit(userId);

      await request(app)
        .post(`/api/kits/${id}/practice/f1`)
        .set('Cookie', cookie)
        .send({ confidence: 1 });
      await request(app)
        .post(`/api/kits/${id}/practice/f1`)
        .set('Cookie', cookie)
        .send({ confidence: 3 });

      const stored = await kitRepository.findOwned(userId, id);
      expect(stored?.practice['f1']).toMatchObject({ confidence: 3, timesReviewed: 2 });
    });

    /**
     * The reason this endpoint bypasses the mutation funnel. Someone editing a
     * question in another tab is holding `updatedAt` as their version; if
     * practising moved it, their next save would be refused as stale for a
     * reason they could not possibly guess.
     */
    it('does not move the version an editor in another tab is holding', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const id = await seedKit(userId);

      const before = await kitRepository.findOwned(userId, id);
      const version = before?.updatedAt.toISOString();

      await request(app)
        .post(`/api/kits/${id}/practice/f1`)
        .set('Cookie', cookie)
        .send({ confidence: 1 });

      const after = await kitRepository.findOwned(userId, id);
      expect(after?.updatedAt.toISOString()).toBe(version);

      // And the edit that was in flight still lands.
      const edited = await request(app)
        .patch(`/api/kits/${id}/questions/q1`)
        .set('Cookie', cookie)
        .send({ version, prompt: 'Still saveable after practising' });

      expect(edited.status).toBe(200);
    });

    it('leaves the contract object untouched', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const id = await seedKit(userId);
      const before = (await kitRepository.findOwned(userId, id))?.kit as Kit;

      await request(app)
        .post(`/api/kits/${id}/practice/f1`)
        .set('Cookie', cookie)
        .send({ confidence: 3 });

      const after = (await kitRepository.findOwned(userId, id))?.kit as Kit;
      expect(after).toEqual(before);
    });

    it.each([[0], [4], [2.5], ['2'], [null]])('rejects %p as a confidence', async (value) => {
      const { cookie, userId } = await signUp('ada@example.com');
      const id = await seedKit(userId);

      const response = await request(app)
        .post(`/api/kits/${id}/practice/f1`)
        .set('Cookie', cookie)
        .send({ confidence: value });

      expect(response.status).toBe(400);
    });

    it('404s on a card this kit does not have', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const id = await seedKit(userId);

      const response = await request(app)
        .post(`/api/kits/${id}/practice/f99`)
        .set('Cookie', cookie)
        .send({ confidence: 1 });

      expect(response.status).toBe(404);
    });

    it("cannot rate a card in another user's kit", async () => {
      const ada = await signUp('ada@example.com');
      const grace = await signUp('grace@example.com');
      const id = await seedKit(grace.userId);

      const response = await request(app)
        .post(`/api/kits/${id}/practice/f1`)
        .set('Cookie', ada.cookie)
        .send({ confidence: 1 });

      expect(response.status).toBe(404);
      expect((await kitRepository.findOwned(grace.userId, id))?.practice).toEqual({});
    });
  });

  describe('GET /api/kits/:id/interview-day', () => {
    it('composes the briefing from the kit that is already stored', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const id = await seedKit(userId);

      const response = await request(app)
        .get(`/api/kits/${id}/interview-day`)
        .set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body.briefing.company).toBe('Acme');
      expect(response.body.briefing.role).toBe('Senior Backend Engineer');
      expect(response.body.briefing.keyRequirements[0].id).toBe('r1');
      expect(response.body.briefing.questionsToAsk.length).toBeGreaterThan(0);
      expect(response.body.days).toBe(3);
    });

    it('refuses an anonymous request', async () => {
      const { userId } = await signUp('ada@example.com');
      const id = await seedKit(userId);

      expect((await request(app).get(`/api/kits/${id}/interview-day`)).status).toBe(401);
    });

    it("cannot reach another user's kit", async () => {
      const ada = await signUp('ada@example.com');
      const grace = await signUp('grace@example.com');
      const id = await seedKit(grace.userId);

      const response = await request(app)
        .get(`/api/kits/${id}/interview-day`)
        .set('Cookie', ada.cookie);

      expect(response.status).toBe(404);
    });
  });
});
