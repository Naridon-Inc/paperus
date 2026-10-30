import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.webkit.launch();c=b.new_context(service_workers='allow');page=c.new_page()
 page.goto(os.environ.get('PAPERUS_TEST_URL','http://localhost:18085'),wait_until='domcontentloaded')
 page.wait_for_function('async()=>!!(await navigator.serviceWorker.getRegistration())?.active',timeout=90000)
 page.wait_for_function('!!window.p2pTeamManager',timeout=60000)
 page.wait_for_function('!!navigator.serviceWorker.controller',timeout=30000)
 c.set_offline(True);page.reload(wait_until='domcontentloaded')
 page.wait_for_function('!!window.p2pTeamManager',timeout=60000)
 print('Static hosting without Docker runtime settings: offline reload PASS',flush=True)
 b.close()
