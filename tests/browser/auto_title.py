import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 engine=os.environ.get('PAPERUS_TEST_BROWSER','webkit')
 args=['--host-resolver-rules='+os.environ['PAPERUS_TEST_HOST_MAPPING']] if os.environ.get('PAPERUS_TEST_HOST_MAPPING') and engine=='chromium' else []
 b=getattr(p,engine).launch(args=args);c=b.new_context()
 c.add_init_script("localStorage.setItem('notionless_onboarded','1')")
 page=c.new_page();page.goto(os.environ.get('PAPERUS_TEST_URL','http://localhost:18085'),wait_until='domcontentloaded')
 page.wait_for_function('!!window.p2pTeamManager')
 team=page.evaluate("async()=>{const t=await window.p2pTeamManager.createTeam('Dom');await window.api.setSettings('defaultNoteTeamId',t.teamId);return t.teamId}")
 def create():
  page.evaluate("document.querySelector('#add-btn').click()")
  page.wait_for_function("document.querySelector('#doc-title').value==='Untitled'&&!window.isUpdatingFromYjs")
  page.wait_for_timeout(400)
 def body(text):
  page.evaluate("text=>{window.cmView.focus();window.cmView.dispatch({changes:{from:0,to:window.cmView.state.doc.length,insert:text}})}",text)
 create();body('Zakupy do domu na najbliższy weekend i jeszcze coś')
 page.wait_for_function("document.querySelector('#doc-title').value==='Zakupy do domu na najbliższy weekend'")
 assert page.locator('.page-title').input_value()=='Zakupy do domu na najbliższy weekend'
 assert page.evaluate('id=>window.p2pTeamManager.getNotesTree(id)[0].title',team)=='Zakupy do domu na najbliższy weekend'
 page.locator('.page-title').fill('Mój własny tytuł');page.locator('.page-title').press('Enter')
 body('Inna treść nie zmienia własnego tytułu');page.wait_for_timeout(1700)
 assert page.locator('#doc-title').input_value()=='Mój własny tytuł'
 create();body('Szybka zmiana notatki zanim timer zadziała')
 page.locator('.page-title').fill('Tytuł wpisany w trakcie');page.locator('.page-title').press('Enter')
 page.wait_for_timeout(1700);assert page.locator('#doc-title').input_value()=='Tytuł wpisany w trakcie'
 page.evaluate("window.api.setSettings('defaultNoteTeamId',null)")
 create();body('Prywatna notatka z początkiem jako tytułem')
 page.wait_for_function("document.querySelector('#doc-title').value==='Prywatna notatka z początkiem jako tytułem'")
 page.wait_for_function("JSON.parse(localStorage.getItem('setting_knownFiles')).some(p=>p.endsWith('/Prywatna notatka z początkiem jako tytułem.md'))")
 assert page.evaluate('window.cmView.state.doc.toString()')=='Prywatna notatka z początkiem jako tytułem'
 create();body('Prywatna notatka z początkiem jako tytułem druga treść')
 page.wait_for_function("JSON.parse(localStorage.getItem('setting_knownFiles')).some(p=>p.endsWith('/Prywatna notatka z początkiem jako tytułem 1.md'))")
 assert page.evaluate("Object.keys(localStorage).some(k=>k.endsWith('/Prywatna notatka z początkiem jako tytułem.md')&&localStorage.getItem(k)==='Prywatna notatka z początkiem jako tytułem')")
 print('Automatic titles: shared index, local filename, body preserved, manual title and pending-timer protection: PASS')
 b.close()
