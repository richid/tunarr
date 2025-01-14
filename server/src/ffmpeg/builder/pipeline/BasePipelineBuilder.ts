import { find, first, isNil, isNull, isUndefined } from 'lodash-es';
import { MarkRequired } from 'ts-essentials';
import { P, match } from 'ts-pattern';
import { Nilable, Nullable } from '../../../types/util.ts';
import { ifDefined, isNonEmptyString } from '../../../util/index.ts';
import { Logger, LoggerFactory } from '../../../util/logging/LoggerFactory.ts';
import { getTunarrVersion } from '../../../util/version.ts';
import { AudioStream, VideoStream } from '../MediaStream.ts';
import { FfmpegCapabilities } from '../capabilities/FfmpegCapabilities.ts';
import {
  OutputFormatTypes,
  OutputLocation,
  VideoFormats,
} from '../constants.ts';
import { Decoder } from '../decoder/Decoder.ts';
import { DecoderFactory } from '../decoder/DecoderFactory.ts';
import { AudioEncoder, VideoEncoder } from '../encoder/BaseEncoder.ts';
import {
  CopyAllEncoder,
  CopyAudioEncoder,
  CopyVideoEncoder,
} from '../encoder/CopyEncoders.ts';
import { Encoder } from '../encoder/Encoder.ts';
import {
  ImplicitVideoEncoder,
  LibKvazaarEncoder,
  LibOpenH264Encoder,
  Libx264Encoder,
  Libx265Encoder,
  RawVideoEncoder,
} from '../encoder/SoftwareVideoEncoders.ts';
import { AudioPadFilter } from '../filter/AudioPadFilter.ts';
import { AudioFirstPtsFilter } from '../filter/AudioResampleFilter.ts';
import { ComplexFilter } from '../filter/ComplexFilter.ts';
import { FilterChain } from '../filter/FilterChain.ts';
import { LoopFilter } from '../filter/LoopFilter.ts';
import { RealtimeFilter } from '../filter/RealtimeFilter.ts';
import { AudioInputSource } from '../input/AudioInputSource.ts';
import { ConcatInputSource } from '../input/ConcatInputSource.ts';
import { VideoInputSource } from '../input/VideoInputSource.ts';
import { WatermarkInputSource } from '../input/WatermarkInputSource.ts';
import {
  AudioBitrateOutputOption,
  AudioBufferSizeOutputOption,
  AudioChannelsOutputOption,
  AudioSampleRateOutputOption,
} from '../options/AudioOutputOptions.ts';
import {
  HideBannerOption,
  NoStdInOption,
  StandardFormatFlags,
  ThreadCountOption,
} from '../options/GlobalOption.ts';
import { HlsConcatOutputFormat } from '../options/HlsConcatOutputFormat.ts';
import { HlsOutputFormat } from '../options/HlsOutputFormat.ts';
import { LogLevelOption } from '../options/LogLevelOption.ts';
import { NoStatsOption } from '../options/NoStatsOption.ts';
import {
  ClosedGopOutputOption,
  DoNotMapMetadataOutputOption,
  FastStartOutputOption,
  FrameRateOutputOption,
  MatroskaOutputFormatOption,
  MetadataServiceNameOutputOption,
  MetadataServiceProviderOutputOption,
  Mp4OutputFormatOption,
  Mp4OutputOptions,
  MpegTsOutputFormatOption,
  NoAutoScaleOutputOption,
  NoDemuxDecodeDelayOutputOption,
  NoSceneDetectOutputOption,
  NutOutputFormatOption,
  OutputTsOffsetOption,
  PipeProtocolOutputOption,
  TimeLimitOutputOption,
  VideoBitrateOutputOption,
  VideoBufferSizeOutputOption,
  VideoTrackTimescaleOutputOption,
} from '../options/OutputOption.ts';
import { ConcatHttpReconnectOptions } from '../options/input/ConcatHttpReconnectOptions.ts';
import { ConcatInputFormatOption } from '../options/input/ConcatInputFormatOption.ts';
import { HttpReconnectOptions } from '../options/input/HttpReconnectOptions.ts';
import { InfiniteLoopInputOption } from '../options/input/InfiniteLoopInputOption.ts';
import { ReadrateInputOption } from '../options/input/ReadrateInputOption.ts';
import { StreamSeekInputOption } from '../options/input/StreamSeekInputOption.ts';
import { UserAgentInputOption } from '../options/input/UserAgentInputOption.ts';
import { AudioState } from '../state/AudioState.ts';
import { FfmpegState } from '../state/FfmpegState.ts';
import { FrameState } from '../state/FrameState.ts';
import { FrameDataLocation, HardwareAccelerationMode } from '../types.ts';
import { IPipelineStep, PipelineStep } from '../types/PipelineStep.ts';
import { Pipeline } from './Pipeline.ts';
import { PipelineBuilder } from './PipelineBuilder.ts';

