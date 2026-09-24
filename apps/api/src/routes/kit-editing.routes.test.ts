import type { Kit } from '@prep/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LlmProvider } from '../ai/llm-provider.js';
import { createApp } from '../app.js';
import { SESSION_COOKIE_NAME } from '../config/cookies.js';
import { emptyDigest } from '../pipeline/research-digest.js';
import { kitRepository } from '../repositories/kit.repository.js';
import {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from '../test-support/database.js';
import { createFakeProvider } from '../test-support/fake-llm-provider.js';
import { validKit } from '../test-support/kit-fixture.js';

/**
 * The editing and regeneration endpoints.
 *
 * The rules themselves are covered by `edit-kit.test.ts` without a database;
 * what is tested here is the boundary — ownership, the version guard, the
 * refusal to persist a change that would break the contract, and the promise
 * that a regeneration which fails leaves the kit exactly as it was.
 */

/** Regeneration builds its own provider; this is the seam to replace it. */
const fake = vi.hoisted(() => ({ provider: null as LlmProvider | null }));

vi.mock('../ai/groq-provider.js', () => ({
  createConfiguredProvider: () => {
    if (!fake.provider) throw new Error('no fake provider set for this test');
    return fake.provider;
  },
}));

const database = await connectTestDatabase(import.meta.url);
const app = createApp();

const INPUT = { jd: 'a'.repeat(40), company_url: 'https://acme.example/', days: 2 };

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

/** A finished kit, which is the only kind that can be edited. */
async function seedKit(
  userId: string,
  fingerprint = 'fp-1',
  kit: Kit = validKit(),
): Promise<{ id: string; version: string }> {
  const created = await kitRepository.create(userId, INPUT, fingerprint);

  await kitRepository.completeKit(created.id, {
    kit,
    provenance: {},
    idCounters: { requirement: 2, question: 2, flashcard: 1 },
    context: { digest: { ...emptyDigest(), industry: 'logistics' } },
    research: { pagesUsed: [], pagesFailed: [], searchUsed: '', notes: [] },
  });

  const stored = await kitRepository.findOwned(userId, created.id);
  if (!stored) throw new Error('seeding failed');

  return { id: stored.id, version: stored.updatedAt.toISOString() };
}

async function storedKitOf(userId: string, kitId: string): Promise<Kit> {
  const stored = await kitRepository.findOwned(userId, kitId);
  if (!stored?.kit) throw new Error('expected a stored kit');
  return stored.kit;
}

describe.skipIf(!database.available)('kit editing endpoints', () => {
  beforeEach(() => {
    fake.provider = null;
  });
  afterEach(clearTestDatabase);
  afterAll(disconnectTestDatabase);

  describe('editing a question', () => {
    it('saves the change and hands back the whole kit', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);

      const response = await request(app)
        .patch(`/api/kits/${id}/questions/q1`)
        .set('Cookie', cookie)
        .send({ version, prompt: 'Reworded by hand' });

      expect(response.status).toBe(200);
      expect(response.body.kit.kit.questions[0].prompt).toBe('Reworded by hand');
      expect(response.body.kit.provenance.q1.edited).toBe(true);

      const stored = await storedKitOf(userId, id);
      expect(stored.questions[0]?.prompt).toBe('Reworded by hand');
    });

    it('refuses an anonymous request', async () => {
      const { userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);

      const response = await request(app)
        .patch(`/api/kits/${id}/questions/q1`)
        .send({ version, prompt: 'nope' });

      expect(response.status).toBe(401);
    });

    it("cannot reach another user's kit", async () => {
      const ada = await signUp('ada@example.com');
      const grace = await signUp('grace@example.com');
      const { id, version } = await seedKit(grace.userId);

      const response = await request(app)
        .patch(`/api/kits/${id}/questions/q1`)
        .set('Cookie', ada.cookie)
        .send({ version, prompt: 'not mine' });

      // 404 rather than 403: a 403 would confirm the kit exists.
      expect(response.status).toBe(404);
      expect((await storedKitOf(grace.userId, id)).questions[0]?.prompt).toBe(
        validKit().questions[0]?.prompt,
      );
    });

    /** Two tabs, one kit: the second write must not silently win. */
    it('refuses a write made against a version that has moved on', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);

      const first = await request(app)
        .patch(`/api/kits/${id}/questions/q1`)
        .set('Cookie', cookie)
        .send({ version, prompt: 'first tab wins' });
      expect(first.status).toBe(200);

      const second = await request(app)
        .patch(`/api/kits/${id}/questions/q1`)
        .set('Cookie', cookie)
        .send({ version, prompt: 'second tab should not clobber' });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('CONFLICT');
      expect((await storedKitOf(userId, id)).questions[0]?.prompt).toBe('first tab wins');
    });

    it('rejects a change with no version at all', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id } = await seedKit(userId);

      const response = await request(app)
        .patch(`/api/kits/${id}/questions/q1`)
        .set('Cookie', cookie)
        .send({ prompt: 'no version' });

      expect(response.status).toBe(400);
    });

    it('rejects a change that would break the contract, and stores nothing', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);

      const response = await request(app)
        .patch(`/api/kits/${id}/questions/q1`)
        .set('Cookie', cookie)
        .send({ version, requirement_ids: ['r-does-not-exist'] });

      expect(response.status).toBe(400);

      const stored = await storedKitOf(userId, id);
      expect(stored.questions[0]?.requirement_ids).toEqual(['r1']);
    });

    it('refuses to edit a kit that is still being built', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const created = await kitRepository.create(userId, INPUT, 'fp-pending');
      const stored = await kitRepository.findOwned(userId, created.id);

      const response = await request(app)
        .patch(`/api/kits/${created.id}/questions/q1`)
        .set('Cookie', cookie)
        .send({ version: stored?.updatedAt.toISOString(), prompt: 'too early' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  describe('adding, deleting and reordering', () => {
    it('adds a question the user owns', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);

      const response = await request(app)
        .post(`/api/kits/${id}/questions`)
        .set('Cookie', cookie)
        .send({
          version,
          category: 'technical',
          prompt: 'One I want to be asked',
          difficulty: 2,
          requirement_ids: ['r1'],
        });

      expect(response.status).toBe(200);
      expect(response.body.kit.provenance.q3.origin).toBe('user');
      expect(response.body.kit.idCounters.question).toBe(3);
    });

    it('deletes a question and takes its schedule references with it', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);

      const response = await request(app)
        .delete(`/api/kits/${id}/questions/q1`)
        .set('Cookie', cookie)
        .send({ version });

      expect(response.status).toBe(200);

      const stored = await storedKitOf(userId, id);
      expect(stored.questions.map((question) => question.id)).toEqual(['q2']);
      expect(stored.schedule.days.flatMap((day) => day.question_ids)).not.toContain('q1');
    });

    it('rejects an order that is not a permutation of the category', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);

      const response = await request(app)
        .post(`/api/kits/${id}/questions/reorder`)
        .set('Cookie', cookie)
        .send({ version, category: 'technical', ids: ['q1', 'q2'] });

      expect(response.status).toBe(400);
    });
  });

  describe('the company brief', () => {
    it('is editable', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);

      const response = await request(app)
        .patch(`/api/kits/${id}/brief`)
        .set('Cookie', cookie)
        .send({ version, summary: 'What I actually know about them.' });

      expect(response.status).toBe(200);
      expect((await storedKitOf(userId, id)).company_brief.summary).toBe(
        'What I actually know about them.',
      );
    });
  });

  describe('regenerating the schedule', () => {
    /** Arithmetic, not generation: it must work with no model configured at all. */
    it('rebuilds the plan without calling a model', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);

      const added = await request(app)
        .post(`/api/kits/${id}/questions`)
        .set('Cookie', cookie)
        .send({
          version,
          category: 'technical',
          prompt: 'Unscheduled until the plan is rebuilt',
          difficulty: 1,
          requirement_ids: ['r1'],
        });
      expect(added.status).toBe(200);

      const response = await request(app)
        .post(`/api/kits/${id}/regenerate/schedule`)
        .set('Cookie', cookie)
        .send({ version: added.body.kit.updatedAt });

      expect(response.status).toBe(200);

      const stored = await storedKitOf(userId, id);
      expect(stored.schedule.days.flatMap((day) => day.question_ids)).toContain('q3');
      expect(stored.schedule.days_available).toBe(2);
    });
  });

  describe('regenerating a question category', () => {
    it('reports what it would keep before replacing anything', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);

      await request(app)
        .patch(`/api/kits/${id}/questions/q1`)
        .set('Cookie', cookie)
        .send({ version, pinned: true });

      const response = await request(app)
        .get(`/api/kits/${id}/regenerate/questions/technical/plan`)
        .set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body.plan).toEqual({ protectedIds: ['q1'], replaceableIds: [] });
    });

    it('replaces generated questions and keeps the edited one', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);

      // Make q1 the user's by editing it; it must come through untouched.
      const edited = await request(app)
        .patch(`/api/kits/${id}/questions/q1`)
        .set('Cookie', cookie)
        .send({ version, prompt: 'My own wording' });
      expect(edited.status).toBe(200);

      fake.provider = createFakeProvider([
        {
          questions: [
            {
              requirement_ids: ['r1'],
              prompt: 'A freshly generated question',
              answer_outline: 'outline',
              difficulty: 2,
            },
          ],
        },
      ]);

      const response = await request(app)
        .post(`/api/kits/${id}/regenerate/questions/technical`)
        .set('Cookie', cookie)
        .send({ version: edited.body.kit.updatedAt });

      expect(response.status).toBe(200);

      const stored = await storedKitOf(userId, id);
      const technical = stored.questions.filter((question) => question.category === 'technical');

      expect(technical.map((question) => question.prompt)).toEqual([
        'My own wording',
        'A freshly generated question',
      ]);
      // The behavioural question was not part of this and has not moved.
      expect(stored.questions.at(-1)?.id).toBe('q2');
    });

    /**
     * The promise that nothing is written until everything succeeded. A model
     * that fails halfway must leave the kit exactly as it was.
     */
    it('leaves the kit untouched when the model call fails', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);
      const before = await storedKitOf(userId, id);

      fake.provider = createFakeProvider(() => {
        throw new Error('the model fell over');
      });

      const response = await request(app)
        .post(`/api/kits/${id}/regenerate/questions/technical`)
        .set('Cookie', cookie)
        .send({ version });

      expect(response.status).toBe(500);
      expect(await storedKitOf(userId, id)).toEqual(before);
    });

    it('keeps the existing questions when the model returns none', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);
      const before = await storedKitOf(userId, id);

      fake.provider = createFakeProvider([{ questions: [] }]);

      const response = await request(app)
        .post(`/api/kits/${id}/regenerate/questions/technical`)
        .set('Cookie', cookie)
        .send({ version });

      expect(response.status).toBe(422);
      expect(await storedKitOf(userId, id)).toEqual(before);
    });

    it('404s on a category that does not exist', async () => {
      const { cookie, userId } = await signUp('ada@example.com');
      const { id, version } = await seedKit(userId);

      const response = await request(app)
        .post(`/api/kits/${id}/regenerate/questions/trivia`)
        .set('Cookie', cookie)
        .send({ version });

      expect(response.status).toBe(404);
    });
  });
});
