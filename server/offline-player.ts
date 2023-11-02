/******************
 * Offline player is for special screens, like the error
 * screen or the Flex Fallback screen.
 *
 * This module has to follow the program-player contract.
 * Asynchronous call to return a stream. Then the stream
 * can be used to play the program.
 **/
import EventEmitter from 'events';
import { FFMPEG, FfmpegEvents } from './ffmpeg.js';
import { serverOptions } from './globals.js';
import { Maybe, PlayerContext, TypedEventEmitter } from './types.js';
import { Player } from './player.js';
import { Readable, Writable } from 'stream';

export class OfflinePlayer extends Player {
  private context: PlayerContext;
  private error: boolean;
  private ffmpeg: FFMPEG;

  constructor(error: boolean, context: PlayerContext) {
    super();
    this.context = context;
    this.error = error;
    if (context.isLoading === true) {
      context.channel = {
        ...context.channel,
        offlinePicture: `http://localhost:${
          serverOptions().port
        }/images/loading-screen.png`,
        offlineSoundtrack: undefined,
      };
    }
    this.ffmpeg = new FFMPEG(context.ffmpegSettings, context.channel);
    this.ffmpeg.setAudioOnly(this.context.audioOnly);
  }

  cleanUp() {
    super.cleanUp();
    this.ffmpeg.kill();
  }

  async play(outStream: Writable) {
    try {
      let emitter = new EventEmitter() as TypedEventEmitter<FfmpegEvents>;
      let ffmpeg = this.ffmpeg;
      let lineupItem = this.context.lineupItem;
      let duration = lineupItem.streamDuration ?? 0 - lineupItem.start;
      let ff: Maybe<Readable>;
      if (this.error) {
        ff = await ffmpeg.spawnError(duration);
      } else {
        ff = await ffmpeg.spawnOffline(duration);
      }
      ff?.pipe(outStream, { end: false });

      ffmpeg.on('end', () => {
        emitter.emit('end');
      });
      ffmpeg.on('close', () => {
        emitter.emit('close');
      });
      ffmpeg.on('error', async (err) => {
        //wish this code wasn't repeated.
        if (!this.error) {
          console.log('Replacing failed stream with error stream');
          ff?.unpipe(outStream);
          // ffmpeg.removeAllListeners('data'); Type inference says this is never actually used...
          ffmpeg.removeAllListeners('end');
          ffmpeg.removeAllListeners('error');
          ffmpeg.removeAllListeners('close');
          ffmpeg = new FFMPEG(
            this.context.ffmpegSettings,
            this.context.channel,
          ); // Set the transcoder options
          ffmpeg.setAudioOnly(this.context.audioOnly);
          ffmpeg.on('close', () => {
            emitter.emit('close');
          });
          ffmpeg.on('end', () => {
            emitter.emit('end');
          });
          ffmpeg.on('error', (err) => {
            emitter.emit('error', err);
          });

          ff = await ffmpeg.spawnError(
            'oops',
            'oops',
            Math.min(duration, 60000),
          );
          ff?.pipe(outStream);
        } else {
          emitter.emit('error', err);
        }
      });
      return emitter;
    } catch (err) {
      if (err instanceof Error) {
        throw err;
      } else {
        throw Error(
          'Error when attempting to play offline screen: ' +
            JSON.stringify(err),
        );
      }
    }
  }
}
