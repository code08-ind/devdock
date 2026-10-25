/**
 * xterm.js writes its per-terminal CSS (cell size, theme colours, scrollbar) into `<style>`
 * elements it creates. DevDock's CSP (`style-src 'self'`, no 'unsafe-inline') blocks those, and
 * loosening the CSP for the whole app would weaken SPEC 5. Instead, a `<style>` element made by
 * this page gets its text applied through a constructed stylesheet (CSSOM from our own bundled
 * code, the same trust as `element.style`), adopted by the document while the element exists.
 * The element itself stays empty, so nothing inline is ever parsed.
 *
 * Only xterm makes `<style>` elements in DevDock (React and our CSS never do).
 */
let installed = false

export function installStyleShim(): void {
  if (installed) return
  installed = true
  const create = Document.prototype.createElement
  Document.prototype.createElement = function (
    this: Document,
    tag: string,
    options?: ElementCreationOptions,
  ) {
    const el = create.call(this, tag, options)
    if (tag.toLowerCase() === 'style') adopt(el as HTMLStyleElement, this)
    return el
  } as typeof Document.prototype.createElement
}

function adopt(el: HTMLStyleElement, doc: Document): void {
  const sheet = new CSSStyleSheet()
  let text = ''
  const attach = () => {
    if (!doc.adoptedStyleSheets.includes(sheet)) {
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
    }
  }
  Object.defineProperty(el, 'textContent', {
    configurable: true,
    get: () => text,
    set: (value: unknown) => {
      text = value == null ? '' : String(value)
      sheet.replaceSync(text)
      attach()
    },
  })
  const remove = el.remove.bind(el)
  el.remove = () => {
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet)
    remove()
  }
}
