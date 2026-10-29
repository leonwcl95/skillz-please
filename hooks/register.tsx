import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Flip, PluginRow } from '../types'

const PANE = 'skill-gate'
const GATED = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash'])
const REST = 999
const MAX = 12 // rows per list; search narrows the rest
const TICK = 50 // ms per frame: stagger and glyph steps stay in the 30-80ms range
const SPARK = ['✦', '✧', '⋆', '✧']
const TO_ON = ['○', '◐', '●']
const TO_OFF = ['●', '◐', '○']

const plugins = atom({ plugin: 'skill-gate', key: 'plugins' } as const, [], { shape: 'plugins-1' })
const blocked = atom({ plugin: 'skill-gate', key: 'blocked' } as const, null, { shape: 'blocked-1' })
const frame = atom({ plugin: 'skill-gate', key: 'frame' } as const, REST, { shape: 'frame-1' })
const flip = atom({ plugin: 'skill-gate', key: 'flip' } as const, null, { shape: 'flip-1' })
const skills = atom({ plugin: 'skill-gate', key: 'skills' } as const, [], { shape: 'skills-1' })
const picked = atom({ plugin: 'skill-gate', key: 'picked' } as const, [], { shape: 'picked-1' })
const pickedPlugins = atom({ plugin: 'skill-gate', key: 'pickedPlugins' } as const, [], { shape: 'pickedPlugins-1' })
const query = atom({ plugin: 'skill-gate', key: 'query' } as const, '', { shape: 'query-1' })
const tabAtom = atom({ plugin: 'skill-gate', key: 'tab' } as const, 'plugins', { shape: 'tab-1' })
const session = atom({ plugin: 'skill-gate', key: 'session' } as const, false, { shape: 'session-1' })

