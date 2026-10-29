# skillz-please

A Claude Code mod that holds code-changing tool calls in a turn where no skill was used until you approve them, lets you pick skills and plugins the model should always prefer, and gives you a pane to switch installed plugins on or off. The plugin itself is called `skill-gate`; `skillz-please` is the repository and marketplace name.

The idea: if a turn is about to edit files or run commands without going through any skill, stop and make that a visible, deliberate choice. It adds friction and a plugin switchboard.

## Read this first: it does not save tokens

The gate does not reduce token use, and in practice it usually increases it.

- Each refusal adds the denial message to the conversation, and the model then retries.
- The model is nudged toward invoking a skill, and invoking one loads that skill's full instructions into context. That can be thousands of tokens, and the model may load one only to get past the gate.
- Turns that already use a skill are not gated. Once you pick skills or plugins, the mod adds one short reminder line to the system prompt of every request; with nothing picked it adds nothing. The pane and animations are drawn locally with no model calls.
- The one thing that can lower usage is switching plugins off in the pane: fewer enabled plugins means fewer skill descriptions in each request. That comes from the toggle, not the gate, and has not been measured.

Use it if you want the pause and the switchboard, not as a token saver.

## What it does

1. **Gate.** In each turn, if the model calls `Edit`, `Write`, `NotebookEdit` or `Bash` and no skill has been used in that turn, the call is held. With nothing picked, the turn waits for you to answer in the pane. With skills or plugins picked, the call is refused at once with a message naming your picks, and the model retries after invoking a skill.
2. **Always use.** In the pane, tick skills (■) and star plugins (★). Every request then carries a line telling the model which skills to invoke, and which plugins' skills to prefer. Unpicked skills stay automatic.
3. **Pane.** `/skill-gate` opens it. It has a status line for the gate, an "Always use" summary, and Plugins and Skills tabs. Each tab has a search box and shows up to 12 rows, with a "+N more" line. Plugin rows say `ON` or `OFF` in words. After a block it also shows **Allow this turn**, **Allow for this session** and **Deny**.

A turn counts as "using a skill" when the model calls the Skill tool, or when a skill's prompt is expanded (for example by typing `/some-skill`). Pressing **Allow this turn** lets the rest of that turn through; the next turn starts gated again. **Allow for this session** lets everything through until you press **Turn the gate back on** (not saved across sessions).

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

- Work as usual. When a code change is attempted without a skill, it is held (or refused, if you picked skills) and the pane opens.
- Open `/skill-gate`, choose the Skills tab, and click skills to pick them; star plugins on the Plugins tab. Picks last for the session only.
- Press **Allow this turn** or **Allow for this session** to proceed, **Deny** to refuse, or ask the model to use a skill.
- Click the `ON`/`OFF` part of a plugin row to toggle it. The change is written to `~/.claude/settings.json` under `enabledPlugins`, and should take effect after `/reload-plugins` or a restart.

## More

- [HOW_IT_WORKS.md](HOW_IT_WORKS.md): the exact rules, files touched and events used.
- [LIMITATIONS.md](LIMITATIONS.md): what it does not do and what has not been tested.

## License

[MIT](LICENSE)
