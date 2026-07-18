/* eslint-disable @typescript-eslint/naming-convention */
import axios from 'axios';

const REPO = 'modm-io/cmsis-svd-stm32';
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;

interface GithubTreeResponse {
  tree: {
    path: string;
    type: 'blob' | 'tree';
  }[];
}

export interface SVDFile {
  name: string;
  download_url: string;
}
export async function getSVDFileList(): Promise<SVDFile[]> {
  const response = await axios.get<GithubTreeResponse>(TREE_URL);
  if (response.status !== 200) {
    throw new Error('Could not get SVD files from GitHub');
  }

  return response.data.tree
    .filter(entry =>
      entry.type === 'blob'
      && entry.path.toLowerCase().endsWith('.svd'))
    .map(entry => ({
      name: entry.path.split('/').pop()!,
      download_url: `${RAW_BASE}/${entry.path}`,
    }));
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
  const fileBuffer = (await axios.get(svdFile.download_url)).data;
  return {
    name: svdFile.name,
    data: fileBuffer
  };
}
