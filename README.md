# VXCode

VXCode is a VS Code extension for building and running iOS Simulator apps with Xcode on macOS.

## Requirements

- macOS with Xcode installed and configured.
- VS Code 1.85 or newer.
- An iOS project with a shared application scheme.

## Install

```sh
npm install
npm run package
```

Install the generated `vxcode-*.vsix` file from **Extensions → … → Install from VSIX…**.

## Use

1. Open an iOS project folder in VS Code.
2. Open the VXCode view from the Activity Bar.
3. Select a project, scheme, and simulator.
4. Choose **Build & Run**, **Build only**, or **Run tests**.

The same actions are available from the Command Palette with the `VXCode:` prefix.

## Development

```sh
npm test
npm run check
```

Set `VXCode.developerDirectory` in VS Code settings if multiple Xcode installations are present.

VXCode is independent of Apple and Microsoft and is MIT licensed.
