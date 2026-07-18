import * as vscode from "vscode";
import { forEach } from "lodash";

import { parseConfigfile, readConfigFile } from '../configuration/stm32Config';
import { formatBytes } from '../buildArtifacts';
import { getLatestMemoryAnalysisReport, MemoryAnalyzerRegion } from '../memoryAnalyzer';

export interface BuildCommandDefinition {
  label: string;
  command: string;
  explanation: string;
  arguments?: string[];
}
interface ProfileAction {
  action: 'build' | 'flash';
}
const cleanBuildCommand: BuildCommandDefinition = {
  label: 'Clean Build',
  command: 'stm32-for-vscode.cleanBuild',
  explanation: 'Performs a clean build by removing earlier build files and building from scratch.',
};
const debugCommand: BuildCommandDefinition = {
  label: 'Debug STM32',
  command: 'workbench.action.debug.start',
  arguments: ['Debug STM32'],
  explanation: 'Starts a debugging session for the STM32 MCU.',
};
const changeProgrammerCommand: BuildCommandDefinition = {
  label: 'Change Programmer',
  command: 'stm32-for-vscode.setProgrammer',
  explanation: `Changes the programming interface in the openocd.cfg file. 
  Select from a list of available programmers.`,
};
const importCubeProject: BuildCommandDefinition = {
  label: "Run CubeIDE Importer",
  command: 'stm32-for-vscode.importCubeIDEProject',
  explanation: 'Imports a CubeIDE project or example project when present in the current workspace.'
};
const openCubeMX: BuildCommandDefinition = {
  label: "Open STM32CubeMX",
  command: 'stm32-for-vscode.openCubeMX',
  explanation: 'Opens STM32CubeMX for the current project.'
};
const openPeripheralViewer: BuildCommandDefinition = {
  label: 'Open Peripheral Viewer',
  command: 'stm32-for-vscode.openPeripheralViewer',
  explanation: 'Opens the native Cortex-Debug XPERIPHERALS view for the active debug session.',
};
const COMMANDS: { [key: string]: BuildCommandDefinition } = {
  cleanBuildCommand,
  debugCommand,
  changeProgrammerCommand,
  importCubeProject,
  openCubeMX,
  openPeripheralViewer,
};

class BuildCommand extends vscode.TreeItem {
  public children?: BuildCommand[];
  public constructor(
    label: string,
    explanation: string,
    command: string | undefined,
    collapsibleState: vscode.TreeItemCollapsibleState,
    args?: string[],
    children?: BuildCommand[],
    description?: string,
  ) {
    super(label, collapsibleState);
    this.tooltip = `${this.label}: ${explanation}`;
    this.description = description || '';
    this.children = children;
    if (command) {
      this.command = {
        command,
        arguments: args,
        title: label,
      };
    }
  }
}

export default class CommandMenuProvider implements vscode.TreeDataProvider<BuildCommand> {
  private context: vscode.ExtensionContext;
  public constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public getTreeItem(element: BuildCommand): vscode.TreeItem {
    return element;
  }
  public async getChildren(element?: BuildCommand): Promise<BuildCommand[]> {
    if (element?.children) {
      return element.children;
    }
    const hasBuildTools = this.context.globalState.get('hasBuildTools');
    if (!hasBuildTools) {
      setTimeout(() => {
        this.refresh();
      }, 1000);
      return [];
    }

    let profiles = ['debug', 'release'];
    try {
      const config = parseConfigfile(await readConfigFile());
      profiles = Object.keys(config.profiles);
    } catch (error) {
      // The command view can still show the standard actions before configuration exists.
    }
    const profileActions = (action: ProfileAction['action']): BuildCommand[] => profiles.map((profile) => (
      new BuildCommand(
        profile,
        `Builds the ${profile} profile${action === 'flash' ? ' and flashes it' : ''}.`,
        'stm32-for-vscode.profileAction',
        vscode.TreeItemCollapsibleState.None,
        [action, profile],
      )
    ));
    const analysis = getLatestMemoryAnalysisReport();
    const memoryChildren = analysis
      ? analysis.regions.map((region: MemoryAnalyzerRegion) => {
        const used = formatBytes(region.used);
        const size = formatBytes(region.size);
        const percentage = region.size ? `${((region.used / region.size) * 100).toFixed(2)}%` : 'n/a';
        return new BuildCommand(
          region.name,
          `${region.name}: ${used} used of ${size} (${percentage})`,
          'stm32-for-vscode.openMemoryAnalyzer',
          vscode.TreeItemCollapsibleState.None,
          [region.name],
          undefined,
          `${used} / ${size}  ${percentage}`,
        );
      })
      : [new BuildCommand(
        'No analysis available',
        'Build a profile to generate the unified memory analysis report.',
        undefined,
        vscode.TreeItemCollapsibleState.None,
      )];
    memoryChildren.push(new BuildCommand(
      'Open Detailed Analyzer',
      'Inspect regions, sections, symbols, and source locations.',
      'stm32-for-vscode.openMemoryAnalyzer',
      vscode.TreeItemCollapsibleState.None,
    ));
    const commands: BuildCommand[] = [
      new BuildCommand(
        'Build',
        'Builds a selected STM32 profile.',
        undefined,
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        profileActions('build'),
      ),
      new BuildCommand(
        'Flash',
        'Builds and flashes a selected STM32 profile using OpenOCD.',
        undefined,
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        profileActions('flash'),
      ),
      new BuildCommand(
        'Memory Analysis',
        'Unified RAM, FLASH, section, and symbol analysis from the latest successful build.',
        undefined,
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        memoryChildren,
      ),
    ];
    forEach(COMMANDS, (command: BuildCommandDefinition) => {
      commands.push(
        new BuildCommand(
          command.label,
          command.explanation,
          command.command,
          vscode.TreeItemCollapsibleState.None,
          command?.arguments
        )
      );
    });
    return commands;
  }
  // eslint-disable-next-line max-len
  private _onDidChangeTreeData: vscode.EventEmitter<BuildCommand | undefined> = new vscode.EventEmitter<BuildCommand | undefined>();
  public readonly onDidChangeTreeData: vscode.Event<BuildCommand | undefined> = this._onDidChangeTreeData.event;

  public refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
