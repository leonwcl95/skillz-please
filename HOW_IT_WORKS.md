# How skill-gate works

Everything lives in `hooks/register.tsx`. It is a hooks module: it registers handlers for engine events and holds no other code.

## The gate

| Event | What the mod does |
| --- | --- |
| `turn.start` | Resets the "skill used" flag, for the main conversation only (subagent turns do not reset it). |
| `skill.prompt` | Sets the flag. Fires when a skill's prompt is expanded: `/name`, the Skill tool, or a preload. |
| `tool.call` | If the tool is `Skill`, sets the flag. Otherwise, if the tool is one of `Edit`, `Write`, `NotebookEdit`, `Bash` and the flag is not set, returns a denial, records the tool name, and opens the pane. Every other tool passes through untouched. |

The denial text tells the model to invoke a relevant skill first, or to ask you to press **Allow this turn**. Each denial is an extra tool result in the conversation and is usually followed by a retry, so it costs tokens rather than saving them; see [LIMITATIONS.md](LIMITATIONS.md).

The `tool.call` hook has a `.catch` that passes the call through. If the gate itself throws, work is not blocked.

The flag is a plain variable in the module. It resets on a plugin reload and is not saved across sessions.

## The pane

Opened by `/skill-gate`, and automatically on a block. Drawn by a `ui.render` hook for the pane id `skill-gate`.

Plugin list, built each time the pane opens or a plugin is toggled:

- the keys of `enabledPlugins` in `~/.claude/settings.json`, plus
- the keys of `plugins` in `~/.claude/plugins/installed_plugins.json`.

A plugin shows as on only if `enabledPlugins[id]` is exactly `true`. One that is installed but has no entry shows as off.

The home folder is read from `USERPROFILE`, falling back to `HOME`.

## Toggling

Clicking a plugin reads `~/.claude/settings.json`, flips `enabledPlugins[id]`, and writes the whole file back as JSON with two-space indentation. Other settings are preserved, but comments and original formatting in that file are not (it is JSON, rewritten from its parsed form).

Nothing is installed, uninstalled or deleted. Only that one flag changes.

## Animation

The pane redraws in short bursts, one frame every 50 ms, then stops. When nothing is moving, no timer runs.

- **Opening:** about 14 frames. Rows appear one after another, the bar grows into place, and the header sparkle cycles.
- **Toggling:** 4 frames. The marker steps `○ → ◐ → ●` (or back), and the bar updates.
- **A block:** the notice card's border blinks twice.

## State

Stored through the mod's `$.state` (declared in `types/index.d.ts`): the plugin list, the last blocked tool, the animation frame and the toggle in flight. These are session-only.

## Files

| File | Role |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest. |
| `.claude-plugin/marketplace.json` | Makes the repository installable as the `skillz-please` marketplace. |
| `hooks/hooks.json` | Points to the hooks module. |
| `hooks/register.tsx` | All behaviour. |
| `types/index.d.ts` | Type contract for the stored state. |
