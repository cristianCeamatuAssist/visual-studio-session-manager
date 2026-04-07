# Changelog

## [0.6.2] - 2026-04-07

### Fixed

- Fix session status stuck on wrong state (Green when Working, Working when idle) caused by session_id mismatch between hook payloads and .json session files — Claude Code changes session_id on /clear but doesn't update the file. Switched to PID-based markers which are stable for process lifetime.
- Clean up legacy UUID-based marker files automatically

## [0.6.1] - 2026-04-06

### Fixed

- Fix hook script not parsing session_id from JSON payloads with spaces after colons, causing sessions to permanently show "Working" instead of transitioning to "Needs Input" or "Done"

## [0.1.0] - 2026-03-27

### Added

- Project sidebar with live Claude Code CLI session status indicators
- Auto-detect projects from Claude session history (`~/.claude/sessions/` and `~/.claude/projects/`)
- Smart window switching with macOS AppleScript window position preservation
- Expandable project nodes showing individual sessions (PID, CPU%, start time)
- Status bar showing total session count with color-coded status
- Add, remove, and rename projects
- Open terminal at project directory
- Configurable polling interval, CPU threshold, and status bar visibility
