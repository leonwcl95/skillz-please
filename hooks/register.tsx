import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Flip, PluginRow, Profile } from '../types'

const PANE = 'skill-gate'
const GATED = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash'])
const REST = 999
const MAX = 12 // plugin rows shown; search narrows the rest
const SOFT_CAP = 5 // picks beyond this make every request's reminder noticeably longer
const HOLD_MS = 120_000 // a held call is denied after this long unanswered
const TICK = 50 // ms per frame: glyph steps stay in the 30-80ms range
const SPARK = ['✦', '✧', '⋆', '✧']
const TO_ON = ['○', '◐', '●']
const TO_OFF = ['●', '◐', '○']
// One read-only command, no chaining, no redirects, no `--output` file writes.
// shortcut: a regex, not a shell parser; paths with parentheses are not matched, widen when it annoys.
const SAFE = /^\s*(ls|pwd|cat|head|tail|wc|grep|rg|git\s+(status|log|diff|show|branch))\b(?!.*--output)[^;&|><`$()\n]*$/
const EMPTY: Profile = { skills: [], plugins: [] }

export type Mode = 'advise' | 'gate'

// A starred plugin already covers all of its skills, so a pick inside one adds nothing.
export function effective(p: Profile): Profile {
  return { plugins: p.plugins, skills: p.skills.filter(s => !p.plugins.includes(s.split(':')[0])) }
}

// The ledger of skills that actually ran, by the name the engine reported. `since` dates it.
export type Usage = Record<string, { n: number; last: number }>
export type Ledger = { since: number; uses: Usage }

export const bump = (u: Usage, skill: string, now: number): Usage => ({ ...u, [skill]: { n: (u[skill]?.n ?? 0) + 1, last: now } })

// A plugin pick counts every skill under it; a skill pick counts its own name, bare or `plugin:skill`.
export function uses(u: Usage, pick: string, isPlugin: boolean): number {
  const tail = pick.split(':').pop()
  return Object.entries(u).reduce((t, [k, v]) => t + (k === pick || (isPlugin ? k.startsWith(`${pick}:`) : k.split(':').pop() === tail) ? v.n : 0), 0)
}

/** The picks that never ran, with a starred plugin's covered skills left out as `effective` does. */
export function unused(p: Profile, u: Usage): Profile {
  const e = effective(p)
  return { plugins: e.plugins.filter(n => uses(u, n, true) === 0), skills: e.skills.filter(s => uses(u, s, false) === 0) }
}

async function readLedger($: any): Promise<Ledger> {
  const l = (await $.store.get('usage').catch(() => undefined)) as Ledger | undefined
  return l && typeof l.since === 'number' && l.uses ? l : { since: 0, uses: {} }
}

async function record($: any, skill: string) {
  const l = await readLedger($)
  const now = await $.clock.now()
  await $.store.set('usage', { since: l.since || now, uses: bump(l.uses, skill, now) })
}

/** The line added to every request, or null when nothing is picked. Advise leaves the choice to the model; gate asks for a skill every turn. */
export function reminder(p: Profile, mode: Mode): string | null {
  const { skills, plugins } = effective(p)
  if (skills.length === 0 && plugins.length === 0) return null
  if (mode === 'advise') {
    const list = [...skills, ...plugins.map(n => `any ${n} skill`)].join(', ')
    return `The person favors these skills: ${list}. For each request, check whether one clearly fits and invoke it with the Skill tool only if it does. If none fits, or the request is a question or a small edit, go without one. Never invoke a skill just to satisfy this note.`
  }
  const parts = []
  if (skills.length > 0) parts.push(`The person chose these skills for this session: ${skills.join(', ')}. Invoke the relevant one with the Skill tool before you change code or run commands, every turn, without being asked.`)
  if (plugins.length > 0) parts.push(`The person chose these plugins to always prefer: ${plugins.join(', ')}. When one of their skills fits the task, invoke it with the Skill tool.`)
  return parts.join(' ')
}

const plugins = atom({ plugin: 'skill-gate', key: 'plugins' } as const, [], { shape: 'plugins-1' })
const blocked = atom({ plugin: 'skill-gate', key: 'blocked' } as const, null, { shape: 'blocked-1' })
const frame = atom({ plugin: 'skill-gate', key: 'frame' } as const, REST, { shape: 'frame-1' })
const flip = atom({ plugin: 'skill-gate', key: 'flip' } as const, null, { shape: 'flip-1' })
const skills = atom({ plugin: 'skill-gate', key: 'skills' } as const, [], { shape: 'skills-1' })
const profiles = atom({ plugin: 'skill-gate', key: 'profiles' } as const, { Default: EMPTY }, { shape: 'profiles-1' })
const active = atom({ plugin: 'skill-gate', key: 'active' } as const, 'Default', { shape: 'active-1' })
const openGroups = atom({ plugin: 'skill-gate', key: 'openGroups' } as const, [], { shape: 'openGroups-1' })
const newName = atom({ plugin: 'skill-gate', key: 'newName' } as const, '', { shape: 'newName-1' })
const query = atom({ plugin: 'skill-gate', key: 'query' } as const, '', { shape: 'query-1' })
const tabAtom = atom({ plugin: 'skill-gate', key: 'tab' } as const, 'plugins', { shape: 'tab-1' })
const session = atom({ plugin: 'skill-gate', key: 'session' } as const, false, { shape: 'session-1' })
const modeAtom = atom({ plugin: 'skill-gate', key: 'mode' } as const, 'advise', { shape: 'mode-1' })

let stop: (() => void) | undefined

const flipIn = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

// Runs `frames` ticks from 0 then rests: the timer only lives during a burst, so an idle pane never redraws.
async function play($: any, frames: number) {
  stop?.()
  await update($, frame, () => 0)
  const timer = $.clock.every(TICK, async () => {
    let f = 0
    await update($, frame, (v: number) => (f = v + 1))
    if (f >= frames) {
      timer.cancel()
      await update($, frame, () => REST)
    }
  })
  stop = () => timer.cancel()
}

async function settingsPath($: any) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return `${home}/.claude/settings.json`
}

async function load($: any) {
  const file = await settingsPath($)
  const json = JSON.parse(await $.fs.read(file).catch(() => '{}'))
  const ids = new Set<string>(Object.keys(json.enabledPlugins ?? {}))
  const installed = JSON.parse(
    await $.fs
      .read(file.replace('settings.json', 'plugins/installed_plugins.json'))
      .catch(() => '{}'),
  )
  for (const id of Object.keys(installed.plugins ?? {})) ids.add(id)
  const rows: PluginRow[] = [...ids].sort().map(id => ({ id, isOn: json.enabledPlugins?.[id] === true }))
  await update($, plugins, () => rows)
}

// Names the Skill tool accepts: `plugin:skill` for plugin skills, the bare name otherwise.
// A bare name that also exists as `plugin:name` is the same skill listed twice, so it is dropped.
async function loadSkills($: any) {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  const list: any[] = usage?.context?.breakdown?.skills?.skillFrontmatter ?? []
  let names: string[] = list
    .filter(s => s.source !== 'built-in')
    .map(s => (s.pluginName && !s.name.includes(':') ? `${s.pluginName}:${s.name}` : s.name))
  // The /context breakdown does not exist before the first response. Slash commands do, and a plugin's
  // skills are among them (so are its plain commands: shortcut, the list is rough until the first turn ends).
  if (names.length === 0) {
    const cmds: any[] = await $.command.list().catch(() => [])
    names = cmds.filter(c => c.source === 'plugin' || c.source === 'user').map(c => c.name)
  }
  const unique = [...new Set(names)].filter(n => n.includes(':') || !names.some(m => m.endsWith(`:${n}`)))
  await update($, skills, () => unique.sort())
}

// Profiles live across sessions in the mod's store.
async function saveProfiles($: any) {
  await $.store.set('profiles', { profiles: await read($, profiles), active: await read($, active) })
}

async function setMode($: any, m: Mode) {
  await update($, modeAtom, () => m)
  await $.store.set('mode', m)
}

async function loadProfiles($: any) {
  if ((await $.store.get('mode').catch(() => undefined)) === 'gate') await update($, modeAtom, () => 'gate')
  const saved = (await $.store.get('profiles').catch(() => undefined)) as
    | { profiles: Record<string, Profile>; active: string }
    | undefined
  if (!saved || Object.keys(saved.profiles).length === 0) return
  await update($, profiles, () => saved.profiles)
  await update($, active, () => (saved.profiles[saved.active] ? saved.active : Object.keys(saved.profiles)[0]))
}

async function current($: any): Promise<Profile> {
  return (await read($, profiles))[await read($, active)] ?? EMPTY
}

// Change the active profile's picks and save.
async function edit($: any, fn: (p: Profile) => Profile) {
  const name = await read($, active)
  await update($, profiles, (ps: Record<string, Profile>) => ({ ...ps, [name]: fn(ps[name] ?? EMPTY) }))
  await saveProfiles($)
}

async function switchTo($: any, name: string) {
  await update($, active, () => name)
  await saveProfiles($)
}

async function addProfile($: any, raw: string) {
  const name = raw.trim()
  if (name === '') return
  await update($, profiles, (ps: Record<string, Profile>) => (ps[name] ? ps : { ...ps, [name]: EMPTY }))
  await update($, newName, () => '')
  await switchTo($, name)
}

async function dropProfile($: any) {
  const name = await read($, active)
  const rest = Object.fromEntries(Object.entries(await read($, profiles)).filter(([k]) => k !== name))
  if (Object.keys(rest).length === 0) return // always keep one
  await update($, profiles, () => rest)
  await switchTo($, Object.keys(rest)[0])
}

async function toggle($: any, id: string) {
  const file = await settingsPath($)
  const json = JSON.parse(await $.fs.read(file).catch(() => '{}'))
  const to = json.enabledPlugins?.[id] !== true
  json.enabledPlugins = { ...json.enabledPlugins, [id]: to }
  await $.fs.write(file, JSON.stringify(json, null, 2))
  const f: Flip = { id, to }
  await update($, flip, () => f)
  await load($)
  await play($, 4)
}

async function show($: any) {
  await load($)
  await loadSkills($)
  await $.ui.open({ id: PANE, title: 'Skill gate' })
  await play($, 14)
}

export const register: Register = on => {
  // Per-turn: true once a skill ran, or the person pressed "Allow this turn".
  let isAllowed = false
  // Per-session: set by "Allow for this session"; survives turns until revoked.
  let isSession = false
  // Tool calls parked until the person answers in the pane.
  const waiting: Array<(d: 'allow' | 'deny') => void> = []
  const release = (d: 'allow' | 'deny') => waiting.splice(0).forEach(r => r(d))

  on('session.start', async ($, e, next) => {
    await loadProfiles($)
    await $.command.register({
      name: 'skill-gate',
      description: 'Show installed plugins and toggle them on or off',
    })
    return next(e)
  })

  on('command.run', { command: 'skill-gate' }, async $ => {
    await show($)
    return { text: 'Skill gate pane opened.' }
  })

  // Tell the model about the active profile's skills and plugins in every request of the session.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const text = reminder(await current($), await read($, modeAtom))
    if (text === null) return r
    return { sections: [...r.sections, { id: 'skill-gate:picked', text, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      isAllowed = false
      release('deny') // a new turn means the parked call is stale
    }
    return next(e)
  })

  // Swap the rough pre-first-turn list for the exact one as soon as a response exists.
  on('turn.complete', async ($, e, next) => {
    await loadSkills($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    isAllowed = true
    await record($, e.skill)
    return next(e)
  }).catch(($, e, next) => next(e)) // a ledger failure must not stop the skill

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Skill') isAllowed = true
    // Advise mode never holds a call: the reminder informs the model and it decides.
    if (isAllowed || isSession || !GATED.has(e.tool) || (await read($, modeAtom)) === 'advise') return next(e)
    if (e.tool === 'Bash' && SAFE.test(String((e as any).command ?? ''))) return next(e)

    // Picked skills mean approval is implied: tell the model which to use and let it retry.
    const p = await current($)
    const chosen = [...p.skills, ...p.plugins.map(n => `a ${n} skill`)]
    if (chosen.length > 0) {
      return { deny: `skill-gate: invoke one of the skills the person chose (${chosen.join(', ')}) with the Skill tool, then retry.` }
    }

    // Park the call: the turn really waits here until a pane button answers, or the hold times out.
    await update($, blocked, () => e.tool)
    void show($)
    $.ui.toast('skill-gate: a call is waiting for your answer')
    await $.ui.status('skill-gate: waiting for your approval in the Skill gate pane')
    let timedOut = false
    const d = await Promise.race([
      new Promise<'allow' | 'deny'>(res => waiting.push(res)),
      $.clock.sleep(HOLD_MS).then(() => {
        timedOut = true
        return 'deny' as const
      }),
    ])
    await $.ui.status(undefined)
    await update($, blocked, () => null)
    if (d === 'allow') return next(e)
    return {
      deny: timedOut
        ? 'skill-gate: no answer from the person in 2 minutes. Invoke a relevant skill or ask them how to proceed.'
        : 'skill-gate: the person declined this call. Invoke a relevant skill or ask them how to proceed.',
    }
  }).catch(($, e, next) => next(e)) // fail open: a broken gate must not stop work

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const rows = await read($, plugins)
    const last = await read($, blocked)
    const f = await read($, frame)
    const fl = await read($, flip)
    const isSess = await read($, session)
    const all = await read($, skills)
    const profs = await read($, profiles)
    const act = await read($, active)
    const open = await read($, openGroups)
    const name = await read($, newName)
    const q = await read($, query)
    const tab = await read($, tabAtom)
    const prof = profs[act] ?? EMPTY
    const mode = await read($, modeAtom)
    const ledger = await readLedger($)
    const dead = unused(prof, ledger.uses)
    const deadCount = dead.plugins.length + dead.skills.length
    const eff = effective(prof)
    const picks = eff.skills.length + eff.plugins.length
    const isMoving = f < REST
    const onCount = rows.filter(r => r.isOn).length
    // The border blinks yellow twice when a call is blocked, then stays steady.
    const warn = !isMoving || f % 4 < 2 ? 'yellow' : undefined
    const needle = q.trim().toLowerCase()
    const match = (s: string) => needle === '' || s.toLowerCase().includes(needle)
    const toggleSkill = (v: string) => edit($, p => ({ ...p, skills: flipIn(p.skills, v) }))
    const togglePlugin = (v: string) => edit($, p => ({ ...p, plugins: flipIn(p.plugins, v) }))
    const toggleGroup = (g: string) => update($, openGroups, (l: string[]) => flipIn(l, g))
    const pickTab = async (t: string) => {
      await update($, tabAtom, () => t)
      await update($, query, () => '')
    }

    const plugRows = rows.filter(r => match(r.id))
    const hidden = Math.max(0, plugRows.length - MAX)
    // Skills grouped by their plugin; no colon means one of your own.
    const groups = new Map<string, string[]>()
    for (const s of all.filter(match)) {
      const g = s.includes(':') ? s.split(':')[0] : '(own)'
      groups.set(g, [...(groups.get(g) ?? []), s])
    }
    const groupList = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))

    const gate = mode === 'advise'
      ? { color: 'cyan', text: picks > 0 ? `Claude knows your favorites (${act}) and uses one only when it helps.` : 'No favorites picked yet. Claude uses skills on its own.' }
      : isSess
      ? { color: 'green', text: 'The gate is off for this session: Claude can edit freely.' }
      : picks > 0
        ? { color: 'cyan', text: `Claude must use a skill before it edits or runs anything. Your favorites (${act}) are suggested.` }
        : { color: 'yellow', text: 'Claude must use a skill before it edits or runs anything, or you approve it here.' }
    // One card shape for the whole pane: 2 columns and 1 row inside the border, 1 row between children.
    const card = { borderStyle: 'round', paddingX: 2, paddingY: 1, gap: 1, flexDirection: 'column' } as const
    // Preferred first, then switched on, then by name, so what matters is in the first rows, not behind "+N more".
    const rank = (r: PluginRow) => (prof.plugins.includes(r.id.split('@')[0]) ? 0 : 2) + (r.isOn ? 0 : 1)
    const ordered = [...plugRows].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
    const chips = [
      ...eff.plugins.map(p => ({ key: `p-${p}`, mark: '◆', text: p, n: uses(ledger.uses, p, true), color: 'cyan' })),
      ...eff.skills.map(s => ({ key: `s-${s}`, mark: '✓', text: s, n: uses(ledger.uses, s, false), color: undefined })),
    ]
    const runs = (n: number) => (n === 0 ? 'never ran' : `${n} run${n === 1 ? '' : 's'}`)

    return (
      <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
        <Box flexDirection="column">
          <Box>
            <Text color="magenta" bold>
              {isMoving ? SPARK[f % SPARK.length] : '✦'}{' '}
            </Text>
            <Text bold>Skill gate</Text>
          </Box>
          <Text color={gate.color}>● {gate.text}</Text>
        </Box>

        <Box gap={1} alignItems="center">
          <Text dimColor>Rule</Text>
          <Button key="m-advise" variant={mode === 'advise' ? 'primary' : undefined} onPress={() => setMode($, 'advise')}>
            Free choice
          </Button>
          <Button key="m-gate" variant={mode === 'gate' ? 'primary' : undefined} onPress={() => setMode($, 'gate')}>
            Skill required
          </Button>
          <Text dimColor>{mode === 'advise' ? 'Claude picks a skill only if it helps' : 'nothing runs until a skill is used'}</Text>
        </Box>

        {last !== null && (
          <Box {...card} borderColor={warn}>
            <Text color="yellow" bold>
              Paused · {last}
            </Text>
            <Text dimColor>No skill was used this turn. The turn is waiting for you.</Text>
            <Box gap={1}>
              <Button
                key="allow"
                variant="primary"
                onPress={async () => {
                  isAllowed = true
                  await update($, blocked, () => null)
                  release('allow')
                }}
              >
                Allow this turn
              </Button>
              <Button
                key="session"
                onPress={async () => {
                  isSession = true
                  await update($, session, () => true)
                  await update($, blocked, () => null)
                  release('allow')
                }}
              >
                Allow for this session
              </Button>
              <Button
                key="deny"
                onPress={async () => {
                  await update($, blocked, () => null)
                  release('deny')
                }}
              >
                Deny
              </Button>
            </Box>
          </Box>
        )}

        {isSess && (
          <Box>
            <Button
              key="revoke"
              onPress={async () => {
                isSession = false
                await update($, session, () => false)
              }}
            >
              Turn the gate back on
            </Button>
          </Box>
        )}

        <Box {...card} borderColor="cyan">
          <Text bold>Profile</Text>
          <Box gap={1} flexWrap="wrap">
            {Object.keys(profs).map(n => (
              <Button key={`p-${n}`} variant={n === act ? 'primary' : undefined} onPress={() => switchTo($, n)}>
                {n}
              </Button>
            ))}
          </Box>
          <Box gap={1}>
            <Input
              key="new"
              label="New profile "
              placeholder="name, then Enter"
              value={name}
              onInput={(v: string) => update($, newName, () => v)}
              onSubmit={(v: string) => addProfile($, v)}
            />
            {Object.keys(profs).length > 1 && (
              <Button key="drop" onPress={() => dropProfile($)}>
                Delete {act}
              </Button>
            )}
          </Box>
          {picks === 0 ? (
            <Text dimColor>Nothing picked. Prefer a plugin (◆) on the Plugins tab, or pick skills on the Skills tab.</Text>
          ) : (
            <Box gap={1} flexWrap="wrap">
              {chips.slice(0, 8).map(c => (
                <Text key={c.key} color={c.color}>
                  {c.mark} {c.text} <Text dimColor>{c.n}</Text>
                </Text>
              ))}
              {chips.length > 8 && <Text dimColor>+{chips.length - 8} more</Text>}
            </Box>
          )}
          {ledger.since > 0 && deadCount > 0 && (
            <Box gap={1} flexDirection="column">
              <Text color="yellow">
                Never ran since {new Date(ledger.since).toLocaleDateString()}: {[...dead.plugins, ...dead.skills].join(', ')}. Each rides in every request.
              </Text>
              <Box>
                <Button
                  key="drop-unused"
                  onPress={() => edit($, p => ({ plugins: p.plugins.filter(x => !dead.plugins.includes(x)), skills: p.skills.filter(x => !dead.skills.includes(x)) }))}
                >
                  Drop {deadCount} unused
                </Button>
              </Box>
            </Box>
          )}
          {picks > SOFT_CAP && (
            <Text color="yellow">
              {picks} picks: every request now carries a longer reminder. Fewer is cheaper.
            </Text>
          )}
        </Box>

        <Box {...card} borderColor="magenta">
          <Box gap={1}>
            <Button key="t-plugins" variant={tab === 'plugins' ? 'primary' : undefined} onPress={() => pickTab('plugins')}>
              Plugins {onCount} on · {rows.length - onCount} off
            </Button>
            <Button key="t-skills" variant={tab === 'skills' ? 'primary' : undefined} onPress={() => pickTab('skills')}>
              Skills {prof.skills.length} picked · {all.length}
            </Button>
          </Box>
          <Input
            key="search"
            label="Search "
            placeholder={tab === 'plugins' ? 'filter plugins' : 'filter skills'}
            value={q}
            onInput={(v: string) => update($, query, () => v)}
            onSubmit={() => {}}
          />

          {tab === 'plugins' && (
            <Box flexDirection="column">
              {ordered.slice(0, MAX).map(r => {
                const [pname, market] = r.id.split('@')
                const isFlipping = fl?.id === r.id && f < TO_ON.length
                const glyph = isFlipping ? (fl.to ? TO_ON : TO_OFF)[f] : r.isOn ? '●' : '○'
                const isFav = prof.plugins.includes(pname)
                const n = uses(ledger.uses, pname, true)
                return (
                  <Box key={r.id} gap={1}>
                    <Button key="fav" onPress={() => togglePlugin(pname)}>
                      <Text color={isFav ? 'cyan' : undefined} dimColor={!isFav}>
                        {isFav ? '◆' : '◇'}
                      </Text>
                    </Button>
                    <Box width={30}>
                      <Button key="on" onPress={() => toggle($, r.id)}>
                        <Text color={r.isOn ? 'green' : 'red'} bold>
                          {glyph} {r.isOn ? 'ON ' : 'OFF'}{' '}
                        </Text>
                        <Text bold={r.isOn} dimColor={!r.isOn}>
                          {pname}
                        </Text>
                        {market !== undefined && pname !== market && <Text dimColor> {market}</Text>}
                      </Button>
                    </Box>
                    <Text dimColor>{n > 0 ? runs(n) : ''}</Text>
                  </Box>
                )
              })}
            </Box>
          )}

          {tab === 'skills' && (
            <Box flexDirection="column" gap={1}>
              {groupList.map(([g, list]) => {
                const isOpen = needle !== '' || open.includes(g)
                const picked = list.filter(s => prof.skills.includes(s)).length
                return (
                  <Box key={g} flexDirection="column">
                    <Button key="head" onPress={() => toggleGroup(g)}>
                      <Text bold>{isOpen ? '▾' : '▸'} {g}</Text>
                      <Text dimColor> {list.length}</Text>
                      {prof.plugins.includes(g) ? <Text color="cyan"> · ◆ covers all</Text> : picked > 0 && <Text color="cyan"> · {picked} picked</Text>}
                    </Button>
                    {isOpen && (
                      <Box flexDirection="column" paddingLeft={2}>
                        {list.map(s => {
                          const isPicked = prof.skills.includes(s)
                          const n = uses(ledger.uses, s, false)
                          return (
                            <Button key={s} onPress={() => toggleSkill(s)}>
                              <Text color={isPicked ? 'cyan' : undefined} dimColor={!isPicked}>
                                {isPicked ? '✓' : '·'} {s.includes(':') ? s.slice(s.indexOf(':') + 1) : s}
                              </Text>
                              {n > 0 && <Text dimColor> {runs(n)}</Text>}
                            </Button>
                          )
                        })}
                      </Box>
                    )}
                  </Box>
                )
              })}
            </Box>
          )}

          {(tab === 'plugins' ? plugRows.length : groupList.length) === 0 && <Text dimColor>No match.</Text>}
          {tab === 'plugins' && hidden > 0 && <Text dimColor>+{hidden} more · type to narrow</Text>}
        </Box>

        <Text dimColor>
          {tab === 'plugins'
            ? '◆ preferred · click ON/OFF to switch (applies after /reload-plugins)'
            : '▸ open a plugin, click a skill to pick · unpicked skills stay automatic'}
        </Text>
      </Box>
    )
  })
}
