/**
 * MIT License
 *
 * Copyright (c) 2020 Bureau Moeilijke Dingen
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

import * as OpenOCDConfig from './configuration/openOCDConfig';
import * as vscode from 'vscode';

import CommandMenu from './menu/CommandMenu';
import addCommandMenu from './menu';
import { checkBuildTools } from './buildTools';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext): { installTools: () => Promise<void> } {
  // This line of code will only be executed once when your extension is
  // activated
  let commandMenu: CommandMenu | undefined = undefined;
  checkBuildTools(context).then((hasBuildTools) => {
    if (hasBuildTools) {
      // should continue with 
    }
    commandMenu = addCommandMenu(context);
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'stm32-for-vscode.refreshMenu',
        () => commandMenu?.refresh(),
      ),
    );
    vscode.commands.executeCommand('setContext', 'stm32ForVSCodeReady', true);
  });
  const importCubeIDEProjectCommand = vscode.commands.registerCommand(
    'stm32-for-vscode.importCubeIDEProject',
    async () => {
      try {
        const { default: importAndSetupCubeIDEProject } = await import('./import');
        await importAndSetupCubeIDEProject();
      } catch (error) {
        vscode.window.showErrorMessage(`Something went wrong with importing the CubeIDE project: ${error}`);
      }
    }
  );
  context.subscriptions.push(importCubeIDEProjectCommand);
  const setProgrammerCommand = vscode.commands.registerCommand(
    'stm32-for-vscode.setProgrammer',
    (programmer?: string
    ) => {
      OpenOCDConfig.changeProgrammerDialogue(programmer);
    });
  context.subscriptions.push(setProgrammerCommand);
  const openSettingsCommand = vscode.commands.registerCommand('stm32-for-vscode.openSettings', () => {
    vscode.commands.executeCommand('workbench.action.openSettings', `@ext:bmd.stm32-for-vscode`);
  });
  context.subscriptions.push(openSettingsCommand);
  const openExtension = vscode.commands.registerCommand('stm32-for-vscode.openExtension', async () => {
    await checkBuildTools(context);
  });
  context.subscriptions.push(openExtension);
  const openMemoryAnalyzer = vscode.commands.registerCommand(
    'stm32-for-vscode.openMemoryAnalyzer', async (focusRegion?: string) => {
      const { openMemoryAnalyzer: openAnalyzer } = await import('./MemoryAnalyzerPanel');
      await openAnalyzer(focusRegion);
    });
  context.subscriptions.push(openMemoryAnalyzer);
  const installBuildTools = vscode.commands.registerCommand('stm32-for-vscode.installBuildTools', async () => {
    const { installBuildToolsCommand } = await import('./buildTools/installTools');
    await installBuildToolsCommand(context, commandMenu);
    // try {
    //   await installAllTools(context);
    //   const hasBuildTools = await checkBuildTools(context);
    //   if (hasBuildTools && commandMenu) {
    //     commandMenu.refresh();
    //   }

    // } catch (error) {
    //   vscode.window.showErrorMessage(`Something went wrong with installing the build tools. Error:${error}`);
    // }
  });
  context.subscriptions.push(installBuildTools);

  const buildToolsCommand = vscode.commands.registerCommand("stm32-for-vscode.checkBuildTools", async () => {
    await checkBuildTools(context);
  });
  context.subscriptions.push(buildToolsCommand);

  const openCubeMXCommand = vscode.commands.registerCommand("stm32-for-vscode.openCubeMX", async () => {
    const { openCubeMX } = await import('./CubeMX');
    await openCubeMX();
  });
  context.subscriptions.push(openCubeMXCommand);
  const runProfileAction = async (action: 'build' | 'flash', profile: string): Promise<void> => {
    const { default: buildSTM } = await import('./BuildTask');
    await buildSTM({profile, flash: action === 'flash'});
  };
  const buildCmd = vscode.commands.registerCommand(
    'stm32-for-vscode.build',
    async () => {
      await runProfileAction('build', 'debug');

    }
  );

  context.subscriptions.push(buildCmd);
  const buildReleaseCmd = vscode.commands.registerCommand(
    'stm32-for-vscode.buildRelease',
    async () => {
      await runProfileAction('build', 'release');

    }
  );
  context.subscriptions.push(buildReleaseCmd);
  const flashCmd = vscode.commands.registerCommand(
    'stm32-for-vscode.flash',
    async () => {
      await runProfileAction('flash', 'debug');
    }
  );
  context.subscriptions.push(flashCmd);

  const flashReleaseCmd = vscode.commands.registerCommand(
    'stm32-for-vscode.flashRelease',
    async () => {
      await runProfileAction('flash', 'release');
    }
  );
  context.subscriptions.push(flashReleaseCmd);

  const cleanBuildCmd = vscode.commands.registerCommand(
    'stm32-for-vscode.cleanBuild',
    async () => {
      const { default: buildSTM } = await import('./BuildTask');
      await buildSTM({
        cleanBuild: true,
        profile: 'debug',
      });
    }
  );
  context.subscriptions.push(cleanBuildCmd);
  const profileActionCmd = vscode.commands.registerCommand(
    'stm32-for-vscode.profileAction',
    async (action: 'build' | 'flash', profile: string) => {
      await runProfileAction(action, profile);
    },
  );
  context.subscriptions.push(profileActionCmd);
  return {
    installTools: async () => { const { installBuildToolsCommand } = await import('./buildTools/installTools');
      await installBuildToolsCommand(context, commandMenu); }
  };
}
