import type { JSONSchema, Matcher } from "./types.ts";

/** Deterministic PRNG (mulberry32) so that every trial is reproducible from its seed. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function deriveSeed(...parts: Array<string | number>): number {
  return hashString(parts.join("::"));
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

function isOperator(m: unknown): m is Record<string, unknown> {
  if (!m || typeof m !== "object" || Array.isArray(m)) return false;
  const keys = Object.keys(m);
  return keys.length === 1 && keys[0]!.startsWith("$");
}

/** Match a value against a matcher (literal or operator object). */
export function matchValue(value: unknown, matcher: Matcher): boolean {
  if (isOperator(matcher)) {
    const [op, arg] = Object.entries(matcher)[0]!;
    switch (op) {
      case "$regex":
        return typeof value === "string" && new RegExp(String(arg), "i").test(value);
      case "$exists":
        return arg ? value !== undefined : value === undefined;
      case "$gt":
        return typeof value === "number" && value > Number(arg);
      case "$lt":
        return typeof value === "number" && value < Number(arg);
      case "$oneOf":
        return Array.isArray(arg) && arg.some((x) => deepEqual(x, value));
      case "$any":
        return true;
      default:
        return false;
    }
  }
  return deepEqual(value, matcher);
}

/** Every key in `pattern` must match the corresponding field in `obj` (subset semantics). */
export function matchObject(obj: unknown, pattern: Record<string, Matcher> | undefined, getter = getField): boolean {
  if (!pattern) return true;
  return Object.entries(pattern).every(([k, m]) => matchValue(getter(obj, k), m));
}

function getField(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/**
 * Render {{args.x}} / {{state.y}} templates. A string that is exactly one template keeps the
 * referenced value's type (so `"{{args.amount}}"` stays a number).
 */
export function renderTemplate(value: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const whole = value.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (whole) return getPath(ctx, whole[1]!);
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p: string) => {
      const v = getPath(ctx, p);
      return v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, ctx));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderTemplate(v, ctx)]));
  }
  return value;
}

export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

/**
 * Minimal JSON-Schema validator covering what tool parameter schemas use in practice.
 * Returns human-readable errors such as `amount: expected number, got string`.
 */
export function validateSchema(value: unknown, schema: JSONSchema, path = ""): string[] {
  const errors: string[] = [];
  const at = path || "(root)";
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const ok = allowed.some((t) => t === actual || (t === "number" && actual === "integer"));
    if (!ok) {
      errors.push(`${at}: expected ${allowed.join("|")}, got ${actual}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) {
    errors.push(`${at}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: must be ≤ ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: does not match /${schema.pattern}/`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...validateSchema(item, schema.items!, `${path}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const req of schema.required ?? []) {
      if (obj[req] === undefined) errors.push(`${path ? path + "." : ""}${req}: is required`);
    }
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k];
      if (sub) errors.push(...validateSchema(v, sub, path ? `${path}.${k}` : k));
      else if (schema.additionalProperties === false) errors.push(`${path ? path + "." : ""}${k}: unexpected property`);
    }
  }
  return errors;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
