import { isEmpty } from 'lodash-es';
import type { Channel } from '../dao/direct/schema/Channel';
import { FfmpegTranscodeSession } from '../ffmpeg/FfmpegTrancodeSession.js';
import { ConcatOptions } from '../ffmpeg/ffmpeg.js';
import { ConcatStream } from './ConcatStream';
import { DirectStreamSession } from './DirectStreamSession.js';
import { ConcatSessionType, SessionOptions } from './Session.js';

export type ConcatSessionOptions = SessionOptions & {
  sessionType: ConcatSessionType;
  audioOnly: boolean;
  concatOptions: ConcatOptions;
};

export class ConcatSession extends DirectStreamSession<ConcatSessionOptions> {
  #transcodeSession: FfmpegTranscodeSession;

  constructor(channel: Channel, options: ConcatSessionOptions) {
    super(channel, options);
    this.on('removeConnection', () => {
      if (isEmpty(this.connections())) {
        this.scheduleCleanup(5_000);
      }
    });
  }

  isStale(): boolean {
    return isEmpty(this.connections());
  }

  get sessionType() {
    return this.sessionOptions.sessionType;
  }

  protected initializeStream(): FfmpegTranscodeSession {
    this.#transcodeSession = new ConcatStream(this.channel, {
      ...this.sessionOptions.concatOptions,
      mode: this.sessionOptions.sessionType,
      logOutput: true,
    }).createSession();

    this.#transcodeSession.on('error', (e) => this.emit('error', e));
    this.#transcodeSession.on('exit', () => this.emit('end'));

    return this.#transcodeSession;
  }

  protected stopStream(): Promise<void> {
    this.#transcodeSession?.kill();
    return Promise.resolve(void 0);
  }
}
