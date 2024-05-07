import { FfmpegCommandGenerator } from './FfmpegCommandGenerator';
import { AudioStream, StillImageStream, VideoStream } from './MediaStream';
import { VideoFormats } from './constants';
import { PipelineBuilderFactory } from './pipeline/PipelineBuilderFactory';
import { AudioState } from './state/AudioState';
import { FfmpegState } from './state/FfmpegState';
import { FrameState } from './state/FrameState';
import {
  AudioInputSource,
  FrameSize,
  PixelFormat,
  VideoInputSource,
  WatermarkInputSource,
} from './types';

describe('FfmpegCommandGenerator', () => {
  test('args', () => {
    const pixelFormat: PixelFormat = {
      name: 'yuv420p',
      ffmpegName: 'yuv420p',
      bitDepth: 8,
    };

    const videoStream = VideoStream.create({
      index: 0,
      codec: VideoFormats.H264,
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
      [AudioStream.create({ index: 1, codec: 'flac', channels: 6 })],
      audioState,
    );

    const target = FrameSize.withDimensions(1280, 720);

    const desiredState = FrameState({
      scaledSize: videoStream.squarePixelFrameSize(target),
      paddedSize: FrameSize.withDimensions(1280, 720),
      isAnamorphic: false,
      realtime: true,
      videoFormat: VideoFormats.Hevc,
      frameRate: 20,
      videoBitrate: 30_000,
      interlaced: true,
    });

    const generator = new FfmpegCommandGenerator();

    const videoInputFile = new VideoInputSource('video', [videoStream]);
    const watermarkInputFile = new WatermarkInputSource(
      'watermark',
      StillImageStream.create({
        index: 0,
        frameSize: FrameSize.create({ width: 100, height: 100 }),
      }),
      {
        duration: 0,
        enabled: true,
        horizontalMargin: 10,
        verticalMargin: 10,
        position: 'bottom-right',
        width: 100,
      },
    );

    const builder = PipelineBuilderFactory.builder()
      .setHardwareAccelerationMode('none')
      .setVideoInputSource(videoInputFile)
      .setAudioInputSource(audioInputFile)
      .setWatermarkInputSource(watermarkInputFile)
      .build();

    const steps = builder.build(FfmpegState.create(), desiredState);

    const result = generator.generateArgs(videoInputFile, steps);

    console.log(result.join(' '));
  });
});