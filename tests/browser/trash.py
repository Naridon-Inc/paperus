import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 engine=os.environ.get('PAPERUS_TEST_BROWSER','webkit')
 args=['--host-resolver-rules='+os.environ['PAPERUS_TEST_HOST_MAPPING']] if os.environ.get('PAPERUS_TEST_HOST_MAPPING') and engine=='chromium' else []
 b=getattr(p,engine).launch(args=args);c=b.new_context()
 c.add_init_script('''localStorage.setItem('notionless_onboarded','1');localStorage.setItem('setting_knownFiles',JSON.stringify(['root/Keep.md','root/.trash/t_test__Removed.md']));localStorage.setItem('vfs_root/Keep.md','Original private note');localStorage.setItem('vfs_root/.trash/t_test__Removed.md','Archived content');localStorage.setItem('setting_recentDocs',JSON.stringify([{type:'local',path:'root/.trash/t_test__Removed.md',name:'t_test__Removed'}]));''')
 page=c.new_page();page.on('dialog',lambda d:d.accept())
 page.goto(os.environ.get('PAPERUS_TEST_URL','http://localhost:18085'),wait_until='domcontentloaded')
 page.wait_for_function('!!window.p2pTeamManager')
 page.wait_for_function('document.querySelector(".tree-item[data-path=\\"root/Keep.md\\"]")')
 assert page.locator('.tree-item[data-path*=".trash/"]').count()==0
 assert page.locator('#recents-section').inner_text().find('t_test__Removed')<0
 original=page.evaluate("async()=>{const id=await window.api.invoke('fs:getDocId','root/Keep.md');await window.api.invoke('fs:rename','root/Keep.md','root/.trash/manual.md');if(await window.api.invoke('fs:getDocId','root/.trash/manual.md')!==id)throw Error('identity changed on trash');await window.api.invoke('fs:rename','root/.trash/manual.md','root/Keep.md');return id}")
 page.locator('.tree-item[data-path="root/Keep.md"]').click()
 page.wait_for_function('window.cmView?.state.doc.toString()==="Original private note"&&!window.isUpdatingFromYjs')
 page.evaluate("window.cmView.dispatch({changes:{from:window.cmView.state.doc.length,insert:' — latest edit'}})")
 page.evaluate("window.dispatchEvent(new CustomEvent('cmd:trash-file',{detail:{path:'root/Keep.md'}}))")
 page.wait_for_function("!JSON.parse(localStorage.getItem('setting_knownFiles')).includes('root/Keep.md')")
 page.wait_for_timeout(1600)
 assert page.evaluate("localStorage.getItem('vfs_root/Keep.md')") is None
 assert page.locator('.tree-item[data-path*=".trash/"]').count()==0
 assert page.evaluate("Object.keys(localStorage).some(k=>k.startsWith('vfs_')&&k.includes('/.trash/')&&localStorage.getItem(k).includes('latest edit'))")
 page.evaluate("document.querySelector('#trash-btn').click()")
 page.wait_for_selector('.trash-overlay')
 page.get_by_role('button',name='Restore',exact=True).click()
 page.wait_for_function("JSON.parse(localStorage.getItem('setting_knownFiles')).includes('root/Keep.md')")
 assert page.evaluate("window.api.invoke('fs:getDocId','root/Keep.md')")==original
 assert 'latest edit' in page.evaluate("window.api.readFile('root/Keep.md')")
 print('Trash hidden from Private/Recent; no resurrection; restore preserves identity and edits: PASS')
 b.close()
