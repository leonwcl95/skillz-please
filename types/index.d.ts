export type PluginRow = { id: string; isOn: boolean }
export type Flip = { id: string; to: boolean }
// A named set of "always use" picks: skills by their Skill-tool name, plugins by name.
export type Profile = { skills: string[]; plugins: string[] }

declare module 'claude-code' {
  interface PluginState {
    'skill-gate': {
      plugins: Shaped<PluginRow[]>
      blocked: Shaped<string | null>
      // Animation frame since the last play(); a large value means "at rest".
      frame: Shaped<number>
      flip: Shaped<Flip | null>
      session: Shaped<boolean>
      mode: Shaped<string>
      skills: Shaped<string[]>
      profiles: Shaped<Record<string, Profile>>
      active: Shaped<string>
      openGroups: Shaped<string[]>
      newName: Shaped<string>
      query: Shaped<string>
      tab: Shaped<string>
    }
  }
}
