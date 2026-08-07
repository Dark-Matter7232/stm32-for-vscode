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
  if (result.elf && !result.map) {
    const elfBaseName = path.basename(result.elf, path.extname(result.elf));
    const targetName = elfBaseName.replace(/-(debug|release)$/i, '');
    const mapPath = path.join(root, 'build', `${targetName}.map`);
    if (fs.existsSync(mapPath)) {
      result.map = path.relative(root, mapPath);
    }
  }
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
  const executablePath = configuredPath !== executable && !fs.existsSync(configuredPath)
    ? executable
    : configuredPath;
  return new Promise((resolve) => {
    execFile(executablePath, ['-B', elfPath], (error, stdout) => {
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
    if (memory) {
      lines.push(`FLASH: ${formatBytes(memory.flash)}`);
      lines.push(`RAM: ${formatBytes(memory.ram)}`);
    }
    const analysis = await analyzeBuild(elfPath, mapPath, info.tools.armToolchainPath);
    analysis.profile = info.profile || 'debug';
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
