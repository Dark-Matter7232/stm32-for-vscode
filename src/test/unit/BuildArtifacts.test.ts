import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { expect } from 'chai';
import { suite, test } from 'mocha';

import { existingArtifacts, parseMemoryUsageOutput } from '../../buildArtifacts';

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

  test('finds the map file in the build directory when no map was supplied', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stm32-build-artifacts-test-'));
    try {
      fs.mkdirSync(path.join(root, 'build', 'debug'), { recursive: true });
      fs.writeFileSync(path.join(root, 'build', 'debug', 'firmware-debug.elf'), 'elf');
      fs.writeFileSync(path.join(root, 'build', 'firmware.map'), 'map');

      expect(existingArtifacts({
        elf: 'build/debug/firmware-debug.elf',
      }, root)).to.deep.equal({
        elf: 'build/debug/firmware-debug.elf',
        map: 'build/firmware.map',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
