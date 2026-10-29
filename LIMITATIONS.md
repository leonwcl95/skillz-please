# Limitations

## What the gate cannot do

- **Replies with no tools are not gated.** It only sees tool calls. A turn that just answers in text goes through, skill or not.
- **A skill call is a weak signal.** Any skill, relevant or not, lifts the gate for the turn. The model could call one only to get past it.
- **It guards four tools only:** `Edit`, `Write`, `NotebookEdit`, `Bash`. Other tools, including MCP tools, are not gated.
- **It does not measure or report tokens.** Whether you save any depends on how you use it.
- **It applies everywhere it is installed**, to every project, with no per-folder setting.

## Plugin toggling

- Toggles edit `~/.claude/settings.json` only. They should apply after `/reload-plugins` or a restart; this has not been confirmed in every setup.
- The settings file is rewritten from its parsed JSON, so comments and original layout in it are lost.
- Plugins whose enabled state is set in a project's or managed settings file are not changed by it and may still show a different state than the one in effect.
- Two editors writing `settings.json` at the same moment can overwrite each other.

## Not tested

- Subagents: whether their tool calls are gated, and whether one skill use in the main turn covers them, is unverified.
- Platforms other than Windows. The home folder lookup supports `HOME` but has not been run on macOS or Linux.
- How the pane looks in every surface (terminal, desktop, VS Code). The glyphs `◐ ● ○ ✦ █ ░` can render as boxes in some fonts.
- Animation smoothness at the 50 ms frame rate in the desktop app.
- Install from a marketplace. It has been run from the session's mods folder only.

## Not included

- Tests. Validation with `claude plugin validate` passed; there is no `*.test.ts`.
