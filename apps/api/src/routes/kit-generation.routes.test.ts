import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { SESSION_COOKIE_NAME } from '../config/cookies.js';
import { kitRepository } from '../repositories/kit.repository.js';
import {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from '../test-support/database.js';

/**
 * The HTTP generation path. The pipeline itself is tested elsewhere, so the
 * runner is stubbed here: what matters at this boundary is the 202, ownership,
 * validation and the duplicate rules.
 */
vi.mock('../services/generation-runner.js', () => ({
  startGeneration: vi.fn(),
  generateKit: vi.fn(() => Promise.resolve()),
}));

const { startGeneration } = await import('../services/generation-runner.js');

const database = await connectTestDatabase(import.meta.url);
const app = createApp();

const JD = [
  'Senior Backend Engineer',
  '',
  'Required:',
  '- 5+ years with Node.js and TypeScript',
  '- Experience mentoring junior engineers',
].join('\n');

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

function createBody(overrides: Record<string, unknown> = {}) {
  return { jd: JD, company_url: 'https://acme.example/', days: 5, ...overrides };
}

describe.skipIf(!database.available)('kit generation endpoints', () => {
  beforeEach(() => {
    vi.mocked(startGeneration).mockClear();
  });
  afterEach(clearTestDatabase);
  afterAll(disconnectTestDatabase);

  describe('POST /api/kits', () => {
    it('accepts the work and returns 202 without waiting for it', async () => {
      const { cookie } = await signUp('ada@example.com');

      const response = await request(app)
        .post('/api/kits')
        .set('Cookie', cookie)
        .send(createBody());

      expect(response.status).toBe(202);
      expect(response.body.id).toBeTruthy();
      expect(response.body.reused).toBe(false);
      expect(startGeneration).toHaveBeenCalledOnce();
    });

    it('refuses an anonymous request', async () => {
      const response = await request(app).post('/api/kits').send(createBody());

      expect(response.status).toBe(401);
      expect(startGeneration).not.toHaveBeenCalled();
    });

    it.each([
      ['a missing job description', { jd: undefined }],
      ['a job description of a few words', { jd: 'too short' }],
      ['a missing company url', { company_url: undefined }],
      ['a company url that is not a url', { company_url: 'acme' }],
      ['days below the minimum', { days: 0 }],
      ['days above the maximum', { days: 61 }],
      ['a fractional day count', { days: 2.5 }],
    ])('rejects %s', async (_label, overrides) => {
      const { cookie } = await signUp('ada@example.com');

      const response = await request(app)
        .post('/api/kits')
        .set('Cookie', cookie)
        .send(createBody(overrides));

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(startGeneration).not.toHaveBeenCalled();
    });

    it.each([1, 60])('accepts the boundary day count %i', async (days) => {
      const { cookie } = await signUp('ada@example.com');

      const response = await request(app)
        .post('/api/kits')
        .set('Cookie', cookie)
        .send(createBody({ days }));

      expect(response.status).toBe(202);
    });

    it('never takes the owner from the request body', async () => {
      const ada = await signUp('ada@example.com');
      const grace = await signUp('grace@example.com');

      const response = await request(app)
        .post('/api/kits')
        .set('Cookie', ada.cookie)
        .send({ ...createBody(), userId: grace.userId });

      expect(response.status).toBe(202);

      // The kit belongs to the session, not to the body.
      const asGrace = await request(app).get('/api/kits').set('Cookie', grace.cookie);
      expect(asGrace.body.kits).toEqual([]);
    });
  });

  describe('duplicate submissions', () => {
    it('returns the existing kit for the same posting rather than generating twice', async () => {
      const { cookie } = await signUp('ada@example.com');

      const first = await request(app).post('/api/kits').set('Cookie', cookie).send(createBody());
      vi.mocked(startGeneration).mockClear();

      const second = await request(app).post('/api/kits').set('Cookie', cookie).send(createBody());

      expect(second.status).toBe(202);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.reused).toBe(true);
      expect(startGeneration).not.toHaveBeenCalled();
    });

    /** `days` is part of the fingerprint, because the schedule is built around it. */
    it('treats a different day count as a genuinely different kit', async () => {
      const { cookie } = await signUp('ada@example.com');

      const five = await request(app)
        .post('/api/kits')
        .set('Cookie', cookie)
        .send(createBody({ days: 5 }));
      const ten = await request(app)
        .post('/api/kits')
        .set('Cookie', cookie)
        .send(createBody({ days: 10 }));

      expect(ten.body.id).not.toBe(five.body.id);
      expect(ten.body.reused).toBe(false);
    });

    /**
     * The read-then-create pattern cannot settle a race on its own. The unique
     * index is the authority, and the loser must return the winner rather than
     * starting a second minute-long generation.
     */
    it('starts exactly one generation when the same posting is submitted concurrently', async () => {
      const { cookie } = await signUp('ada@example.com');

      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          request(app).post('/api/kits').set('Cookie', cookie).send(createBody()),
        ),
      );

      for (const response of responses) expect(response.status).toBe(202);

      const ids = new Set(responses.map((response) => response.body.id));
      expect(ids.size).toBe(1);
      expect(startGeneration).toHaveBeenCalledOnce();
    });

    it('lets two users submit the same posting independently', async () => {
      const ada = await signUp('ada@example.com');
      const grace = await signUp('grace@example.com');

      const first = await request(app)
        .post('/api/kits')
        .set('Cookie', ada.cookie)
        .send(createBody());
      const second = await request(app)
        .post('/api/kits')
        .set('Cookie', grace.cookie)
        .send(createBody());

      expect(second.body.id).not.toBe(first.body.id);
    });

    it('retries a previously failed kit instead of refusing it forever', async () => {
      const { cookie, userId } = await signUp('ada@example.com');

      const first = await request(app).post('/api/kits').set('Cookie', cookie).send(createBody());
      await kitRepository.failKit(first.body.id, { code: 'GENERATION_FAILED', message: 'boom' });
      vi.mocked(startGeneration).mockClear();

      const retry = await request(app).post('/api/kits').set('Cookie', cookie).send(createBody());

      expect(retry.body.id).toBe(first.body.id);
      expect(retry.body.reused).toBe(false);
      expect(startGeneration).toHaveBeenCalledOnce();

      const kits = await kitRepository.listByOwner(userId);
      expect(kits).toHaveLength(1);
    });
  });

  describe('GET /api/kits/:id/status', () => {
    it('reports progress for the owner', async () => {
      const { cookie } = await signUp('ada@example.com');
      const created = await request(app).post('/api/kits').set('Cookie', cookie).send(createBody());

      await kitRepository.updateProgress(created.body.id, 'generating', {
        step: 'Writing interview questions',
        completedSteps: 6,
        totalSteps: 9,
      });

      const status = await request(app)
        .get(`/api/kits/${created.body.id}/status`)
        .set('Cookie', cookie);

      expect(status.status).toBe(200);
      expect(status.body).toMatchObject({
        status: 'generating',
        step: 'Writing interview questions',
        completedSteps: 6,
        totalSteps: 9,
      });
    });

    it('surfaces the error on a failed kit', async () => {
      const { cookie } = await signUp('ada@example.com');
      const created = await request(app).post('/api/kits').set('Cookie', cookie).send(createBody());

      await kitRepository.failKit(created.body.id, {
        code: 'GENERATION_FAILED',
        message: 'The model was unavailable.',
      });

      const status = await request(app)
        .get(`/api/kits/${created.body.id}/status`)
        .set('Cookie', cookie);

      expect(status.body.status).toBe('failed');
      expect(status.body.error.message).toBe('The model was unavailable.');
    });

    /** Anti-enumeration: someone else's kit is indistinguishable from a missing one. */
    it('hides another user’s kit behind a 404', async () => {
      const ada = await signUp('ada@example.com');
      const grace = await signUp('grace@example.com');

      const created = await request(app)
        .post('/api/kits')
        .set('Cookie', grace.cookie)
        .send(createBody());

      const response = await request(app)
        .get(`/api/kits/${created.body.id}/status`)
        .set('Cookie', ada.cookie);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('KIT_NOT_FOUND');
    });

    it('refuses an anonymous request', async () => {
      const { cookie } = await signUp('ada@example.com');
      const created = await request(app).post('/api/kits').set('Cookie', cookie).send(createBody());

      const response = await request(app).get(`/api/kits/${created.body.id}/status`);
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/kits/batch', () => {
    const row = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      jd: JD,
      company_url: 'https://acme.example/',
      days: 5,
      ...overrides,
    });

    it('queues one kit per valid row', async () => {
      const { cookie, userId } = await signUp('ada@example.com');

      const response = await request(app)
        .post('/api/kits/batch')
        .set('Cookie', cookie)
        .send([row('one'), row('two', { days: 7 })]);

      expect(response.status).toBe(202);
      expect(response.body.accepted).toHaveLength(2);
      expect(response.body.rejected).toEqual([]);
      expect(await kitRepository.listByOwner(userId)).toHaveLength(2);
    });

    /** One bad row must not cost the good ones. */
    it('reports an invalid row while still queueing the valid ones', async () => {
      const { cookie, userId } = await signUp('ada@example.com');

      const response = await request(app)
        .post('/api/kits/batch')
        .set('Cookie', cookie)
        .send([row('good'), { id: 'bad', jd: JD }, row('also-good', { days: 9 })]);

      expect(response.body.accepted.map((entry: { id: string }) => entry.id)).toEqual([
        'good',
        'also-good',
      ]);
      expect(response.body.rejected).toHaveLength(1);
      expect(response.body.rejected[0].id).toBe('bad');
      expect(response.body.rejected[0].reason).toContain('company_url');

      expect(await kitRepository.listByOwner(userId)).toHaveLength(2);
    });

    it('rejects an upload that is not a list of cases', async () => {
      const { cookie } = await signUp('ada@example.com');

      const response = await request(app).post('/api/kits/batch').set('Cookie', cookie).send({});
      expect(response.status).toBe(400);
    });

    it('refuses an anonymous request', async () => {
      const response = await request(app)
        .post('/api/kits/batch')
        .send([row('one')]);
      expect(response.status).toBe(401);
    });
  });
});
