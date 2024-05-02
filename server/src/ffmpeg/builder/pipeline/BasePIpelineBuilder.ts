import { isNull } from 'lodash-es';
import os from 'node:os';
import { Nullable } from '../../../types/util';
import { VideoFormats } from '../constants';
import { CopyAudioEncoder, CopyVideoEncoder } from '../encoder/CopyEncoders';
import {
  HideBannerOption,
  NoStdInOption,
  ThreadCountOption,
} from '../options/GlobalOption';
import { LogLevelOption } from '../options/LogLevelOption';
import { NoStatsOption } from '../options/NoStatsOption';
import { FfmpegState } from '../state/FfmpegState';
import { FrameState } from '../state/FrameState';
import { AudioInputFile, PipelineStep, VideoInputFile } from '../types';
import { PipelineBuilder } from './PipelineBuilder';
import { ifDefined } from '../../../util';
import { RealtimeInputOption, StreamSeekOption } from '../options/InputOption';
import { AudioStream, VideoStream } from '../MediaStream';
import { Decoder } from '../decoder/Decoder';
import { DecoderFactory } from '../decoder/DecoderFactory';
import {
  ClosedGopOutputOption,
  FrameRateOutputOption,
  MpegTsOutputFormatOption,
  NoDemuxDecodeDelayOutputOption,
  PipeProtocolOutputOption,
  VideoBitrateOutputOption,
  VideoBufferSizeOutputOption,
  VideoTrackTimescaleOutputOption,
} from '../options/OutputOption';
import { FilterChain } from '../filter/FilterChain';
import { EncoderFactory } from '../encoder/EncoderFactory';
import { ComplexFilter } from '../filter/ComplexFilter';
import { AudioEncoder } from '../encoder/BaseEncoder';
import { AudioState } from '../state/AudioState';
import {
  AudioBitrateOutputOption,
  AudioBufferSizeOutputOption,
  AudioChannelsOutputOption,
  AudioSampleRateOutputOption,
} from '../options/AudioOutputOptions';
import { AudioPadFilter } from '../filter/AudioPadFilter';

const numProcessors = os.cpus().length;

// Args passed to each setter -- we use an object here so we
// 1. can deconstruct args in each implementor to use only what we need
// 2. easily add more (does not affect argument list)
export type PipelineVideoFunctionArgs = {
  videoStream: VideoStream;
  ffmpegState: FfmpegState;
  desiredState: FrameState;
  pipelineSteps: PipelineStep[];
  filterChain: FilterChain;
};

export type PipelineAudioFunctionArgs = {
  audioStream: AudioStream;
  ffmpegState: FfmpegState;
  desiredState: AudioState;
  pipelineSteps: PipelineStep[];
};

export abstract class BasePipelineBuilder implements PipelineBuilder {
  protected decoder: Nullable<Decoder> = null;

  constructor(
    protected videoInputFile: VideoInputFile,
    private audioInputFile: Nullable<AudioInputFile>,
  ) {}

  validate(): Nullable<Error> {
    return null;
  }

  build(currentState: FfmpegState, desiredState: FrameState): PipelineStep[] {
    const steps: PipelineStep[] = [
      desiredState.realtime
        ? new ThreadCountOption(1)
        : new ThreadCountOption(currentState.threadCount ?? numProcessors),
      new NoStdInOption(),
      new HideBannerOption(),
      new NoStatsOption(),
      new LogLevelOption(),

      NoDemuxDecodeDelayOutputOption(),
      ClosedGopOutputOption(),
    ];

    const filterChain = new FilterChain();

    if (this.videoInputFile.videoStreams.length > 0) {
      if (desiredState.videoFormat === VideoFormats.Copy) {
        steps.push(CopyVideoEncoder.create());
      } else {
        this.buildVideoPipeline({
          ffmpegState: currentState,
          desiredState,
          videoStream: this.videoInputFile.videoStreams[0],
          pipelineSteps: steps,
          filterChain,
        });
      }
    }

    if (isNull(this.audioInputFile)) {
      steps.push(new CopyAudioEncoder());
    } else if (this.audioInputFile.audioStreams.length > 0) {
      this.buildAudioPipeline({
        ffmpegState: currentState,
        audioStream: this.audioInputFile.audioStreams[0],
        pipelineSteps: steps,
        desiredState: this.audioInputFile.desiredState,
      });
    }

    // metadata

    this.setOutputFormat({
      ffmpegState: currentState,
      desiredState,
      videoStream: this.videoInputFile.videoStreams[0],
      pipelineSteps: steps,
      filterChain,
    });

    steps.push(
      new ComplexFilter(this.videoInputFile, this.audioInputFile, filterChain),
    );

    if (isNull(this.audioInputFile)) {
      steps.push(new CopyAudioEncoder());
    }

    return steps;
  }

