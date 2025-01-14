import { StreamLineupItem } from '../dao/derived_types/StreamLineup.ts';
import { Channel } from '../dao/direct/schema/Channel.ts';
import { GetCurrentLineupItemRequest } from './StreamProgramCalculator.ts';

export class PlayerContext {
  constructor(
    public lineupItem: StreamLineupItem,
    public channel: Channel,
    public audioOnly: boolean,
    public isLoading: boolean,
    public realtime: boolean,
    public useNewPipeline: boolean = false,
  ) {}

  static error(
    duration: number,
    error: string | boolean | Error,
    channel: Channel,
    realtime: boolean = true,
    useNewPipeline: boolean = false,
  ): PlayerContext {
    return new PlayerContext(
      {
        type: 'error',
        duration,
        streamDuration: duration,
        title: 'Error',
        error,
      },
      channel,
      false,
      false,
      realtime,
      useNewPipeline,
    );
  }
}

export type GetPlayerContextRequest = GetCurrentLineupItemRequest & {
  audioOnly: boolean;
};
