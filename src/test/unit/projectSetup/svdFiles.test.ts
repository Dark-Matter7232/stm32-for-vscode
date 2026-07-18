import { expect } from 'chai';
import { findSVDFileForChip, SVDFile } from '../../../projectSetup/svdFiles';

const files: SVDFile[] = [
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { name: 'STM32F407.svd', download_url: 'f407' },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { name: 'STM32H743.svd', download_url: 'h743' },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { name: 'STM32H743x.svd', download_url: 'h743x' },
];

suite('SVD file matching tests', () => {
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
