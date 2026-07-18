import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { commands, window, workspace } from 'vscode';

import MakeInfo from './types/MakeInfo';
import { analyzeBuild, getLatestMemoryAnalysisReport, setLatestMemoryAnalysisReport } from './memoryAnalyzer';

export interface BuildArtifacts {
  elf?: string;
  hex?: string;
  bin?: string;
  map?: string;
  lss?: string;
}

export function artifactCandidates(info: MakeInfo, debug: boolean): BuildArtifacts[] {
  const suffix = debug ? 'debug' : 'release';
  const target = `${info.target}-${suffix}`;
  const directory = path.join('build', suffix);
  return [
    {
      elf: path.join(directory, `${target}.elf`),
      hex: path.join(directory, `${target}.hex`),
      bin: path.join(directory, `${target}.bin`),
      lss: path.join(directory, `${target}.lss`),
      map: path.join('build', `${target}.map`),
    },
    {
      elf: path.join(directory, `${info.target}.elf`),
      hex: path.join(directory, `${info.target}.hex`),
      bin: path.join(directory, `${info.target}.bin`),
      lss: path.join(directory, `${info.target}.lss`),
      map: path.join('build', `${info.target}.map`),
    },
  ];
}

export function existingArtifacts(candidate: BuildArtifacts, root: string): BuildArtifacts {
  const result: BuildArtifacts = {};
  (Object.keys(candidate) as (keyof BuildArtifacts)[]).forEach((key) => {
    const value = candidate[key];
    if (value && fs.existsSync(path.join(root, value))) {
      result[key] = value;
    }
  });
  return result;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(2)} KiB`;
  }
  return `${(bytes / (1024 ** 2)).toFixed(2)} MiB`;
}

export interface MemoryUsage {
  flash: number;
  ram: number;
}

export interface MemoryRegionUsage {
  name: 'RAM' | 'FLASH';
  used: number;
  size?: number;
  percentage?: number;
  profile: string;
}

let latestBuildArtifacts: BuildArtifacts = {};

export function getLatestMemoryUsage(): MemoryRegionUsage[] {
  // Kept as a compatibility API; the unified analysis report is the source of truth.
  const report = getLatestMemoryAnalysisReport();
  return report?.regions
    .filter((region) => /RAM|FLASH/i.test(region.name))
    .map((region) => ({
      name: region.name.toUpperCase().includes('RAM') ? 'RAM' : 'FLASH',
      used: region.used,
      size: region.size,
      percentage: region.size ? (region.used / region.size) * 100 : undefined,
      profile: report.profile || 'debug',
    })) || [];
}

export function getLatestBuildArtifacts(): BuildArtifacts {
  return { ...latestBuildArtifacts };
}

export async function clearLatestMemoryUsage(): Promise<void> {
  setLatestMemoryAnalysisReport(undefined);
  latestBuildArtifacts = {};
  await commands.executeCommand('stm32-for-vscode.refreshMenu');
}

function parseMemoryLength(value: string): number | undefined {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([KMG]?)(?:B)?$/i);
  if (!match) {
    return undefined;
  }
  let multiplier = 1;
  switch (match[2].toUpperCase()) {
    case 'K': multiplier = 1024; break;
    case 'M': multiplier = 1024 ** 2; break;
    case 'G': multiplier = 1024 ** 3; break;
    default: break;
  }
  return Number(match[1]) * multiplier;
}

function getMemoryRegionSizes(info: MakeInfo, root: string): {[name: string]: number} {
  const linkerScript = path.join(root, info.ldscript);
  if (!fs.existsSync(linkerScript)) {
    return {};
  }
  const content = fs.readFileSync(linkerScript, 'utf8');
  const memoryBlock = content.match(/\bMEMORY\s*\{([\s\S]*?)\}/i)?.[1] || '';
  const sizes: {[name: string]: number} = {};
  const regionPattern = /^\s*([\w-]+)\s*\([^)]*\)\s*:\s*ORIGIN\s*=\s*[^,]+,\s*LENGTH\s*=\s*([^\s,}]+)/gm;
  let match = regionPattern.exec(memoryBlock);
  while (match) {
    const size = parseMemoryLength(match[2]);
    if (size) {
      sizes[match[1].toUpperCase()] = size;
    }
    match = regionPattern.exec(memoryBlock);
  }
  return sizes;
}

export function parseMemoryUsageOutput(stdout: string): MemoryUsage | undefined {
  const dataLine = stdout.split(/\r?\n/)
    .find((line) => /^\s*\d+\s+\d+\s+\d+\s+\d+/.test(line));
  if (!dataLine) {
    return undefined;
  }
  const values = dataLine.trim().split(/\s+/).map(Number);
  if (values.length < 3 || values.slice(0, 3).some(Number.isNaN)) {
    return undefined;
  }
  const [text, data, bss] = values;
  return { flash: text + data, ram: data + bss };
}

function getMemoryUsage(info: MakeInfo, elfPath: string): Promise<MemoryUsage | undefined> {
  const executable = process.platform === 'win32' ? 'arm-none-eabi-size.exe' : 'arm-none-eabi-size';
  const configuredPath = typeof info.tools.armToolchainPath === 'string'
    ? path.join(info.tools.armToolchainPath, executable)
    : executable;
  return new Promise((resolve) => {
    execFile(configuredPath, ['-B', elfPath], (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      resolve(parseMemoryUsageOutput(stdout));
    });
  });
}

export default async function reportBuildArtifacts(info: MakeInfo, debug: boolean): Promise<BuildArtifacts> {
  const root = workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    return {};
  }
  const candidate = artifactCandidates(info, debug)
    .map((entry) => existingArtifacts(entry, root))
    .find((entry) => entry.elf || entry.hex || entry.bin) || {};
  latestBuildArtifacts = candidate;
  const lines = [`Build profile: ${info.profile}`];
  (Object.keys(candidate) as (keyof BuildArtifacts)[]).forEach((key) => {
    const value = candidate[key];
    if (value) {
      const size = fs.statSync(path.join(root, value)).size;
      lines.push(`${key.toUpperCase()}: ${value} (${formatBytes(size)})`);
    }
  });
  if (candidate.elf) {
    const elfPath = path.join(root, candidate.elf);
    const mapPath = candidate.map ? path.join(root, candidate.map) : undefined;
    const memory = await getMemoryUsage(info, elfPath);
    const regionSizes = getMemoryRegionSizes(info, root);
    const memoryRegions: Array<{name: 'RAM' | 'FLASH'; used: number; size?: number}> = [];
    if (memory) {
      lines.push(`FLASH: ${formatBytes(memory.flash)}`);
      lines.push(`RAM: ${formatBytes(memory.ram)}`);
      (['RAM', 'FLASH'] as const).forEach((name) => {
        const used = name === 'RAM' ? memory.ram : memory.flash;
        const size = Object.entries(regionSizes).find(([region]) => region.includes(name))?.[1];
        memoryRegions.push({ name, used, size });
      });
    }
    const analysis = await analyzeBuild(elfPath, mapPath, info.tools.armToolchainPath);
    analysis.profile = info.profile || 'debug';
    analysis.regions.forEach((region) => {
      const summary = memoryRegions.find((entry) => region.name.toUpperCase().includes(entry.name));
      if (summary) {
        region.used = summary.used;
        region.size = summary.size || region.size;
      }
    });
    setLatestMemoryAnalysisReport(analysis);
  }
  if (!candidate.elf) {
    setLatestMemoryAnalysisReport(undefined);
    latestBuildArtifacts = {};
  }
  await commands.executeCommand('stm32-for-vscode.refreshMenu');
  if (Object.keys(candidate).length > 0) {
    window.showInformationMessage(lines.join(' | '));
    if (candidate.elf) {
      const { refreshMemoryAnalyzer } = await import('./MemoryAnalyzerPanel');
      await refreshMemoryAnalyzer(
        path.join(root, candidate.elf),
        candidate.map ? path.join(root, candidate.map) : undefined,
        info.tools.armToolchainPath,
      );
    }
  }
  return candidate;
}
