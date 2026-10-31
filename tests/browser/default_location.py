import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 engine=os.environ.get('PAPERUS_TEST_BROWSER','webkit')
 args=['--host-resolver-rules='+os.environ['PAPERUS_TEST_HOST_MAPPING']] if os.environ.get('PAPERUS_TEST_HOST_MAPPING') and engine=='chromium' else []
 b=getattr(p,engine).launch(args=args)
 opts=p.devices['iPhone 13'].copy();opts.pop('default_browser_type',None)
 c=b.new_context(**opts);c.add_init_script("localStorage.setItem('notionless_onboarded','1')")
 page=c.new_page();page.on('dialog',lambda d:d.accept())
 page.goto(os.environ.get('PAPERUS_TEST_URL','http://localhost:18085'),wait_until='domcontentloaded')
 page.wait_for_function('!!window.p2pTeamManager')
 team=page.evaluate("async()=>{const m=window.p2pTeamManager;return (await m.createTeam('Dom')).teamId}")
 def settings():
  page.evaluate("document.querySelector('#account-btn').click()")
  page.locator('#wp-settings').click()
  page.wait_for_selector('#default-note-team')
 settings()
 page.locator('#default-note-team').select_option(team)
 page.wait_for_function("document.querySelector('#note-preferences-status').textContent==='Saved'")
 page.locator('#note-preferences-close').click()
 page.reload(wait_until='domcontentloaded')
 page.wait_for_function('id=>window.p2pTeamManager?.getTeams().some(t=>t.teamId===id)',arg=team)
 settings();assert page.locator('#default-note-team').input_value()==team
 page.locator('#note-preferences-close').click()
 page.evaluate("document.querySelector('#add-btn').click()")
 page.wait_for_function('id=>window.p2pTeamManager.getNotesTree(id).length===1',arg=team)
 page.wait_for_function('!!window.cmView&&!window.isUpdatingFromYjs')
 assert not page.evaluate("JSON.parse(localStorage.getItem('setting_knownFiles')||'[]').some(p=>p.includes('Untitled'))")
 settings();page.locator('#default-note-team').select_option('')
 page.wait_for_function("document.querySelector('#note-preferences-status').textContent==='Saved'")
 page.locator('#note-preferences-close').click()
 page.evaluate("document.querySelector('#add-btn').click()")
 page.wait_for_function("JSON.parse(localStorage.getItem('setting_knownFiles')||'[]').some(p=>p.includes('Untitled'))")
 assert page.evaluate('id=>window.p2pTeamManager.getNotesTree(id).length',team)==1
 page.evaluate("window.api.setSettings('defaultNoteTeamId','missing-team')")
 page.evaluate("document.querySelector('#add-btn').click()")
 page.wait_for_selector('#default-note-team')
 assert page.locator('#default-note-team').input_value()=='missing-team'
 assert len(page.evaluate("JSON.parse(localStorage.getItem('setting_knownFiles')||'[]')"))==1
 print('Default team: settings persistence, shared creation, private opt-out, missing-team safeguard: PASS')
 b.close()
