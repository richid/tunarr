import { constant, first, isNil } from 'lodash-es';
import { FrameState } from '../state/FrameState';
import { FrameDataLocation, InputFile } from '../types';
import { Decoder } from './Decoder';

export abstract class BaseDecoder implements Decoder {
  abstract name: string;
  protected abstract outputFrameDataLocation: FrameDataLocation;

  // It's weird that these are defined in places where they
  // will never be hit... perhaps we should rethink the hierarchy
  filterOptions = constant([]);
  globalOptions = constant([]);
  outputOptions = constant([]);

  appliesToInput(input: InputFile): boolean {
    return input.type === 'video';
  }

  inputOptions(): string[] {
    return ['-c:v', this.name];
  }

  nextState(currentState: FrameState): FrameState {
    return {
      ...currentState,
      frameDataLocation: this.outputFrameDataLocation,
    };
  }

  protected inputBitDepth(inputFile: InputFile): number {
    let depth = 8;
    if (inputFile.isVideo()) {
      const fmt = first(inputFile.videoStreams)?.pixelFormat;
      if (!isNil(fmt)) {
        depth = fmt.bitDepth;
      }
    }
    return depth;
  }
}
