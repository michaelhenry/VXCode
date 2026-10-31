import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as crypto from 'crypto';
import * as core from './core';
import { Sidebar } from './sidebar';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('VXCode');
  const diagnostics = vscode.languages.createDiagnosticCollection('VXCode');
  let project,
    scheme,
    device,
    activeChild,
    busy = false,
    cancelled = false;
  let status = 'Ready',
    lastError = '';
  const sidebar = new Sidebar(context, () => ({
    project,
    scheme,
    device,
    busy,
    status,
    error: lastError,
    configuration: config().get('configuration'),
  }));
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('VXCode.launch', sidebar),
    vscode.workspace.onDidChangeConfiguration(() => sidebar.refresh()),
  );
  const config = () => vscode.workspace.getConfiguration('VXCode');
  const checkCancelled = () => {
    if (cancelled) throw new Error('Operation cancelled.');
  };
  const stop = () => {
    cancelled = true;
    if (busy) {
      status = 'Cancelling…';
      sidebar.refresh();
    }
    if (activeChild?.pid) {
      const child = activeChild;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (_) {
        /* Already exited. */
      }
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (_) {}
      }, 3000);
      timer.unref();
    }
  };
  context.subscriptions.push(output, diagnostics, { dispose: stop });
  function exec(command, args, cwd, collectDiagnostics = false) {
    checkCancelled();
    status = command.endsWith('xcodebuild') ? 'Building / reading Xcode project…' : 'Preparing Simulator…';
    sidebar.refresh();
    output.appendLine(`\n> ${command} ${args.map((a) => JSON.stringify(a)).join(' ')}`);
    return new Promise<string>((resolve, reject) => {
      const env = { ...process.env };
      const developerDirectory = config().get<string>('developerDirectory');
      if (developerDirectory) env.DEVELOPER_DIR = developerDirectory;
      const child = spawn(command, args, { cwd, env, shell: false, detached: true });
      activeChild = child;
      let stdout = '',
        stderr = '';
      const pending = { out: '', err: '' };
      const report = (line) => {
        if (!collectDiagnostics) return;
        const d = core.diagnostic(line, cwd);
        if (!d) return;
        const uri = vscode.Uri.file(d.file);
        const severity = {
          error: vscode.DiagnosticSeverity.Error,
          warning: vscode.DiagnosticSeverity.Warning,
          note: vscode.DiagnosticSeverity.Information,
        }[d.severity]!;
        const item = new vscode.Diagnostic(
          new vscode.Range(d.line, d.column, d.line, d.column + 1),
          d.message,
          severity,
        );
        item.source = 'xcodebuild';
        diagnostics.set(uri, [...(diagnostics.get(uri) || []), item]);
      };
      const receive = (kind, chunk) => {
        output.append(chunk);
        if (kind === 'out') stdout += chunk;
        else stderr = (stderr + chunk).slice(-16000);
        const lines = (pending[kind] + chunk).split(/\r?\n/);
        pending[kind] = lines.pop() || '';
        lines.forEach(report);
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => receive('out', chunk));
      child.stderr.on('data', (chunk) => receive('err', chunk));
      child.on('error', reject);
      child.on('close', (code) => {
        if (activeChild === child) activeChild = undefined;
        report(pending.out);
        report(pending.err);
        if (cancelled) reject(new Error('Operation cancelled.'));
        else if (code !== 0)
          reject(new Error(`${command} exited with code ${code}. See VXCode output.\n${stderr.slice(-1200)}`));
        else resolve(stdout);
      });
    });
  }
  const json = async (command: string, args: string[], cwd?: string) => JSON.parse(await exec(command, args, cwd));
  async function selectProject() {
    const files = await vscode.workspace.findFiles(
      '**/{*.xcodeproj/project.pbxproj,*.xcworkspace/contents.xcworkspacedata}',
      config().get<string>('discoveryExclude'),
    );
    const paths = [...new Set(files.map((f) => path.dirname(f.fsPath)))].filter((p) => !p.includes('.xcodeproj/'));
    if (!paths.length) throw new Error('No Xcode project or workspace found. Open its containing folder in VS Code.');
    const chosen = await vscode.window.showQuickPick(
      paths.sort().map((p) => ({ label: path.basename(p), description: p, value: p })),
      { placeHolder: 'Select an Xcode project or workspace (prefer workspace for CocoaPods)' },
    );
    if (!chosen) throw new Error('Selection cancelled.');
    project = chosen.value;
    scheme = undefined;
    sidebar.refresh();
  }
  async function selectScheme() {
    if (!project) await selectProject();
    const choices = core.schemes(
      await json('/usr/bin/xcodebuild', [...core.projectArgs(project), '-list', '-json'], path.dirname(project)),
    );
    if (!choices.length) throw new Error('No schemes found. Create a shared scheme in Xcode.');
    const chosen = await vscode.window.showQuickPick(choices, { placeHolder: 'Select scheme' });
    if (!chosen) throw new Error('Selection cancelled.');
    scheme = chosen;
    sidebar.refresh();
  }
  async function selectSimulator() {
    const choices = core.simulators(await json('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'available', '-j']));
    if (!choices.length)
      throw new Error('No available iOS simulators. Install an iOS runtime and create a simulator in Xcode.');
    const chosen = await vscode.window.showQuickPick(
      choices.map((d) => ({
        label: d.name,
        description: `${d.runtime.split('.').pop()} · ${d.state}`,
        detail: d.udid,
        value: d,
      })),
      { placeHolder: 'Select iOS simulator (scheme compatibility is checked by xcodebuild)' },
    );
    if (!chosen) throw new Error('Selection cancelled.');
    device = chosen.value;
    sidebar.refresh();
  }
  async function build(run, test = false) {
    if (!project) await selectProject();
    if (!scheme) await selectScheme();
    if (!device) await selectSimulator();
    if (!(await vscode.workspace.saveAll(false)))
      throw new Error('Some files could not be saved. Save them before building.');
    checkCancelled();
    diagnostics.clear();
    output.show(true);
    const cwd = path.dirname(project);
    const hash = crypto.createHash('sha256').update(project).digest('hex').slice(0, 16);
    const derived = path.join(context.globalStorageUri.fsPath, 'DerivedData', hash);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(derived));
    const args = core.buildArgs(project, scheme, device.udid, config().get<string>('configuration') || 'Debug', derived);
    await exec('/usr/bin/xcodebuild', [...args, test ? 'test' : 'build'], cwd, true);
    if (test) {
      vscode.window.showInformationMessage('Xcode tests passed.');
      return;
    }
    if (!run) {
      vscode.window.showInformationMessage('Xcode build succeeded.');
      return;
    }
    const apps = core.applications(await json('/usr/bin/xcodebuild', [...args, '-showBuildSettings', '-json'], cwd));
    if (!apps.length) throw new Error('Scheme produced no runnable iOS Simulator app. Select an application scheme.');
    const app =
      apps.length === 1
        ? apps[0]
        : (
            await vscode.window.showQuickPick(
              apps.map((a) => ({ label: a.name, description: a.path, value: a })),
              { placeHolder: 'Select application to launch' },
            )
          )?.value;
    if (!app) throw new Error('Selection cancelled.');
    const bundle = (
      await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(app.path, 'Info.plist')], cwd)
    ).trim();
    const current = core
      .simulators(await json('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'available', '-j'], cwd))
      .find((d) => d.udid === device.udid);
    if (!current) {
      device = undefined;
      throw new Error('Selected simulator is no longer available. Select another simulator.');
    }
    if (current.state !== 'Booted') await exec('/usr/bin/xcrun', ['simctl', 'boot', device.udid], cwd);
    await exec('/usr/bin/xcrun', ['simctl', 'bootstatus', device.udid, '-b'], cwd);
    await exec('/usr/bin/open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', device.udid], cwd);
    await exec('/usr/bin/xcrun', ['simctl', 'install', device.udid, app.path], cwd);
    await exec('/usr/bin/xcrun', ['simctl', 'launch', '--terminate-running-process', device.udid, bundle], cwd);
    vscode.window.showInformationMessage(`Launched ${bundle} on ${device.name}.`);
  }
  function register(name, action) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`VXCode.${name}`, async () => {
        if (process.platform !== 'darwin') return vscode.window.showErrorMessage('VXCode requires macOS.');
        if (!vscode.workspace.isTrusted)
          return vscode.window.showErrorMessage('Trust this workspace before running Xcode tools.');
        if (vscode.env.remoteName)
          return vscode.window.showErrorMessage('Open a local macOS folder; remote workspaces are not supported.');
        if (busy) return vscode.window.showWarningMessage('VXCode is busy. Cancel the current operation first.');
        busy = true;
        cancelled = false;
        lastError = '';
        status = 'Preparing…';
        sidebar.refresh();
        try {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'VXCode', cancellable: true },
            async (_, token) => {
              const subscription = token.onCancellationRequested(stop);
              try {
                await action();
                status =
                  name === 'test'
                    ? 'Tests passed'
                    : name === 'run'
                      ? 'App launched'
                      : name === 'build'
                        ? 'Build succeeded'
                        : 'Ready';
              } finally {
                subscription.dispose();
              }
            },
          );
        } catch (error) {
          status = cancelled ? 'Cancelled' : 'Operation failed';
          lastError = cancelled ? '' : error.message || String(error);
          output.appendLine(String(error));
          vscode.window.showErrorMessage(error.message || String(error));
        } finally {
          busy = false;
          sidebar.refresh();
        }
      }),
    );
  }
  register('selectProject', selectProject);
  register('selectScheme', selectScheme);
  register('selectSimulator', selectSimulator);
  register('test', () => build(false, true));
  register('build', () => build(false));
  register('run', () => build(true));
  context.subscriptions.push(
    vscode.commands.registerCommand('VXCode.cancel', stop),
    vscode.commands.registerCommand('VXCode.showOutput', () => output.show()),
  );
}
