import { describe, expect, it } from 'vitest'
import { AgentNotFoundError, agentSpawn, detectAgents } from '../../src/main/services/agents'
import { isCmdSafePrompt, pickAgent, type AgentInfo } from '../../src/shared/agents'

const found = (paths: Partial<Record<AgentInfo['id'], string>>): AgentInfo[] =>
  (['claude', 'codex', 'gemini', 'copilot'] as const).map((id) => ({
    id,
    name: id,
    path: paths[id] ?? null,
  }))

describe('detectAgents', () => {
  it('finds each CLI on PATH; on Windows also npm’s .cmd scripts', () => {
    const mac = detectAgents({
      platform: 'darwin',
      env: { PATH: '/opt/homebrew/bin:/Users/me/.local/bin' },
      isExecutable: (p) => p === '/Users/me/.local/bin/claude' || p === '/opt/homebrew/bin/gemini',
    })
    expect(mac.map((a) => [a.id, a.path])).toEqual([
      ['claude', '/Users/me/.local/bin/claude'],
      ['codex', null],
      ['gemini', '/opt/homebrew/bin/gemini'],
      ['copilot', null],
    ])
    expect(mac[0]!.name).toBe('Claude Code')
    const win = detectAgents({
      platform: 'win32',
      env: { Path: 'C:\\npm' },
      isExecutable: (p) => p === 'C:\\npm\\codex.cmd',
    })
    expect(win.find((a) => a.id === 'codex')!.path).toBe('C:\\npm\\codex.cmd')
  })
})

describe('agentSpawn', () => {
  const msg = 'Use the bug-fixer agent. Ticket brief: docs/ai/specs/DD-7/TICKET.md.'
  it('starts the CLI itself with the prompt as one argument, in each CLI’s own form', () => {
    const agents = found({
      claude: '/b/claude',
      codex: '/b/codex',
      gemini: '/b/gemini',
      copilot: '/b/copilot',
    })
    const args = (id: AgentInfo['id']) => agentSpawn({ id, prompt: msg }, agents, 'darwin').args
    expect(args('claude')).toEqual([msg])
    expect(args('codex')).toEqual([msg])
    expect(args('gemini')).toEqual(['-i', msg])
    expect(args('copilot')).toEqual(['-i', msg])
    expect(agentSpawn({ id: 'claude' }, agents, 'darwin')).toEqual({
      file: '/b/claude',
      args: [],
      name: 'Claude Code',
      note: null,
    })
  })

  it('a prompt with shell characters is still one argument (never parsed by a shell)', () => {
    const evil = 'Figma: https://x.test/?a=1&b=$(rm -rf ~); `id`'
    const s = agentSpawn({ id: 'claude', prompt: evil }, found({ claude: '/b/claude' }), 'darwin')
    expect(s.args).toEqual([evil])
  })

  it('a missing CLI is a typed error', () => {
    expect(() => agentSpawn({ id: 'codex', prompt: msg }, found({}), 'darwin')).toThrow(
      AgentNotFoundError,
    )
  })

  it('Windows .cmd scripts get the prompt only when cmd.exe has nothing to parse in it', () => {
    const agents = found({ claude: 'C:\\npm\\claude.cmd', codex: 'C:\\bin\\codex.exe' })
    expect(agentSpawn({ id: 'claude', prompt: msg }, agents, 'win32').args).toEqual([msg])
    const risky = `${msg} Figma: https://www.figma.com/file/x?node-id=1-2&t=abc.`
    const s = agentSpawn({ id: 'claude', prompt: risky }, agents, 'win32')
    expect(s.args).toEqual([])
    expect(s.note).toMatch(/clipboard/)
    // A real .exe gets its arguments quoted by Windows itself.
    expect(agentSpawn({ id: 'codex', prompt: risky }, agents, 'win32').args).toEqual([risky])
  })
})

describe('isCmdSafePrompt / pickAgent', () => {
  it('lets plain messages through and stops cmd.exe metacharacters', () => {
    expect(
      isCmdSafePrompt('Use the spec-writer agent. Ticket brief: C:\\Users\\me\\x\\TICKET.md.'),
    ).toBe(true)
    for (const c of ['&', '|', '%', '^', '<', '>', '"', '!', '(', '\n']) {
      expect(isCmdSafePrompt(`a ${c} b`)).toBe(false)
    }
  })
  it('the preferred agent when installed, else the first installed', () => {
    const agents = found({ codex: '/b/codex', gemini: '/b/gemini' })
    expect(pickAgent(agents, 'gemini')!.id).toBe('gemini')
    expect(pickAgent(agents, 'claude')!.id).toBe('codex')
    expect(pickAgent(agents, 'auto')!.id).toBe('codex')
    expect(pickAgent(found({}), 'auto')).toBeNull()
  })
})
