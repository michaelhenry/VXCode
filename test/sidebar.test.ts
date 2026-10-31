'use strict';
export {};
const assert = require('assert');
const Module = require('module');
const vm = require('vm');
const original = Module._load;
const commands: string[] = [];
Module._load = function (name, ...args) {
  return name === 'vscode'
    ? { commands: { executeCommand: (c) => commands.push(c) } }
    : original.call(this, name, ...args);
};
const { Sidebar } = require('../src/sidebar');
Module._load = original;
let receiver, posted;
const view = {
  webview: {
    html: '',
    onDidReceiveMessage: (fn) => {
      receiver = fn;
      return { dispose() {} };
    },
    postMessage: (s) => {
      posted = s;
    },
  },
  onDidChangeVisibility: () => ({ dispose() {} }),
  onDidDispose() {},
};
const sidebar = new Sidebar({}, () => ({
  project: '/tmp/My App.xcodeproj',
  scheme: 'App',
  device: { name: 'iPhone', udid: 'UUID', runtime: 'iOS' },
  configuration: 'Debug',
  busy: false,
  status: 'Ready',
}));
sidebar.resolveWebviewView(view);
assert.strictEqual(posted.project, 'My App.xcodeproj');
assert.strictEqual(posted.device, 'iPhone');
receiver({ action: 'run' });
receiver({ action: 'test' });
receiver({ action: 'toggleDebugger' });
receiver({ action: 'clean' });
receiver({ action: 'archive' });
receiver({ action: 'arbitraryCommand' });
receiver(null);
assert.deepStrictEqual(commands, [
  'VXCode.run',
  'VXCode.test',
  'VXCode.toggleDebugger',
  'VXCode.clean',
  'VXCode.archive',
]);
const scriptMatch = view.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Sidebar HTML must contain its webview script.');
const script = scriptMatch[1];
const elements = new Map();
const element = (id) => {
  if (!elements.has(id))
    elements.set(id, {
      setAttribute(k, v) {
        this[k] = v;
      },
    });
  return elements.get(id);
};
let update;
const context = {
  acquireVsCodeApi: () => ({ postMessage() {} }),
  document: { querySelectorAll: () => [], getElementById: element },
  window: {
    addEventListener: (_, fn) => {
      update = fn;
    },
  },
};
vm.runInNewContext(script, context);
update({ data: posted });
assert.strictEqual(element('project').textContent, 'My App.xcodeproj');
assert.strictEqual(element('debug')['aria-checked'], 'false');
update({ data: { ...posted, debug: true } });
assert.strictEqual(element('debug')['aria-checked'], 'true');
update({ data: { ...posted, busy: true, error: '<script>bad</script>', status: 'Building' } });
assert.strictEqual(element('error').textContent, '<script>bad</script>');
assert.strictEqual(element('cancel').hidden, false);
assert.strictEqual(element('status').className, 'status busy');
console.log('Sidebar rendering and command routing passed.');
