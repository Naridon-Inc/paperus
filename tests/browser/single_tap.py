import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 engine=os.environ.get('PAPERUS_TEST_BROWSER','webkit')
 args=['--host-resolver-rules='+os.environ['PAPERUS_TEST_HOST_MAPPING']] if os.environ.get('PAPERUS_TEST_HOST_MAPPING') and engine=='chromium' else []
 b=getattr(p,engine).launch(args=args)
 opts=p.devices['iPhone 13'].copy();opts.pop('default_browser_type',None)
 c=b.new_context(**opts);c.add_init_script("localStorage.setItem('notionless_onboarded','1')");page=c.new_page()
 page.goto(os.environ.get('PAPERUS_TEST_URL','http://localhost:18083'),wait_until='domcontentloaded')
 page.wait_for_function('!!window.p2pTeamManager')
 if page.locator('.pob-skip').is_visible():page.locator('.pob-skip').click()
 page.evaluate("async()=>{const m=window.p2pTeamManager,t=await m.createTeam('Single tap test');await m.createNote(t.teamId,{title:'Tap first'});await m.createNote(t.teamId,{title:'Tap second'})}")
 for title in ['Tap first','Tap second']:
  if page.locator('#sidebar').evaluate("e=>e.classList.contains('collapsed')"):
   page.locator('#sidebar-expand-btn').tap()
  row=page.locator('.sidebar-doc-item').filter(has_text=title)
  assert row.evaluate('e=>e.onmouseenter===null')
  row.tap()
  page.wait_for_function('t=>document.querySelector("#doc-title")?.value===t&&!window.isUpdatingFromYjs',arg=title,timeout=15000)
  page.locator('#sidebar-expand-btn').tap()
  page.touchscreen.tap(page.viewport_size['width']-8,300)
  page.wait_for_function('document.querySelector("#sidebar").classList.contains("collapsed")')
  assert not page.evaluate('document.activeElement?.isContentEditable || false')
 print('Single-tap note opening and outside-tap menu dismissal: PASS')
 b.close()
