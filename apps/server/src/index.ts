import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { RunManager } from "./runs.ts";
import { seed } from "./seed.ts";
import { Store } from "./store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

// Load .env from the repo root without adding a dependency.
const envFile = resolve(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2].replace(/^["']|["']$/g, "");
  }
}

const store = new Store(openDb(process.env.AGENTLAB_DATA_DIR ? undefined : resolve(root, ".data/agentlab.db")));
await seed(store);
const runs = new RunManager(store);

const server = new Hono();
server.route("/", createApp(store, runs));

const webDist = resolve(root, "apps/web/dist");
if (existsSync(webDist)) {
  server.use("/*", serveStatic({ root: webDist }));
  const index = readFileSync(resolve(webDist, "index.html"), "utf8");
  server.get("*", (c) => c.html(index)); // SPA fallback
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: server.fetch, port }, () => {
  console.log(`\n  🧪 AgentLab API on http://localhost:${port}/api`);
  if (existsSync(webDist)) console.log(`  🔬 Lab UI on     http://localhost:${port}`);
  console.log(`  Claude ${process.env.ANTHROPIC_API_KEY ? "enabled" : "disabled (set ANTHROPIC_API_KEY to run Claude agents, LLM users and judges)"}\n`);
});
