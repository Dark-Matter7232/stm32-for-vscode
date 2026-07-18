import { expect } from 'chai';

import { getLinuxDistributionId, getLinuxMakeInstallPlan } from '../../../buildTools/linuxPackageManager';

suite('Linux package manager tests', () => {
  test('reads the distribution id from os-release', () => {
    expect(getLinuxDistributionId('NAME="Example"\nID=fedora\n')).to.equal('fedora');
  });

  test('uses build-essential on Debian-based distributions', () => {
    const plan = getLinuxMakeInstallPlan('ubuntu');
    expect(plan?.packages).to.deep.equal(['libc6-dev', 'gcc', 'g++', 'make', 'dpkg-dev']);
    expect(plan?.commands).to.deep.equal([
      ['sudo', '-S', 'apt-get', 'update'],
      ['sudo', '-S', 'apt-get', '-y', 'install', 'libc6-dev', 'gcc', 'g++', 'make', 'dpkg-dev'],
    ]);
  });

  test('uses make with the native package manager on Fedora', () => {
    const plan = getLinuxMakeInstallPlan('fedora', 'dnf');
    expect(plan?.packages).to.deep.equal(['glibc-devel', 'gcc', 'gcc-c++', 'make', 'rpm-build']);
    expect(plan?.commands).to.deep.equal([
      ['sudo', '-S', 'dnf', '-y', 'install', 'glibc-devel', 'gcc', 'gcc-c++', 'make', 'rpm-build'],
    ]);
  });

  test('uses the Gentoo package name', () => {
    expect(getLinuxMakeInstallPlan('gentoo')?.packages).to.deep.equal([
      'sys-libs/glibc', 'sys-devel/gcc', 'sys-devel/make', 'sys-apps/portage'
    ]);
  });

  test('returns no plan for unsupported distributions', () => {
    expect(getLinuxMakeInstallPlan('zorin-like-custom-distro')).to.equal(undefined);
  });
});
