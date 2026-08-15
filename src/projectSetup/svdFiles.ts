/* eslint-disable @typescript-eslint/naming-convention */
import axios from 'axios';

const REPO = 'modm-io/cmsis-svd-stm32';
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;
const RAW_MIRROR_URLS = [
  (url: string) => url,
  (url: string) => `https://ghfast.top/${url}`,
  (url: string) => `https://cdn.jsdmirror.com/gh/${REPO}@main/${url.slice(`${RAW_BASE}/`.length)}`,
  (url: string) => `https://gh-proxy.com/${url}`,
  (url: string) => `https://gh.catmak.name/${url}`,
];
const GITHUB_REQUEST_CONFIG = {
  timeout: 15_000,
  headers: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'stm32-for-vscode',
  },
};

interface GithubTreeResponse {
  tree: {
    path: string;
    type: string;
  }[];
  truncated?: boolean;
}

export interface SVDFile {
  name: string;
  download_url: string;
}

function rawFileUrl(filePath: string): string {
  const encodedPath = filePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
  return `${RAW_BASE}/${encodedPath}`;
}

export function rawFileUrls(filePath: string): string[] {
  const rawUrl = rawFileUrl(filePath);
  return RAW_MIRROR_URLS.map(buildUrl => buildUrl(rawUrl));
}

export function parseSVDFileList(data: GithubTreeResponse): SVDFile[] {
  if (!data || !Array.isArray(data.tree)) {
    throw new Error('GitHub returned an invalid SVD file list');
  }
  if (data.truncated) {
    throw new Error('GitHub returned an incomplete SVD file list');
  }

  return data.tree
    .filter(entry => entry.type === 'blob' && entry.path.toLowerCase().endsWith('.svd'))
    .map(entry => ({
      name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
      download_url: rawFileUrl(entry.path),
    }));
}

export async function getSVDFileList(): Promise<SVDFile[]> {
  try {
    const response = await axios.get<GithubTreeResponse>(TREE_URL, GITHUB_REQUEST_CONFIG);
    return parseSVDFileList(response.data);
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('GitHub returned')
      || error.message === 'GitHub returned an invalid SVD file list')) {
      throw error;
    }
    throw new Error('Could not get SVD files from GitHub');
  }
}

export interface SVDLocalFile {
  name: string,
  data: string;
}

function normalizeChipName(value: string): string {
  return value
    .replace(/\.svd$/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    // CubeMX startup files commonly use a trailing XX as a family wildcard.
    .replace(/X+$/, '');
}

function cleanChipName(value: string): string {
  return value.replace(/\.svd$/i, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/**
 * Finds the most specific SVD file for a device or device family name.
 * SVD files may describe a family (STM32H743) while startup files may use a
 * wildcard or full part number (STM32H743XX / STM32H743ZIT6).
 */
export function findSVDFileForChip(chip: string, files: SVDFile[]): SVDFile | undefined {
  const normalizedChip = normalizeChipName(chip);
  const rawChip = cleanChipName(chip);
  const chipUsesWildcard = /X+$/.test(rawChip);
  if (!normalizedChip) {
    return undefined;
  }

  return files
    .map((file) => ({
      file,
      name: normalizeChipName(file.name),
      rawName: cleanChipName(file.name),
    }))
    .filter(({ name }) => name === normalizedChip
      || name.startsWith(normalizedChip)
      || normalizedChip.startsWith(name))
    .sort((left, right) => {
      if (left.rawName === rawChip) { return -1; }
      if (right.rawName === rawChip) { return 1; }
      return chipUsesWildcard
        ? left.rawName.length - right.rawName.length
        : right.rawName.length - left.rawName.length;
    })[0]?.file;
}

export async function getSVDFileForChip(chip: string): Promise<SVDLocalFile> {
  const svdFileList = await getSVDFileList();
  const svdFile = findSVDFileForChip(chip, svdFileList);

  if (!svdFile) { throw new Error('Could not find desired SVD file for the chip'); }
  const downloadUrls = [
    svdFile.download_url,
    ...RAW_MIRROR_URLS.slice(1).map(buildUrl => buildUrl(svdFile.download_url)),
  ];
  for (const downloadUrl of downloadUrls) {
    try {
      const response = await axios.get<string>(downloadUrl, {
        ...GITHUB_REQUEST_CONFIG,
        responseType: 'text',
      });
      if (typeof response.data === 'string' && response.data.length > 0) {
        return { name: svdFile.name, data: response.data };
      }
    } catch {
      // Try the next mirror. These services can be unavailable independently.
    }
  }
  throw new Error(`Could not download SVD file ${svdFile.name} from GitHub or configured mirrors`);
}
