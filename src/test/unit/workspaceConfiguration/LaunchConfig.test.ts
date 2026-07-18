import { suite, test } from 'mocha';

import { debugFixture, debugFixtureWithSVD } from '../../fixtures/launchTaskFixture';
import { expect } from 'chai';
import getLaunchTask from '../../../configuration/LaunchTasksConfig';
import { testMakefileInfo } from '../../fixtures/testSTMCubeMakefile';

suite('Launch configuration test', () => {
  test('Returns correct config', () => {
    const res = getLaunchTask(testMakefileInfo);
    expect(res).to.deep.equal(debugFixture);
  });

  test('adds the SVD file for Cortex-Debug peripheral support', () => {
    const res = getLaunchTask(testMakefileInfo, 'STM32H743x.svd');
    expect(res).to.deep.equal(debugFixtureWithSVD);
  });
});