// Args passed to each setter -- we use an object here so we
// 1. can deconstruct args in each implementor to use only what we need
// 2. easily add more (does not affect argument list)
export type PipelineVideoFunctionArgs = {
  videoStream: VideoStream;
  ffmpegState: FfmpegState;
  desiredState: FrameState;
  pipelineSteps: IPipelineStep[];
  filterChain: FilterChain;
  decoder: Nullable<Decoder>;
};

export type PipelineAudioFunctionArgs = {
  audioStream: AudioStream;
  ffmpegState: FfmpegState;
  desiredState: AudioState;
  pipelineSteps: IPipelineStep[];
};

export type PipelineBuilderContext = {
  videoStream?: VideoStream;
  audioStream?: AudioStream;
  ffmpegState: FfmpegState;
  desiredState: FrameState;
  desiredAudioState?: AudioState;
  pipelineSteps: PipelineStep[];
  filterChain: FilterChain;
  decoder: Nullable<Decoder>;

  hasWatermark: boolean;
  hasSubtitleOverlay: boolean;
  shouldDeinterlace: boolean;
  is10BitOutput: boolean;
  isIntelVaapiOrQsv: boolean;
};

export type PipelineBuilderContextWithVideo = MarkRequired<
  PipelineBuilderContext,
  'videoStream'
>;
export type PipelineBuilderContextWithAudio = MarkRequired<
  PipelineBuilderContext,
  'audioStream' | 'desiredAudioState'
>;

export function isVideoPipelineContext(
  context: PipelineBuilderContext,
): context is PipelineBuilderContextWithVideo {
  return !isUndefined(context.videoStream);
}

export function isAudioPipelineContext(
  context: PipelineBuilderContext,
): context is PipelineBuilderContextWithAudio {
  return (
    !isUndefined(context.audioStream) && !isUndefined(context.desiredAudioState)
  );
}

export abstract class BasePipelineBuilder implements PipelineBuilder {
  protected logger: Logger = LoggerFactory.child({
    caller: import.meta,
    className: this.constructor.name,
  });
  protected decoder: Nullable<Decoder> = null;
  protected context: PipelineBuilderContext;

  constructor(
    protected videoInputSource: VideoInputSource,
    private audioInputSource: Nullable<AudioInputSource>,
    protected watermarkInputSource: Nullable<WatermarkInputSource>,
    protected concatInputSource: Nullable<ConcatInputSource>,
    protected ffmpegCapabilities: FfmpegCapabilities,
  ) {}

  validate(): Nullable<Error> {
    return null;
  }

