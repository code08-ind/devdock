import { describe, expect, it } from 'vitest'
import { prKey } from '../../src/shared/bitbucket'
import { cloudRepoFromRemote, parsePrLink } from '../../src/shared/prlink'

describe('parsePrLink (P3.02)', () => {
  it.each([
    'https://bitbucket.org/acme/web-app/pull-requests/42',
    'https://bitbucket.org/acme/web-app/pull-requests/42/',
    'https://bitbucket.org/acme/web-app/pull-requests/42/diff',
    'https://bitbucket.org/acme/web-app/pull-requests/42/overview',
    'https://bitbucket.org/acme/web-app/pull-requests/42/commits',
    'https://bitbucket.org/acme/web-app/pull-requests/42/diff?w=1#chg-src/App.tsx',
    'https://bitbucket.org/acme/web-app/pull-requests/42?at=develop',
    'https://www.bitbucket.org/acme/web-app/pull-requests/42',
    'bitbucket.org/acme/web-app/pull-requests/42',
    '  <https://bitbucket.org/acme/web-app/pull-requests/42>  ',
  ])('Cloud: %s', (link) => {
    expect(parsePrLink(link)).toEqual({
      flavor: 'cloud',
      baseUrl: 'https://bitbucket.org',
      ref: { owner: 'acme', repo: 'web-app', id: 42 },
    })
  })

  it.each([
    'https://bb.example.com/projects/PROJ/repos/web-app/pull-requests/7',
    'https://bb.example.com/projects/PROJ/repos/web-app/pull-requests/7/overview',
    'https://bb.example.com/projects/PROJ/repos/web-app/pull-requests/7/diff#src/App.tsx',
    'https://bb.example.com/projects/PROJ/repos/web-app/pull-requests/7/commits/abc123',
    'https://bb.example.com/projects/PROJ/repos/web-app/pull-requests/7/overview?commentId=55',
  ])('Data Center project repo: %s', (link) => {
    expect(parsePrLink(link)).toEqual({
      flavor: 'datacenter',
      baseUrl: 'https://bb.example.com',
      ref: { owner: 'PROJ', repo: 'web-app', id: 7 },
    })
  })

  it('Data Center user (personal) repo → project key ~user', () => {
    expect(
      parsePrLink('https://bb.example.com/users/ada.lovelace/repos/dotfiles/pull-requests/3/diff'),
    ).toEqual({
      flavor: 'datacenter',
      baseUrl: 'https://bb.example.com',
      ref: { owner: '~ada.lovelace', repo: 'dotfiles', id: 3 },
    })
  })

  it('Data Center behind a context path and a port', () => {
    expect(
      parsePrLink(
        'http://git.corp.example:7990/bitbucket/projects/WEB/repos/shop/pull-requests/12',
      ),
    ).toEqual({
      flavor: 'datacenter',
      baseUrl: 'http://git.corp.example:7990/bitbucket',
      ref: { owner: 'WEB', repo: 'shop', id: 12 },
    })
  })

  it.each([
    ['empty', ''],
    ['not a URL', 'watch this please'],
    ['a repo, not a PR', 'https://bitbucket.org/acme/web-app'],
    ['a branch page', 'https://bitbucket.org/acme/web-app/branch/develop'],
    ['the PR list', 'https://bitbucket.org/acme/web-app/pull-requests/'],
    ['a non-numeric id', 'https://bitbucket.org/acme/web-app/pull-requests/abc'],
    ['id zero', 'https://bitbucket.org/acme/web-app/pull-requests/0'],
    ['a DC repo browse page', 'https://bb.example.com/projects/PROJ/repos/web-app/browse'],
    ['a DC commit page', 'https://bb.example.com/projects/PROJ/repos/web-app/commits/abc'],
    ['another protocol', 'ftp://bitbucket.org/acme/web-app/pull-requests/1'],
    ['a GitHub PR', 'https://github.com/acme/web-app/pull/42'],
    ['path traversal in a slug', 'https://bitbucket.org/acme/%2E%2E/pull-requests/1'],
    ['a slug with a slash', 'https://bitbucket.org/acme/web%2Fapp/pull-requests/1'],
    ['bad percent-encoding', 'https://bitbucket.org/acme/%E0%A4%A/pull-requests/1'],
  ])('rejects %s', (_label, link) => {
    expect(parsePrLink(link)).toBeNull()
  })

  it('prKey is stable per PR and ignores case (DC says ~ADA, its links /users/ada)', () => {
    expect(prKey({ owner: '~ADA', repo: 'Dotfiles', id: 3 })).toBe('~ada/dotfiles#3')
    const link = parsePrLink('https://bb.example.com/users/ada/repos/dotfiles/pull-requests/3')
    expect(prKey(link!.ref)).toBe(prKey({ owner: '~ADA', repo: 'dotfiles', id: 3 }))
  })
})

describe('cloudRepoFromRemote', () => {
  it.each([
    'git@bitbucket.org:acme/web-app.git',
    'git@bitbucket.org:acme/web-app',
    'https://ada@bitbucket.org/acme/web-app.git',
    'https://bitbucket.org/acme/web-app',
    'ssh://git@bitbucket.org/acme/web-app.git',
    'ssh://git@bitbucket.org:22/acme/web-app.git',
  ])('%s', (remote) => {
    expect(cloudRepoFromRemote(remote)).toEqual({ owner: 'acme', repo: 'web-app' })
  })

  it.each([
    'git@github.com:acme/web-app.git',
    'https://bb.example.com/scm/proj/web-app.git',
    'https://evilbitbucket.org/acme/web-app.git',
    '/Users/ada/src/web-app',
    'git@bitbucket.org:acme/../x.git',
  ])('ignores %s', (remote) => {
    expect(cloudRepoFromRemote(remote)).toBeNull()
  })
})