let stop: (() => void) | undefined

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
async function loadSkills($: any) {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  const list: any[] = usage?.context?.breakdown?.skills?.skillFrontmatter ?? []
  const names = list.filter(s => s.source !== 'built-in').map(s => (s.pluginName && !s.name.includes(':') ? `${s.pluginName}:${s.name}` : s.name))
  await update($, skills, () => [...new Set<string>(names)].sort())
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

  // Tell the model about the chosen skills in every request of the session.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const names = await read($, picked)
    const favs = await read($, pickedPlugins)
    if (names.length === 0 && favs.length === 0) return r
    const parts = []
    if (names.length > 0) parts.push(`The person chose these skills for this session: ${names.join(', ')}. Invoke the relevant one with the Skill tool before you change code or run commands, every turn, without being asked.`)
    if (favs.length > 0) parts.push(`The person chose these plugins to always prefer: ${favs.join(', ')}. When one of their skills fits the task, invoke it with the Skill tool.`)
    const text = parts.join(' ')
    return { sections: [...r.sections, { id: 'skill-gate:picked', text, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      isAllowed = false
      release('deny') // a new turn means the parked call is stale
    }
    return next(e)
  })

  on('skill.prompt', ($, e, next) => {
    isAllowed = true
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Skill') isAllowed = true
    if (isAllowed || isSession || !GATED.has(e.tool)) return next(e)

    // Chosen skills mean approval is implied: tell the model which to use and let it retry.
    const chosen = [...(await read($, picked)), ...(await read($, pickedPlugins)).map(p => `a ${p} skill`)]
    if (chosen.length > 0) {
      return { deny: `skill-gate: invoke one of the skills the person chose (${chosen.join(', ')}) with the Skill tool, then retry.` }
    }

    // Park the call: the turn really waits here until a pane button answers.
    await update($, blocked, () => e.tool)
    void show($)
    await $.ui.status('skill-gate: waiting for your approval in the Skill gate pane')
    const d = await new Promise<'allow' | 'deny'>(res => waiting.push(res))
    await $.ui.status(undefined)
    if (d === 'allow') return next(e)
    return { deny: 'skill-gate: the person declined this call. Invoke a relevant skill or ask them how to proceed.' }
  }).catch(($, e, next) => next(e)) // fail open: a broken gate must not stop work

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const rows = await read($, plugins)
    const last = await read($, blocked)
    const f = await read($, frame)
    const fl = await read($, flip)
    const isSess = await read($, session)
    const all = await read($, skills)
    const chosen = await read($, picked)
    const favs = await read($, pickedPlugins)
    const q = await read($, query)
    const tab = await read($, tabAtom)
    const isMoving = f < REST
    const onCount = rows.filter(r => r.isOn).length
    // The border blinks yellow twice when a call is blocked, then stays steady.
    const warn = !isMoving || f % 4 < 2 ? 'yellow' : undefined
    const needle = q.trim().toLowerCase()
    const match = (s: string) => needle === '' || s.toLowerCase().includes(needle)
    const flipIn = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])
    const toggleSkill = (v: string) => update($, picked, (l: string[]) => flipIn(l, v))
    const togglePlugin = (v: string) => update($, pickedPlugins, (l: string[]) => flipIn(l, v))
    const pickTab = async (t: string) => {
      await update($, tabAtom, () => t)
      await update($, query, () => '')
    }

    const plugRows = rows.filter(r => match(r.id))
    const skillRows = all.filter(match).sort((a, b) => Number(chosen.includes(b)) - Number(chosen.includes(a)))
    const count = tab === 'plugins' ? plugRows.length : skillRows.length
    const hidden = Math.max(0, count - MAX)

    const gate = isSess
      ? { color: 'green', text: 'gate open for this session' }
      : chosen.length + favs.length > 0
        ? { color: 'cyan', text: 'gate on: needs a skill, reminds me of your picks' }
        : { color: 'yellow', text: 'gate on: asks you before code changes' }

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="column">
          <Box>
            <Text color="magenta" bold>
              {isMoving ? SPARK[f % SPARK.length] : '✦'}{' '}
            </Text>
            <Text bold>Skill gate</Text>
          </Box>
          <Text color={gate.color}>● {gate.text}</Text>
        </Box>

        {last !== null && (
          <Box borderStyle="round" borderColor={warn} paddingX={1} flexDirection="column">
            <Text color="yellow" bold>
              Paused · {last}
            </Text>
            <Text dimColor>No skill was used this turn. The turn is waiting for you.</Text>
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
        )}

        {isSess && (
          <Button
            key="revoke"
            onPress={async () => {
              isSession = false
              await update($, session, () => false)
            }}
          >
            Turn the gate back on
          </Button>
        )}

        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold>Always use</Text>
          {chosen.length + favs.length === 0 ? (
            <Text dimColor>Nothing picked. Tick a skill or star a plugin below.</Text>
          ) : (
            <Text>
              {[...favs.map(p => `★ ${p}`), ...chosen.map(s => `■ ${s}`)].join('  ')}
            </Text>
          )}
        </Box>

        <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column">
          <Box gap={2}>
            <Button key="t-plugins" variant={tab === 'plugins' ? 'primary' : undefined} onPress={() => pickTab('plugins')}>
              Plugins {onCount} on · {rows.length - onCount} off
            </Button>
            <Button key="t-skills" variant={tab === 'skills' ? 'primary' : undefined} onPress={() => pickTab('skills')}>
              Skills {chosen.length} picked · {all.length}
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

          {tab === 'plugins' &&
            plugRows.slice(0, MAX).map(r => {
              const [name, market] = r.id.split('@')
              const isFlipping = fl?.id === r.id && f < TO_ON.length
              const glyph = isFlipping ? (fl.to ? TO_ON : TO_OFF)[f] : r.isOn ? '●' : '○'
              const isFav = favs.includes(name)
              return (
                <Box key={r.id}>
                  <Button key="fav" onPress={() => togglePlugin(name)}>
                    <Text color={isFav ? 'cyan' : undefined} dimColor={!isFav}>
                      {isFav ? '★' : '☆'}{' '}
                    </Text>
                  </Button>
                  <Button key="on" onPress={() => toggle($, r.id)}>
                    <Text color={r.isOn ? 'green' : 'red'} bold>
                      {glyph} {r.isOn ? 'ON ' : 'OFF'}{' '}
                    </Text>
                    <Text bold={r.isOn} dimColor={!r.isOn}>
                      {name}
                    </Text>
                    {market !== undefined && <Text dimColor> {market}</Text>}
                  </Button>
                </Box>
              )
            })}

          {tab === 'skills' &&
            skillRows.slice(0, MAX).map(s => (
              <Button key={s} onPress={() => toggleSkill(s)}>
                <Text color={chosen.includes(s) ? 'cyan' : undefined} dimColor={!chosen.includes(s)}>
                  {chosen.includes(s) ? '■' : '□'} {s}
                </Text>
              </Button>
            ))}

          {count === 0 && <Text dimColor>No match.</Text>}
          {hidden > 0 && <Text dimColor>+{hidden} more · type to narrow</Text>}
        </Box>

        <Text dimColor>
          {tab === 'plugins'
            ? '★ always prefer · ● ON / ○ OFF, click to switch (applies after /reload-plugins)'
            : '□ → ■ click to always use · unpicked skills stay automatic'}
        </Text>
      </Box>
    )
  })
}
