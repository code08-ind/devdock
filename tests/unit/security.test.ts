import { describe, expect, it } from 'vitest'
import { CSP_PROD, WEB_PREFERENCES, checkExternalUrl, isAppUrl } from '../../src/main/security'

const allow = ['bitbucket.org', 'atlassian.net']

describe('checkExternalUrl', () => {
  it.each([
    'https://bitbucket.org/ws/repo/pull-requests/1',
    'https://acme.atlassian.net/browse/NM-1',
    'http://bitbucket.org/x',
  ])('allows %s', (url) => expect(checkExternalUrl(url, allow).ok).toBe(true))

  it.each([
    ['file:///etc/passwd', 'file:'],
    ['javascript:alert(1)', 'javascript:'],
    ['smb://evil/share', 'smb:'],
    ['https://evil.com/bitbucket.org', 'allowlist'],
    ['https://bitbucket.org.evil.com/', 'allowlist'],
    ['https://notatlassian.net/', 'allowlist'],
    ['https://user:pw@bitbucket.org/', 'credentials'],
    ['not a url', 'valid'],
  ])('rejects %s', (url, why) => {
    const v = checkExternalUrl(url, allow)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain(why)
  })
})

describe('isAppUrl', () => {
  it('keeps navigation on the app origin', () => {
    expect(isAppUrl('file:///app/index.html#/repos', 'file://')).toBe(true)
    expect(isAppUrl('https://example.com', 'file://')).toBe(false)
    expect(isAppUrl('http://localhost:5173/x', 'http://localhost:5173')).toBe(true)
    expect(isAppUrl('http://localhost:5174/x', 'http://localhost:5173')).toBe(false)
  })
})

describe('baseline constants', () => {
  it('locks down webPreferences', () => {
    expect(WEB_PREFERENCES).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    })
  })
  it('production CSP allows no remote or inline scripts', () => {
    expect(CSP_PROD).toContain("default-src 'self'")
    expect(CSP_PROD).toContain("script-src 'self';")
    expect(CSP_PROD).not.toMatch(/unsafe-inline|unsafe-eval|https?:/)
  })
})