  hlsConcat(input: ConcatInputSource, state: FfmpegState) {
    const pipelineSteps: PipelineStep[] = [
      new NoStdInOption(),
      new HideBannerOption(),
      new NoStatsOption(),
      new LogLevelOption(state.logLevel),
      new StandardFormatFlags(),
      NoDemuxDecodeDelayOutputOption(),
      FastStartOutputOption(),
      ClosedGopOutputOption(),
    ];

    input.addOptions(
      new ConcatInputFormatOption(),
      new ReadrateInputOption(this.ffmpegCapabilities, 0),
      new InfiniteLoopInputOption(),
      new UserAgentInputOption(`Ffmpeg Tunarr/${getTunarrVersion()}`),
    );

    if (input.protocol === 'http') {
      input.addOption(new ConcatHttpReconnectOptions());
    }

    if (this.ffmpegState.threadCount) {
      pipelineSteps.unshift(
        new ThreadCountOption(this.ffmpegState.threadCount),
      );
    }

    pipelineSteps.push(NoSceneDetectOutputOption(0), new CopyAllEncoder());
    if (state.metadataServiceName) {
      pipelineSteps.push(
        MetadataServiceNameOutputOption(state.metadataServiceName),
      );
    }
    if (state.metadataServiceProvider) {
      pipelineSteps.push(
        MetadataServiceProviderOutputOption(state.metadataServiceProvider),
      );
    }
    pipelineSteps.push(MpegTsOutputFormatOption(), PipeProtocolOutputOption());
    // TODO: save report

    return new Pipeline(pipelineSteps, {
      videoInput: null,
      audioInput: null,
      concatInput: input,
      watermarkInput: null,
    });
  }

  build(ffmpegState: FfmpegState, desiredState: FrameState): Pipeline {
    this.context = {
      videoStream: first(this.videoInputSource.streams),
      audioStream: first(this.audioInputSource?.streams),
      ffmpegState,
      desiredState,
      desiredAudioState: this.audioInputSource?.desiredState,
      pipelineSteps: [],
      filterChain: new FilterChain(),
      decoder: this.decoder,
      hasWatermark: !!this.watermarkInputSource,
      hasSubtitleOverlay: false, // TODO:
      is10BitOutput: (desiredState.pixelFormat?.bitDepth ?? 8) === 10,
      shouldDeinterlace: desiredState.deinterlaced,
      isIntelVaapiOrQsv: false,
    };

    this.context.pipelineSteps = [
      ...this.getThreadCountOption(desiredState, ffmpegState),
      new NoStdInOption(),
      new HideBannerOption(),
      new NoStatsOption(),
      new LogLevelOption(),
      new StandardFormatFlags(),

      NoDemuxDecodeDelayOutputOption(),
      ClosedGopOutputOption(),
    ];

    const movFlags =
      this.ffmpegState.outputFormat.type === OutputFormatTypes.Mp4 ||
      (this.ffmpegState.outputFormat.type === OutputFormatTypes.Hls &&
        this.ffmpegState.hlsSegmentTemplate?.includes('m4s'))
        ? Mp4OutputOptions()
        : FastStartOutputOption();
    this.pipelineSteps.push(movFlags);

    // TODO BFrames

    if (this.concatInputSource) {
      this.concatInputSource.addOptions(
        new ConcatInputFormatOption(),
        new InfiniteLoopInputOption(),
      );
      this.pipelineSteps.push(NoAutoScaleOutputOption());
    }

    this.setStreamSeek();

    if (this.ffmpegState.duration && this.ffmpegState.duration > 0) {
      this.pipelineSteps.push(TimeLimitOutputOption(this.ffmpegState.duration));
    }

    if (
      this.videoInputSource.protocol === 'http' &&
      this.videoInputSource.continuity === 'discrete'
    ) {
      this.videoInputSource.addOption(new HttpReconnectOptions());
    }

    if (
      this.audioInputSource?.path &&
      this.audioInputSource.protocol === 'http' &&
      this.audioInputSource.continuity === 'discrete' &&
      this.videoInputSource.path !== this.audioInputSource.path
    ) {
      this.audioInputSource.addOption(new HttpReconnectOptions());
    }

    if (
      this.desiredState.videoFormat !== 'copy' &&
      (this.ffmpegState.ptsOffset ?? 0) > 0 &&
      !isNull(this.desiredState.videoTrackTimescale)
    ) {
      this.pipelineSteps.push(
        OutputTsOffsetOption(
          this.ffmpegState.ptsOffset ?? 0,
          this.desiredState.videoTrackTimescale,
        ),
      );
    }

    if (isVideoPipelineContext(this.context)) {
      if (desiredState.videoFormat === VideoFormats.Copy) {
        this.context.pipelineSteps.push(new CopyVideoEncoder());
      } else {
        this.buildVideoPipeline();
      }
    }

    if (isNull(this.audioInputSource)) {
      this.context.pipelineSteps.push(new CopyAudioEncoder());
    } else if (this.audioInputSource.streams.length > 0) {
      this.buildAudioPipeline();
    }

    // metadata
    if (this.ffmpegState.doNotMapMetadata) {
      this.pipelineSteps.push(DoNotMapMetadataOutputOption());
    }

    if (isNonEmptyString(this.ffmpegState.metadataServiceProvider)) {
      this.pipelineSteps.push(
        MetadataServiceProviderOutputOption(
          this.ffmpegState.metadataServiceProvider,
        ),
      );
    }

    if (isNonEmptyString(this.ffmpegState.metadataServiceName)) {
      this.pipelineSteps.push(
        MetadataServiceNameOutputOption(this.ffmpegState.metadataServiceName),
      );
    }

    if (
      !isNull(this.concatInputSource) &&
      isNonEmptyString(this.ffmpegState.hlsSegmentTemplate) &&
      isNonEmptyString(this.ffmpegState.hlsPlaylistPath)
    ) {
      this.pipelineSteps.push(
        new HlsConcatOutputFormat(
          this.ffmpegState.hlsSegmentTemplate,
          this.ffmpegState.hlsPlaylistPath,
        ),
      );
    } else {
      this.setOutputFormat();
    }

    this.pipelineSteps.push(
      new ComplexFilter(
        this.videoInputSource,
        this.audioInputSource,
        this.watermarkInputSource,
        this.context.filterChain,
      ),
    );

    if (isNull(this.audioInputSource)) {
      this.pipelineSteps.push(new CopyAudioEncoder());
    }

    return new Pipeline(this.pipelineSteps, {
      videoInput: this.videoInputSource,
      audioInput: this.audioInputSource,
      watermarkInput: this.watermarkInputSource,
      concatInput: this.concatInputSource,
    });
  }

