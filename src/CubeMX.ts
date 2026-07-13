import { exec } from 'child_process';
import * as vscode from 'vscode';
import { which } from './Helpers';

/**
 * Commands to open STM32CubeMX with the current project's .ioc file if present.
 */
export async function openCubeMX(): Promise<void> {
  const config = vscode.workspace.getConfiguration('stm32-for-vscode');
  let cubeMXPath = config.get<string>('cubeMXPath') || '';

  if (!cubeMXPath) {
    const pathCubeMX = which('STM32CubeMX') || which('stm32cubemx') || which('cubemx');
    if (pathCubeMX) {
      cubeMXPath = pathCubeMX;
    }
  }

  if (!cubeMXPath) {
    const option = await vscode.window.showErrorMessage(
      'Path to STM32CubeMX is not configured. Please set the path in settings.',
      'Configure Path'
    );
    if (option === 'Configure Path') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'stm32-for-vscode.cubeMXPath');
    }
    return;
  }

  const iocFiles = await vscode.workspace.findFiles('*.ioc');
  const iocPath = iocFiles.length > 0 ? iocFiles[0].fsPath : '';

  const command = iocPath ? `"${cubeMXPath}" "${iocPath}"` : `"${cubeMXPath}"`;

  exec(command, (error) => {
    if (error) {
      vscode.window.showErrorMessage(`Failed to open STM32CubeMX: ${error.message}`);
    }
  });
}
