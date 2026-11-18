'use strict';
export {};
const assert = require('assert');
const core = require('../src/core');
assert.deepStrictEqual(core.projectArgs('/tmp/My App.xcworkspace'), ['-workspace', '/tmp/My App.xcworkspace']);
assert.deepStrictEqual(core.projectArgs('/tmp/App.xcodeproj'), ['-project', '/tmp/App.xcodeproj']);
const args = core.buildArgs('/tmp/My App.xcodeproj', 'App Tests', 'UUID', 'Debug', '/tmp/Build Data');
assert(args.includes('platform=iOS Simulator,id=UUID'));
assert(args.includes('/tmp/My App.xcodeproj'));
assert.strictEqual(args[args.indexOf('-scmProvider') + 1], 'system');
const archive = core.archiveArgs('/tmp/App.xcworkspace', 'App', '/tmp/Data', '/tmp/App.xcarchive');
assert(archive.includes('generic/platform=iOS'));
assert(!archive.includes('-configuration'));
assert.strictEqual(archive[archive.indexOf('-scmProvider') + 1], 'system');
assert.strictEqual(archive[archive.indexOf('-archivePath') + 1], '/tmp/App.xcarchive');
assert.deepStrictEqual(core.schemes({ workspace: { schemes: ['Z', 'A', 'A'] } }), ['A', 'Z']);
assert.deepStrictEqual(core.schemes({ project: { schemes: ['App'] } }), ['App']);
assert.strictEqual(
  core.simulators({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
        { name: 'iPhone', udid: '1', isAvailable: true },
        { name: 'Old', isAvailable: false },
      ],
      'com.apple.CoreSimulator.SimRuntime.tvOS-18-0': [{ name: 'TV', isAvailable: true }],
    },
  }).length,
  1,
);
assert.deepStrictEqual(core.diagnostic('/tmp/My App/File.swift:12:3: error: Broken', '/tmp'), {
  file: '/tmp/My App/File.swift',
  line: 11,
  column: 2,
  severity: 'error',
  message: 'Broken',
});
assert.strictEqual(core.diagnostic('** BUILD FAILED **', '/tmp'), undefined);
const settings = {
  WRAPPER_EXTENSION: 'app',
  PRODUCT_TYPE: 'com.apple.product-type.application',
  PLATFORM_NAME: 'iphonesimulator',
  TARGET_BUILD_DIR: '/tmp/My Build',
  FULL_PRODUCT_NAME: 'My App.app',
};
assert.deepStrictEqual(
  core.applications([
    { target: 'App', buildSettings: settings },
    { target: 'Tests', buildSettings: { ...settings, PRODUCT_TYPE: 'com.apple.product-type.bundle.unit-test' } },
  ]),
  [{ name: 'App', path: '/tmp/My Build/My App.app' }],
);
assert.strictEqual(core.launchedPid('com.example.App: 4321\n'), 4321);
assert.strictEqual(core.launchedPid('An error was encountered'), undefined);
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const { packagesHtml } = require('../src/packages');
  const fixture = path.join(__dirname, '../../test/fixtures/App.pbxproj');
  const text = fs.readFileSync(fixture, 'utf8');
  const pbx = JSON.parse(fs.readFileSync(`${fixture}.json`, 'utf8'));
  const [ref, product, file, phase, target] = [
    '6F3292151AB654E3F7CE4516',
    '1DDD8ADA3B80D63A9D614112',
    'FB4ADDA0C718A3BBFDEF8932',
    '9E7BD6A6933BA1EE03384D4A',
    '803EEE0FC0222BABDF9B239D',
  ];
  assert.deepStrictEqual(core.packageDependencies(pbx), [
    {
      id: ref,
      name: 'swift-argument-parser',
      url: 'git@github.com:apple/swift-argument-parser.git',
      path: undefined,
      requirement: { kind: 'upToNextMajorVersion', minimumVersion: '1.3.0' },
      products: [{ id: product, name: 'ArgumentParser', targets: ['SSHDemo'] }],
    },
  ]);
  assert.deepStrictEqual(core.nativeTargets(pbx), [{ id: target, name: 'SSHDemo' }]);
  assert.strictEqual(core.requirementLabel({ kind: 'exactVersion', version: '2.0.0' }), 'Exactly 2.0.0');
  assert.strictEqual(core.requirementLabel(undefined), 'Local package');
  assert.deepStrictEqual(core.packageRequirement('versionRange', ' 1.0.0', '2.0.0 '), {
    kind: 'versionRange',
    maximumVersion: '2.0.0',
    minimumVersion: '1.0.0',
  });
  assert.throws(() => core.packageRequirement('exactVersion', '1.0'));
  assert.throws(() => core.packageRequirement('branch', 'main"; evil = 1'));
  assert.throws(() => core.packageRequirement('unknown', '1.0.0'));
  assert(core.isPackageUrl('git@github.com:apple/swift-argument-parser.git'));
  assert(core.isPackageUrl('https://github.com/apple/swift-argument-parser'));
  assert(!core.isPackageUrl('https://example.com/a"b'));
  assert(!core.isPackageUrl('file:///tmp/pkg'));

  const removed = core.removePackage(text, pbx, ref);
  for (const id of [ref, product, file]) assert(!removed.includes(id), `${id} should be removed`);
  assert(removed.includes(phase) && removed.includes(target));

  let n = 0;
  const random = () => (++n).toString(16).padStart(24, 'a');
  const added = core.addPackage(
    removed,
    pbx,
    'https://github.com/pointfreeco/swift-case-paths.git',
    core.packageRequirement('branch', 'main'),
    ['CasePaths'],
    [target],
    random,
  );
  const [newRef, newProduct, newFile] = [
    'aaaaaaaaaaaaaaaaaaaaaaa1',
    'aaaaaaaaaaaaaaaaaaaaaaa2',
    'aaaaaaaaaaaaaaaaaaaaaaa3',
  ].map((id) => id.toUpperCase());
  assert(added.includes(`repositoryURL = "https://github.com/pointfreeco/swift-case-paths.git";`));
  assert(added.includes('\t\t\t\tbranch = main;\n\t\t\t\tkind = branch;\n'));
  assert(added.includes(`productRef = ${newProduct} /* CasePaths */;`));
  assert(added.includes(`\t\t\t\t${newRef} /* XCRemoteSwiftPackageReference "swift-case-paths" */,\n`));
  assert(added.includes(`\t\t\t\t${newFile} /* CasePaths in Frameworks */,\n`));

  const updated = core.updatePackage(
    text,
    ref,
    'git@github.com:apple/swift-argument-parser.git',
    core.packageRequirement('exactVersion', '1.5.0'),
  );
  assert(updated.includes('\t\t\t\tkind = exactVersion;\n\t\t\t\tversion = 1.5.0;\n'));
  assert(!updated.includes('minimumVersion = 1.3.0'));

  const html = packagesHtml('n', '<b>App</b>', [
    { id: 'X', name: '<img src=x>', url: 'git@h:"a', requirement: undefined, products: [] },
  ]);
  assert(!html.includes('<img src=x>') && html.includes('&lt;img src=x&gt;') && html.includes('&lt;b&gt;App'));

  if (process.platform === 'darwin') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vxcode-'));
    const parse = (contents) => {
      const target = path.join(dir, 'project.pbxproj');
      fs.writeFileSync(target, contents);
      return JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', target], { encoding: 'utf8' }));
    };
    assert.deepStrictEqual(core.packageDependencies(parse(removed)), []);
    const addedPackages = core.packageDependencies(parse(added));
    assert.deepStrictEqual(
      addedPackages.map((p) => [p.name, p.requirement, p.products.map((x) => [x.name, x.targets])]),
      [['swift-case-paths', { kind: 'branch', branch: 'main' }, [['CasePaths', ['SSHDemo']]]]],
    );
    assert.strictEqual(core.requirementLabel(core.packageDependencies(parse(updated))[0].requirement), 'Exactly 1.5.0');
    fs.rmSync(dir, { recursive: true });
  }
}
console.log('All core tests passed.');
assert.strictEqual(core.customDerivedData('', '/Users/me', '/ws', '/ws/App'), undefined);
assert.strictEqual(core.customDerivedData('  ', '/Users/me', '/ws', '/ws/App'), undefined);
assert.strictEqual(core.customDerivedData('/tmp/DD', '/Users/me', '/ws', '/ws/App'), '/tmp/DD');
assert.strictEqual(core.customDerivedData('~/DD', '/Users/me', '/ws', '/ws/App'), '/Users/me/DD');
assert.strictEqual(
  core.customDerivedData('${workspaceFolder}/.build/DD', '/Users/me', '/ws', '/ws/App'),
  '/ws/.build/DD',
);
assert.strictEqual(core.customDerivedData('build/DD', '/Users/me', '/ws', '/ws/App'), '/ws/build/DD');
assert.strictEqual(core.customDerivedData('build/DD', '/Users/me', undefined, '/proj'), '/proj/build/DD');
assert.strictEqual(core.portableDerivedData('/ws/.build/DD', '/ws'), '${workspaceFolder}/.build/DD');
assert.strictEqual(core.portableDerivedData('/ws', '/ws'), '${workspaceFolder}');
assert.strictEqual(core.portableDerivedData('/other/DD', '/ws'), '/other/DD');
assert.strictEqual(core.portableDerivedData('/ws-two/DD', '/ws'), '/ws-two/DD');
assert.strictEqual(core.portableDerivedData('/other/DD', undefined), '/other/DD');
assert.deepStrictEqual(
  core.configurations([
    { project: { configurations: ['Release', 'Debug'] } },
    { project: { configurations: ['Debug', 'Staging'] } },
    { workspace: { schemes: ['App'] } },
  ]),
  ['Debug', 'Release', 'Staging'],
);
assert.deepStrictEqual(core.configurations([]), []);
assert.deepStrictEqual(core.optimizationArgs([], true), []);
assert.deepStrictEqual(core.optimizationArgs(undefined, false), []);
assert.deepStrictEqual(core.optimizationArgs(['parallelTesting', 'noCodeCoverage', 'unknown'], false), []);
assert.deepStrictEqual(core.optimizationArgs(['parallelTesting', 'noCodeCoverage'], true), [
  '-enableCodeCoverage',
  'NO',
  '-parallel-testing-enabled',
  'YES',
]);
assert.deepStrictEqual(
  core.optimizationArgs(['skipValidation', 'noPreviews'], false, (flag) => flag !== '-skipMacroValidation'),
  ['-skipPackagePluginValidation', 'ENABLE_PREVIEWS=NO', 'ENABLE_DEBUG_DYLIB=NO'],
);
assert.strictEqual(
  core.optimizationArgs(
    core.buildOptimizations.map((o) => o.id),
    true,
  ).length,
  11,
);
assert.deepStrictEqual(core.parseList(' AppTests/A \n\nAppTests/B, AppTests/A\n'), ['AppTests/A', 'AppTests/B']);
assert.deepStrictEqual(core.parseList(''), []);
assert.deepStrictEqual(core.parseArguments('-jobs\n 8 \n\nOTHER_SWIFT_FLAGS=-D A B\n'), [
  '-jobs',
  '8',
  'OTHER_SWIFT_FLAGS=-D A B',
]);
assert.deepStrictEqual(core.onlyTestingArgs(['AppTests/A']), ['-only-testing:AppTests/A']);
assert.deepStrictEqual(core.onlyTestingArgs(undefined), []);
assert.strictEqual(core.buildOptionsSummary(0, 0, 0), 'Default');
assert.strictEqual(core.buildOptionsSummary(1, 2, 0), '1 speedup · 2 test filters');
assert.strictEqual(core.buildOptionsSummary(3, 0, 1), '3 speedups · 1 extra arg');
{
  const { buildOptionsHtml } = require('../src/buildOptions');
  const html = buildOptionsHtml('n', {
    optimizations: ['dwarf'],
    onlyTesting: ['<img src=x>'],
    additionalArguments: ['</textarea><script>'],
    preview: ['DEBUG_INFORMATION_FORMAT=dwarf'],
  });
  assert(html.includes('data-id="dwarf" checked'));
  assert(!html.includes('data-id="noCodeCoverage" checked'));
  assert(!html.includes('<img src=x>') && html.includes('&lt;img src=x&gt;'));
  assert(!html.includes('</textarea><script>'));
  assert(html.includes('&quot;DEBUG_INFORMATION_FORMAT=dwarf&quot;'));
}
assert.deepStrictEqual(
  core.workspaceProjects(
    `<?xml version="1.0"?><Workspace version="1.0">
      <FileRef location = "group:App.xcodeproj"></FileRef>
      <FileRef location = "container:Libs/Lib.xcodeproj"></FileRef>
      <FileRef location = "absolute:/abs/Other.xcodeproj"></FileRef>
      <FileRef location = "group:Pods/Pods.xcodeproj"></FileRef>
      <FileRef location = "group:App.xcodeproj"></FileRef>
      <FileRef location = "group:README.md"></FileRef>
    </Workspace>`,
    '/ws/App.xcworkspace',
  ),
  ['/ws/App.xcodeproj', '/ws/Libs/Lib.xcodeproj', '/abs/Other.xcodeproj', '/ws/Pods/Pods.xcodeproj'],
);
assert.strictEqual(core.timestamp(new Date(2026, 0, 2, 3, 4, 5, 6)), '03:04:05.006');
assert.strictEqual(core.duration(0), '0ms');
assert.strictEqual(core.duration(850), '850ms');
assert.strictEqual(core.duration(12_345), '12.3s');
assert.strictEqual(core.duration(125_000), '2m 05s');
assert.strictEqual(core.duration(3_725_000), '1h 02m');
{
  // The output grammar must stay valid JSON with compilable patterns that match what exec() writes.
  const grammar = require(require('path').join(__dirname, '../../syntaxes/vxcode-output.tmLanguage.json'));
  const rule = (name) => new RegExp(grammar.repository[name].match);
  assert(rule('timestamp').test('[14:03:27.042] ** BUILD SUCCEEDED **'));
  assert(rule('command').test('[14:03:27.042] > /usr/bin/xcodebuild "-scheme" "App"'));
  assert(rule('success').test('✔ xcodebuild finished (12.3s)'));
  assert(rule('failure').test('✖ xcodebuild failed with exit code 65 (4.2s)'));
  assert(rule('failure').test("Test Case '-[AppTests.FooTests testBar]' failed (0.010 seconds)."));
  assert(rule('error').test('/tmp/App/View.swift:12:5: error: cannot find x in scope'));
  assert(rule('warning').test('/tmp/App/View.swift:3:1: warning: unused variable'));
  assert(rule('location').test('/tmp/App/View.swift:12:5'));
  assert(rule('step').test('[14:03:27.042] CompileSwift normal arm64 /tmp/App/View.swift'));
  assert(rule('duration').test('✔ xcodebuild finished (2m 05s)'));
  assert(!rule('duration').test('Test Case passed (0.010 seconds).'));
}
assert.strictEqual(core.actionLabel('run'), 'Build & Run');
assert.strictEqual(core.actionLabel('selectScheme'), undefined);
{
  const grammar = require(require('path').join(__dirname, '../../syntaxes/vxcode-output.tmLanguage.json'));
  const rule = (name) => new RegExp(grammar.repository[name].match);
  assert(rule('command').test('[14:03:21.000] ▶ Build & Run started'));
  assert(rule('success').test('✔ Build & Run succeeded — total time (1m 02s)'));
  assert(rule('duration').test('✔ Build & Run succeeded — total time (1m 02s)'));
}
