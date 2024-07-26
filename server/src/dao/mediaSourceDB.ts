import {
  InsertMediaSourceRequest,
  UpdateMediaSourceRequest,
} from '@tunarr/types/api';
import ld, { isNil, isUndefined, keys, map, mapValues } from 'lodash-es';
import { groupByUniq } from '../util/index.js';
import { ChannelDB } from './channelDb.js';
import { ProgramSourceType } from './custom_types/ProgramSourceType.js';
import { getEm } from './dataSource.js';
import { MediaSource, mediaSourceTypeFromApi } from './entities/MediaSource.js';
import { Program } from './entities/Program.js';

//hmnn this is more of a "PlexServerService"...
const ICON_REGEX =
  /https?:\/\/.*(\/library\/metadata\/\d+\/thumb\/\d+).X-Plex-Token=.*/;

type Report = {
  type: 'channel' | 'custom-show' | 'filler';
  id: string;
  channelNumber?: number;
  channelName?: string;
  destroyedPrograms: number;
  modifiedPrograms: number;
};

export class MediaSourceDB {
  #channelDb: ChannelDB;

  constructor(channelDb: ChannelDB) {
    this.#channelDb = channelDb;
  }

  async getAll() {
    const em = getEm();
    return em.repo(MediaSource).findAll();
  }

  async getById(id: string) {
    return getEm().repo(MediaSource).findOne({ uuid: id });
  }

  async getByExternalid(nameOrClientId: string) {
    return getEm()
      .repo(MediaSource)
      .findOne({
        $or: [{ name: nameOrClientId }, { clientIdentifier: nameOrClientId }],
      });
  }

  async deleteMediaSource(id: string, removePrograms: boolean = true) {
    const deletedServer = await getEm().transactional(async (em) => {
      const ref = em.getReference(MediaSource, id);
      const existing = await em.findOneOrFail(MediaSource, ref, {
        populate: ['uuid', 'name'],
      });
      em.remove(ref);
      return existing;
    });

    let reports: Report[];
    if (!removePrograms) {
      reports = [];
    } else {
      reports = await this.fixupProgramReferences(deletedServer.name);
    }

    return { deletedServer, reports };
  }

  async updateMediaSource(server: UpdateMediaSourceRequest) {
    const em = getEm();
    const repo = em.repo(MediaSource);
    const id = server.id;

    if (isNil(id)) {
      throw Error('Missing server id from request');
    }

    const s = await repo.findOne({ uuid: id });

    if (isNil(s)) {
      throw Error("Server doesn't exist.");
    }

    const sendGuideUpdates =
      server.type === 'plex' ? server.sendGuideUpdates ?? false : false;
    const sendChannelUpdates =
      server.type === 'plex' ? server.sendChannelUpdates ?? false : false;

    em.assign(s, {
      name: server.name,
      uri: server.uri,
      accessToken: server.accessToken,
      sendGuideUpdates,
      sendChannelUpdates,
      updatedAt: new Date(),
    });

    this.normalizeServer(s);

    const report = await this.fixupProgramReferences(id, s);

    await repo.upsert(s);
    await em.flush();

    return report;
  }

  async addMediaSource(server: InsertMediaSourceRequest): Promise<string> {
    const em = getEm();
    const repo = em.repo(MediaSource);
    const name = isUndefined(server.name) ? 'plex' : server.name;
    const sendGuideUpdates =
      server.type === 'plex' ? server.sendGuideUpdates ?? false : false;
    const sendChannelUpdates =
      server.type === 'plex' ? server.sendChannelUpdates ?? false : false;
    const index = await repo.count();

    const newServer = em.create(MediaSource, {
      ...server,
      name,
      sendGuideUpdates,
      sendChannelUpdates,
      index,
      type: mediaSourceTypeFromApi(server.type),
    });

    this.normalizeServer(newServer);

    return await em.insert(MediaSource, newServer);
  }

