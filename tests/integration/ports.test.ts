import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { PortService, runCommand } from '../../src/main/services/process/ports'
import { isListening } from '../fixtures/ports'

/**
 * P5.D2 (main side): a real process listening on a port is found by `lsof` and stopped by PID.
 * Windows is covered by the mocked-execFile unit tests (tests/unit/ports.test.ts).
 */
describe.skipIf(process.platform === 'win32')('port scanner on this machine', () => {
  it('lists a fixture server and stops it by port', async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        "require('net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)})",
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    const port = await new Promise<number>((resolve) =>
      child.stdout!.once('data', (d: Buffer) => resolve(Number(String(d).trim()))),
    )
    const service = new PortService({
      platform: process.platform,
      run: runCommand,
      signal: (pid, sig) => process.kill(pid, sig),
      ownPids: () => [process.pid],
    })
    try {
      const row = (await service.list()).find((p) => p.port === port)
      expect(row).toMatchObject({ pid: child.pid, addresses: ['127.0.0.1'] })
      expect(row!.command).toMatch(/createServer/)
      expect(await service.stop({ pid: child.pid!, port, force: false, confirmed: true })).toEqual({
        stillListening: false,
      })
      expect(await isListening(port)).toBe(false)
    } finally {
      child.kill('SIGKILL')
    }
  }, 20_000)
})
