import * as path from 'path';

export interface XcodeProjectData {
  workspace?: { schemes?: string[] };
  project?: { schemes?: string[] };
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
export function buildArgs(
  project: string,
  scheme: string,
  device: string,
  configuration: string,
  derivedData: string,
): string[] {
  return [
    ...projectArgs(project),
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
// No -configuration, so the scheme's Archive action (usually Release) decides, as in Xcode.
export function archiveArgs(project: string, scheme: string, derivedData: string, archivePath: string): string[] {
  return [
    ...projectArgs(project),
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