  private async fixupProgramReferences(
    serverName: string,
    newServer?: MediaSource,
  ) {
    // TODO: We need to update this to:
    // 1. handle different source types
    // 2. use program_external_id table
    // 3. not delete programs if they still have another reference via
    //    the external id table (program that exists on 2 servers)
    const em = getEm();
    const allPrograms = await em
      .repo(Program)
      .find(
        { sourceType: ProgramSourceType.PLEX, externalSourceId: serverName },
        { populate: ['fillerShows', 'channels', 'customShows'] },
      );

    const channelById = groupByUniq(
      allPrograms.flatMap((p) => p.channels.toArray()),
      'uuid',
    );

    const customShowById = groupByUniq(
      allPrograms.flatMap((p) => p.customShows.toArray()),
      'uuid',
    );

    const fillersById = groupByUniq(
      allPrograms.flatMap((p) => p.fillerShows.toArray()),
      'uuid',
    );

    const channelToProgramCount = mapValues(
      channelById,
      ({ uuid }) =>
        allPrograms.filter((p) => p.channels.exists((f) => f.uuid === uuid))
          .length,
    );

    const customShowToProgramCount = mapValues(
      customShowById,
      ({ uuid }) =>
        allPrograms.filter((p) => p.customShows.exists((f) => f.uuid === uuid))
          .length,
    );

    const fillerToProgramCount = mapValues(
      fillersById,
      ({ uuid }) =>
        allPrograms.filter((p) => p.fillerShows.exists((f) => f.uuid === uuid))
          .length,
    );

    const isUpdate = newServer && newServer.uuid !== serverName;
    if (isUpdate) {
      ld.chain(allPrograms)
        .map((program) => this.fixupProgram(program, newServer))
        .sum()
        .value();
      await em.flush();
    } else {
      allPrograms.forEach((program) => {
        // Remove all associations of this program
        program.channels.removeAll();
        program.fillerShows.removeAll();
        program.customShows.removeAll();
      });

      for (const channel of keys(channelById)) {
        await this.#channelDb.removeProgramsFromLineup(
          channel,
          map(allPrograms, 'uuid'),
        );
      }
      em.remove(allPrograms);
      await em.flush();
    }

    const channelReports: Report[] = map(
      channelById,
      ({ number, name }, id) => {
        return {
          type: 'channel',
          id,
          channelNumber: number,
          channelName: name,
          destroyedPrograms: isUpdate ? 0 : channelToProgramCount[id] ?? 0,
          modifiedPrograms: isUpdate ? channelToProgramCount[id] ?? 0 : 0,
        } as Report;
      },
    );

    const fillerReports: Report[] = map(fillersById, ({ uuid }) => ({
      type: 'filler',
      id: uuid,
      destroyedPrograms: isUpdate ? 0 : fillerToProgramCount[uuid] ?? 0,
      modifiedPrograms: isUpdate ? fillerToProgramCount[uuid] ?? 0 : 0,
    }));

    const customShowReports: Report[] = map(customShowById, ({ uuid }) => ({
      type: 'custom-show',
      id: uuid,
      destroyedPrograms: isUpdate ? 0 : customShowToProgramCount[uuid] ?? 0,
      modifiedPrograms: isUpdate ? customShowToProgramCount[uuid] ?? 0 : 0,
    }));

    return [...channelReports, ...fillerReports, ...customShowReports];
  }

  private fixupProgram(program: Program, newServer: MediaSource) {
    let modified = false;
    const fixIcon = (icon: string | undefined) => {
      if (
        !isUndefined(icon) &&
        icon.includes('/library/metadata') &&
        icon.includes('X-Plex-Token')
      ) {
        const m = icon.match(ICON_REGEX);
        if (m?.length == 2) {
          const lib = m[1];
          const newUri = `${newServer.uri}${lib}?X-Plex-Token=${newServer.accessToken}`;
          modified = true;
          return newUri;
        }
      }
      return icon;
    };

    program.icon = fixIcon(program.icon);
    program.showIcon = fixIcon(program.showIcon);
    program.episodeIcon = fixIcon(program.episodeIcon);
    program.seasonIcon = fixIcon(program.seasonIcon);

    return modified;
  }

  private normalizeServer(server: MediaSource) {
    while (server.uri.endsWith('/')) {
      server.uri = server.uri.slice(0, -1);
    }
  }
}