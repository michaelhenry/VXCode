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
