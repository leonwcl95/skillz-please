export type PluginRow = { id: string; isOn: boolean }
export type Flip = { id: string; to: boolean }

declare module 'claude-code' {
  interface PluginState {
    'skill-gate': {
      plugins: Shaped<PluginRow[]>
      blocked: Shaped<string | null>
      // Animation frame since the last play(); a large value means "at rest".
      frame: Shaped<number>
      flip: Shaped<Flip | null>
      session: Shaped<boolean>
      skills: Shaped<string[]>
      picked: Shaped<string[]>
      pickedPlugins: Shaped<string[]>
      query: Shaped<string>
      tab: Shaped<string>
    }
  }
}
