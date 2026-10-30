import os,tempfile
from playwright.sync_api import sync_playwright
URL=os.environ.get('PAPERUS_TEST_URL','http://localhost:18083')
ENGINE=os.environ.get('PAPERUS_TEST_BROWSER','webkit')
ARGS=['--host-resolver-rules='+os.environ['PAPERUS_TEST_HOST_MAPPING']] if ENGINE=='chromium' and os.environ.get('PAPERUS_TEST_HOST_MAPPING') else []
PROFILE=tempfile.mkdtemp(prefix='paperus-background-profile-')
INITIAL='Treść starszej notatki przed pracą offline.'
EDITED=INITIAL+'\nZmiana offline wysłana bez ponownego otwierania notatki.'
TITLE='Starsza notatka — background test'

def ready(page):
 page.goto(URL,wait_until='domcontentloaded',timeout=60000)
 page.wait_for_function('!!window.p2pTeamManager',timeout=60000)
 if page.locator('.pob-skip').is_visible():page.locator('.pob-skip').click()

def open_note(page,data):
 page.evaluate("d=>window.dispatchEvent(new CustomEvent('cmd:open-team-note',{detail:d}))",data)
 page.wait_for_function('t=>window.cmView && document.querySelector("#doc-title")?.value===t && !window.isUpdatingFromYjs',arg=TITLE,timeout=30000)

def watch(page):
 page.on('dialog',lambda d:d.dismiss())
 page.on('pageerror',lambda e:print('PAGEERROR',e,flush=True))

with sync_playwright() as p:
 bt=getattr(p,ENGINE);opts=p.devices['iPhone 13'].copy();opts.pop('default_browser_type',None)
 def launch(offline=False):
  return bt.launch_persistent_context(PROFILE,headless=True,args=ARGS,offline=offline,service_workers='allow',**opts)
 c=launch();page=c.pages[0];watch(page);ready(page)
 page.wait_for_function('document.querySelector("#paperus-offline [data-info]")?.textContent.includes("The app is stored")',timeout=90000)
 data=page.evaluate('''async title=>{
  const m=window.p2pTeamManager,t=await m.createTeam('Background regression '+Date.now());
  const noteId=await m.createNote(t.teamId,{title});
  for(let i=0;i<15;i++)await m.createNote(t.teamId,{title:'Nowsza notatka '+i});
  return {teamId:t.teamId,noteId,rootKey:t.rootKey};
 }''',TITLE)
 open_note(page,data)
 page.evaluate('t=>window.cmView.dispatch({changes:{from:0,to:window.cmView.state.doc.length,insert:t}})',INITIAL)
 # Verify the starting value really reached the relay, in an isolated peer.
 b=bt.launch(headless=True,args=ARGS);peerctx=b.new_context(**opts);peer=peerctx.new_page();watch(peer);ready(peer)
 peer.evaluate('async key=>await window.p2pTeamManager.joinTeam(key)',data['rootKey'])
 peer.wait_for_function('d=>!!window.p2pTeamManager.getNoteMeta(d.teamId,d.noteId)',arg=data,timeout=45000)
 open_note(peer,data);peer.wait_for_function('t=>window.cmView.state.doc.toString()===t',arg=INITIAL,timeout=45000)
 b.close();c.close()
 c=launch(True);page=c.pages[0];watch(page);ready(page)
 page.wait_for_function('id=>window.p2pTeamManager.getTeams().some(t=>t.teamId===id)',arg=data['teamId'])
 open_note(page,data);page.wait_for_function('t=>window.cmView.state.doc.toString()===t',arg=INITIAL)
 page.evaluate('t=>window.cmView.dispatch({changes:{from:0,to:window.cmView.state.doc.length,insert:t}})',EDITED)
 page.wait_for_timeout(1500);c.close()
 print(ENGINE,'edited an older note offline; browser fully closed',flush=True)
 c=launch();page=c.pages[0];watch(page);ready(page)
 page.wait_for_function('d=>window.p2pTeamManager._teams.get(d.teamId)?.notes.size===16',arg=data,timeout=30000)
 assert page.evaluate('d=>!window.p2pTeamManager._teams.get(d.teamId)._openNotes.has(d.noteId)',data)
 page.wait_for_function('''d=>{const e=window.p2pTeamManager._teams.get(d.teamId);return e&&!e._webSyncRunning&&document.querySelector('[data-sync]').textContent.includes('complete: 16')}''',arg=data,timeout=120000)
 assert page.evaluate('d=>!window.p2pTeamManager._teams.get(d.teamId)._openNotes.has(d.noteId)',data)
 print(ENGINE,'all 16 closed notes synced after app startup; target never opened',flush=True)
 # Stop the sender so the new client must obtain the edit from the QNAP.
 c.close()
 b=bt.launch(headless=True,args=ARGS);peerctx=b.new_context(**opts);peer=peerctx.new_page();watch(peer);ready(peer)
 peer.evaluate('async key=>await window.p2pTeamManager.joinTeam(key)',data['rootKey'])
 peer.wait_for_function('d=>!!window.p2pTeamManager.getNoteMeta(d.teamId,d.noteId)',arg=data,timeout=45000)
 open_note(peer,data);peer.wait_for_function('t=>window.cmView.state.doc.toString()===t',arg=EDITED,timeout=45000)
 print(ENGINE,'QNAP delivered offline edit to a new device while sender was closed',flush=True)
 print(ENGINE,'BACKGROUND SYNC PASS',flush=True);b.close()
