import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROTECTED,
  SLUG_MAX,
  isProtectedBranch,
  isValidBranchName,
  renderBranchName,
  slugify,
  uniqueBranchName,
} from '../../src/main/services/git/branches'

describe('slugify', () => {
  it('makes ASCII kebab-case', () => {
    expect(slugify('Add Login Form')).toBe('add-login-form')
    expect(slugify('  Fix: header / nav (mobile)!! ')).toBe('fix-header-nav-mobile')
    expect(slugify('Use v2.3 API & retry')).toBe('use-v2-3-api-retry')
  })

  it('transliterates accents and drops other scripts', () => {
    expect(slugify('Café déjà vu — naïve façade')).toBe('cafe-deja-vu-naive-facade')
    expect(slugify('Straße Ærø Łódź')).toBe('strasse-aero-lodz')
    expect(slugify('ログイン画面 login 修正')).toBe('login')
    expect(slugify('😀 emoji 🚀 title')).toBe('emoji-title')
    expect(slugify('日本語のみ')).toBe('')
  })

  it(`is at most ${SLUG_MAX} characters, cut at a word boundary`, () => {
    const s = slugify(
      'Implement the new onboarding checklist for enterprise customers with SSO enabled',
    )
    expect(s.length).toBeLessThanOrEqual(SLUG_MAX)
    expect(s).toBe('implement-the-new-onboarding-checklist-for')
    expect(s.endsWith('-')).toBe(false)
  })

  it('cuts a single over-long word', () => {
    expect(slugify('a'.repeat(80))).toHaveLength(SLUG_MAX)
    expect(slugify('word '.repeat(30), 12)).toBe('word-word')
  })
})

describe('renderBranchName', () => {
  it('fills the template', () => {
    expect(renderBranchName('feature/{KEY}-{slug}', { KEY: 'NM-1234', slug: 'add-login' })).toBe(
      'feature/NM-1234-add-login',
    )
    expect(renderBranchName('bugfix/{KEY}-{slug}', { KEY: 'NM-9', slug: 'crash' })).toBe(
      'bugfix/NM-9-crash',
    )
  })
  it('drops empty parts with their separator', () => {
    expect(renderBranchName('feature/{KEY}-{slug}', { KEY: 'NM-12', slug: '' })).toBe(
      'feature/NM-12',
    )
    expect(renderBranchName('feature/{KEY}-{slug}', { slug: 'tidy-up' })).toBe('feature/tidy-up')
    // Nothing to name it after: no bare "feature".
    expect(renderBranchName('feature/{KEY}-{slug}', { KEY: ' ', slug: '' })).toBe('')
  })
  it('produces valid git branch names', () => {
    for (const title of ['Café', 'a..b', 'x~y^z:w?*[', 'ends with dot.', '日本']) {
      const name = renderBranchName('feature/{KEY}-{slug}', { KEY: 'NM-1', slug: slugify(title) })
      expect(isValidBranchName(name), name).toBe(true)
    }
  })
})

describe('uniqueBranchName', () => {
  const t = 'feature/{KEY}-{slug}'
  it('returns the rendered name when free', () => {
    expect(uniqueBranchName(t, { KEY: 'NM-1', slug: 'x' }, new Set(['main']))).toBe(
      'feature/NM-1-x',
    )
  })
  it('adds -2, -3 on collisions (case-insensitive)', () => {
    const taken = new Set(['feature/NM-1-x', 'Feature/NM-1-X-2'])
    expect(uniqueBranchName(t, { KEY: 'NM-1', slug: 'x' }, taken)).toBe('feature/NM-1-x-3')
  })
  it('keeps the slug within the limit including the suffix', () => {
    const slug = slugify('a'.repeat(SLUG_MAX))
    const name = uniqueBranchName(t, { KEY: 'NM-1', slug }, new Set([`feature/NM-1-${slug}`]))
    const slugPart = name.slice('feature/NM-1-'.length)
    expect(slugPart).toMatch(/-2$/)
    expect(slugPart.length).toBeLessThanOrEqual(SLUG_MAX)
  })
  it('numbers a name with no slug', () => {
    expect(uniqueBranchName(t, { KEY: 'NM-1', slug: '' }, new Set(['feature/NM-1']))).toBe(
      'feature/NM-1-2',
    )
  })
})

describe('isValidBranchName', () => {
  it.each(['main', 'feature/NM-1-x', 'release/1.2.0'])('accepts %s', (n) => {
    expect(isValidBranchName(n)).toBe(true)
  })
  it.each(['', '-x', '.hidden', 'a..b', 'a b', 'x.lock', 'a//b', 'a/', 'x@{1}', '@', 'tab\there'])(
    'rejects %j',
    (n) => {
      expect(isValidBranchName(n)).toBe(false)
    },
  )
})

describe('isProtectedBranch', () => {
  const p = DEFAULT_PROTECTED
  it.each(['main', 'master', 'develop', 'release/1.4', 'refs/heads/main', 'MAIN', 'Release/2'])(
    'blocks %s',
    (b) => {
      expect(isProtectedBranch(b, p)).toBe(true)
    },
  )
  it.each(['feature/main', 'main-fix', 'release', 'release/1.4/hotfix', 'developer'])(
    'allows %s',
    (b) => {
      expect(isProtectedBranch(b, p)).toBe(false)
    },
  )
  it('supports ** across segments and custom lists', () => {
    expect(isProtectedBranch('release/1.4/hotfix', ['release/**'])).toBe(true)
    expect(isProtectedBranch('main', [])).toBe(false)
    expect(isProtectedBranch('hotfix/x', ['hotfix/*', ' '])).toBe(true)
  })
})
