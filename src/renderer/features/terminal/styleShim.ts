/**
 * xterm.js styles itself in two ways that DevDock's CSP (`style-src 'self'`, no
 * 'unsafe-inline') blocks: `<style>` elements with its per-terminal CSS (cell size, theme
 * colours, scrollbar), and `element.style.x = …` on its own elements (sizes, the viewport's
 * background), which Chromium checks as inline style attributes. Loosening the CSP for the whole
 * window would weaken SPEC 5, so this shim keeps both inside constructed stylesheets — CSSOM
 * from our own bundled code, which the CSP allows — adopted by the document:
 *
 * - a `<style>` element asked for by this page is an inert `<template>` whose text is applied
 *   through its own constructed sheet until it is removed, so no inline style is ever parsed;
 * - an element's `style` (on first use) is the declaration of a rule in one shared sheet that
 *   matches only that element, with an id-level specificity so it wins over xterm.css like a
 *   real inline style would.
 *
 * Only elements made with `document.createElement` after the first terminal opens are touched,
 * and only once their `style` is read; React and DevDock's own CSS never use inline styles
 * (DECISIONS: no inline style attributes), so in practice this is xterm's elements only.
 */
let installed = false
let nextId = 1
let inlineSheet: CSSStyleSheet | null = null

const ATTR = 'data-devdock-style'

export function installStyleShim(): void {
  if (installed) return
  installed = true
  const create = Document.prototype.createElement
  Document.prototype.createElement = function (
    this: Document,
    tag: string,
    options?: ElementCreationOptions,
  ) {
    if (tag.toLowerCase() === 'style') {
      // Even an empty <style> in the page is checked (and refused) by the CSP, so xterm gets an
      // inert <template> in its place: it only ever sets `textContent` and calls `remove()`.
      const stand = create.call(this, 'template', options) as HTMLTemplateElement
      adoptStyleElement(stand, this)
      return stand
    }
    const el = create.call(this, tag, options)
    redirectInlineStyle(el, this)
    return el
  } as typeof Document.prototype.createElement
}

function attach(doc: Document, sheet: CSSStyleSheet): void {
  if (!doc.adoptedStyleSheets.includes(sheet)) {
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
  }
}

function adoptStyleElement(el: HTMLElement, doc: Document): void {
  const sheet = new CSSStyleSheet()
  let text = ''
  Object.defineProperty(el, 'textContent', {
    configurable: true,
    get: () => text,
    set: (value: unknown) => {
      text = value == null ? '' : String(value)
      sheet.replaceSync(text)
      attach(doc, sheet)
    },
  })
  const remove = el.remove.bind(el)
  el.remove = () => {
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet)
    remove()
  }
}

/** Rules of elements that were garbage-collected are dropped from the shared sheet. */
const released =
  typeof FinalizationRegistry === 'undefined'
    ? null
    : new FinalizationRegistry<CSSRule>((rule) => {
        const sheet = inlineSheet
        if (!sheet) return
        const index = Array.prototype.indexOf.call(sheet.cssRules, rule)
        if (index >= 0) sheet.deleteRule(index)
      })

function redirectInlineStyle(el: Element, doc: Document): void {
  let declaration: CSSStyleDeclaration | null = null
  Object.defineProperty(el, 'style', {
    configurable: true,
    get: () => {
      if (declaration) return declaration
      const id = String(nextId++)
      el.setAttribute(ATTR, id)
      inlineSheet ??= new CSSStyleSheet()
      attach(doc, inlineSheet)
      // `:not(#…)` lifts the rule to id specificity (xterm.css uses classes only), and the
      // adopted sheet comes after the document's, so it wins like an inline style.
      const index = inlineSheet.insertRule(
        `[${ATTR}="${id}"]:not(#devdock-never) {}`,
        inlineSheet.cssRules.length,
      )
      const rule = inlineSheet.cssRules[index] as CSSStyleRule
      released?.register(el, rule)
      declaration = rule.style
      return declaration
    },
  })
}