  protected get ffmpegState() {
    return this.context.ffmpegState;
  }

  protected get desiredState() {
    return this.context.desiredState;
  }

  protected get desiredAudioState() {
    return this.context.desiredAudioState;
  }

  protected get pipelineSteps() {
    return this.context.pipelineSteps;
  }

  protected buildVideoPipeline() {
    this.setHardwareAccelState();
    if (isVideoPipelineContext(this.context)) {
      this.decoder = this.setupDecoder();
    }
    if (
      this.desiredState.videoFormat !== VideoFormats.Copy &&
      this.desiredState.frameRate
    ) {
      this.pipelineSteps.push(
        FrameRateOutputOption(this.desiredState.frameRate),
      );
    }

    ifDefined(this.desiredState.videoTrackTimescale, (ts) =>
      this.pipelineSteps.push(VideoTrackTimescaleOutputOption(ts)),
    );
    ifDefined(this.desiredState.videoBitrate, (br) =>
      this.pipelineSteps.push(VideoBitrateOutputOption(br)),
    );
    ifDefined(this.desiredState.videoBufferSize, (bs) =>
      this.pipelineSteps.push(VideoBufferSizeOutputOption(bs)),
    );

    this.setupVideoFilters();
  }

  protected buildAudioPipeline() {
    if (!isAudioPipelineContext(this.context)) {
      return;
    }

    const encoder = new AudioEncoder(
      this.context.desiredAudioState.audioEncoder,
    );
    this.pipelineSteps.push(encoder);

    this.pipelineSteps.push(
      AudioChannelsOutputOption(
        this.context.audioStream.codec,
        this.context.audioStream.channels,
        this.context.desiredAudioState.audioChannels,
      ),
    );

    this.pushSettingIfDefined(
      this.context.desiredAudioState.audioBitrate,
      AudioBitrateOutputOption,
    );
    this.pushSettingIfDefined(
      this.context.desiredAudioState.audioBufferSize,
      AudioBufferSizeOutputOption,
    );
    this.pushSettingIfDefined(
      this.context.desiredAudioState.audioSampleRate,
      AudioSampleRateOutputOption,
    );

    // TODO Audio volumne
    if (encoder.name !== 'copy') {
      this.audioInputSource?.filterSteps.push(new AudioFirstPtsFilter(0));
    }

    if (!isNull(this.context.desiredAudioState.audioDuration)) {
      this.audioInputSource?.filterSteps.push(
        AudioPadFilter.create(this.context.desiredAudioState.audioDuration),
      );
    }
  }

