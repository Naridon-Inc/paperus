import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkboxChange } from '../src/renderer/src/checklist.js'
function toggle(text, item, done, sort = true, order = {}) {
 const change = checkboxChange(text, text.indexOf(item), done, sort, order)
 return text.slice(0, change.from) + change.insert + text.slice(change.to)
}
test('stable ordering stays inside its list and preserves surrounding text', () => {
 const before = '# Zakupy\n- [ ] mleko\n- [x] chleb\n- [ ] masło\n\n# Inne\n- [ ] telefon\n'
 assert.equal(toggle(before,'mleko',true), '# Zakupy\n- [ ] masło\n- [x] chleb\n- [x] mleko\n\n# Inne\n- [ ] telefon\n')
})
test('unchecking restores unfinished group; disabling leaves position unchanged', () => {
 const before = '- [ ] A\n- [x] B\n- [x] C'
 assert.equal(toggle(before,'C',false), '- [ ] A\n- [ ] C\n- [x] B')
 assert.equal(toggle(before,'A',true,false), '- [x] A\n- [x] B\n- [x] C')
})
test('parent carries nested tasks and continuation text; nested check stays inside parent', () => {
 const before = '- [ ] A\n  opis\n  - [ ] A1\n  - [ ] A2\n- [ ] B\n'
 assert.equal(toggle(before,'A\n',true), '- [ ] B\n- [x] A\n  opis\n  - [ ] A1\n  - [ ] A2\n')
 assert.equal(toggle(before,'A1',true), '- [ ] A\n  opis\n  - [ ] A2\n  - [x] A1\n- [ ] B\n')
})
test('duplicate labels retain all items; no final newline is added', () => {
 assert.equal(toggle('- [ ] A\n- [ ] A\n- [x] B','A',true), '- [ ] A\n- [x] B\n- [x] A')
})
test('automatic title excludes checklist markers', async () => {
 const { titleFromContent } = await import('../src/renderer/src/auto-title.js')
 assert.equal(titleFromContent('- [ ] Mleko\n- [x] Chleb\n- [ ] Masło'), 'Mleko Chleb Masło')
})

test('multiple completions restore original positions even after serializing history', () => {
 let order = {}
 let text = '- [ ] A\n- [ ] B\n- [ ] C\n- [ ] D'
 text = toggle(text, 'B', true, true, order)
 text = toggle(text, 'A', true, true, order)
 assert.equal(text, '- [ ] C\n- [ ] D\n- [x] B\n- [x] A')
 order = JSON.parse(JSON.stringify(order))
 text = toggle(text, 'B', false, true, order)
 assert.equal(text, '- [ ] B\n- [ ] C\n- [ ] D\n- [x] A')
 text = toggle(text, 'A', false, true, order)
 assert.equal(text, '- [ ] A\n- [ ] B\n- [ ] C\n- [ ] D')
})
