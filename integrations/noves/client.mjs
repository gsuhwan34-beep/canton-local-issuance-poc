import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [action, party] = process.argv.slice(2);
if (action !== 'tools' && (action !== 'balance' || !party?.trim())) {
  throw new Error('Use npm run tools or npm run balance -- <public Canton party>.');
}
const server = fileURLToPath(new URL('./node_modules/@noves/canton-mcp/dist/index.js', import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [server] });
const client = new Client({ name: 'canton-poc', version: '1.0.0' });
try {
  await client.connect(transport);
  if (action === 'tools') {
    const { tools } = await client.listTools();
    console.log(tools.map(tool => tool.name).sort().join('\n'));
  } else {
    // Authentication and public-network lookup are handled by the official Noves server.
    const result = await client.callTool({ name: 'get_balance', arguments: { party } });
    console.log(JSON.stringify(result.content, null, 2));
    if (result.isError) process.exitCode = 1;
  }
} finally { await client.close(); }
