import fc, { Arbitrary } from 'fast-check';
import { Channel } from '../../src/dao/entities/Channel.js';
import { RequiredEntityData } from '@mikro-orm/core';

export function genChannel(): Arbitrary<RequiredEntityData<Channel>> {
  return fc.record({
    uuid: fc.uuid(),
    number: fc.integer({ min: 0 }),
    guideMinimumDuration: fc.integer({ min: 0 }),
    duration: fc.integer({ min: 0 }),
    disableFillerOverlay: fc.boolean(),
    name: fc.string(),
    offline: fc.record({
      picture: fc.option(fc.string()),
      soundtrack: fc.option(fc.string()),
      mode: fc.constantFrom('pic', 'clip'),
    }),
    startTime: fc.date().map((d) => d.getTime()),
    stealth: fc.boolean(),
  });
}
