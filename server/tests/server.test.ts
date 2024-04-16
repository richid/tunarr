import fc from 'fast-check';
import { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { initTestApp } from './lib/testServer.js';
import { initOrm } from '../src/dao/dataSource.js';
import { Channel } from '../src/dao/entities/Channel.js';
import { z } from 'zod';
import { ChannelSchema } from '@tunarr/types/schemas';
import { genChannel } from './lib/generators.js';

let app: FastifyInstance;

beforeAll(async () => {
  // we use different ports to allow parallel testing
  app = await initTestApp(30001);
});

afterAll(async () => {
  // we close only the fastify app - it will close the database connection via onClose hook automatically
  await app?.close();
  await initOrm().then((orm) => orm.close());
});

test('list all channels', async () => {
  const orm = await initOrm();

  await fc.assert(
    fc.asyncProperty(genChannel(), async (arbChannel) => {
      const em = orm.em.fork();

      await em.fork().nativeDelete(Channel, {});

      const channel = em.create(Channel, arbChannel);

      await em.persistAndFlush(channel);

      // mimic the http request via `app.inject()`
      const res = await app.inject({
        method: 'get',
        url: '/api/channels',
      });

      // assert it was successful response
      expect(res.statusCode).toBe(200);

      const parsed = z.array(ChannelSchema).safeParse(res.json());
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        // expect(parsed.data).toMatchObject([channel]);
      }
    }),
  );
});