  protected abstract setupVideoFilters(): void;

  protected setupEncoder(currentState: FrameState): Nullable<VideoEncoder> {
    if (!isVideoPipelineContext(this.context)) {
      return null;
    }

    if (this.ffmpegState.outputFormat.type === OutputFormatTypes.Nut) {
      return new RawVideoEncoder();
    }

    return match(this.desiredState.videoFormat)
      .with(
        VideoFormats.Hevc,
        P.when(() => this.ffmpegCapabilities.hasVideoEncoder('libx265')),
        () =>
          new Libx265Encoder(
            currentState.updateFrameLocation(FrameDataLocation.Software),
            this.desiredState.videoPreset,
          ),
      )
      .with(
        VideoFormats.Hevc,
        P.when(() => this.ffmpegCapabilities.hasVideoEncoder('libkvazaar')),
        () =>
          new LibKvazaarEncoder(
            currentState.updateFrameLocation(FrameDataLocation.Software),
            this.desiredState.videoPreset,
          ),
      )
      .with(
        VideoFormats.H264,
        P.when(() => this.ffmpegCapabilities.hasVideoEncoder('libx264')),
        () =>
          new Libx264Encoder(
            this.desiredState.videoProfile,
            this.desiredState.videoPreset,
          ),
      )
      .with(
        VideoFormats.H264,
        P.when(() => this.ffmpegCapabilities.hasVideoEncoder('libopenh264')),
        () => new LibOpenH264Encoder(this.desiredState.videoProfile),
      )
      .with(VideoFormats.Copy, () => new CopyVideoEncoder())
      .with(P._, () => new ImplicitVideoEncoder())
      .exhaustive();
  }

  protected setupDecoder(): Nullable<Decoder> {
    let decoder: Nullable<Decoder> = null;
    if (isVideoPipelineContext(this.context)) {
      decoder = DecoderFactory.getSoftwareDecoder(this.context.videoStream);
      this.videoInputSource.addOption(decoder);
    }
    this.context.decoder = decoder;
    return decoder;
  }

  protected setHardwareAccelState() {
    this.context.ffmpegState.decoderHwAccelMode = 'none';
    this.context.ffmpegState.encoderHwAccelMode = 'none';
  }

  protected setStreamSeek() {
    if (
      (!isNull(this.context.ffmpegState.start) &&
        isNonEmptyString(this.context.ffmpegState.start)) ||
      (this.context.ffmpegState.start ?? 0) > 0
    ) {
      const option = new StreamSeekInputOption(this.context.ffmpegState.start!);
      this.audioInputSource?.addOption(option);
      this.videoInputSource.addOption(option);
    }
  }

