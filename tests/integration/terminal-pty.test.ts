import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TerminalManager, type PtySpawn } from '../../src/main/services/terminal/manager'
import { TerminalSettingsSchema } from '../../src/shared/terminal'

/** The real node-pty (its N-API prebuilds load in Node as in Electron). */
const { spawn } = createRequire(import.meta.url)('node-pty') as { spawn: PtySpawn }
const win = process.platform === 'win32'

let dir = ''
let m: TerminalManager | undefined
afterEach(async () => {
  await m?.killAll()
  rmSync(dir, { recursive: true, force: true })
})

function start() {
  dir = mkdtempSync(join(tmpdir(), 'devdock-pty-'))
  const out: string[] = []
  const exits: number[] = []
  m = new TerminalManager({
    spawn,
    // sh / PowerShell without profiles: the test must not depend on whoever runs it.
    settings: () => TerminalSettingsSchema.parse({ shell: win ? 'powershell' : '/bin/sh' }),
    onOutput: (_o, e) => out.push(e.data),
    onExit: (_o, e) => exits.push(e.exitCode),
    promptDir: join(dir, 'prompt'),
    batchMs: 5,
    killGraceMs: 500,
  })
  return { m, text: () => out.join(''), exits }
}

describe('real PTY (node-pty)', { timeout: 30_000 }, () => {
  it('runs a command in the folder and reports the exit code', async () => {
    const t = start()
    const s = await t.m.create({
      owner: 1,
      cwd: dir,
      title: 'x',
      repoId: null,
      cols: 120,
      rows: 30,
    })
    t.m.write(1, s.id, win ? 'echo "devdock-$(1+1)"\r' : 'echo "devdock-$((1+1))"; pwd\r')
    await expect.poll(t.text, { timeout: 15_000 }).toMatch(/devdock-2/)
    t.m.write(1, s.id, 'exit 3\r')
    await expect.poll(() => t.exits, { timeout: 15_000 }).toEqual([3])
    expect(t.m.list(1)[0]).toMatchObject({ status: 'exited', exitCode: 3 })
  })

  it('closing the tab stops the shell and what it started', async () => {
    const t = start()
    const s = await t.m.create({ owner: 1, cwd: dir, title: 'x', repoId: null, cols: 80, rows: 24 })
    const [pid] = t.m.pids(1)
    t.m.write(1, s.id, win ? 'Start-Sleep 600\r' : 'sleep 600\r')
    await new Promise((r) => setTimeout(r, 300))
    await t.m.kill(1, s.id)
    const alive = () => {
      try {
        process.kill(pid!, 0)
        return true
      } catch {
        return false
      }
    }
    await expect.poll(alive, { timeout: 5_000 }).toBe(false)
    expect(t.m.count()).toBe(0)
  })
})
