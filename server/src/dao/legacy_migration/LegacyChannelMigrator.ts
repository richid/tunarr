import { seq } from '@tunarr/shared/util';
import {
  Channel as ApiChannel,
  Program as ApiProgram,
  ChannelStreamModes,
  TupleToUnion,
} from '@tunarr/types';
import dayjs from 'dayjs';
import {
  chunk,
  compact,
  difference,
  filter,
  get,
  isBoolean,
  isUndefined,
  keys,
  map,
  uniq,
  uniqBy,
  values,
} from 'lodash-es';
import fs from 'node:fs/promises';
import path from 'path';
import { v4 } from 'uuid';
import { ChannelNotFoundError } from '../../types/errors.js';
import { Maybe } from '../../types/util.js';
import {
  emptyStringToUndefined,
  groupByUniq,
  groupByUniqPropAndMap,
  isNonEmptyString,
  mapAsyncSeq,
  mapToObj,
  run,
} from '../../util/index.js';
import { LoggerFactory } from '../../util/logging/LoggerFactory.js';
import { ChannelDB } from '../channelDb.js';
import { CustomShowDB } from '../customShowDb.js';
import {
  ContentItem,
  CurrentLineupSchemaVersion,
  Lineup,
  LineupItem,
  OfflineItem,
  RedirectItem,
} from '../derived_types/Lineup.js';
import { directDbAccess } from '../direct/directDbAccess.js';
import { ProgramUpsertFields } from '../direct/programQueryHelpers.js';
import { Channel, NewChannelFillerShow } from '../direct/schema/Channel.js';
import { Program } from '../direct/schema/Program.js';
import { ChannelIcon } from '../direct/schema/base.js';
import {
  ChannelOfflineSettings,
  ChannelTranscodingSettings,
  ChannelWatermark,
} from '../entities/Channel.js';
import { FillerShowId } from '../entities/FillerShow.js';
import { ProgramDB } from '../programDB.js';
import { booleanToNumber } from '../sqliteUtil.js';
import {
  JSONArray,
  JSONObject,
  convertRawProgram,
  createProgramEntity,
  tryParseResolution,
  uniqueProgramId,
} from './migrationUtil.js';

const validPositions = [
  'bottom-left',
  'bottom-right',
  'top-left',
  'top-right',
] as const;

function isValidPosition(s: string): s is TupleToUnion<typeof validPositions> {
  for (const position of validPositions) {
    if (s === position) {
      return true;
    }
  }
  return false;
}

export type LegacyProgram = Omit<ApiProgram, 'channel'> & {
  isOffline: boolean;
  channel: number;
  ratingKey?: string;
};

export class LegacyChannelMigrator {
  private logger = LoggerFactory.child({
    caller: import.meta,
    className: this.constructor.name,
  });

  constructor(
    private channelDB: ChannelDB = new ChannelDB(),
    private customShowDB: CustomShowDB = new CustomShowDB(new ProgramDB()),
  ) {}

  async createLineup(
    rawPrograms: LegacyProgram[],
    dbProgramById: Record<string, Program>,
  ): Promise<Lineup> {
    const channels = await this.channelDB.getAllChannels();
    const channelIdsByNumber = groupByUniqPropAndMap(
      channels,
      'number',
      (c) => c.uuid,
    );

    const lineupItems: LineupItem[] = seq.collect(rawPrograms, (program) => {
      if (
        program.type &&
        ['movie', 'episode', 'track'].includes(program.type)
      ) {
        const dbProgram = dbProgramById[uniqueProgramId(program)];
        if (!isUndefined(dbProgram)) {
          // Content type
          return {
            type: 'content',
            id: dbProgram.uuid,
            durationMs: program.duration,
          } as ContentItem;
        }
      } else if (program.type === 'redirect') {
        return {
          type: 'redirect',
          channel: channelIdsByNumber[program.channel],
          durationMs: program.duration,
        } as RedirectItem;
      } else if (program.isOffline) {
        return {
          type: 'offline',
          durationMs: program.duration,
        } as OfflineItem;
      }

      return;
    });

    return {
      lastUpdated: dayjs().valueOf(),
      items: lineupItems,
      version: CurrentLineupSchemaVersion,
    };
  }

