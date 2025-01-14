import { isNull } from 'lodash-es';
import { Nullable } from '../../../../types/util.ts';
import { isNonEmptyString } from '../../../../util/index.ts';
import { FfmpegPixelFormats, PixelFormat } from '../../format/PixelFormat.ts';
import { FrameState } from '../../state/FrameState.ts';
import { FilterOption } from '../FilterOption.ts';

export class HardwareDownloadCudaFilter extends FilterOption {
  public affectsFrameState: boolean = true;

  constructor(
    private currentPixelFormat: Nullable<PixelFormat>,
    private targetPixelFormat: Nullable<PixelFormat>,
  ) {
    super();
  }

  get filter() {
    let f = 'hwdownload';
    if (
      this.currentPixelFormat &&
      isNonEmptyString(this.currentPixelFormat.ffmpegName)
    ) {
      f += `,format=${this.currentPixelFormat.ffmpegName}`;
      if (this.currentPixelFormat.ffmpegName === FfmpegPixelFormats.NV12) {
        if (!this.targetPixelFormat) {
          const target = this.currentPixelFormat.unwrap();
          if (target) {
            f += `,format=${target.ffmpegName}`;
          }
        } else {
          f += `,format=${this.targetPixelFormat.ffmpegName}`;
        }
      }
    }

    return f;
  }

  nextState(currentState: FrameState): FrameState {
    let nextState = currentState.updateFrameLocation('software');
    if (!isNull(this.targetPixelFormat)) {
      return nextState.update({ pixelFormat: this.targetPixelFormat });
    }

    if (!isNull(this.currentPixelFormat)) {
      if (this.currentPixelFormat.ffmpegName === FfmpegPixelFormats.NV12) {
        nextState = nextState.update({ pixelFormat: null });
      } else {
        nextState = nextState.update({ pixelFormat: this.currentPixelFormat });
      }
    }

    return nextState;
  }
}
