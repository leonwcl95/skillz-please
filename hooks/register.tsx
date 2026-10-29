import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Flip, PluginRow } from '../types'

const PANE = 'skill-gate'
const GATED = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash'])
const REST = 999
const TICK = 50 // ms per frame: stagger and glyph steps stay in the 30-80ms range
const SPARK = ['✦', '✧', '⋆', '✧']
const TO_ON = ['○', '◐', '●']
const TO_OFF = ['●', '◐', '○']

const plugins = atom({ plugin: 'skill-gate', key: 'plugins' } as const, [], { shape: 'plugins-1' })
const blocked = atom({ plugin: 'skill-gate', key: 'blocked' } as const, null, { shape: 'blocked-1' })
const frame = atom({ plugin: 'skill-gate', key: 'frame' } as const, REST, { shape: 'frame-1' })
const flip = atom({ plugin: 'skill-gate', key: 'flip' } as const, null, { shape: 'flip-1' })
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const rows = await read($, plugins)
    const last = await read($, blocked)
    const f = await read($, frame)
    const fl = await read($, flip)
    const isSess = await read($, session)
    const isMoving = f < REST
    const onCount = rows.filter(r => r.isOn).length
    const barWidth = 24
    const filled = rows.length === 0 ? 0 : Math.round((onCount / rows.length) * barWidth)
    // The bar grows into place during the entrance (ease-out: big steps first).
    const grow = isMoving ? Math.min(filled, Math.round(filled * (1 - (1 - Math.min(f / 8, 1)) ** 2))) : filled
    // The border blinks yellow twice when a call is blocked, then stays steady.
    const warn = !isMoving || f % 4 < 2 ? 'yellow' : undefined

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box>
          <Text color="magenta" bold>
            {isMoving ? SPARK[f % SPARK.length] : '✦'}{' '}
          </Text>
          <Text bold>Skill gate</Text>
          <Text dimColor> · asks before changing code without a skill</Text>
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
          <Box borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
            <Text color="green" bold>Allowed for this session</Text>
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

        <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column">
          <Box>
            <Text bold>Plugins </Text>
            <Text color="green">{'█'.repeat(grow)}</Text>
            <Text dimColor>{'░'.repeat(barWidth - grow)}</Text>
            <Text dimColor>
              {' '}
              {onCount}/{rows.length}
            </Text>
          </Box>
          {rows.map((r, i) => {
            const [name, market] = r.id.split('@')
            const isFlipping = fl?.id === r.id && f < TO_ON.length * 1
            const glyph = isFlipping ? (fl.to ? TO_ON : TO_OFF)[f] : r.isOn ? '●' : '○'
            // Stagger: row i fades in one frame after row i-1 (dim, then full).
            if (isMoving && fl === null && f < i) return <Text key={r.id} dimColor>·</Text>
            const isFresh = isMoving && fl === null && f === i
            return (
              <Button key={r.id} onPress={() => toggle($, r.id)}>
                <Text color={r.isOn ? 'green' : undefined} dimColor={!r.isOn || isFresh}>
                  {glyph}{' '}
                </Text>
                <Text bold={r.isOn} dimColor={!r.isOn || isFresh}>
                  {name}
                </Text>
                {market !== undefined && <Text dimColor> {market}</Text>}
              </Button>
            )
          })}
        </Box>
        <Text dimColor>Click a plugin to toggle · applies after /reload-plugins</Text>
      </Box>
    )
  })
}
