import { chromium } from 'playwright'

const URL = process.env.HARNESS_URL || 'http://localhost:8799/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 3200 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

await page.goto(URL, { waitUntil: 'load' })
await page.waitForFunction(() => window.__harnessReady || window.__harnessError, { timeout: 20000 }).catch(() => {})
const harnessError = await page.evaluate(() => window.__harnessError || null)

// Give async widgets (mermaid render, katex, image fetch, iframe) time to settle.
await page.waitForTimeout(4000)

const checks = await page.evaluate(() => {
  const q = (s) => document.querySelectorAll(s).length
  return {
    callout: q('.cm-callout'),
    katex: q('.katex'),
    table: q('table'),
    database: q('[class*="cm-db"]'),
    mermaid_svg: q('.cm-mermaid svg'),
    toggle: q('.cm-toggle'),
    toc: q('.cm-toc'),
    embed_iframe: q('.cm-embed iframe'),
    bookmark: q('.cm-bookmark'),
    columns: q('.cm-columns'),
    image: q('.cm-image'),
    highlight: q('.cm-hl'),
    date_chip: q('.cm-date-chip'),
    reminder_chip: q('.cm-date-chip.cm-reminder'),
    crit_ins: q('.cm-crit-ins'),
    crit_del: q('.cm-crit-del'),
    crit_sub: q('.cm-crit-sub-new'),
    crit_mark: q('.cm-crit-mark'),
    crit_comment: q('.cm-crit-comment'),
    db_computed: q('.cm-db-computed'),
    db_chart_svg: q('.cm-db-chart-svg'),
    db_timeline_bar: q('.cm-db-tl-bar'),
    cm_editor: q('.cm-editor'),
    cm_lines: q('.cm-line'),
  }
})

await page.screenshot({ path: 'tools/harness/harness.png', fullPage: true })

// CM6 only decorates the visible viewport (the editor scrolls internally), so
// the bottom-of-document Round-6 features aren't in the DOM yet. Walk the
// scroller down in steps so every section renders at least once, accumulating
// the max count seen for each bottom feature.
const bottomKeys = ['date_chip', 'reminder_chip', 'crit_ins', 'crit_del', 'crit_sub', 'crit_mark', 'crit_comment', 'db_computed', 'db_chart_svg', 'db_timeline_bar']
const bottom = Object.fromEntries(bottomKeys.map((k) => [k, 0]))
const steps = await page.evaluate(() => {
  const s = document.querySelector('.cm-scroller')
  return s ? Math.ceil(s.scrollHeight / s.clientHeight) + 1 : 1
})
for (let i = 0; i <= steps; i++) {
  await page.evaluate((frac) => {
    const s = document.querySelector('.cm-scroller')
    if (s) s.scrollTop = Math.round(s.scrollHeight * frac)
  }, i / steps)
  await page.waitForTimeout(700)
  const seen = await page.evaluate((keys) => {
    const sel = {
      date_chip: '.cm-date-chip', reminder_chip: '.cm-date-chip.cm-reminder',
      crit_ins: '.cm-crit-ins', crit_del: '.cm-crit-del', crit_sub: '.cm-crit-sub-new',
      crit_mark: '.cm-crit-mark', crit_comment: '.cm-crit-comment',
      db_computed: '.cm-db-computed', db_chart_svg: '.cm-db-chart-svg', db_timeline_bar: '.cm-db-tl-bar',
    }
    const o = {}
    for (const k of keys) o[k] = document.querySelectorAll(sel[k]).length
    return o
  }, bottomKeys)
  for (const k of bottomKeys) bottom[k] = Math.max(bottom[k], seen[k])
}
// Final bottom screenshot (scroller parked at the end).
await page.evaluate(() => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = s.scrollHeight })
await page.waitForTimeout(1500)
await page.screenshot({ path: 'tools/harness/harness-lower.png', fullPage: true })

console.log('HARNESS_ERROR:', harnessError)
console.log('CHECKS_TOP:', JSON.stringify(checks))
console.log('CHECKS_BOTTOM:', JSON.stringify(bottom))
console.log('CONSOLE_ERRORS:', JSON.stringify(errors.slice(0, 25)))
await browser.close()
