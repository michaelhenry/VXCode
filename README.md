 <img width="705" height="573" alt="Screenshot 2026-10-31 at 9 19 27 pm" src="https://github.com/user-attachments/assets/948fd943-b469-4117-9c42-022fcd7ac704" />


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

Or build and install in one step (requires the `code` command in your `PATH`):

```sh
npm run install:local
```

Then run **Developer: Reload Window** (or **Developer: Restart Extension Host**) from the Command Palette. VS Code does not
prompt for a reload when the reinstalled version number is unchanged, so open windows keep running the old copy until
reloaded.

## Use

1. Open an iOS project folder in VS Code.
2. Open the VXCode view from the Activity Bar.
3. Select a project, scheme, and simulator.
4. Choose **Build & Run**, **Build only**, or **Run tests**.

**Clean build folder** runs `xcodebuild clean` for the selected scheme and simulator. **Archive for device** builds a
`generic/platform=iOS` archive with the scheme's Archive configuration and saves it under
`~/Library/Developer/Xcode/Archives`, where Xcode's Organizer lists it for distribution. Archiving needs working code
signing for the scheme.

The same actions are available from the Command Palette with the `VXCode:` prefix.

## Development

```sh
npm test
npm run check
```

Press **F5** (**Run VXCode**) to compile in watch mode and open an Extension Development Host. After saving changes,
press **Cmd+R** in that window to reload it.

Set `VXCode.developerDirectory` in VS Code settings if multiple Xcode installations are present.

VXCode is independent of Apple and Microsoft and is MIT licensed.
