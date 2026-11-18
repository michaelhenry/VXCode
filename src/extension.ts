import * as vscode from 'vscode';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as core from './core';
import { Sidebar } from './sidebar';
import { packageActions, packagesHtml } from './packages';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('VXCode');
  const diagnostics = vscode.languages.createDiagnosticCollection('VXCode');
  const saved = context.workspaceState.get<any>('VXCode.selection', {});
  const restored = !!saved.project && fs.existsSync(saved.project);
  let project = restored ? saved.project : undefined,
    scheme = restored ? saved.scheme : undefined,
    device = saved.device,
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
    derivedData: config().get<string>('derivedDataPath') || '',
    derivedDataDetail: project ? derivedDataLocation() : '',
    debug: !!config().get('attachDebugger'),
  }));
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('VXCode.launch', sidebar),
    vscode.workspace.onDidChangeConfiguration(() => sidebar.refresh()),
  );
  const config = () => vscode.workspace.getConfiguration('VXCode');
  const remember = () => context.workspaceState.update('VXCode.selection', { project, scheme, device });
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
  const appCache = new Map<string, core.Application[]>(Object.entries(context.workspaceState.get('VXCode.apps', {})));
  const saveApps = () => context.workspaceState.update('VXCode.apps', Object.fromEntries(appCache));
  const packageFlags = new Map<string, Promise<string[]>>();
  // Older Xcode rejects unknown flags, so probe once per developer directory.
  function packageArgs(): Promise<string[]> {
    const dir = config().get<string>('developerDirectory') || '';
    if (!packageFlags.has(dir))
      packageFlags.set(
        dir,
        new Promise((resolve) =>
          execFile(
            '/usr/bin/xcodebuild',
            ['-help'],
            { env: dir ? { ...process.env, DEVELOPER_DIR: dir } : process.env },
            (_error, stdout, stderr) =>
              resolve(/-skipPackageUpdates\b/.test(stdout + stderr) ? ['-skipPackageUpdates'] : []),
          ),
        ),
      );
    return packageFlags.get(dir)!;
  }
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
    remember();
    sidebar.refresh();
  }
  async function selectScheme() {
    if (!project) await selectProject();
    const choices = core.schemes(
      await json(
        '/usr/bin/xcodebuild',
        [...core.projectArgs(project), ...core.scmArgs, '-list', '-json'],
        path.dirname(project),
      ),
    );
    if (!choices.length) throw new Error('No schemes found. Create a shared scheme in Xcode.');
    const chosen = await vscode.window.showQuickPick(choices, { placeHolder: 'Select scheme' });
    if (!chosen) throw new Error('Selection cancelled.');
    scheme = chosen;
    remember();
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
    remember();
    sidebar.refresh();
  }
  function derivedDataLocation() {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project))?.uri.fsPath;
    const custom = core.customDerivedData(
      config().get<string>('derivedDataPath'),
      os.homedir(),
      folder,
      path.dirname(project),
    );
    const hash = crypto.createHash('sha256').update(project).digest('hex').slice(0, 16);
    return custom || path.join(context.globalStorageUri.fsPath, 'DerivedData', hash);
  }
  async function derivedDataPath() {
    const derived = derivedDataLocation();
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(derived));
    return derived;
  }
  async function selectDerivedData() {
    const current = config().get<string>('derivedDataPath') || '';
    const items = [
      { label: '$(folder) Choose folder…', value: 'browse' },
      { label: '$(edit) Enter path…', description: 'Supports ~ and ${workspaceFolder}', value: 'enter' },
      ...(current
        ? [{ label: '$(discard) Use default', description: "VXCode's per-project storage", value: 'reset' }]
        : []),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: current ? `DerivedData: ${current}` : 'DerivedData: default (per-project VXCode storage)',
    });
    if (!picked) return;
    const workspaceFolder = project
      ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project))
      : vscode.workspace.workspaceFolders?.[0];
    let value = '';
    if (picked.value === 'browse') {
      const uri = (
        await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: 'Use as DerivedData',
          defaultUri: workspaceFolder?.uri,
        })
      )?.[0];
      if (!uri) return;
      value = core.portableDerivedData(uri.fsPath, workspaceFolder?.uri.fsPath);
    } else if (picked.value === 'enter') {
      const entered = await vscode.window.showInputBox({
        prompt: 'DerivedData folder (absolute, ~/…, ${workspaceFolder}/…, or relative to the workspace folder)',
        value: current || '${workspaceFolder}/.build/DerivedData',
        validateInput: (text) => (text.trim() ? undefined : 'Enter a path, or choose "Use default".'),
      });
      if (entered === undefined) return;
      value = entered.trim();
    }
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await config().update('derivedDataPath', value || undefined, target);
  }
  async function prepare(needsDevice = true) {
    if (!project) await selectProject();
    if (!scheme) await selectScheme();
    if (needsDevice && !device) await selectSimulator();
    if (!(await vscode.workspace.saveAll(false)))
      throw new Error('Some files could not be saved. Save them before building.');
    checkCancelled();
    diagnostics.clear();
    output.show(true);
  }
  async function archive() {
    await prepare(false);
    const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    const stamp = local.toISOString().replace('T', ' ').replace(/:/g, '.').slice(0, 19);
    // Xcode's Organizer lists archives saved under this folder.
    const archivePath = path.join(
      os.homedir(),
      'Library/Developer/Xcode/Archives',
      stamp.slice(0, 10),
      `${scheme} ${stamp}.xcarchive`,
    );
    const args = [...core.archiveArgs(project, scheme, await derivedDataPath(), archivePath), ...(await packageArgs())];
    await exec('/usr/bin/xcodebuild', [...args, 'archive'], path.dirname(project), true);
    const choice = await vscode.window.showInformationMessage(`Archived ${scheme}.`, 'Reveal in Finder');
    if (choice) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(archivePath));
  }
  async function build(run, test = false, action?: 'clean') {
    await prepare();
    const cwd = path.dirname(project);
    const args = [
      ...core.buildArgs(
        project,
        scheme,
        device.udid,
        config().get<string>('configuration') || 'Debug',
        await derivedDataPath(),
      ),
      ...(await packageArgs()),
    ];
    if (action === 'clean') {
      await exec('/usr/bin/xcodebuild', [...args, 'clean'], cwd, true);
      appCache.clear();
      saveApps();
      vscode.window.showInformationMessage('Xcode clean succeeded.');
      return;
    }
    await exec('/usr/bin/xcodebuild', [...args, test ? 'test' : 'build'], cwd, true);
    if (test) {
      vscode.window.showInformationMessage('Xcode tests passed.');
      return;
    }
    if (!run) {
      vscode.window.showInformationMessage('Xcode build succeeded.');
      return;
    }
    const key = args.join('\0');
    // shortcut: a renamed product whose old .app still exists launches stale; clearing DerivedData resets it.
    let apps = appCache.get(key)?.filter((a) => fs.existsSync(a.path)) || [];
    if (!apps.length) {
      apps = core.applications(await json('/usr/bin/xcodebuild', [...args, '-showBuildSettings', '-json'], cwd));
      appCache.set(key, apps);
      saveApps();
    }
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
      remember();
      throw new Error('Selected simulator is no longer available. Select another simulator.');
    }
    if (current.state !== 'Booted') await exec('/usr/bin/xcrun', ['simctl', 'boot', device.udid], cwd);
    await exec('/usr/bin/xcrun', ['simctl', 'bootstatus', device.udid, '-b'], cwd);
    await exec('/usr/bin/open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', device.udid], cwd);
    await exec('/usr/bin/xcrun', ['simctl', 'install', device.udid, app.path], cwd);
    const debug = config().get<boolean>('attachDebugger');
    if (debug && !vscode.extensions.getExtension('swiftlang.swift-vscode'))
      throw new Error(
        'Debugging requires the Swift extension (swiftlang.swift-vscode). Install it or turn off the debugger.',
      );
    const launched = await exec(
      '/usr/bin/xcrun',
      [
        'simctl',
        'launch',
        '--terminate-running-process',
        ...(debug ? ['--wait-for-debugger'] : []),
        device.udid,
        bundle,
      ],
      cwd,
    );
    if (debug) {
      const pid = core.launchedPid(launched);
      const attached =
        pid !== undefined &&
        (await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
          type: 'swift',
          request: 'attach',
          name: `VXCode: ${bundle}`,
          pid,
        }));
      if (!attached) {
        // The app is suspended waiting for a debugger; don't leave it hanging.
        await exec('/usr/bin/xcrun', ['simctl', 'terminate', device.udid, bundle], cwd).catch(() => undefined);
        throw new Error(`Could not attach the debugger to ${bundle}. See VXCode output.`);
      }
    }
    vscode.window.showInformationMessage(`${debug ? 'Debugging' : 'Launched'} ${bundle} on ${device.name}.`);
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
                  {
                    test: 'Tests passed',
                    run: 'App launched',
                    build: 'Build succeeded',
                    clean: 'Clean succeeded',
                    archive: 'Archive succeeded',
                    resolvePackages: 'Packages resolved',
                  }[name] || 'Ready';
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
  const cancelledSelection = () => new Error('Selection cancelled.');
  const readPbx = (file: string) =>
    new Promise<any>((resolve, reject) =>
      execFile(
        '/usr/bin/plutil',
        ['-convert', 'json', '-o', '-', file],
        { maxBuffer: 256 * 1024 * 1024 },
        (error, stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve(JSON.parse(stdout))),
      ),
    );
  const lintPbx = (file: string) =>
    new Promise<void>((resolve, reject) =>
      execFile('/usr/bin/plutil', ['-lint', '-s', file], (error, stdout) =>
        error ? reject(new Error(stdout || error.message)) : resolve(),
      ),
    );
  async function xcodeprojFor(selected: string) {
    if (selected.endsWith('.xcodeproj')) return selected;
    const data = fs.readFileSync(path.join(selected, 'contents.xcworkspacedata'), 'utf8');
    const projects = [...data.matchAll(/location\s*=\s*"(group|container|absolute):([^"]+\.xcodeproj)"/g)]
      .map(([, kind, location]) => (kind === 'absolute' ? location : path.resolve(path.dirname(selected), location)))
      .filter((p) => path.basename(p) !== 'Pods.xcodeproj' && fs.existsSync(p));
    if (!projects.length) throw new Error('No Xcode project found in this workspace.');
    if (projects.length === 1) return projects[0];
    const chosen = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: path.basename(p), description: p, value: p })),
      { placeHolder: 'Select the project whose packages to manage' },
    );
    if (!chosen) throw cancelledSelection();
    return chosen.value;
  }
  let packagesPanel: vscode.WebviewPanel | undefined;
  let packagesFile = '';
  async function showPackages() {
    if (!project) await selectProject();
    packagesFile = path.join(await xcodeprojFor(project), 'project.pbxproj');
    if (!packagesPanel) {
      packagesPanel = vscode.window.createWebviewPanel(
        'VXCode.packages',
        'Package Dependencies',
        vscode.ViewColumn.Active,
        { enableScripts: true, localResourceRoots: [] },
      );
      packagesPanel.onDidDispose(() => (packagesPanel = undefined), null, context.subscriptions);
      packagesPanel.webview.onDidReceiveMessage(handlePackageMessage, null, context.subscriptions);
    }
    packagesPanel.reveal();
    await renderPackages();
  }
  async function renderPackages() {
    if (!packagesPanel) return;
    const nonce = crypto.randomBytes(24).toString('base64');
    const packages = core.packageDependencies(await readPbx(packagesFile));
    packagesPanel.webview.html = packagesHtml(nonce, path.dirname(packagesFile), packages);
  }
  async function editPbx(change: (text: string, pbx: any) => string) {
    const original = fs.readFileSync(packagesFile, 'utf8');
    fs.writeFileSync(packagesFile, change(original, await readPbx(packagesFile)));
    try {
      await lintPbx(packagesFile);
    } catch (error) {
      fs.writeFileSync(packagesFile, original);
      throw new Error(`The edit produced an invalid project file and was reverted. ${error.message}`);
    }
  }
  async function ask(options: vscode.InputBoxOptions) {
    const value = await vscode.window.showInputBox({ ignoreFocusOut: true, ...options });
    if (value === undefined) throw cancelledSelection();
    return value.trim();
  }
  const urlError = (v: string) =>
    core.isPackageUrl(v.trim()) ? undefined : 'Enter an https://, ssh:// or git@ repository URL.';
  async function askRequirement(current?: Record<string, string>) {
    const chosen = await vscode.window.showQuickPick(
      Object.entries(core.requirementKinds)
        .map(([value, label]) => ({ label, value, description: value === current?.kind ? 'current' : undefined }))
        .sort((a, b) => Number(b.value === current?.kind) - Number(a.value === current?.kind)),
      { placeHolder: 'Dependency rule' },
    );
    if (!chosen) throw cancelledSelection();
    const kind = chosen.value;
    if (kind === 'versionRange') {
      const versionError = (v: string) => (core.isVersion(v.trim()) ? undefined : 'Enter a version like 1.2.3.');
      const minimum = await ask({
        prompt: 'Minimum version (inclusive)',
        value: current?.minimumVersion,
        validateInput: versionError,
      });
      const maximum = await ask({
        prompt: 'Maximum version (exclusive)',
        value: current?.maximumVersion,
        validateInput: versionError,
      });
      return core.packageRequirement(kind, minimum, maximum);
    }
    const field = { exactVersion: 'version', branch: 'branch', revision: 'revision' }[kind] || 'minimumVersion';
    const value = await ask({
      prompt: chosen.label,
      value: current?.[field] ?? (kind === 'branch' ? 'main' : ''),
      validateInput: (v) => {
        try {
          core.packageRequirement(kind, v);
        } catch (error) {
          return error.message;
        }
      },
    });
    return core.packageRequirement(kind, value);
  }
  async function addPackageDependency() {
    const pbx = await readPbx(packagesFile);
    const existing = core.packageDependencies(pbx);
    const url = await ask({
      prompt: 'Package repository URL (HTTPS or SSH)',
      placeHolder: 'git@github.com:owner/repo.git',
      validateInput: (v) =>
        urlError(v) || (existing.some((p) => p.url === v.trim()) ? 'This package is already added.' : undefined),
    });
    const requirement = await askRequirement();
    const products = (
      await ask({
        prompt: 'Products to link (comma-separated)',
        value: core.packageName(url),
        validateInput: (v) =>
          v.split(',').every((p) => core.isProductName(p.trim()))
            ? undefined
            : 'Enter product names separated by commas.',
      })
    )
      .split(',')
      .map((p) => p.trim());
    const targets = await vscode.window.showQuickPick(
      core.nativeTargets(pbx).map((t) => ({ label: t.name, id: t.id })),
      { canPickMany: true, placeHolder: 'Link the products to these targets' },
    );
    if (!targets?.length) throw cancelledSelection();
    await editPbx((text, current) =>
      core.addPackage(
        text,
        current,
        url,
        requirement,
        [...new Set(products)],
        targets.map((t) => t.id),
        () => crypto.randomBytes(12).toString('hex'),
      ),
    );
  }
  async function editPackageDependency(dependency: core.PackageDependency) {
    const url = await ask({ prompt: 'Package repository URL', value: dependency.url, validateInput: urlError });
    const requirement = await askRequirement(dependency.requirement);
    await editPbx((text) => core.updatePackage(text, dependency.id, url, requirement));
  }
  async function deletePackageDependency(dependency: core.PackageDependency) {
    const count = dependency.products.length;
    const choice = await vscode.window.showWarningMessage(
      `Remove ${dependency.name}${count ? ` and unlink its ${count} product${count === 1 ? '' : 's'}` : ''}?`,
      { modal: true },
      'Remove',
    );
    if (choice === 'Remove') await editPbx((text, pbx) => core.removePackage(text, pbx, dependency.id));
  }
  async function handlePackageMessage(message) {
    if (!packageActions.has(message?.action)) return;
    try {
      if (message.action === 'resolve') return void (await vscode.commands.executeCommand('VXCode.resolvePackages'));
      if (busy && message.action !== 'refresh')
        return void vscode.window.showWarningMessage('VXCode is busy. Cancel the current operation first.');
      if (message.action === 'add') await addPackageDependency();
      const dependency = core.packageDependencies(await readPbx(packagesFile)).find((p) => p.id === message.id);
      if (message.action === 'edit' && dependency?.url) await editPackageDependency(dependency);
      if (message.action === 'delete' && dependency) await deletePackageDependency(dependency);
    } catch (error) {
      if (error.message !== 'Selection cancelled.') vscode.window.showErrorMessage(error.message || String(error));
    }
    await renderPackages().catch((error) => vscode.window.showErrorMessage(error.message || String(error)));
  }
  register('packages', showPackages);
  register('resolvePackages', async () => {
    if (!project) await selectProject();
    output.show(true);
    await exec(
      '/usr/bin/xcodebuild',
      [...core.projectArgs(project), ...core.scmArgs, '-resolvePackageDependencies'],
      path.dirname(project),
    );
  });
  register('selectProject', selectProject);
  register('selectScheme', selectScheme);
  register('selectSimulator', selectSimulator);
  register('test', () => build(false, true));
  register('build', () => build(false));
  register('run', () => build(true));
  register('clean', () => build(false, false, 'clean'));
  register('archive', archive);
  context.subscriptions.push(
    vscode.commands.registerCommand('VXCode.cancel', stop),
    vscode.commands.registerCommand('VXCode.showOutput', () => output.show()),
    vscode.commands.registerCommand('VXCode.selectDerivedData', selectDerivedData),
    vscode.commands.registerCommand('VXCode.toggleDebugger', () =>
      config().update('attachDebugger', !config().get<boolean>('attachDebugger'), vscode.ConfigurationTarget.Global),
    ),
  );
}
