import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// The renderer modules read the preload bridge when they load.
vi.stubGlobal('window', {
  devdock: { on: () => () => undefined },
  addEventListener() {},
  removeEventListener() {},
})
let ui: {
  DevDockError: typeof import('../../src/renderer/lib/devdock').DevDockError
  ErrorNotice: typeof import('../../src/renderer/ui/Feedback').ErrorNotice
  RepoStatusError: typeof import('../../src/renderer/features/repos/RepoStatusLine').RepoStatusError
}
beforeAll(async () => {
  const { DevDockError } = await import('../../src/renderer/lib/devdock')
  const { ErrorNotice } = await import('../../src/renderer/ui/Feedback')
  const { RepoStatusError } = await import('../../src/renderer/features/repos/RepoStatusLine')
  ui = { DevDockError, ErrorNotice, RepoStatusError }
})

describe('errors with Details (SPEC: human-readable, raw output behind a disclosure)', () => {
  it('shows the message, and the raw output only inside a closed "Details"', () => {
    const err = new ui.DevDockError(
      'GIT_FAILED',
      'Git could not read this repo.',
      'fatal: bad HEAD',
    )
    for (const html of [
      renderToStaticMarkup(createElement(ui.ErrorNotice, { error: err })),
      renderToStaticMarkup(createElement(ui.RepoStatusError, { error: err })),
    ]) {
      expect(html).toContain('Git could not read this repo.')
      expect(html).toMatch(
        /<details class="error-details"><summary>Details<\/summary><pre[^>]*>fatal: bad HEAD<\/pre><\/details>/,
      )
    }
  })

  it('no Details when there is nothing behind the message', () => {
    const html = renderToStaticMarkup(
      createElement(ui.RepoStatusError, { error: new Error('Folder not found.') }),
    )
    expect(html).toContain('Folder not found.')
    expect(html).not.toContain('<details')
  })
})