  // Migrates programs for a channel. The channel must already be persisted to the DB
  async migratePrograms(fullPath: string) {
    const channelFileContents = await fs.readFile(fullPath);

    const parsed = JSON.parse(
      channelFileContents.toString('utf-8'),
    ) as JSONObject;

    const channelNumber = parsed['number'] as number;
    const isOnDemand = run(() => {
      const rawValue = get(parsed, 'onDemand.isOnDemand');
      return isBoolean(rawValue) ? rawValue : false;
    });

    const channelEntity = await this.channelDB.getChannel(channelNumber);
    if (!channelEntity) {
      throw new ChannelNotFoundError(channelNumber);
    }

    const fallbackPrograms = (
      (parsed['fallback'] as Maybe<JSONArray>) ?? []
    ).map(convertRawProgram);

    // We don't filter out uniques yet because we will use this
    // array to create the 'raw' lineup, which can contain dupes
    const programs = filter(
      map((parsed['programs'] as JSONArray) ?? [], convertRawProgram),
      (p) =>
        isNonEmptyString(p.serverKey) &&
        isNonEmptyString(p.ratingKey) &&
        isNonEmptyString(p.key),
    );

    const programEntities = seq.collect(
      uniqBy(programs, uniqueProgramId),
      createProgramEntity,
    );

    this.logger.debug(
      'Upserting %d programs from legacy DB',
      programEntities.length,
    );

    const upsertedPrograms: Program[] = [];
    for (const c of chunk(programEntities, 100)) {
      upsertedPrograms.push(
        ...(await directDbAccess()
          .transaction()
          .execute((tx) =>
            tx
              .insertInto('program')
              .values(map(c, 'program'))
              .onConflict((oc) =>
                oc
                  .columns(['sourceType', 'externalSourceId', 'externalKey'])
                  .doUpdateSet((eb) =>
                    mapToObj(ProgramUpsertFields, (f) => ({
                      [f.replace('excluded.', '')]: eb.ref(f),
                    })),
                  ),
              )
              .returningAll()
              .execute(),
          )),
      );
    }

    const dbProgramById = groupByUniq(
      upsertedPrograms,
      (program) => `${program.externalSourceId}|${program.externalKey}`,
    );

    this.logger.debug(
      'Upserted %d programs from legacy DB',
      keys(dbProgramById).length,
    );

    const customShowIds = await this.customShowDB.getAllShowIds();

    const customShowRefs = uniq(seq.collect(programs, (p) => p.customShowId));

    const missingIds = difference(customShowRefs, customShowIds);

    if (missingIds.length > 0) {
      this.logger.warn(
        'There are custom show IDs that are not found in the DB: %O',
        missingIds,
      );
    }

    this.logger.debug('Saving channel %s', channelEntity.uuid);
    await directDbAccess()
      .transaction()
      .execute(async (tx) => {
        await tx
          .deleteFrom('channelPrograms')
          .where('channelPrograms.channelUuid', '=', channelEntity.uuid)
          .execute();
        await tx
          .deleteFrom('channelCustomShows')
          .where('channelCustomShows.channelUuid', '=', channelEntity.uuid)
          .execute();
        // Update associations from custom show <-> channel
        await tx
          .insertInto('channelCustomShows')
          .values(
            map(customShowRefs, (cs) => ({
              customShowUuid: cs,
              channelUuid: channelEntity.uuid,
            })),
          )
          .execute();
        // Associate the programs with the channel
        await tx
          .insertInto('channelPrograms')
          .values(
            map(values(dbProgramById), (id) => ({
              programUuid: id.uuid,
              channelUuid: channelEntity.uuid,
            })),
          )
          .execute();
      });

    this.logger.debug('Saving channel lineup %s', channelEntity.uuid);
    const channelDB = new ChannelDB();
    await channelDB.saveLineup(channelEntity.uuid, {
      ...(await this.createLineup(programs, dbProgramById)),
      onDemandConfig: isOnDemand
        ? {
            state: 'paused',
            cursor: 0,
          }
        : undefined,
    });

    return {
      legacyPrograms: programs,
      legacyFallback: fallbackPrograms,
      persistedPrograms: values(dbProgramById),
      persistedFallbacks: [],
    };
  }

