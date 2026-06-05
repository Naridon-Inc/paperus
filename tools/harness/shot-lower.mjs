import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1000, height: 1150 } })
await p.goto('http://localhost:8799/', { waitUntil: 'load' })
await p.waitForFunction(() => window.__harnessReady, { timeout: 20000 }).catch(()=>{})
await p.waitForTimeout(4000)
// Scroll whatever the real scroll container is so the lower blocks are visible.
const info = await p.evaluate(() => {
  const sc = document.querySelector('.cm-scroller')
  const emb = document.querySelector('.cm-embed')
  let scrolled = 'none'
  if (sc && sc.scrollHeight > sc.clientHeight) { sc.scrollTop = sc.scrollHeight; scrolled = 'cm-scroller' }
  else if (emb) { emb.scrollIntoView({ block: 'start' }); scrolled = 'window-to-embed' }
  return { scrolled, scrollerH: sc?.scrollHeight, clientH: sc?.clientHeight, bodyH: document.body.scrollHeight }
})
console.log('SCROLL_INFO:', JSON.stringify(info))
await p.waitForTimeout(1200)
await p.screenshot({ path: 'tools/harness/harness-lower.png' })
await b.close()
console.log('done')
