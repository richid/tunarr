import {
  CreateCustomShowRequestSchema,
  IdPathParamSchema,
  UpdateCustomShowRequestSchema,
} from '@tunarr/types/api';
import { CustomProgramSchema, CustomShowSchema } from '@tunarr/types/schemas';
import { isNil, isNull, map, sumBy } from 'lodash-es';
import { z } from 'zod';
import { RouterPluginAsyncCallback } from '../types/serverType.js';
import { LoggerFactory } from '../util/logging/LoggerFactory.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const customShowsApiV2: RouterPluginAsyncCallback = async (fastify) => {
  const logger = LoggerFactory.child({
    caller: import.meta,
    className: 'CustomShowsApi',
  });

  fastify.addHook('onError', (req, _, error, done) => {
    logger.error({ error, url: req.routeOptions.config.url });
    done();
  });

  fastify.get(
    '/custom-shows',
    {
      schema: {
        response: {
          200: z.array(CustomShowSchema),
        },
      },
    },
    async (req, res) => {
      const customShows = await req.serverCtx.customShowDB.getAllShowsInfo();

      return res.send(
        map(customShows, (cs) => ({
          id: cs.id,
          name: cs.name,
          contentCount: cs.count,
          totalDuration: cs.totalDuration,
        })),
      );
    },
  );

  fastify.get(
    '/custom-shows/:id',
    {
      schema: {
        params: IdPathParamSchema,
        response: {
          200: CustomShowSchema,
          404: z.void(),
        },
      },
    },
    async (req, res) => {
      const customShow = await req.serverCtx.customShowDB.getShow(
        req.params.id,
      );

      if (isNil(customShow)) {
        return res.status(404).send();
      }

      return res.status(200).send({
        id: customShow.uuid,
        name: customShow.name,
        contentCount: customShow.customShowContent.length,
        totalDuration: sumBy(customShow.customShowContent, (c) => c.duration),
      });
    },
  );

  fastify.put(
    '/custom-shows/:id',
    {
      schema: {
        params: IdPathParamSchema,
        body: UpdateCustomShowRequestSchema,
        response: {
          200: CustomShowSchema,
          404: z.void(),
        },
      },
    },
    async (req, res) => {
      const customShow = await req.serverCtx.customShowDB.saveShow(
        req.params.id,
        req.body,
      );

      if (isNil(customShow)) {
        return res.status(404).send();
      }

      return res.status(200).send({
        id: customShow.uuid,
        name: customShow.name,
        contentCount: customShow.customShowContent.length,
        totalDuration: sumBy(customShow.customShowContent, (c) => c.duration),
      });
    },
  );

  fastify.get(
    '/custom-shows/:id/programs',
    {
      schema: {
        params: IdPathParamSchema,
        response: {
          200: z.array(CustomProgramSchema),
          404: z.void(),
        },
      },
    },
    async (req, res) => {
      return res
        .status(200)
        .send(await req.serverCtx.customShowDB.getShowPrograms(req.params.id));
    },
  );

  fastify.post(
    '/custom-shows',
    {
      schema: {
        body: CreateCustomShowRequestSchema,
        response: {
          201: z.object({ id: z.string() }),
        },
      },
    },
    async (req, res) => {
      const newId = await req.serverCtx.customShowDB.createShow(req.body);

      return res.status(201).send({ id: newId });
    },
  );

  fastify.delete(
    '/custom-shows/:id',
    {
      schema: {
        params: IdPathParamSchema,
        response: {
          200: z.object({ id: z.string() }),
          404: z.void(),
        },
      },
    },
    async (req, res) => {
      const customShow = await req.serverCtx.customShowDB.getShow(
        req.params.id,
      );

      if (isNull(customShow)) {
        return res.status(404).send();
      }

      await req.serverCtx.customShowDB.deleteShow(req.params.id);

      return res.status(200).send({ id: req.params.id });
    },
  );
};
