# skillz-please

A Claude Code mod that holds code-changing tool calls in a turn where no skill was used until you approve them, lets you save named profiles of skills and plugins the model should always prefer, and gives you a pane to switch installed plugins on or off. The plugin itself is called `skill-gate`; `skillz-please` is the repository and marketplace name.

## Two modes

- **Advise (the default).** Nothing is ever held. The reminder on every request lists what you picked and tells the model to use one **only if it clearly fits** the request, and never just to satisfy the note. The model reads your picks and decides each turn; a question or a small edit goes without a skill.
- **Gate.** The original behavior below: a code-changing call in a turn with no skill is held or refused until a skill is used or you allow it. Switch with the **Mode** button at the top of the pane; the choice is saved.

A preferred plugin (◆) already covers all of its skills, so skills you also picked inside it are dropped from the reminder and the pane shows "◆ covers all" on that group. Pick a plugin to say "anything from here", or single skills to say "only these", not both.

## The pane, as of 0.7

- No star icons: a preferred plugin is marked ◆, an unmarked one ◇, a picked skill ✓.
- **Plugins sort by what matters:** preferred first, then switched on, then by name, so your picks are in the first rows instead of behind "+N more". Each row shows how many times a skill from that plugin ran.
- **The rule** is a two-button switch: **Free choice** (advise mode) or **Skill required** (gate mode), with one plain sentence under the title saying what Claude will do.
- One card shape throughout: 2 columns and 1 row of padding inside the border, 1 row between items, button groups 1 column apart. Long pick lists wrap instead of running off the edge.

## The ledger

Every time a skill actually runs (the Skill tool, or `/name`), the mod counts it. The Profile card shows each pick with its count (`◆ caveman 12`), and a pick that has **never run** since the ledger began is listed in yellow with a **Drop N unused** button. Each pick rides in every request, so dropping dead ones is the one thing here that lowers cost. A preferred plugin counts every skill under that plugin. Counts are kept across sessions, for all profiles together, and start the first time a skill runs after updating.

The rest of this page describes the gate mode.

## Read this first: it does not save tokens

The gate does not reduce token use, and in practice it usually increases it. Advise mode costs only the reminder line.

- Each refusal adds the denial message to the conversation, and the model then retries.
- The model is nudged toward invoking a skill, and invoking one loads that skill's full instructions into context. That can be thousands of tokens, and the model may load one only to get past the gate.
- Turns that already use a skill are not gated. Once you pick skills or plugins, the mod adds one short reminder line to the system prompt of every request; with nothing picked it adds nothing. The pane and animations are drawn locally with no model calls.
- The one thing that can lower usage is switching plugins off in the pane: fewer enabled plugins means fewer skill descriptions in each request. That comes from the toggle, not the gate, and has not been measured.

Use it if you want the pause and the switchboard, not as a token saver.

## What it does

1. **Gate.** In each turn, if the model calls `Edit`, `Write`, `NotebookEdit` or `Bash` and no skill has been used in that turn, the call is held. With nothing picked, the turn waits for you to answer in the pane. With skills or plugins picked, the call is refused at once with a message naming your picks, and the model retries after invoking a skill. A held call that gets no answer in 2 minutes is denied, and a toast tells you a call is waiting. A single read-only Bash command (`ls`, `pwd`, `cat`, `head`, `tail`, `wc`, `grep`, `rg`, and `git status`/`log`/`diff`/`show`/`branch`, with no chaining or redirects) passes without a skill.
2. **Profiles.** A profile is a named set of picked skills and preferred plugins (◆), for example "Design" or "Review". Switch with one click; the active profile's picks go into a reminder line on every request, telling the model which skills to invoke and which plugins' skills to prefer. Unpicked skills stay automatic. Profiles are saved across sessions. Past 5 picks the pane warns that the reminder is getting long.
3. **Pane.** `/skill-gate` opens it. It has a status line for the gate, a Profile card, and Plugins and Skills tabs. Each tab has a search box. Plugins show up to 12 rows, with a "+N more" line; skills are grouped under collapsible plugin headers. Plugin rows say `ON` or `OFF` in words. After a block it also shows **Allow this turn**, **Allow for this session** and **Deny**.

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
- Open `/skill-gate`, choose the Skills tab, and open a plugin group and click skills to pick them; mark plugins as preferred (◆) on the Plugins tab. Picks go into the active profile.
- Press **Allow this turn** or **Allow for this session** to proceed, **Deny** to refuse, or ask the model to use a skill.
- Click the `ON`/`OFF` part of a plugin row to toggle it. The change is written to `~/.claude/settings.json` under `enabledPlugins`, and should take effect after `/reload-plugins` or a restart.

## More

- [HOW_IT_WORKS.md](HOW_IT_WORKS.md): the exact rules, files touched and events used.
- [LIMITATIONS.md](LIMITATIONS.md): what it does not do and what has not been tested.

## License

[MIT](LICENSE)
