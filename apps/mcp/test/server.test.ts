import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTyrellMcpServer } from "../src/server.js";
import { viewClient, viewSourceFromEnv } from "../src/view.js";
import { POISON, fixture } from "./fixture.js";

const TOOLS = ["tyrell_blast", "tyrell_check_address", "tyrell_decisions", "tyrell_incidents", "tyrell_memory", "tyrell_status"];
const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]!.text);

async function connected(getView = async () => fixture()) {
  const server = createTyrellMcpServer(getView);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("MCP server (in memory)", () => {
  it("lists exactly the six read-only tools", async () => {
    const c = await connected();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
    for (const t of tools) expect(t.annotations, t.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it("answers a tool call with JSON", async () => {
    const c = await connected();
    const r = await c.callTool({ name: "tyrell_check_address", arguments: { address: POISON } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(text(r))).toMatchObject({ verdict: "quarantined" });
  });

  it("rejects bad input before touching the view", async () => {
    let reads = 0;
    const c = await connected(async () => (reads++, fixture()));
    for (const [name, args] of [
      ["tyrell_check_address", { address: "0x123" }],
      ["tyrell_memory", { id: "not-an-id" }],
      ["tyrell_incidents", { limit: 500 }],
      ["tyrell_blast", { seedId: -1 }],
      ["tyrell_decisions", { verdict: "PAY" }],
    ] as const) {
      const r = await c.callTool({ name, arguments: args });
      expect(r.isError, name).toBe(true);
    }
    expect(reads).toBe(0);
  });

  it("turns a failure to read the view into a tool error, not a crash", async () => {
    const c = await connected(async () => {
      throw new Error("control's view API did not answer");
    });
    const r = await c.callTool({ name: "tyrell_status", arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/did not answer/);
  });
});

describe("the view client", () => {
  it("only talks to this machine", () => {
    expect(() => viewSourceFromEnv({ TYRELL_API_URL: "http://example.com:7878" })).toThrow(/127\.0\.0\.1/);
    expect(() => viewSourceFromEnv({ TYRELL_API_URL: "https://127.0.0.1:7878" })).toThrow();
    expect(viewSourceFromEnv({ TYRELL_API_PORT: "9999" }).url).toBe("http://127.0.0.1:9999/api/view");
    expect(viewSourceFromEnv({ TYRELL_API_URL: "http://localhost:1/x" }).url).toBe("http://localhost:1/api/view");
  });

  it("explains a missing token", () => {
    const src = viewSourceFromEnv({ TYRELL_HOME: "/nonexistent/tyrell-home" });
    expect(() => src.token()).toThrow(/TYRELL_API_TOKEN/);
  });

  it("sends the bearer token, caches briefly, and explains a 401", async () => {
    const calls: Array<string | undefined> = [];
    const fake = (async (_u: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).authorization;
      calls.push(auth);
      return auth === "Bearer right" ? Response.json(fixture()) : new Response("", { status: 401 });
    }) as typeof fetch;
    const get = viewClient({ url: "http://127.0.0.1:1/api/view", token: () => "right" }, { fetch: fake, ttlMs: 60_000 });
    expect((await get()).chainId).toBe(1983);
    await get();
    expect(calls).toEqual(["Bearer right"]);
    const bad = viewClient({ url: "http://127.0.0.1:1/api/view", token: () => "wrong" }, { fetch: fake });
    await expect(bad()).rejects.toThrow(/401/);
  });
});

describe("over stdio, against a local view API", () => {
  let api: Server;
  let port = 0;
  beforeAll(async () => {
    api = createServer((req, res) => {
      if (req.headers.authorization !== "Bearer t0k") return void res.writeHead(401).end();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(fixture()));
    });
    await new Promise<void>((r) => api.listen(0, "127.0.0.1", () => r()));
    port = (api.address() as { port: number }).port;
  });
  afterAll(() => api.close());

  it("starts, lists the tools and answers tyrell_status (stdout carries only MCP)", async () => {
    const root = join(__dirname, "../../..");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", join(root, "apps/mcp/src/main.ts")],
      cwd: root,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TYRELL_API_URL: `http://127.0.0.1:${port}`, TYRELL_API_TOKEN: "t0k" },
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "1" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
      const r = await client.callTool({ name: "tyrell_status", arguments: {} });
      expect(JSON.parse(text(r))).toMatchObject({ chainId: 1983, network: "testnet" });
    } finally {
      await client.close();
    }
  }, 60_000);
});
