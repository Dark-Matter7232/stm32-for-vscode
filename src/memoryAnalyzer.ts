/* eslint-disable max-len */
import * as fs from 'fs';
import * as os from 'os';
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
  // Match the same region names as the reference analyzer, including names
  // containing punctuation (the linker is not restricted to C identifiers).
  const regionPattern = /^\s*(\S+)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)/gim;
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
    // Keep the same field layout as the reference parser. GNU nm omits the
    // size field for some linker-generated symbols and separates source
    // metadata with a tab rather than a space.
    const match = line.match(/^([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)?\s*\w\s+([^\t]*)\t*(\S*)/);
    if (!match) {
      return [];
    }
    let name = match[3].trim();
    let sourceFile: string | undefined;
    let sourceLine: number | undefined;
    const tabLocation = match[4].match(/^(.*):(\d+)$/);
    if (tabLocation) {
      sourceFile = tabLocation[1];
      sourceLine = Number(tabLocation[2]);
    }
    // Some nm versions separate the source location with spaces instead of
    // a tab. Accept that form too while retaining the reference field layout.
    if (!tabLocation) {
      const inlineLocation = name.match(/\s+(\S+):(\d+)$/);
      if (inlineLocation) {
        name = name.slice(0, name.length - inlineLocation[0].length).trim();
        sourceFile = inlineLocation[1];
        sourceLine = Number(inlineLocation[2]);
      }
    }
    const size = Number.isNaN(Number.parseInt(match[2] || '', 16)) ? 0 : numberFromHex(match[2] || '0');
    return [{
      name,
      address: numberFromHex(match[1]),
      size,
      type: line.match(/^[0-9A-Fa-f]+\s+(?:[0-9A-Fa-f]+\s+)?(\w)/)?.[1] || '',
      source: sourceFile !== undefined ? `${sourceFile}:${sourceLine}` : undefined,
      sourceFile,
      sourceLine,
    }];
  });
}

export function parseObjdumpSections(output: string): MemoryAnalyzerSection[] {
  const lines = output.split(/\r?\n/);
  const sections: MemoryAnalyzerSection[] = [];
  // Keep the same state machine as the reference parser: an ALLOC flags line
  // belongs to the most recent section header, even if objdump inserts an
  // additional line between them.
  const header = /^\s*\d+\s+([\.\w]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)/i;
  let previousLine = '';
  for (const line of lines) {
    if (!/\bALLOC\b/.test(line)) {
      previousLine = line;
      continue;
    }
    const match = header.exec(previousLine);
    if (!match) {
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
  const candidate = path.join(toolchainPath, process.platform === 'win32' ? `${executable}.exe` : executable);
  return fs.existsSync(candidate) ? candidate : executable;
}

function runTool(executable: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(executable, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? undefined : stdout);
    });
  });
}

async function withElfCopy<T>(elfPath: string, analyze: (safeElfPath: string) => Promise<T>): Promise<T> {
  let tempDir: string | undefined;
  let safeElfPath = elfPath;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stm32-memory-analyzer-'));
    safeElfPath = path.join(tempDir, path.basename(elfPath));
    fs.writeFileSync(safeElfPath, fs.readFileSync(elfPath));
  } catch (error) {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  }

  try {
    return await analyze(safeElfPath);
  } finally {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        // Analysis has already completed; cleanup failure must not hide it.
      }
    }
  }
}

export async function analyzeBuild(elfPath: string, mapPath: string | undefined, toolchainPath: string | boolean): Promise<MemoryAnalyzerReport> {
  const map = mapPath && fs.existsSync(mapPath) ? parseMapFile(fs.readFileSync(mapPath, 'utf8')) : { regions: [], sections: [] };
  const toolOutput = await withElfCopy(elfPath, async (safeElfPath) => ({
    objdump: await runTool(toolPath(toolchainPath, 'arm-none-eabi-objdump'), ['-h', safeElfPath]),
    nm: await runTool(toolPath(toolchainPath, 'arm-none-eabi-nm'), ['-C', '-S', '-n', '-l', '--defined-only', safeElfPath]),
  }));
  // The reference view is ELF-driven. If objdump is unavailable it shows no
  // section/symbol hierarchy rather than inventing one from map-file text.
  const elfSections = toolOutput.objdump ? parseObjdumpSections(toolOutput.objdump) : [];
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
  const nmOutput = toolOutput.nm;
  const parsedSymbols = nmOutput ? parseNmOutput(nmOutput) : [];
  // Keep one record for each region/section membership, matching the nested
  // reference model. In particular, identical nm records are not collapsed.
  const symbols: MemoryAnalyzerSymbol[] = [];
  parsedSymbols.forEach((symbol) => {
    sections.forEach((section) => {
      if (symbol.address >= section.address && symbol.address < section.address + section.size) {
        symbols.push({ ...symbol, section: section.name, region: section.region });
      }
    });
  });
  return { elf: elfPath, map: mapPath, regions: map.regions, sections, symbols };
}
