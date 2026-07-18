/* eslint-disable max-len */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

export interface MemoryAnalyzerRegion {
  name: string;
  origin: number;
  size: number;
  used: number;
}

export interface MemoryAnalyzerSection {
  name: string;
  address: number;
  size: number;
  region?: string;
  loadAddress?: number;
}

export interface MemoryAnalyzerSymbol {
  name: string;
  address: number;
  size: number;
  type: string;
  section?: string;
  source?: string;
  sourceFile?: string;
  sourceLine?: number;
  region?: string;
}

export interface MemoryAnalyzerReport {
  elf: string;
  map?: string;
  profile?: string;
  focusRegion?: string;
  regions: MemoryAnalyzerRegion[];
  sections: MemoryAnalyzerSection[];
  symbols: MemoryAnalyzerSymbol[];
}

let latestMemoryAnalysisReport: MemoryAnalyzerReport | undefined;

export function getLatestMemoryAnalysisReport(): MemoryAnalyzerReport | undefined {
  return latestMemoryAnalysisReport;
}

export function setLatestMemoryAnalysisReport(report: MemoryAnalyzerReport | undefined): void {
  latestMemoryAnalysisReport = report;
}

function numberFromHex(value: string): number {
  return Number.parseInt(value, 16);
}

export function parseMapFile(content: string): {
  regions: MemoryAnalyzerRegion[];
  sections: MemoryAnalyzerSection[];
} {
  const regions: MemoryAnalyzerRegion[] = [];
  const memoryStart = content.search(/^Memory Configuration\s*$/im);
  const linkerStart = content.search(/^Linker script and memory map\s*$/im);
  const memoryContent = content.slice(memoryStart >= 0 ? memoryStart : 0, linkerStart >= 0 ? linkerStart : undefined);
  const regionPattern = /^\s*([A-Za-z_][\w-]*)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)/gim;
  let regionMatch = regionPattern.exec(memoryContent);
  while (regionMatch) {
    const regionName = regionMatch[1];
    const normalizedName = regionName.toLowerCase();
    if (!normalizedName.includes('default')
      && !normalizedName.includes('catch-all')
      && !normalizedName.includes('catchall')
      && !(regionName.startsWith('*') && regionName.endsWith('*'))) {
      regions.push({
        name: regionName,
        origin: numberFromHex(regionMatch[2]),
        size: numberFromHex(regionMatch[3]),
        used: 0,
      });
    }
    regionMatch = regionPattern.exec(memoryContent);
  }

  const sections: MemoryAnalyzerSection[] = [];
  const sectionPattern = /^\s+(\.[A-Za-z0-9_.$/+-]+)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)/gim;
  let sectionMatch = sectionPattern.exec(content.slice(linkerStart >= 0 ? linkerStart : 0));
  while (sectionMatch) {
    const address = numberFromHex(sectionMatch[2]);
    const size = numberFromHex(sectionMatch[3]);
    if (size > 0 && !sections.some((section) => section.name === sectionMatch?.[1] && section.address === address)) {
      const region = regions.find((candidate) => address >= candidate.origin && address < candidate.origin + candidate.size);
      sections.push({ name: sectionMatch[1], address, size, region: region?.name });
    }
    sectionMatch = sectionPattern.exec(content.slice(linkerStart >= 0 ? linkerStart : 0));
  }
  regions.forEach((region) => {
    const intervals = sections
      .filter((section) => section.region === region.name)
      .map((section) => [section.address, section.address + section.size] as [number, number])
      .sort((left, right) => left[0] - right[0]);
    let end = 0;
    intervals.forEach(([start, finish]) => {
      if (finish > end) {
        region.used += finish - Math.max(start, end);
        end = finish;
      }
    });
  });
  return { regions, sections };
}

