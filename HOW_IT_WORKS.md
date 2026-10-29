# How skill-gate works

Everything lives in `hooks/register.tsx`. It is a hooks module: it registers handlers for engine events and holds no other code.

## The gate

| Event | What the mod does |
| --- | --- |
| `turn.start` | Resets the "skill used" flag, for the main conversation only (subagent turns do not reset it). |
| `skill.prompt` | Sets the flag. Fires when a skill's prompt is expanded: `/name`, the Skill tool, or a preload. |
| `tool.call` | If the tool is `Skill`, sets the flag. Otherwise, if the tool is one of `Edit`, `Write`, `NotebookEdit`, `Bash` and neither the turn flag nor the session allowance is set: a single read-only Bash command (matched by a regex: `ls`, `pwd`, `cat`, `head`, `tail`, `wc`, `grep`, `rg`, `git status|log|diff|show|branch`; no `;`, `|`, `&`, `>`, `<`, backticks, `$`, parentheses or `--output`) passes; with skills or plugins picked, returns a denial naming them; with none picked, records the tool name, opens the pane, shows a toast and holds the call for up to 2 minutes, then denies it. Every other tool passes through untouched. |
| `session.start` | Loads the saved profiles and the active one from the mod's store, and registers `/skill-gate`. |
| `turn.complete` | Refreshes the skill list from the exact `/context` data. |
| `prompt.compose` | When the active profile has skills or plugins, adds one `session` section to the system prompt asking the model to invoke the picked skills, and to prefer the picked plugins' skills. Adds nothing when nothing is picked. |

With nothing picked, the call is held (the hook waits) until you press a pane button: **Allow this turn** or **Allow for this session** lets it run; **Deny** returns a denial to the model, which may retry, costing tokens; see [LIMITATIONS.md](LIMITATIONS.md). A new turn starting while a call is held denies it.

The `tool.call` hook has a `.catch` that passes the call through. If the gate itself throws, work is not blocked.

The flag is a plain variable in the module. It resets on a plugin reload and is not saved across sessions.

## The pane

Opened by `/skill-gate`, and automatically on a block. Drawn by a `ui.render` hook for the pane id `skill-gate`.

Plugin list, built each time the pane opens or a plugin is toggled:

- the keys of `enabledPlugins` in `~/.claude/settings.json`, plus
- the keys of `plugins` in `~/.claude/plugins/installed_plugins.json`.

Skill list: `$.session.usage({ breakdown: 'summary' })` (the free local `/context` estimate), minus skills whose source is `built-in`. Plugin skills are named `plugin:skill`; a bare name that also exists as `plugin:name` is dropped as a duplicate. Before the first response that breakdown does not exist, so the list falls back to `$.command.list()` (plugin and user commands, which includes a plugin's skills and also its plain commands) until the first turn ends. The Skills tab groups skills by the part before the colon, and `(own)` for skills with none.

A plugin shows as on only if `enabledPlugins[id]` is exactly `true`. One that is installed but has no entry shows as off.

The home folder is read from `USERPROFILE`, falling back to `HOME`.

## Toggling

Clicking a plugin reads `~/.claude/settings.json`, flips `enabledPlugins[id]`, and writes the whole file back as JSON with two-space indentation. Other settings are preserved, but comments and original formatting in that file are not (it is JSON, rewritten from its parsed form).

Nothing is installed, uninstalled or deleted. Only that one flag changes.

## Animation

The pane redraws in short bursts, one frame every 50 ms, then stops. When nothing is moving, no timer runs.

- **Opening:** about 14 frames; the header sparkle cycles.
- **Toggling:** 4 frames. The marker steps `○ → ◐ → ●` (or back).
- **A block:** the notice card's border blinks twice.

## State

Stored through the mod's `$.state` (declared in `types/index.d.ts`): the plugin list, the skill list, the picked skills and plugins, the search text and tab, the session allowance, the last blocked tool, the animation frame and the toggle in flight. The profiles and the active profile are also saved to the mod's `$.store`, so they survive restarts; everything else is session-only.

## Files

| File | Role |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest. |
| `.claude-plugin/marketplace.json` | Makes the repository installable as the `skillz-please` marketplace. |
| `hooks/hooks.json` | Points to the hooks module. |
| `hooks/register.tsx` | All behaviour. |
| `types/index.d.ts` | Type contract for the stored state. |
