import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, launch, test } from './fixtures'

/**
 * T17 (AI half): the real APIs with the owner's own keys — Test connection (free) and one tiny
 * request per provider on its cheapest model. Runs on a COPY of a DevDock data folder that holds
 * the keys (the keychain-encrypted secrets work from the copy; the original is never changed).
 * Opt-in: `DEVDOCK_LIVE_AI_FROM=<DevDock data folder> npx playwright test live-ai`.
 * Costs well under one US cent per run. Never runs in CI.
 */
const from = process.env.DEVDOCK_LIVE_AI_FROM
test.skip(!from || !!process.env.CI, 'set DEVDOCK_LIVE_AI_FROM to a DevDock data folder with keys')
test.setTimeout(180_000)

const CHEAPEST = { anthropic: 'claude-haiku-5-5', google: 'gemini-3.1-flash-lite' } as const

test('live AI: Test connection and one short request per provider with a saved key', async () => {
  const copy = mkdtempSync(join(tmpdir(), 'devdock-live-'))
  cpSync(from!, copy, { recursive: true })
  const { app, win } = await launch(copy)
  try {
    const keys = await win.evaluate(() => window.devdock.secrets.list())
    if (!keys.ok) throw new Error(keys.error.message)
    // Real network: demo off (in the copy only).
    await win.evaluate(() => window.devdock.settings.update({ general: { demoMode: false } }))
    const results: string[] = []
    for (const provider of ['anthropic', 'google'] as const) {
      if (!keys.data.includes(`${provider}.key`)) {
        results.push(`${provider}: no key saved — skipped`)
        continue
      }
      const model = CHEAPEST[provider]
      await win.evaluate(
        ([p, m]) =>
          window.devdock.settings.update({
            ai:
              p === 'anthropic'
                ? { provider: p, model: m as never }
                : { provider: p, googleModel: m as never },
          }),
        [provider, model] as const,
      )
      const test = await win.evaluate(() => window.devdock.ai.testConnection())
      expect(test, `${provider} Test connection`).toMatchObject({ ok: true })
      if (!test.ok) continue
      const offered = test.data.models.includes(model)
      const prepared = await win.evaluate(() =>
        window.devdock.ai.prepare({
          feature: 'lesson',
          comment: 'Please use the design tokens instead of hard-coded colours in this component.',
        }),
      )
      if (!prepared.ok) throw new Error(`${provider} prepare: ${prepared.error.message}`)
      expect(prepared.data).toMatchObject({ provider, model, demo: false })
      const ran = await win.evaluate((id) => window.devdock.ai.run({ id }), prepared.data.id)
      if (!ran.ok)
        throw new Error(`${provider} run: ${ran.error.message} ${ran.error.details ?? ''}`)
      expect(ran.data.text.length, `${provider} answer`).toBeGreaterThan(0)
      results.push(
        `${provider}: HTTP ${test.data.status}, ${test.data.models.length} models (${model} ${offered ? 'listed' : 'NOT listed'}); answer by ${ran.data.model}: "${ran.data.text.slice(0, 120)}" — ${ran.data.inputTokens} in / ${ran.data.outputTokens} out, $${ran.data.costUsd.toFixed(5)}`,
      )
    }
    console.log(`\n${results.join('\n')}\n`)
  } finally {
    await app.close().catch(() => undefined)
    rmSync(copy, { recursive: true, force: true })
  }
})