  protected buildVideoPipeline(args: Readonly<PipelineVideoFunctionArgs>) {
    this.setHardwareAccelState(args);
    this.decoder = this.setupDecoder(args);
    ifDefined(args.desiredState.frameRate, (fr) =>
      args.pipelineSteps.push(FrameRateOutputOption(fr)),
    );
    ifDefined(args.desiredState.videoTrackTimescale, (ts) =>
      args.pipelineSteps.push(VideoTrackTimescaleOutputOption(ts)),
    );
    ifDefined(args.desiredState.videoBitrate, (br) =>
      args.pipelineSteps.push(VideoBitrateOutputOption(br)),
    );
    ifDefined(args.desiredState.videoBufferSize, (bs) =>
      args.pipelineSteps.push(VideoBufferSizeOutputOption(bs)),
    );

    this.setupVideoFilters(args);
  }

  protected buildAudioPipeline(args: Readonly<PipelineAudioFunctionArgs>) {
    const encoder = new AudioEncoder(args.desiredState.audioEncoder);
    args.pipelineSteps.push(encoder);

    args.pipelineSteps.push(
      AudioChannelsOutputOption(
        args.audioStream.codec,
        args.audioStream.channels,
        args.desiredState.audioChannels,
      ),
    );

    ifDefined(args.desiredState.audioBitrate, (br) =>
      args.pipelineSteps.push(AudioBitrateOutputOption(br)),
    );

    ifDefined(args.desiredState.audioBufferSize, (buf) =>
      args.pipelineSteps.push(AudioBufferSizeOutputOption(buf)),
    );

    ifDefined(args.desiredState.audioSampleRate, (rate) =>
      args.pipelineSteps.push(AudioSampleRateOutputOption(rate)),
    );

    // TODO Audio volumne

    if (!isNull(args.desiredState.audioDuration)) {
      this.audioInputFile?.filterSteps.push(
        AudioPadFilter.create(args.desiredState.audioDuration),
      );
    }
  }

  protected abstract setupVideoFilters(
    args: Readonly<PipelineVideoFunctionArgs>,
  ): void;

  protected setupEncoder(
    currentState: FrameState,
    args: Readonly<PipelineVideoFunctionArgs>,
  ) {
    const encoder = EncoderFactory.getSoftwareEncoder(args.videoStream);
    const nextState = encoder.updateFrameState(currentState);
    return {
      nextState,
      encoder,
    };
  }

  protected setupDecoder({
    videoStream,
  }: PipelineVideoFunctionArgs): Nullable<Decoder> {
    const decoder = DecoderFactory.getSoftwareDecoder(videoStream);
    this.videoInputFile.addOption(decoder);
    return decoder;
  }

  protected setHardwareAccelState({ ffmpegState }: PipelineVideoFunctionArgs) {
    ffmpegState.decoderHwAccelMode = 'none';
    ffmpegState.encoderHwAccelMode = 'none';
  }

  protected setStreamSeek(ffmpegState: FfmpegState) {
    ifDefined(ffmpegState.start, (start) => {
      const option = StreamSeekOption(start);
      this.audioInputFile?.addOption(option);
      this.videoInputFile.addOption(option);
    });
  }

  protected setRealtime(desiredState: FrameState) {
    if (desiredState.realtime) {
      const option = RealtimeInputOption();
      this.audioInputFile?.addOption(option);
      this.videoInputFile.addOption(option);
    }
  }

  protected setOutputFormat({ pipelineSteps }: PipelineVideoFunctionArgs) {
    pipelineSteps.push(MpegTsOutputFormatOption(), PipeProtocolOutputOption());
  }
}
