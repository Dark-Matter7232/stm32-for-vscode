import { expect } from 'chai';
import { suite, test } from 'mocha';

import { parseMemoryUsageOutput } from '../../buildArtifacts';

suite('Build artifacts', () => {
  test('parses arm-none-eabi-size output after its header', () => {
    const output = [
      '   text    data     bss     dec     hex filename',
      '   3744       0    1584    5328    14d0 firmware.elf',
    ].join('\n');

    expect(parseMemoryUsageOutput(output)).to.deep.equal({
      flash: 3744,
      ram: 1584,
    });
  });
});
