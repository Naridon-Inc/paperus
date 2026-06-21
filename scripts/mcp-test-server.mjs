#!/usr/bin/env node
/*
 * Minimal stdio MCP server used by scripts/probe-mcp.cjs to exercise the Paperus
 * connector pipeline end-to-end (no network, fully deterministic). Exposes one
 * tool, `echo`, that returns the text it was given. Run as:
 *   node scripts/mcp-test-server.mjs
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server(
  { name: 'paperus-test', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the provided text — used to verify the MCP round trip.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo back' } },
      required: ['text'],
    },
  },
  {
    name: 'add',
    description: 'Add two numbers and return the sum.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params?.name
  const args = req.params?.arguments || {}
  if (name === 'echo') {
    return { content: [{ type: 'text', text: `echo: ${String(args.text ?? '')}` }] }
  }
  if (name === 'add') {
    return { content: [{ type: 'text', text: String(Number(args.a) + Number(args.b)) }] }
  }
  return { content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true }
})

const transport = new StdioServerTransport()
await server.connect(transport)
// Keep the process alive on stdio until the parent closes the pipe.
