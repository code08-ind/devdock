import { callHook, expect, test } from './fixtures'

/** P4-B in demo mode (src/main/demo/jenkins.ts). The full P4.D2 flow through the UI is P4-C. */

const PR_88 =
  'https://demo.devdock.invalid/bitbucket/projects/DEMO/repos/design-system/pull-requests/88'

test('tray: grey dot while idle; a watched PR pipeline shows in the tray as running', async ({
  launched,
}) => {
  const { app, win } = launched
  expect(await callHook(app, 'trayStatus')).toBe('grey')
  const added = await win.evaluate((link) => window.devdock.buildwatch.addPr({ link }), PR_88)
  expect(added).toMatchObject({ ok: true, data: { job: 'design-system/PR-88', number: 12 } })
  await callHook(app, 'pollBuilds')
  expect((await callHook(app, 'trayState')).watched).toEqual([
    { label: 'design-system #88 pipeline #12', state: 'running', finishedAt: null },
  ])
  // Running isn't a result yet: still grey.
  expect(await callHook(app, 'trayStatus')).toBe('grey')
})
