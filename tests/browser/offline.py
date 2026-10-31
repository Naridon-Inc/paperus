import os, tempfile
from playwright.sync_api import sync_playwright
URL=os.environ.get('PAPERUS_TEST_URL','http://localhost:18083')
ENGINE=os.environ.get('PAPERUS_TEST_BROWSER','webkit')
BROWSER_ARGS=['--host-resolver-rules='+os.environ['PAPERUS_TEST_HOST_MAPPING']] if ENGINE=='chromium' and os.environ.get('PAPERUS_TEST_HOST_MAPPING') else []
PROFILE=tempfile.mkdtemp(prefix='paperus-offline-profile-')
NOTE='Notatka testowa offline — '+ENGINE
ONLINE='Treść zapisana przed wyłączeniem sieci.'
OFFLINE=ONLINE+'\nDopisane na iPhonie bez sieci.'

def open_note(page, data):
 page.evaluate("d=>window.dispatchEvent(new CustomEvent('cmd:open-team-note',{detail:d}))",data)
 page.wait_for_function('title=>window.cmView && document.querySelector("#doc-title")?.value===title && window.isUpdatingFromYjs===false',arg=NOTE,timeout=30000)

def ready(page):
 page.goto(URL,wait_until='domcontentloaded',timeout=60000)
 page.wait_for_function('!!window.p2pTeamManager',timeout=60000)
 if page.locator('.pob-skip').is_visible():
  page.locator('.pob-skip').click()
  page.wait_for_timeout(300)

def watch(page):
 page.on('pageerror',lambda e:print('PAGEERROR',str(e),flush=True))
 page.on('dialog',lambda d:d.dismiss())

with sync_playwright() as p:
 bt=getattr(p,ENGINE)
 opts=p.devices['iPhone 13'].copy()
 opts.pop('default_browser_type',None)
 c=bt.launch_persistent_context(PROFILE,headless=True,args=BROWSER_ARGS,service_workers='allow',**opts)
 page=c.pages[0];watch(page);ready(page)
 page.wait_for_function('document.querySelector("#paperus-offline [data-info]")?.textContent.includes("The app is stored")',timeout=90000)
 page.wait_for_function('!!navigator.serviceWorker.controller',timeout=30000)
 print(ENGINE,'shell ready and controlled',flush=True)
 data=page.evaluate('''async title=>{
  const t=await window.p2pTeamManager.createTeam('Offline test '+Date.now());
  const noteId=await window.p2pTeamManager.createNote(t.teamId,{title});
  return {teamId:t.teamId,noteId,rootKey:t.rootKey};
 }''',NOTE)
 open_note(page,data)
 page.evaluate('t=>window.cmView.dispatch({changes:{from:0,to:window.cmView.state.doc.length,insert:t}})',ONLINE)
 page.wait_for_function('t=>window.cmView.state.doc.toString()===t',arg=ONLINE)
 page.wait_for_timeout(2000)
 # Fully stop the browser, not merely the tab, to verify persistence to disk.
 c.close()
 c=bt.launch_persistent_context(PROFILE,headless=True,args=BROWSER_ARGS,service_workers='allow',offline=True,**opts)
 page=c.pages[0];watch(page);ready(page)
 page.wait_for_function('id=>window.p2pTeamManager.getTeams().some(t=>t.teamId===id)',arg=data['teamId'],timeout=30000)
 open_note(page,data)
 page.wait_for_function('t=>window.cmView.state.doc.toString()===t',arg=ONLINE,timeout=30000)
 print(ENGINE,'offline cold start restores team and note',flush=True)
 page.evaluate('t=>window.cmView.dispatch({changes:{from:0,to:window.cmView.state.doc.length,insert:t}})',OFFLINE)
 page.wait_for_timeout(1500)
 assert page.locator('.cm-content').is_visible()
 assert page.evaluate('document.querySelector(".cm-content").getBoundingClientRect().top < innerHeight - 60'), 'Note body must be visible below the title on iPhone'
 page.screenshot(path=os.path.join(os.environ.get('PAPERUS_ARTIFACT_DIR',tempfile.gettempdir()),'paperus-offline-'+ENGINE+'.png'))
 c.close()
 c=bt.launch_persistent_context(PROFILE,headless=True,args=BROWSER_ARGS,service_workers='allow',offline=True,**opts)
 page=c.pages[0];watch(page);ready(page)
 page.wait_for_function('id=>window.p2pTeamManager.getTeams().some(t=>t.teamId===id)',arg=data['teamId'])
 open_note(page,data)
 page.wait_for_function('t=>window.cmView.state.doc.toString()===t',arg=OFFLINE,timeout=30000)
 print(ENGINE,'offline edit survives another browser restart',flush=True)
 # APIs must not be answered from the offline shell cache.
 assert page.evaluate("async()=>{try{await fetch('/api/account/config');return false}catch(e){return true}}")
 c.set_offline(False)
 page.evaluate("window.dispatchEvent(new Event('online'))")
 page.wait_for_function("async()=>{try{return (await fetch('/health')).ok}catch(e){return false}}",timeout=30000)
 other=bt.launch(headless=True,args=BROWSER_ARGS)
 second=other.new_context(service_workers='allow',**opts)
 peer=second.new_page();watch(peer);ready(peer)
 peer.evaluate('async key=>await window.p2pTeamManager.joinTeam(key)',data['rootKey'])
 peer.wait_for_function('d=>!!window.p2pTeamManager.getNoteMeta(d.teamId,d.noteId)',arg=data,timeout=45000)
 open_note(peer,data)
 peer.wait_for_function('t=>window.cmView.state.doc.toString()===t',arg=OFFLINE,timeout=45000)
 print(ENGINE,'offline edit synced to a second device after reconnect',flush=True)
 print(ENGINE,'PASS',flush=True)
 other.close();c.close()
