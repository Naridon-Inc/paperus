import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveEmbedSrc, EmbedWidget } from '../src/renderer/src/cm-embed.js'
test('reject unsafe schemes and lookalike hosts', () => {
 for (const url of ['javascript:alert(1)', 'data:text/html,test', '//youtube.com/watch?v=abcdefg', 'https://evil.example/youtube.com/watch?v=abcdefg', 'https://youtube.com.evil.example/watch?v=abcdefg', 'https://user@youtube.com/watch?v=abcdefg', 'http://youtube.com/watch?v=abcdefg']) assert.equal(resolveEmbedSrc(url), null)
})
test('supported providers produce canonical HTTPS URLs', () => {
 assert.equal(resolveEmbedSrc('https://youtu.be/abcdefghijk'), 'https://www.youtube.com/embed/abcdefghijk')
 assert.equal(resolveEmbedSrc('https://player.vimeo.com/video/123456'), 'https://player.vimeo.com/video/123456')
})
test('widget validates at the sink and isolates allowed frames', () => {
 globalThis.document = { createElement: tag => ({ tag, children: [], attributes: {}, setAttribute(k,v){this.attributes[k]=v}, appendChild(c){this.children.push(c)} }) }
 assert.equal(new EmbedWidget('javascript:alert(1)').toDOM().children.length, 0)
 const frame = new EmbedWidget('https://youtu.be/abcdefghijk').toDOM().children[0]
 assert.equal(frame.referrerPolicy, 'no-referrer')
 assert.equal(frame.attributes.sandbox, 'allow-scripts allow-presentation')
 delete globalThis.document
})