  async migrateChannel(fullPath: string): Promise<{
    raw: Omit<ApiChannel, 'programs' | 'fallback'>;
    entity: Channel;
  }> {
    this.logger.info('Migrating channel file: ' + fullPath);
    const channelFileContents = await fs.readFile(fullPath);

    const parsed = JSON.parse(
      channelFileContents.toString('utf-8'),
    ) as JSONObject;

    const transcodingOptions = get(
      parsed,
      'transcoding.targetResolution',
    ) as Maybe<string>;
    const hasTranscodingOptions = !isUndefined(
      emptyStringToUndefined(transcodingOptions),
    );

    const watermark = parsed['watermark'] as JSONObject;
    const iconPosition = parsed['iconPosition'] as string;
    const isOnDemand = run(() => {
      const rawValue = get(parsed, 'onDemand.isOnDemand');
      return isBoolean(rawValue) ? rawValue : false;
    });

    const channel: ApiChannel = {
      id: v4(),
      disableFillerOverlay: parsed['disableFillerOverlay'] as boolean,
      duration: parsed['duration'] as number,
      // fallback: ((parsed['fallback'] as Maybe<JSONArray>) ?? []).map(
      // convertProgram,
      // ),
      groupTitle: parsed['groupTitle'] as string,
      guideMinimumDuration:
        (parsed['guideMinimumDurationSeconds'] as number) * 1000,
      icon: {
        path: parsed['icon'] as string,
        duration: parsed['iconDuration'] as number,
        position: isValidPosition(iconPosition) ? iconPosition : 'bottom-right',
        width: parsed['iconWidth'] as number,
      },
      startTime: dayjs(parsed['startTime'] as string).unix() * 1000,
      name: parsed['name'] as string,
      offline: {
        picture: parsed['offlinePicture'] as string,
        soundtrack: emptyStringToUndefined(
          parsed['offlineSoundtrack'] as string,
        ),
        mode: parsed['offlineMode'] as 'clip' | 'pic',
      },
      transcoding:
        hasTranscodingOptions &&
        !isUndefined(tryParseResolution(transcodingOptions))
          ? {
              targetResolution: tryParseResolution(transcodingOptions)!,
            }
          : undefined,
      number: parsed['number'] as number,
      fillerCollections: ((parsed['fillerCollections'] as JSONArray) ?? []).map(
        (fc) => {
          return {
            id: fc!['id'] as string,
            weight: fc!['weight'] as number,
            cooldownSeconds: fc!['cooldown'] / 1000,
          };
        },
      ),
      watermark: !isUndefined(watermark)
        ? {
            enabled: watermark['enabled'] as boolean,
            duration: watermark['duration'] as number,
            position:
              isNonEmptyString(watermark['position']) &&
              isValidPosition(watermark['position'])
                ? watermark['position']
                : 'bottom-right',
            width: watermark['width'] as number,
            verticalMargin: watermark['verticalMargin'] as number,
            horizontalMargin: watermark['horizontalMargin'] as number,
            url: watermark['url'] as Maybe<string>,
            animated: isUndefined(watermark['animated'])
              ? false
              : (watermark['animated'] as boolean),
            fixedSize: watermark['fixedSize'] as boolean,
            opacity: 100,
          }
        : undefined,
      stealth: isUndefined(parsed['stealth'])
        ? false
        : (parsed['stealth'] as boolean),
      guideFlexTitle: emptyStringToUndefined(
        parsed['guideFlexPlaceholder'] as string,
      ),
      onDemand: {
        enabled: isOnDemand,
      },
      programCount: 0, // Not really needed here
      streamMode: ChannelStreamModes.Hls,
    };

    let channelEntity: Channel;
    const existingEntity = await this.channelDB.getChannel(channel.number);

    if (existingEntity) {
      channelEntity = existingEntity;
      directDbAccess()
        .updateTable('channel')
        .where('channel.uuid', '=', existingEntity.uuid)
        .limit(1)
        .set({
          disableFillerOverlay: booleanToNumber(channel.disableFillerOverlay),
          groupTitle: channel.groupTitle,
          icon: JSON.stringify({
            ...channel.icon,
            position: !isValidPosition(channel.icon.position)
              ? ('bottom-right' as const)
              : channel.icon.position,
          } satisfies ChannelIcon),
          name: channel.name,
          number: channel.number,
          startTime: channel.startTime,
          stealth: booleanToNumber(channel.stealth),
          transcoding: channel.transcoding
            ? JSON.stringify(
                channel.transcoding satisfies ChannelTranscodingSettings,
              )
            : undefined,
          watermark: channel.watermark
            ? JSON.stringify(channel.watermark satisfies ChannelWatermark)
            : undefined,
          offline: JSON.stringify({
            mode: 'pic',
          } satisfies ChannelOfflineSettings),
          guideMinimumDuration: channel.guideMinimumDuration,
        });
    } else {
      const now = +dayjs();
      channelEntity = await directDbAccess()
        .insertInto('channel')
        .values({
          uuid: v4(),
          createdAt: now,
          updatedAt: now,
          duration: channel.duration,
          disableFillerOverlay: booleanToNumber(channel.disableFillerOverlay),
          groupTitle: channel.groupTitle,
          icon: JSON.stringify({
            ...channel.icon,
            position: !isValidPosition(channel.icon.position)
              ? ('bottom-right' as const)
              : channel.icon.position,
          } satisfies ChannelIcon),
          name: channel.name,
          number: channel.number,
          startTime: channel.startTime,
          stealth: booleanToNumber(channel.stealth),
          transcoding: channel.transcoding
            ? JSON.stringify(
                channel.transcoding satisfies ChannelTranscodingSettings,
              )
            : undefined,
          watermark: channel.watermark
            ? JSON.stringify(channel.watermark satisfies ChannelWatermark)
            : undefined,
          offline: JSON.stringify({
            mode: 'pic',
          } satisfies ChannelOfflineSettings),
          guideMinimumDuration: channel.guideMinimumDuration,
          streamMode: 'hls',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    // const entity = await em.upsert(ChannelEntity, channelEntity, {
    //   onConflictFields: ['number'],
    //   onConflictAction: 'ignore',
    // });

    // Init programs, we may have already inserted some
    await directDbAccess()
      .deleteFrom('channelPrograms')
      .where('channelUuid', '=', channelEntity.uuid)
      .execute();
    await directDbAccess()
      .deleteFrom('channelCustomShows')
      .where('channelUuid', '=', channelEntity.uuid)
      .execute();

    await this.migratePrograms(fullPath);

    return { raw: channel, entity: channelEntity };
  }

  async migrateChannels(dbPath: string) {
    const channelPath = path.resolve(dbPath, 'channels');

    this.logger.info(`Using channel directory: ${channelPath}`);

    const channelFiles = await fs.readdir(channelPath);

    this.logger.info(`Found channels: ${channelFiles.join(', ')}`);

    const migratedChannels = compact(
      await mapAsyncSeq(channelFiles, async (channel) => {
        try {
          const fullPath = path.join(channelPath, channel);
          return await this.migrateChannel(fullPath);
        } catch (e) {
          this.logger.error(`Unable to migrate channel ${channel}`, e);
          return;
        }
      }),
    );

    // Create filler associations
    await mapAsyncSeq(migratedChannels, async ({ raw: channel, entity }) => {
      const fillers = channel.fillerCollections ?? [];
      const relations = map(fillers, (filler) => {
        return {
          channelUuid: entity.uuid,
          fillerShowUuid: filler.id as FillerShowId,
          weight: filler.weight,
          cooldown: filler.cooldownSeconds,
        } satisfies NewChannelFillerShow;
      });

      await directDbAccess()
        .insertInto('channelFillerShow')
        .values(relations)
        .onConflict((oc) => oc.doNothing())
        .execute();
    });

    return migratedChannels;
  }
}
