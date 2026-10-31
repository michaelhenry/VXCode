# Contributing

VXCode is a VS Code extension for building and running iOS Simulator apps with Xcode on macOS. Use Node.js and npm for development. macOS and full Xcode are required for real Xcode builds; the unit tests themselves can run on other platforms.

## Setup

```sh
npm install
```

This installs TypeScript, Prettier, and the VS Code type definitions used by the project. Run setup before using any other npm script; otherwise commands such as `npm test` may fail with `tsc: command not found`.

## Check, test, format, and package

```sh
npm run format
npm run check
npm test
npm run package
```

`npm run format` applies the repository’s Prettier configuration. `npm run check` type-checks the project, while `npm test` compiles the TypeScript and runs the core and sidebar tests.

## Development

Open this directory in VS Code and press F5 to start an Extension Development Host. Open an iOS project in that window and click VXCode in the Activity Bar.

- `src/extension.ts`: commands, Xcode subprocesses, selections, and build/run/test flow.
- `src/core.ts`: typed argument construction and parsing helpers.
- `src/sidebar.ts`: themed sidebar, state updates, and restricted command messages.
- `test/`: core and sidebar tests with a mocked VS Code API.
- `scripts/package.py`: local VSIX builder.
- `media/`: extension icons and Activity Bar glyph.

Keep the `VXCode.*` command and setting identifiers compatible. Use argument arrays rather than shell command interpolation. Add focused tests for behavior changes. Include Xcode and VS Code versions plus relevant redacted output when reporting a bug; do not include credentials or private project contents.

Before a release, complete the README manual acceptance checklist on macOS. Unit tests and the GitHub workflow do not exercise real Xcode projects or simulators.
