import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTyrellMcpServer } from "./server.js";
import { viewClient, viewSourceFromEnv } from "./view.js";

export { createTyrellMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
export * as tools from "./tools.js";
export { parseView, viewClient, viewSourceFromEnv, type ViewDocument } from "./view.js";

/** Serve over stdio. Nothing but MCP messages goes to stdout; diagnostics go to stderr. */
export async function runStdio(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const server = createTyrellMcpServer(viewClient(viewSourceFromEnv(env)));
  await server.connect(new StdioServerTransport());
  process.stderr.write("tyrell mcp: read-only server on stdio (control's view API on this machine)\n");
}
