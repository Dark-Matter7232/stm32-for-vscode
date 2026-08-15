import { expect } from 'chai';
import { suite, test } from 'mocha';
import { findSVDFileForChip, parseSVDFileList, rawFileUrls, SVDFile } from '../../../projectSetup/svdFiles';

const files: SVDFile[] = [
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { name: 'STM32F407.svd', download_url: 'f407' },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { name: 'STM32H743.svd', download_url: 'h743' },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { name: 'STM32H743x.svd', download_url: 'h743x' },
];

suite('SVD file matching tests', () => {
  test('parses only blob SVD entries and safely builds raw URLs', () => {
    expect(parseSVDFileList({
      tree: [
        { type: 'tree', path: 'data/STMicro' },
        { type: 'blob', path: 'data/STMicro/STM32F4 07.svd' },
        { type: 'blob', path: 'README.md' },
      ],
    })).to.deep.equal([{
      name: 'STM32F4 07.svd',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      download_url: 'https://raw.githubusercontent.com/modm-io/cmsis-svd-stm32/main/data/STMicro/STM32F4%2007.svd',
    }]);
  });

  test('builds the China mirror fallback chain in order', () => {
    expect(rawFileUrls('data/STMicro/STM32F407.svd')).to.deep.equal([
      'https://raw.githubusercontent.com/modm-io/cmsis-svd-stm32/main/data/STMicro/STM32F407.svd',
      'https://ghfast.top/https://raw.githubusercontent.com/modm-io/cmsis-svd-stm32/main/data/STMicro/'
        + 'STM32F407.svd',
      'https://cdn.jsdmirror.com/gh/modm-io/cmsis-svd-stm32@main/data/STMicro/'
        + 'STM32F407.svd',
      'https://gh-proxy.com/https://raw.githubusercontent.com/modm-io/cmsis-svd-stm32/main/data/STMicro/'
        + 'STM32F407.svd',
      'https://gh.catmak.name/https://raw.githubusercontent.com/modm-io/cmsis-svd-stm32/main/data/STMicro/'
        + 'STM32F407.svd',
    ]);
  });

  test('rejects an incomplete GitHub tree response', () => {
    expect(() => parseSVDFileList({ tree: [], truncated: true })).to.throw('incomplete SVD file list');
  });

  test('matches startup-file family wildcards', () => {
    expect(findSVDFileForChip('stm32h743xx', files)?.name).to.equal('STM32H743.svd');
  });

  test('matches a full part number to its family SVD', () => {
    expect(findSVDFileForChip('STM32H743ZIT6', files)?.name).to.equal('STM32H743x.svd');
  });

  test('does not guess an unrelated SVD file', () => {
    expect(findSVDFileForChip('STM32G071', files)).to.equal(undefined);
  });
});