  protected setRealtime() {
    const initialBurst = this.desiredState.realtime ? 0 : 45;
    const option = new ReadrateInputOption(
      this.ffmpegCapabilities,
      initialBurst,
    );
    this.audioInputSource?.addOption(option);
    this.videoInputSource.addOption(option);
  }

  protected setOutputFormat() {
    // this.context.pipelineSteps.push(
    //   this.context.ffmpegState.outputFormat === OutputFormats.Mkv
    //     ? MatroskaOutputFormatOption()
    //     : MpegTsOutputFormatOption(),
    //   PipeProtocolOutputOption(),
    // );
    switch (this.ffmpegState.outputFormat.type) {
      case OutputFormatTypes.Mkv:
        this.pipelineSteps.push(MatroskaOutputFormatOption());
        break;
      case OutputFormatTypes.MpegTs:
        this.pipelineSteps.push(MpegTsOutputFormatOption());
        break;
      case OutputFormatTypes.Mp4:
        this.pipelineSteps.push(Mp4OutputFormatOption());
        break;
      case OutputFormatTypes.Nut: {
        if (this.desiredState.bitDepth > 8) {
          this.pipelineSteps.push(NutOutputFormatOption());
        } else {
          this.pipelineSteps.push(MatroskaOutputFormatOption());
        }
        break;
      }
      case OutputFormatTypes.Hls: {
        if (
          isNonEmptyString(this.ffmpegState.hlsPlaylistPath) &&
          isNonEmptyString(this.ffmpegState.hlsSegmentTemplate) &&
          isNonEmptyString(this.ffmpegState.hlsBaseStreamUrl)
        ) {
          console.log(this.ffmpegState);
          this.pipelineSteps.push(
            new HlsOutputFormat(
              this.desiredState,
              this.context.videoStream?.frameRate,
              this.ffmpegState.hlsPlaylistPath,
              this.ffmpegState.hlsSegmentTemplate,
              this.ffmpegState.hlsBaseStreamUrl,
              isNil(this.ffmpegState.ptsOffset) ||
                this.ffmpegState.ptsOffset === 0,
              this.ffmpegState.encoderHwAccelMode ===
                HardwareAccelerationMode.Qsv,
            ),
          );
        }
        break;
      }
    }

    if (this.ffmpegState.outputFormat.type !== OutputFormatTypes.Hls) {
      switch (this.ffmpegState.outputLocation) {
        case OutputLocation.Stdout:
          this.pipelineSteps.push(PipeProtocolOutputOption());
          break;
      }
    }
  }

  protected getThreadCountOption(
    desiredState: FrameState,
    ffmpegState: FfmpegState,
  ) {
    let threadCount: Nullable<number> = null;
    if (
      ffmpegState.decoderHwAccelMode !== 'none' ||
      ffmpegState.encoderHwAccelMode !== 'none'
    ) {
      threadCount = 1;
    } else if (isNonEmptyString(ffmpegState.start) && desiredState.realtime) {
      threadCount = 1;
    } else if (
      !isNull(ffmpegState.threadCount) &&
      ffmpegState.threadCount > 0
    ) {
      threadCount = ffmpegState.threadCount;
    }

    if (!isNull(threadCount)) {
      return [new ThreadCountOption(threadCount)];
    }

    return [];
  }

  protected setStillImageLoop() {
    if (!isVideoPipelineContext(this.context)) {
      return;
    }

    if (this.context.videoStream.inputKind === 'stillimage') {
      this.videoInputSource.filterSteps.push(new LoopFilter());
      if (this.desiredState.realtime) {
        this.videoInputSource.filterSteps.push(new RealtimeFilter());
      }
    }
  }

  protected pushSettingIfDefined<T>(
    setting: Nilable<T>,
    factory: (value: T) => PipelineStep,
  ) {
    ifDefined(setting, (v) => this.pipelineSteps.push(factory(v)));
  }

  protected getEncoderStep() {
    return find(
      this.pipelineSteps,
      (step): step is Encoder => step instanceof Encoder,
    );
  }
}
