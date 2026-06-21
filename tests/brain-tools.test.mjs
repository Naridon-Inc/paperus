/**
 * Company Brain tool-framework unit tests — run against the REAL renderer source
 * (rag-engine.js), no bundler, no browser. Covers the Phase 2 framework: the tool
 * registry (built-ins + dynamic plugin tools), the prompt catalogue, the
 * never-throws dispatch, the tool-call parser, and the streaming gate that hides
 * tool-call JSON while letting a prose answer stream live.
 *
 *   node --import ./tests/ext-loader.mjs tests/brain-tools.test.mjs
 */
import { RAGEngine } from '../src/renderer/src/rag-engine.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

const engine = new RAGEngine();

console.log('\nRegistry — built-ins');
{
  const ids = engine.listTools().map((t) => t.id).sort();
  ok(ids.join(',') === 'build_plugin,get_outline,list_documents,read_document,recent_changes,search_documents',
    'the six read-only/authoring built-ins register at construction');
  ok(engine.listTools().every((t) => t.source === 'builtin'), 'built-ins are tagged source=builtin');

  const catalog = engine._toolCatalog();
  ok(catalog.includes('search_documents') && catalog.includes('{"query"'),
    'catalogue renders tool id + its parameter shape');
  ok(!/\(via/.test(catalog), 'built-ins carry no "(via …)" provenance tag');
}

console.log('\nRegistry — build_plugin built-in (Phase 6)');
{
  // Registration + shape only — its handler needs window.api (absent in Node), so
  // we never invoke it here; we assert it's a protected, catalogued built-in.
  const bp = engine.toolRegistry.get('build_plugin');
  ok(!!bp, 'build_plugin is registered at construction');
  ok(bp && bp.source === 'builtin', 'build_plugin is tagged source=builtin');
  ok(engine.unregisterTool('build_plugin') === false, 'build_plugin is protected from unregisterTool');
  ok(engine.toolRegistry.has('build_plugin'), 'build_plugin survives the unregister attempt');
  ok(engine._toolCatalog().includes('build_plugin'), 'build_plugin appears in the tool catalogue');
}

console.log('\nRegistry — dynamic registration');
{
  ok(engine.registerTool({ id: 'echo_tool', description: 'echoes its input', parameters: { msg: 'string' }, handler: (a) => ({ echoed: a.msg }) }) === true,
    'a well-formed tool registers');
  ok(engine._toolCatalog().includes('echo_tool'), 'a registered tool appears in the catalogue');

  ok(engine.registerTool({ id: 'Bad Id!', description: 'x', handler: () => {} }) === false, 'invalid id is rejected');
  ok(engine.registerTool({ id: 'no_handler', description: 'x' }) === false, 'missing handler is rejected');
  ok(engine.registerTool({ id: 'no_desc', handler: () => {} }) === false, 'missing description is rejected');

  ok(engine.registerTool({ id: 'zd_search', description: 'search zendesk', source: 'plugin:zendesk', handler: () => ({}) }) === true,
    'a plugin-sourced tool registers');
  ok(engine._toolCatalog().includes('(via plugin:zendesk)'), 'plugin tools surface their provenance in the catalogue');
}

console.log('\nDispatch — never throws');
{
  const r1 = await engine.runTool('echo_tool', { msg: 'hi' });
  ok(r1 && r1.echoed === 'hi', 'runTool dispatches to the registered handler');

  const r2 = await engine.runTool('does_not_exist', {});
  ok(r2 && r2.error && Array.isArray(r2._available), 'unknown tool returns {error, _available}, not a throw');
  ok(r2._available.includes('echo_tool'), '_available lists currently-registered tools');

  engine.registerTool({ id: 'boom', description: 'always throws', handler: () => { throw new Error('kaboom'); } });
  const r3 = await engine.runTool('boom', {});
  ok(r3 && /kaboom/.test(r3.error), 'a throwing handler degrades to {error} — the loop never crashes');
}

console.log('\nRegistry — protection + removal');
{
  ok(engine.unregisterTool('list_documents') === false, 'built-ins cannot be unregistered');
  ok(engine.toolRegistry.has('list_documents'), 'the built-in survives an unregister attempt');
  ok(engine.unregisterTool('echo_tool') === true, 'a plugin tool can be removed');
  ok(!engine.toolRegistry.has('echo_tool'), 'the removed tool is gone from the registry');
}

console.log('\nTool-call parser');
{
  ok(engine._parseToolCall('{"tool":"read_document","args":{"name":"x"}}').tool === 'read_document',
    'a bare JSON object is parsed as a tool call');
  ok(engine._parseToolCall('```json\n{"tool":"list_documents"}\n```').tool === 'list_documents',
    'a fenced JSON object is parsed as a tool call');
  ok(engine._parseToolCall('Here is a normal prose answer about your notes.') === null,
    'plain prose is not mistaken for a tool call');
}

console.log('\nStreaming gate');
{
  const out = [];
  const gate = engine._makeStreamGate((t) => out.push(t));
  for (const c of 'Hello, world') gate.push(c);
  ok(gate.streamed() === true, 'prose is detected and streamed');
  ok(out.join('') === 'Hello, world', 'the held prefix is flushed verbatim, then streamed');

  const hidden = [];
  const gate2 = engine._makeStreamGate((t) => hidden.push(t));
  for (const c of '{"tool":"search_documents","args":{}}') gate2.push(c);
  ok(gate2.streamed() === false, 'a JSON tool call is detected, not streamed');
  ok(hidden.length === 0, 'no tool-call tokens reach the user');
  ok(engine._parseToolCall(gate2.raw()).tool === 'search_documents', 'the withheld raw still parses as the tool call');

  const fenced = [];
  const gate3 = engine._makeStreamGate((t) => fenced.push(t));
  for (const c of '```json\n{"tool":"list_documents"}') gate3.push(c);
  ok(gate3.streamed() === false, 'a fenced JSON tool call is also withheld');
  ok(fenced.length === 0, 'no fenced-tool-call tokens reach the user');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
