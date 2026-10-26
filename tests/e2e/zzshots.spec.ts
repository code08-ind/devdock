import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, showView, test } from './fixtures'
test('shots', async () => {
  test.setTimeout(120_000)
  const home = mkdtempSync(join(tmpdir(), 'devdock-home-'))
  const { app, win } = await launch(undefined, { HOME: home, ZDOTDIR: '' })
  await win.evaluate(() =>
    window.devdock.settings.update({ terminal: { shell: '/bin/zsh', devdockPrompt: true } }),
  )
  await showView(win, 'Terminal')
  await win.waitForTimeout(1500)
  await win.locator('.xterm').click()
  const line =
    'printf \'normal text  \\e[1mbold text\\e[0m  \\e[2mdim\\e[0m\\n\'; for i in 0 1 2 3 4 5 6 7; do printf "\\e[3\${i}m colour\$i \\e[1;9\${i}m bright\$i \\e[0m\\n"; done; ls -la /'
  await win.keyboard.type(line)
  await win.keyboard.press('Enter')
  await win.waitForTimeout(1000)
  for (const theme of ['light', 'dark', 'slate', 'high-contrast', 'paper']) {
    await win.evaluate(
      (t) => window.devdock.settings.update({ appearance: { theme: t as never } }),
      theme,
    )
    await win.waitForTimeout(600)
    await win
      .locator('.terminal-viewport')
      .screenshot({
        path:
          '/private/tmp/claude-501/-Users-aryangarg-Developer-AI-Workflow-B-desktop-app/84d46a96-3ad5-4526-a09e-ed4f018dfcca/scratchpad/term-' +
          theme +
          '.png',
      })
  }
  await app.close()
})
