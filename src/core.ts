import * as path from 'path';

export interface XcodeProjectData {
  workspace?: { schemes?: string[] };
  project?: { schemes?: string[]; configurations?: string[] };
}
export interface Simulator {
  name: string;
  udid: string;
  runtime: string;
  state?: string;
  isAvailable?: boolean;
}
export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
}
export interface BuildSettingEntry {
  target: string;
  buildSettings?: Record<string, string>;
}
export interface Application {
  name: string;
  path: string;
}

// `simctl launch` prints "<bundle id>: <pid>".
export function launchedPid(output: string): number | undefined {
  const match = output.match(/:\s*(\d+)\s*$/);
  return match ? Number(match[1]) : undefined;
}
export function projectArgs(project: string): string[] {
  return [project.endsWith('.xcworkspace') ? '-workspace' : '-project', project];
}
export const scmArgs = ['-scmProvider', 'system'];
export function buildArgs(
  project: string,
  scheme: string,
  device: string,
  configuration: string,
  derivedData: string,
): string[] {
  return [
    ...projectArgs(project),
    ...scmArgs,
    '-scheme',
    scheme,
    '-configuration',
    configuration,
    '-destination',
    `platform=iOS Simulator,id=${device}`,
    '-derivedDataPath',
    derivedData,
  ];
}
// Resolves the VXCode.derivedDataPath setting: expands `~` and `${workspaceFolder}`, and resolves
// relative paths against the workspace folder (or the project's directory outside a workspace).
// Returns undefined when unset so the caller falls back to per-project extension storage.
export function customDerivedData(
  setting: string | undefined,
  home: string,
  workspaceFolder: string | undefined,
  projectDir: string,
): string | undefined {
  let value = (setting || '').trim();
  if (!value) return undefined;
  const base = workspaceFolder || projectDir;
  value = value.replace(/\$\{workspaceFolder\}/g, base);
  if (value === '~' || value.startsWith('~/')) value = path.join(home, value.slice(1));
  return path.resolve(base, value);
}
// Stores folders inside the workspace as `${workspaceFolder}/…` so shared settings stay portable.
export function portableDerivedData(folder: string, workspaceFolder: string | undefined): string {
  if (!workspaceFolder) return folder;
  const relative = path.relative(workspaceFolder, folder);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return folder;
  return relative ? `\${workspaceFolder}/${relative.split(path.sep).join('/')}` : '${workspaceFolder}';
}
// No -configuration, so the scheme's Archive action (usually Release) decides, as in Xcode.
export function archiveArgs(project: string, scheme: string, derivedData: string, archivePath: string): string[] {
  return [
    ...projectArgs(project),
    ...scmArgs,
    '-scheme',
    scheme,
    '-destination',
    'generic/platform=iOS',
    '-derivedDataPath',
    derivedData,
    '-archivePath',
    archivePath,
  ];
}
export function schemes(data: XcodeProjectData): string[] {
  return [...new Set(data.workspace?.schemes || data.project?.schemes || [])].sort();
}
export function configurations(data: XcodeProjectData[]): string[] {
  return [...new Set(data.flatMap((d) => d.project?.configurations || []))].sort();
}
// Projects referenced by a workspace's contents.xcworkspacedata (`group:`, `container:` or `absolute:` locations).
// Nested group prefixes are not resolved; projects that do not exist on disk are skipped by the caller.
export function workspaceProjects(contents: string, workspace: string): string[] {
  const base = path.dirname(workspace);
  const found = [
    ...contents.matchAll(/<FileRef\s+location\s*=\s*"(group|container|absolute):([^"]+?\.xcodeproj)"/g),
  ].map(([, kind, location]) => (kind === 'absolute' ? location : path.resolve(base, location)));
  return [...new Set(found)];
}
export function simulators(data: { devices?: Record<string, Simulator[]> }): Simulator[] {
  return Object.entries(data.devices || {})
    .filter(([runtime]) => runtime.includes('.iOS-'))
    .flatMap(([runtime, devices]) => devices.filter((d) => d.isAvailable).map((d) => ({ ...d, runtime })))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function diagnostic(line: string, cwd: string): Diagnostic | undefined {
  const match = line.match(/^(.+?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/);
  if (!match) return undefined;
  return {
    file: path.resolve(cwd, match[1]),
    line: Math.max(0, Number(match[2]) - 1),
    column: Math.max(0, Number(match[3]) - 1),
    severity: match[4] as Diagnostic['severity'],
    message: match[5],
  };
}
export function applications(settings: BuildSettingEntry[]): Application[] {
  return settings
    .filter((entry) => {
      const s = entry.buildSettings || {};
      return (
        s.WRAPPER_EXTENSION === 'app' &&
        s.PRODUCT_TYPE === 'com.apple.product-type.application' &&
        s.PLATFORM_NAME === 'iphonesimulator' &&
        s.TARGET_BUILD_DIR &&
        s.FULL_PRODUCT_NAME
      );
    })
    .map((entry) => ({
      name: entry.target,
      path: path.join(entry.buildSettings!.TARGET_BUILD_DIR!, entry.buildSettings!.FULL_PRODUCT_NAME!),
    }));
}
export interface PackageProduct {
  id: string;
  name: string;
  targets: string[];
}
export interface PackageDependency {
  id: string;
  name: string;
  url?: string;
  path?: string;
  requirement?: Record<string, string>;
  products: PackageProduct[];
}
export const packageName = (location: string) =>
  (location.split('/').pop() || location).replace(/\.git$/, '').replace(/\*\//g, '');
export function packageDependencies(pbx: any): PackageDependency[] {
  const objects = pbx?.objects || {};
  const targets = Object.values<any>(objects).filter((o) => Array.isArray(o.packageProductDependencies));
  return (objects[pbx?.rootObject]?.packageReferences || [])
    .filter((id) => objects[id])
    .map((id) => {
      const ref = objects[id];
      return {
        id,
        name: packageName(ref.repositoryURL || ref.relativePath || id),
        url: ref.repositoryURL,
        path: ref.relativePath,
        requirement: ref.requirement,
        products: Object.entries<any>(objects)
          .filter(([, o]) => o.isa === 'XCSwiftPackageProductDependency' && o.package === id)
          .map(([pid, o]) => ({
            id: pid,
            name: o.productName,
            targets: targets.filter((t) => t.packageProductDependencies.includes(pid)).map((t) => t.name),
          })),
      };
    });
}
export function nativeTargets(pbx: any): { id: string; name: string }[] {
  return (pbx?.objects?.[pbx?.rootObject]?.targets || [])
    .filter((id) => pbx.objects[id]?.isa === 'PBXNativeTarget')
    .map((id) => ({ id, name: pbx.objects[id].name }));
}
export const requirementKinds = {
  upToNextMajorVersion: 'Up to Next Major Version',
  upToNextMinorVersion: 'Up to Next Minor Version',
  exactVersion: 'Exact Version',
  versionRange: 'Version Range',
  branch: 'Branch',
  revision: 'Commit',
};
export function requirementLabel(r?: Record<string, string>): string {
  if (!r) return 'Local package';
  if (r.kind === 'upToNextMajorVersion') return `${r.minimumVersion} – next major`;
  if (r.kind === 'upToNextMinorVersion') return `${r.minimumVersion} – next minor`;
  if (r.kind === 'exactVersion') return `Exactly ${r.version}`;
  if (r.kind === 'versionRange') return `${r.minimumVersion} ..< ${r.maximumVersion}`;
  if (r.kind === 'branch') return `Branch ${r.branch}`;
  if (r.kind === 'revision') return `Commit ${String(r.revision).slice(0, 7)}`;
  return r.kind || 'Unknown';
}
export const isVersion = (v: string) => /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v);
export const isPackageUrl = (v: string) => /^(?:https?:\/\/|ssh:\/\/|git@)[^\s"\\]+$/.test(v);
export const isProductName = (v: string) => /^[A-Za-z0-9_.+-]+$/.test(v);
export function packageRequirement(kind: string, value: string, maximum = ''): Record<string, string> {
  value = value.trim();
  maximum = maximum.trim();
  if (kind === 'upToNextMajorVersion' || kind === 'upToNextMinorVersion' || kind === 'exactVersion') {
    if (!isVersion(value)) throw new Error('Enter a version like 1.2.3.');
    return kind === 'exactVersion' ? { kind, version: value } : { kind, minimumVersion: value };
  }
  if (kind === 'versionRange') {
    if (!isVersion(value) || !isVersion(maximum)) throw new Error('Enter versions like 1.2.3.');
    return { kind, maximumVersion: maximum, minimumVersion: value };
  }
  if (kind === 'branch') {
    if (!/^[^\s"\\]+$/.test(value)) throw new Error('Enter a branch name.');
    return { kind, branch: value };
  }
  if (kind === 'revision') {
    if (!/^[0-9a-f]{7,40}$/i.test(value)) throw new Error('Enter a commit hash.');
    return { kind, revision: value };
  }
  throw new Error(`Unsupported requirement: ${kind}`);
}
const pbxString = (v: string) => (/^[\w./$-]+$/.test(v) ? v : `"${v.replace(/[\\"]/g, '\\$&')}"`);
function objectRange(text: string, id: string): [number, number] {
  const start = text.indexOf(`\n\t\t${id} `);
  if (start < 0) throw new Error(`Object ${id} was not found in project.pbxproj.`);
  const lineEnd = text.indexOf('\n', start + 1);
  return [start, text.slice(start, lineEnd).endsWith('};') ? lineEnd : text.indexOf('\n\t\t};', start) + 5];
}
function removeObject(text: string, id: string): string {
  const [start, end] = objectRange(text, id);
  return (text.slice(0, start) + text.slice(end)).replace(new RegExp(`\\n\\t+${id}(?: /\\*.*?\\*/)?,(?=\\n)`, 'g'), '');
}
function insertInSection(text: string, isa: string, block: string): string {
  const begin = `/* Begin ${isa} section */\n`;
  const at = text.indexOf(begin);
  if (at >= 0) return text.slice(0, at + begin.length) + block + text.slice(at + begin.length);
  const end = text.lastIndexOf('\n\t};\n\trootObject');
  if (end < 0) throw new Error('Unsupported project.pbxproj layout.');
  return `${text.slice(0, end)}\n\n${begin}${block}/* End ${isa} section */${text.slice(end)}`;
}
function addToList(text: string, objectId: string, key: string, entry: string): string {
  const [start, end] = objectRange(text, objectId);
  const block = text.slice(start, end);
  const open = `\n\t\t\t${key} = (\n`;
  const line = `\t\t\t\t${entry},\n`;
  const at = block.indexOf(open);
  const isa = block.indexOf('\n', block.indexOf('\n\t\t\tisa = ') + 1);
  if (at < 0 && isa <= 0) throw new Error(`Unsupported project.pbxproj layout near ${objectId}.`);
  const next =
    at >= 0
      ? block.slice(0, at + open.length) + line + block.slice(at + open.length)
      : `${block.slice(0, isa)}${open}${line}\t\t\t);${block.slice(isa)}`;
  return text.slice(0, start) + next + text.slice(end);
}
function remoteReference(id: string, url: string, requirement: Record<string, string>): string {
  const fields = Object.keys(requirement)
    .sort()
    .map((k) => `\t\t\t\t${k} = ${pbxString(requirement[k])};\n`)
    .join('');
  return `\t\t${id} /* XCRemoteSwiftPackageReference "${packageName(url)}" */ = {\n\t\t\tisa = XCRemoteSwiftPackageReference;\n\t\t\trepositoryURL = ${pbxString(url)};\n\t\t\trequirement = {\n${fields}\t\t\t};\n\t\t};\n`;
}
export function pbxId(text: string, random: () => string): string {
  for (;;) {
    const id = random().toUpperCase();
    if (/^[0-9A-F]{24}$/.test(id) && !text.includes(id)) return id;
  }
}
export function removePackage(text: string, pbx: any, id: string): string {
  const objects = pbx.objects;
  const products = Object.keys(objects).filter((k) => objects[k].package === id);
  const users = Object.keys(objects).filter((k) => products.includes(objects[k].productRef));
  for (const k of [id, ...products, ...users]) text = removeObject(text, k);
  return text;
}
export function updatePackage(text: string, id: string, url: string, requirement: Record<string, string>): string {
  const [start, end] = objectRange(text, id);
  const comment = text.slice(start, end).match(/\/\* (.*?) \*\//)?.[1];
  text = text.slice(0, start) + '\n' + remoteReference(id, url, requirement).slice(0, -1) + text.slice(end);
  return comment
    ? text.split(`${id} /* ${comment} */`).join(`${id} /* XCRemoteSwiftPackageReference "${packageName(url)}" */`)
    : text;
}
export function addPackage(
  text: string,
  pbx: any,
  url: string,
  requirement: Record<string, string>,
  products: string[],
  targets: string[],
  random: () => string,
): string {
  const objects = pbx.objects;
  const ref = pbxId(text, random);
  const refComment = `${ref} /* XCRemoteSwiftPackageReference "${packageName(url)}" */`;
  text = insertInSection(text, 'XCRemoteSwiftPackageReference', remoteReference(ref, url, requirement));
  text = addToList(text, pbx.rootObject, 'packageReferences', refComment);
  for (const target of targets) {
    let phase = (objects[target]?.buildPhases || []).find((p) => objects[p]?.isa === 'PBXFrameworksBuildPhase');
    if (!phase) {
      phase = pbxId(text, random);
      text = insertInSection(
        text,
        'PBXFrameworksBuildPhase',
        `\t\t${phase} /* Frameworks */ = {\n\t\t\tisa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n`,
      );
      text = addToList(text, target, 'buildPhases', `${phase} /* Frameworks */`);
    }
    for (const product of products) {
      const dependency = pbxId(text, random);
      text = insertInSection(
        text,
        'XCSwiftPackageProductDependency',
        `\t\t${dependency} /* ${product} */ = {\n\t\t\tisa = XCSwiftPackageProductDependency;\n\t\t\tpackage = ${refComment};\n\t\t\tproductName = ${pbxString(product)};\n\t\t};\n`,
      );
      const file = pbxId(text, random);
      text = insertInSection(
        text,
        'PBXBuildFile',
        `\t\t${file} /* ${product} in Frameworks */ = {isa = PBXBuildFile; productRef = ${dependency} /* ${product} */; };\n`,
      );
      text = addToList(text, target, 'packageProductDependencies', `${dependency} /* ${product} */`);
      text = addToList(text, phase, 'files', `${file} /* ${product} in Frameworks */`);
    }
  }
  return text;
}
export interface BuildOptimization {
  id: string;
  label: string;
  detail: string;
  args: string[][];
  testOnly?: boolean;
}
export const buildOptimizations: BuildOptimization[] = [
  {
    id: 'noCodeCoverage',
    label: 'Skip code coverage',
    detail: 'Runs tests without coverage instrumentation even when the scheme enables it.',
    args: [['-enableCodeCoverage', 'NO']],
    testOnly: true,
  },
  {
    id: 'lockPackages',
    label: 'Use Package.resolved as-is',
    detail: 'Skips automatic package resolution. Run Resolve packages after changing dependencies.',
    args: [['-disableAutomaticPackageResolution']],
  },
  {
    id: 'skipValidation',
    label: 'Skip package plugin and macro validation',
    detail: 'Avoids trust checks for package plugins and macros such as those in TCA.',
    args: [['-skipPackagePluginValidation'], ['-skipMacroValidation']],
  },
  {
    id: 'noPreviews',
    label: 'Skip SwiftUI preview support',
    detail: 'Sets ENABLE_PREVIEWS=NO and ENABLE_DEBUG_DYLIB=NO, so no separate preview dylib is linked.',
    args: [['ENABLE_PREVIEWS=NO'], ['ENABLE_DEBUG_DYLIB=NO']],
  },
  {
    id: 'dwarf',
    label: 'Skip dSYM generation',
    detail: 'Sets DEBUG_INFORMATION_FORMAT=dwarf; debugging still works locally.',
    args: [['DEBUG_INFORMATION_FORMAT=dwarf']],
  },
  {
    id: 'compilationCache',
    label: 'Compilation caching',
    detail:
      'Sets COMPILATION_CACHE_ENABLE_CACHING=YES to reuse compiled output across branches and cleans (Xcode 26+).',
    args: [['COMPILATION_CACHE_ENABLE_CACHING=YES']],
  },
  {
    id: 'parallelTesting',
    label: 'Parallel testing',
    detail: 'Runs test classes in parallel on Simulator clones.',
    args: [['-parallel-testing-enabled', 'YES']],
    testOnly: true,
  },
  {
    id: 'noIndexStore',
    label: 'Skip indexing while building',
    detail: 'Sets COMPILER_INDEX_STORE_ENABLE=NO. Xcode re-indexes when it next opens the project.',
    args: [['COMPILER_INDEX_STORE_ENABLE=NO']],
  },
  {
    id: 'timingSummary',
    label: 'Build timing summary',
    detail: 'Prints the slowest build steps at the end of the build output.',
    args: [['-showBuildTimingSummary']],
  },
];
export function optimizationArgs(
  selected: readonly string[] | undefined,
  testing: boolean,
  supported: (flag: string) => boolean = () => true,
): string[] {
  const chosen = new Set(selected || []);
  return buildOptimizations
    .filter((o) => chosen.has(o.id) && (testing || !o.testOnly))
    .flatMap((o) => o.args.filter(([flag]) => !flag.startsWith('-') || supported(flag)).flat());
}
export function parseList(text: string): string[] {
  return [
    ...new Set(
      String(text ?? '')
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
export const hasTestPattern = (tests: readonly string[] | undefined) => (tests || []).some((t) => t.includes('*'));
export function testClasses(source: string): string[] {
  return [...String(source).matchAll(/\bclass\s+([A-Za-z_]\w*)\s*:/g)].map(([, name]) => name);
}
const escapeRegExp = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function expandTestPatterns(tests: readonly string[] | undefined, classes: readonly string[]): string[] {
  const known = [...new Set(classes)].sort();
  return [
    ...new Set(
      (tests || []).flatMap((entry) => {
        if (!entry.includes('*')) return [entry];
        const slash = entry.indexOf('/');
        if (slash < 0) return [];
        const [target, pattern] = [entry.slice(0, slash), entry.slice(slash + 1)];
        if (!target || target.includes('*') || pattern.includes('/')) return [];
        const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('\\w*')}$`);
        return known.filter((name) => regex.test(name)).map((name) => `${target}/${name}`);
      }),
    ),
  ];
}
export const skipTestingArgs = (tests: readonly string[] | undefined) => (tests || []).map((t) => `-skip-testing:${t}`);
export function workspaceExcludeGlob(folder: string, workspaceFolder: string | undefined): string | undefined {
  if (!workspaceFolder) return undefined;
  const relative = path.relative(workspaceFolder, folder);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join('/');
}
export function parseArguments(text: string): string[] {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
export const onlyTestingArgs = (tests: readonly string[] | undefined) => (tests || []).map((t) => `-only-testing:${t}`);
export function buildOptionsSummary(optimizations: number, tests: number, extra: number): string {
  const parts = [
    optimizations && `${optimizations} speedup${optimizations === 1 ? '' : 's'}`,
    tests && `${tests} test filter${tests === 1 ? '' : 's'}`,
    extra && `${extra} extra arg${extra === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Default';
}
export const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const pad = (n: number, width = 2) => String(n).padStart(width, '0');
/** Local wall-clock time for output lines, e.g. `14:03:27.042`. */
export const timestamp = (date: Date) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
/** Human-readable elapsed time, e.g. `850ms`, `12.3s`, `2m 05s`, `1h 02m`. */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${pad(Math.floor(seconds / 60) % 60)}m`;
}
/** Output labels for long-running actions whose total time is logged; pickers are not timed. */
const actionLabels: Record<string, string> = {
  build: 'Build',
  run: 'Build & Run',
  test: 'Test',
  testWithoutBuilding: 'Test without building',
  clean: 'Clean',
  archive: 'Archive',
  resolvePackages: 'Resolve packages',
};
export const actionLabel = (name: string): string | undefined => actionLabels[name];
