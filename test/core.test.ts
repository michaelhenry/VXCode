'use strict';
export {};
const assert = require('assert');
const core = require('../src/core');
assert.deepStrictEqual(core.projectArgs('/tmp/My App.xcworkspace'), ['-workspace', '/tmp/My App.xcworkspace']);
assert.deepStrictEqual(core.projectArgs('/tmp/App.xcodeproj'), ['-project', '/tmp/App.xcodeproj']);
const args = core.buildArgs('/tmp/My App.xcodeproj', 'App Tests', 'UUID', 'Debug', '/tmp/Build Data');
assert(args.includes('platform=iOS Simulator,id=UUID'));
assert(args.includes('/tmp/My App.xcodeproj'));
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
console.log('All core tests passed.');
