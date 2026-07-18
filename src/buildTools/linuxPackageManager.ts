export interface LinuxMakeInstallPlan {
  packageManager: string;
  packages: string[];
  commands: string[][];
}

// build-essential's direct Debian dependencies are libc6-dev, gcc, g++, make,
// and dpkg-dev. These arrays provide the native equivalent set for each distro.

function getOsReleaseValue(osRelease: string, key: string): string | undefined {
  const line = osRelease.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) {
    return undefined;
  }

  return line.slice(key.length + 1).trim().replace(/^"|"$/g, '');
}

export function getLinuxDistributionId(osRelease: string): string | undefined {
  return getOsReleaseValue(osRelease, 'ID')?.toLowerCase();
}

/**
 * Returns the native package and commands for GNU Make on supported Linux
 * distributions. An undefined result means the extension should ask the user
 * to install Make instead of guessing a package manager or package name.
 */
export function getLinuxMakeInstallPlan(
  distributionId: string | undefined,
  packageManager?: string,
): LinuxMakeInstallPlan | undefined {
  const distro = distributionId?.toLowerCase();

  if (distro === 'debian' || distro === 'ubuntu' || distro === 'linuxmint' || distro === 'pop'
    || distro === 'raspbian' || distro === 'kali' || distro === 'elementary' || distro === 'zorin') {
    return {
      packageManager: 'apt-get',
      packages: ['libc6-dev', 'gcc', 'g++', 'make', 'dpkg-dev'],
      commands: [
        ['sudo', '-S', 'apt-get', 'update'],
        ['sudo', '-S', 'apt-get', '-y', 'install', 'libc6-dev', 'gcc', 'g++', 'make', 'dpkg-dev'],
      ],
    };
  }

  if (distro === 'fedora' || distro === 'rhel' || distro === 'centos'
    || distro === 'rocky' || distro === 'almalinux') {
    const manager = packageManager === 'yum' ? 'yum' : 'dnf';
    return {
      packageManager: manager,
      packages: ['glibc-devel', 'gcc', 'gcc-c++', 'make', 'rpm-build'],
      commands: [['sudo', '-S', manager, '-y', 'install', 'glibc-devel', 'gcc', 'gcc-c++', 'make', 'rpm-build']],
    };
  }

  if (distro === 'arch' || distro === 'manjaro' || distro === 'endeavouros') {
    return {
      packageManager: 'pacman',
      packages: ['glibc', 'gcc', 'make', 'base-devel'],
      commands: [['sudo', '-S', 'pacman', '--noconfirm', '-S', 'glibc', 'gcc', 'make', 'base-devel']],
    };
  }

  if (distro === 'opensuse' || distro === 'opensuse-leap' || distro === 'opensuse-tumbleweed' || distro === 'sles') {
    return {
      packageManager: 'zypper',
      packages: ['glibc-devel', 'gcc', 'gcc-c++', 'make', 'rpm-build'],
      commands: [[
        'sudo', '-S', 'zypper', '--non-interactive', 'install',
        'glibc-devel', 'gcc', 'gcc-c++', 'make', 'rpm-build'
      ]],
    };
  }

  if (distro === 'alpine') {
    return {
      packageManager: 'apk',
      packages: ['musl-dev', 'gcc', 'g++', 'make', 'abuild'],
      commands: [['sudo', '-S', 'apk', 'add', 'musl-dev', 'gcc', 'g++', 'make', 'abuild']],
    };
  }

  if (distro === 'void') {
    return {
      packageManager: 'xbps-install',
      packages: ['glibc-devel', 'gcc', 'make', 'base-devel'],
      commands: [[
        'sudo', '-S', 'xbps-install', '-S', 'glibc-devel', 'gcc', 'make', 'base-devel'
      ]],
    };
  }

  if (distro === 'gentoo') {
    return {
      packageManager: 'emerge',
      packages: ['sys-libs/glibc', 'sys-devel/gcc', 'sys-devel/make', 'sys-apps/portage'],
      commands: [[
        'sudo', '-S', 'emerge', '--ask=n',
        'sys-libs/glibc', 'sys-devel/gcc', 'sys-devel/make', 'sys-apps/portage'
      ]],
    };
  }

  return undefined;
}
