import { Dictionary } from 'ts-essentials';
import { EnvironmentVariablePipelineStep } from '../types/PipelineStep.ts';

export abstract class EnvironmentVariable
  implements EnvironmentVariablePipelineStep
{
  readonly type = 'environment';

  options(): Dictionary<string> {
    return {};
  }
}

export class VaapiDriverEnvironmentVariable extends EnvironmentVariable {
  constructor(private vaapiDriver: string) {
    super();
  }

  options(): Dictionary<string> {
    return {
      LIBVA_DRIVER_NAME: this.vaapiDriver,
    };
  }
}
