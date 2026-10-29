# skillz-please

A Claude Code mod that pauses code-changing tool calls in a turn where no skill was used, and gives you a pane to switch installed plugins on or off. The plugin itself is called `skill-gate`; `skillz-please` is the repository and marketplace name.

The idea: if a turn is about to edit files or run commands without going through any skill, stop and make that a visible, deliberate choice. Fewer enabled plugins also means fewer skill descriptions competing for context. The mod does not measure tokens; it only enforces the pause and makes plugin toggling quick.

## What it does

1. **Gate.** In each turn, if the model calls `Edit`, `Write`, `NotebookEdit` or `Bash` and no skill has been used in that turn, the call is refused with a message telling the model to invoke a relevant skill first. The Skill gate pane opens at the same time.
2. **Pane.** The "Skill gate" pane lists your installed plugins with an on/off marker, a bar showing how many are on, and (after a block) an **Allow this turn** button.
3. **Command.** `/skill-gate` opens the pane at any time.

A turn counts as "using a skill" when the model calls the Skill tool, or when a skill's prompt is expanded (for example by typing `/some-skill`). Pressing **Allow this turn** lets the rest of that turn through. The next turn starts gated again.

## Install

From a terminal session:

```
/plugin install skill-gate --marketplace leonwcl95/skillz-please
```

From a shell:

```
claude plugin install skill-gate --marketplace leonwcl95/skillz-please
```

When asked, answer `y` to add the marketplace, then pick a scope.

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `leonwcl95/skillz-please`, then **Add plugin**.

To try it from a folder without installing, start Claude with `claude --plugin-dir <path to this folder>`.

## Use

- Work as usual. When a code change is attempted without a skill, it is refused and the pane opens.
- Press **Allow this turn** to let that turn proceed, or ask the model to use a skill.
- Click a plugin in the pane to toggle it. The change is written to `~/.claude/settings.json` under `enabledPlugins`, and should take effect after `/reload-plugins` or a restart.

## More

- [HOW_IT_WORKS.md](HOW_IT_WORKS.md): the exact rules, files touched and events used.
- [LIMITATIONS.md](LIMITATIONS.md): what it does not do and what has not been tested.

## License

[MIT](LICENSE)
