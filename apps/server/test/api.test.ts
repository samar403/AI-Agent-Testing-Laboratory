import { beforeAll, describe, expect, it } from "vitest";
import { runExperiment, SUPPORT_SUITE } from "@agentlab/core";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { RunManager } from "../src/runs.ts";
import { seed } from "../src/seed.ts";
import { Store } from "../src/store.ts";

const store = new Store(openDb(":memory:"));
const runs = new RunManager(store, 0);
const app = createApp(store, runs);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonResponse = Omit<Response, "json"> & { json(): Promise<any> };
const call = (path: string, init?: RequestInit) =>
  app.request(`/api${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } }) as Promise<JsonResponse>;

beforeAll(async () => {
  await seed(store);
});

async function waitFor(runId: string) {
  for (let i = 0; i < 200; i++) {
    const r = await (await call(`/runs/${runId}`)).json();
    if (r.status !== "running" && r.status !== "queued") return r;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error("run did not finish");
}

describe("AgentLab API", () => {
  it("seeds a populated lab", async () => {
    const o = await (await call("/overview")).json();
    expect(o.counts.agents).toBe(2);
    expect(o.counts.suites).toBe(2);
    expect(o.totals.regressionsCaught).toBeGreaterThan(0);
  });

  it("runs an experiment across two versions and compares them", async () => {
    const suites = await (await call("/suites")).json();
    const agents = await (await call("/agents")).json();
    const [v1, v2] = agents[0].versions;
    const res = await call("/runs", { method: "POST", body: JSON.stringify({ suiteId: suites[0].id, versionIds: [v1.id, v2.id], options: { trials: 2, seed: 3 } }) });
    expect(res.status).toBe(201);
    const [a, b] = await res.json();
    const ra = await waitFor(a.id);
    const rb = await waitFor(b.id);
    expect(ra.status).toBe("completed");
    expect(ra.cells).toHaveLength(16);
    const cmp = await (await call(`/compare?a=${ra.id}&b=${rb.id}`)).json();
    expect(cmp.comparison.overall.b).toBeGreaterThan(cmp.comparison.overall.a);
    const trial = await (await call(`/runs/${ra.id}/trials/${ra.cells[0].id}`)).json();
    expect(trial.transcript.length).toBeGreaterThan(1);
    const junit = await (await call(`/runs/${ra.id}/report?format=junit`)).text();
    expect(junit).toContain("<testsuites");
  });

  it("validates suites (JSON and YAML) and agent configs", async () => {
    const bad = await call("/suites", { method: "POST", body: JSON.stringify({ yaml: "name: x\ntools: []\nscenarios: []" }) });
    expect(bad.status).toBe(400);
    const good = await call("/suites", { method: "POST", body: JSON.stringify({ spec: { ...SUPPORT_SUITE, name: "Copy" } }) });
    expect(good.status).toBe(201);
    const agent = await call("/agents", { method: "POST", body: JSON.stringify({ name: "X", config: { kind: "http", url: "ftp://nope" } }) });
    expect(agent.status).toBe(400);
  });

  it("refuses Claude agents without credentials", async () => {
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return;
    const suites = await (await call("/suites")).json();
    const agents = await (await call("/agents")).json();
    const res = await call("/runs", { method: "POST", body: JSON.stringify({ suiteId: suites[0].id, versionIds: [agents[1].versions[0].id] }) });
    expect(res.status).toBe(400);
  });

  it("ingests CI results with an API key", async () => {
    const unauth = await call("/ingest", { method: "POST", body: "{}" });
    expect(unauth.status).toBe(401);
    const { key } = await (await call("/keys", { method: "POST", body: JSON.stringify({ name: "ci" }) })).json();
    const { trials } = await runExperiment(SUPPORT_SUITE, { kind: "mock", variant: "support-v2" }, { trials: 1 });
    const res = await call("/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: JSON.stringify({ suite: SUPPORT_SUITE, agentLabel: "ci-agent", options: { trials: 1 }, trials, commit: "abcdef123" }),
    });
    expect(res.status).toBe(201);
    const { runId } = await res.json();
    const run = await (await call(`/runs/${runId}`)).json();
    expect(run.source).toBe("ci");
    expect(run.agent_label).toContain("abcdef1");
  });

  it("meters usage against the plan", async () => {
    const u = await (await call("/usage")).json();
    expect(u.trials).toBeGreaterThan(0);
    const switched = await (await call("/usage/plan", { method: "POST", body: JSON.stringify({ planId: "institute" }) })).json();
    expect(switched.plan.id).toBe("institute");
  });

  it("locks the workspace when an admin token is configured", async () => {
    process.env.AGENTLAB_ADMIN_TOKEN = "secret";
    try {
      expect((await call("/overview")).status).toBe(401);
      expect((await call("/overview", { headers: { "x-agentlab-token": "secret" } })).status).toBe(200);
      expect((await call("/health")).status).toBe(200);
    } finally {
      delete process.env.AGENTLAB_ADMIN_TOKEN;
    }
  });
});
