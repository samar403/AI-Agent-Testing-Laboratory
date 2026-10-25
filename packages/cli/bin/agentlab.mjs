#!/usr/bin/env node
// Thin launcher: registers the TypeScript loader, then runs the CLI source.
import { register } from "tsx/esm/api";

process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});
register();
await import("../src/index.ts");
