import fs from 'node:fs/promises';
import retry from 'async-retry';
import { SessionOptions, StreamReadyResult, StreamSession } from './Session';
import { isNodeError } from '../util';
import { isError, isString } from 'lodash-es';
import { ConcatStream } from './ConcatStream';
import { Channel } from '../dao/entities/Channel';
import { join, resolve } from 'node:path';
import { getSettings } from '../dao/settings';

export function getDefaultHlsOutputPath() {
  return resolve(process.cwd(), 'streams');
}

export type HlsSessionOptions = SessionOptions & {
  sessionType: 'hls';
  streamOutputPath: string;
};

export class HlsSessionFactory {
  private constructor() {}

  static create(
    channel: Channel,
    opts: Omit<Partial<HlsSessionOptions>, 'sessionType' | 'streamOutputPath'>,
  ): HlsSession {
    const settings = getSettings().ffmpegSettings();
    return new HlsSession(channel, {
      ...opts,
      sessionType: 'hls',
      streamOutputPath:
        settings.hlsSettings.hlsOutputDirectory ?? getDefaultHlsOutputPath(),
    });
  }
}

export class HlsSession extends StreamSession {
  #outPath: string;
  // Absolute path to the stream directory
  #streamPath: string;
  // The path to request streaming assets from the server
  #serverPath: string;

  constructor(channel: Channel, options: HlsSessionOptions) {
    super(channel, options);
    this.#outPath = resolve(
      options.streamOutputPath,
      `stream_${this.channel.uuid}`,
    );
    this.#streamPath = join(this.#outPath, 'stream.m3u8');
    // Direct players back to the /hls URL which will return the playlist
    this.#serverPath = `/media-player/${this.channel.uuid}/hls`;
  }

  get workingDirectory() {
    return this.#outPath;
  }

  get streamPath() {
    return this.#streamPath;
  }

  get serverPath() {
    return this.#serverPath;
  }

  protected async initializeStream() {
    this.logger.debug(`Creating stream directory: ${this.#outPath}`);

    try {
      await fs.stat(this.#outPath);
      await this.cleanupDirectory();
    } catch (e) {
      if (isNodeError(e) && e.code === 'ENOENT') {
        this.logger.debug("[Session %s]: Stream directory doesn't exist.");
      }
    } finally {
      await fs.mkdir(this.#outPath);
    }

    return await new ConcatStream().startStream(
      this.channel.uuid,
      /* audioOnly */ false,
      {
        enableHls: true,
        hlsOptions: {
          streamBasePath: `stream_${this.channel.uuid}`,
          hlsTime: 3,
          hlsListSize: 8,
        },
        logOutput: false,
      },
    );
  }

  protected override async waitForStreamReady(): Promise<StreamReadyResult> {
    // Wait for the stream to become ready
    try {
      await retry(
        async (bail) => {
          try {
            await fs.stat(this.#streamPath);
          } catch (e) {
            if (isNodeError(e) && e.code === 'ENOENT') {
              this.logger.debug('Still waiting for stream session to start.');
              throw e; // Retry
            } else {
              this.state === 'error';
              bail(isError(e) ? e : new Error('Unexplained error: ' + e));
            }
          }
        },
        {
          retries: 10,
          factor: 1.2,
        },
      );
      return {
        type: 'success',
      };
    } catch (e) {
      this.logger.error(e, 'Error starting stream after retrying');
      this.state = 'error';
      return {
        type: 'error',
        error: isError(e) ? e : new Error(isString(e) ? e : 'Unknown error'),
      };
    }
  }

  protected async stopStream(): Promise<void> {
    this.logger.debug(
      `Cleaning out stream path for session: %s`,
      this.#outPath,
    );
    return await this.cleanupDirectory();
  }

  private async cleanupDirectory() {
    try {
      return await fs.rm(this.#outPath, {
        recursive: true,
        force: true,
      });
    } catch (err) {
      return this.logger.error(
        err,
        'Failed to cleanup stream: %s %O',
        this.channel.uuid,
      );
    }
  }
}
