import { AudioStream, VideoStream } from '../../MediaStream.ts';
import { VideoFormats } from '../../constants.ts';
import { PixelFormat } from '../../format/PixelFormat.ts';
import { AudioInputSource } from '../../input/AudioInputSource.ts';
import { AudioState } from '../../state/AudioState.ts';
import { FrameState } from '../../state/FrameState.ts';
import { FrameSize } from '../../types.ts';

describe('SoftwarePipelineBuilder', () => {
  test('build args', () => {
    const pixelFormat: PixelFormat = {
      name: 'yuv420p',
      ffmpegName: 'yuv420p',
      bitDepth: 8,
    };

    const videoStream = VideoStream.create({
      index: 1,
      codec: 'h264',
      pixelFormat,
      frameSize: FrameSize.create({ width: 640, height: 480 }),
      isAnamorphic: false,
      pixelAspectRatio: null,
    });

    const audioState = AudioState.create({
      audioEncoder: 'ac3',
      audioChannels: 2,
      audioBitrate: 192,
      audioSampleRate: 48,
      audioBufferSize: 50,
      audioDuration: 11_000,
    });

    const audioInputFile = new AudioInputSource(
      'audio',
      [AudioStream.create({ index: 2, codec: 'flac', channels: 6 })],
      audioState,
    );

    const target = FrameSize.withDimensions(1280, 720);

    const frameState = FrameState({
      scaledSize: FrameSize.withDimensions(1920, 1080),
      paddedSize: target,
      isAnamorphic: false,
      realtime: true,
      videoFormat: VideoFormats.Hevc,
    });
  });
});
