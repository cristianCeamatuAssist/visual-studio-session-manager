# Changelog

## [0.7.1] - 2026-04-08

### Changed

- Updated README to reflect current feature set: auto-discovery, hooks-based detection, new color system, focused indicator
- Filled in missing CHANGELOG entries for all versions
- Removed `cpuThreshold` configuration setting (hooks-based detection doesn't use it)

## [0.7.0] - 2026-04-07

### Changed

- **Green for "Needs Input"**: Swapped from red to green — green = "your turn, go ahead"
- **White border on focused session**: Current window's status dot now has a white ring for quick identification
- **Removed "Done" state**: Simplified to 2 states (Working/Needs Input) + gray for no session

### Fixed

- Fix session status stuck on wrong state caused by session_id mismatch — switched to PID-based markers which are stable for process lifetime
- Clean up legacy UUID-based marker files automatically

## [0.6.1] - 2026-04-06

### Fixed

- Fix hook script not parsing session_id from JSON payloads with spaces after colons, causing sessions to permanently show "Working"

## [0.6.0] - 2026-04-06

### Added

- **Drag-and-drop reordering** — drag projects in the sidebar to arrange them in your preferred order (persisted across sessions)

## [0.5.0] - 2026-04-06

### Changed

- **Auto-discover open VS Code windows** — replaced manual project management with a shared workspace registry at `~/.claude/vscode-workspaces/`
- Each VS Code window registers itself automatically; all instances stay in sync via file watchers
- Removed manual Add/Remove/Rename project commands (replaced by "Open New Project")
- Stale registry entries are cleaned up automatically when processes exit

## [0.3.0] - 2026-03-27

### Added

- **Hooks-first detection** — optional CLI hooks for instant status updates without CPU polling
- 5 hook lifecycle events: Stop, PreToolUse, UserPromptSubmit, Notification (idle), SessionEnd
- Hooks mode uses marker files for detection, skipping CPU-based polling entirely
- Adjusted polling interval to 5s when hooks are installed (vs 3s default)

### Changed

- **3-state color system**: orange (working), red (needs input), green (done)

## [0.2.3] - 2026-03-27

### Changed

- Use Node.js 24 in CI

## [0.2.1] - 2026-03-27

### Added

- VS Code Marketplace publishing with GitHub Actions CI/CD

### Fixed

- Version-scope hook suggestion key so the install prompt shows again after upgrades

## [0.2.0] - 2026-03-27

### Added

- Improved session status detection with debounced CPU readings and child process aggregation
- CLI hooks integration for instant status updates
- One-time prompt to install hooks on first activation

## [0.1.0] - 2026-03-27

### Added

- Project sidebar with live Claude Code CLI session status indicators
- Auto-detect projects from Claude session history
- Smart window switching with macOS AppleScript window position preservation
- Expandable project nodes showing individual sessions (PID, CPU%, start time)
- Status bar showing total session count with color-coded status
- Add, remove, and rename projects
- Open terminal at project directory
- Configurable polling interval, CPU threshold, and status bar visibility
