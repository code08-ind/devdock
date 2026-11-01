import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The page's head: one site URL everywhere, and every file it names really ships. */
const root = join(import.meta.dirname, '../..')
const html = readFileSync(join(root, 'index.html'), 'utf8')
const pub = (p: string) => join(root, 'public', p.replace(/^\//, ''))
const SITE = 'https://devdock.aryangarg.com/'

const meta = (attr: 'name' | 'property', key: string) =>
  new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`).exec(html)?.[1]

describe('SEO and link previews', () => {
  it('one canonical URL in the head, the sitemap and robots.txt', () => {
    expect(/<link rel="canonical" href="([^"]+)"/.exec(html)?.[1]).toBe(SITE)
    expect(meta('property', 'og:url')).toBe(SITE)
    expect(readFileSync(pub('sitemap.xml'), 'utf8')).toContain(`<loc>${SITE}</loc>`)
    expect(readFileSync(pub('robots.txt'), 'utf8')).toContain(`Sitemap: ${SITE}sitemap.xml`)
  })

  it('a title and description of search-friendly length', () => {
    const title = /<title>([^<]+)<\/title>/.exec(html)![1]!
    expect(title.length).toBeLessThanOrEqual(65)
    const description = /name="description"\s+content="([^"]+)"/.exec(html)![1]!
    expect(description.length).toBeGreaterThan(70)
    expect(description.length).toBeLessThanOrEqual(220)
  })

  it('link previews use an absolute 1200×630 PNG that exists', () => {
    for (const key of ['og:image']) expect(meta('property', key)).toBe(`${SITE}og.png`)
    expect(meta('name', 'twitter:image')).toBe(`${SITE}og.png`)
    expect(meta('name', 'twitter:card')).toBe('summary_large_image')
    const png = readFileSync(pub('og.png'))
    // PNG IHDR: width and height at bytes 16–23.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
  })

  it('every icon and the manifest it names exist', () => {
    const hrefs = [
      ...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g),
    ].map((m) => m[1]!)
    expect(hrefs.length).toBeGreaterThanOrEqual(5)
    for (const h of hrefs) expect(existsSync(pub(h)), h).toBe(true)
    const manifest = JSON.parse(readFileSync(pub('site.webmanifest'), 'utf8')) as {
      icons: { src: string }[]
    }
    for (const i of manifest.icons) expect(existsSync(pub(i.src)), i.src).toBe(true)
  })

  it('the structured data is valid JSON describing a free app', () => {
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]!
    const data = JSON.parse(block) as Record<string, unknown>
    expect(data).toMatchObject({
      '@type': 'SoftwareApplication',
      url: SITE,
      offers: { price: '0' },
    })
  })
})

describe('the Downloads page', () => {
  const page = readFileSync(join(root, 'downloads.html'), 'utf8')

  it('has its own canonical URL, title and description, and is in the sitemap', () => {
    expect(/<link rel="canonical" href="([^"]+)"/.exec(page)?.[1]).toBe(`${SITE}downloads`)
    expect(/<title>([^<]+)<\/title>/.exec(page)?.[1]).toBe('Download DevDock for macOS and Windows')
    const description = /name="description"\s+content="([^"]+)"/.exec(page)![1]!
    expect(description.length).toBeGreaterThan(70)
    expect(description.length).toBeLessThanOrEqual(220)
    expect(readFileSync(pub('sitemap.xml'), 'utf8')).toContain(`<loc>${SITE}downloads</loc>`)
  })

  it('the home page sends every download button there', () => {
    expect(html).toContain('href="downloads#mac"')
    expect(html).toContain('href="downloads#windows"')
    expect(html).not.toContain('id="thanks"')
  })
})