export function parseNmOutput(output: string): MemoryAnalyzerSymbol[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([0-9a-f]+)\s+([0-9a-f]+)\s+(\S)\s+(.+)$/i);
    if (!match) {
      return [];
    }
    const fields = match[4].split(/\s+/);
    const location = fields[fields.length - 1].match(/^(.+):(\d+)$/);
    const nameEnd = location ? fields.length - 1 : fields.length;
    const size = numberFromHex(match[2]);
    if (size === 0) {
      return [];
    }
    return [{
      name: fields.slice(0, nameEnd).join(' '),
      address: numberFromHex(match[1]),
      size,
      type: match[3],
      source: location ? `${location[1]}:${location[2]}` : undefined,
      sourceFile: location ? location[1] : undefined,
      sourceLine: location ? Number(location[2]) : undefined,
    }];
  });
}

export function parseObjdumpSections(output: string): MemoryAnalyzerSection[] {
  const lines = output.split(/\r?\n/);
  const sections: MemoryAnalyzerSection[] = [];
  const header = /^\s*\d+\s+(\S+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)/i;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const match = header.exec(lines[index]);
    if (!match || !/\bALLOC\b/.test(lines[index + 1])) {
      continue;
    }
    const size = numberFromHex(match[2]);
    if (size > 0) {
      sections.push({
        name: match[1],
        size,
        address: numberFromHex(match[3]),
        loadAddress: numberFromHex(match[4]),
      });
    }
  }
  return sections;
}

function toolPath(toolchainPath: string | boolean, executable: string): string {
  if (typeof toolchainPath !== 'string' || toolchainPath.length === 0) {
    return process.platform === 'win32' ? `${executable}.exe` : executable;
  }
  return path.join(toolchainPath, process.platform === 'win32' ? `${executable}.exe` : executable);
}

function runTool(executable: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(executable, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? undefined : stdout);
    });
  });
}

export async function analyzeBuild(elfPath: string, mapPath: string | undefined, toolchainPath: string | boolean): Promise<MemoryAnalyzerReport> {
  const map = mapPath && fs.existsSync(mapPath) ? parseMapFile(fs.readFileSync(mapPath, 'utf8')) : { regions: [], sections: [] };
  const objdumpOutput = await runTool(toolPath(toolchainPath, 'arm-none-eabi-objdump'), ['-h', elfPath]);
  const elfSections = objdumpOutput ? parseObjdumpSections(objdumpOutput) : map.sections;
  const sections: MemoryAnalyzerSection[] = [];
  map.regions.forEach((region) => { region.used = 0; });
  elfSections.forEach((section) => {
    map.regions.forEach((region) => {
      const inRuntimeRegion = section.address >= region.origin && section.address < region.origin + region.size;
      const inLoadRegion = section.name === '.data' && section.loadAddress !== undefined
        && section.loadAddress >= region.origin && section.loadAddress < region.origin + region.size;
      if (inRuntimeRegion || inLoadRegion) {
        sections.push({ ...section, region: region.name });
        region.used += section.size;
      }
    });
  });
  const nmOutput = await runTool(toolPath(toolchainPath, 'arm-none-eabi-nm'), ['-S', '--size-sort', '-C', '-l', '--defined-only', elfPath]);
  const parsedSymbols = nmOutput ? parseNmOutput(nmOutput) : [];
  const symbolsByKey = new Map<string, MemoryAnalyzerSymbol>();
  parsedSymbols.forEach((symbol) => {
    const key = `${symbol.name}:${symbol.address}:${symbol.size}:${symbol.type}`;
    const existing = symbolsByKey.get(key);
    if (!existing || (!existing.source && symbol.source)) {
      symbolsByKey.set(key, symbol);
    }
  });
  const symbols = Array.from(symbolsByKey.values());
  symbols.forEach((symbol) => {
    const section = sections.find((candidate) => symbol.address >= candidate.address && symbol.address < candidate.address + candidate.size);
    symbol.section = section?.name;
    symbol.region = section?.region;
  });
  return { elf: elfPath, map: mapPath, regions: map.regions, sections, symbols };
}
