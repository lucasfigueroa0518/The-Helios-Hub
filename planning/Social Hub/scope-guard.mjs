// Social Hub Phase 1 scope guard (BUILD_PLAN.md §S4).
//   node "planning/Social Hub/scope-guard.mjs" baseline   -> writes scope-baseline.json
//   node "planning/Social Hub/scope-guard.mjs" check      -> compares, exits 1 on any drift
// Hashes every file outside node_modules, .next, .git and the §S3 allowed paths.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..", "..");
const BASELINE = join(HERE, "scope-baseline.json");

const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

/** §S3 allowlist. Paths are repo-relative with forward slashes. */
export function isAllowed(rel) {
  if (rel.startsWith("app/social/")) {
    // app/social/(hub)/** or a new app/social/<segment>/** other than render (SH-57).
    // A file directly in app/social/ (layout.tsx, template.tsx) would wrap render: not allowed.
    const parts = rel.slice("app/social/".length).split("/");
    return parts.length >= 2 && parts[0] !== "render";
  }
  return (
    rel.startsWith("app/api/social-hub/") ||
    rel.startsWith("lib/social-hub/") ||
    rel.startsWith("components/social-hub/") ||
    rel === "app/social-hub.css" ||
    rel === "db/social_hub_schema.sql" ||
    rel === "scripts/apply_social_hub_schema.js" ||
    /^tests\/social-hub-[^/]*\.test\.ts$/.test(rel) ||
    rel.startsWith("tests/fixtures/social-hub/") ||
    rel.startsWith("planning/Social Hub/")
  );
}

/**
 * Named one-edit exceptions (§S3). Empty: the nav.ts edit was not used (DECISIONS_LOG D5),
 * so any change to nav.ts or a layout fails the gate.
 */
const NAMED_EXCEPTIONS = new Set([]);

/**
 * Files other processes write while the build runs (the night's run folders, OS
 * metadata, Claude Code's own state, tool caches). Drift here is reported as a
 * warning, never reverted by the builder, and never counts as the builder's edit
 * (DECISIONS_LOG D8). The allowlist itself is unchanged.
 */
export function isVolatile(rel) {
  return (
    rel.endsWith(".DS_Store") ||
    rel.startsWith(".claude/") ||
    rel.startsWith(".impeccable/") ||
    rel.startsWith("runs/") ||
    rel.startsWith("exports/social/generated/") ||
    rel === "tsconfig.tsbuildinfo" ||
    rel === "next-env.d.ts"
  );
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue; // removed mid-walk; the compare reports it as removed
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(abs, out);
    else if (st.isFile()) {
      const rel = relative(ROOT, abs).split(sep).join("/");
      if (isAllowed(rel)) continue;
      try {
        out[rel] = createHash("sha256").update(readFileSync(abs)).digest("hex");
      } catch {
        /* removed mid-walk */
      }
    }
  }
  return out;
}

const mode = process.argv[2];
if (mode === "baseline") {
  if (existsSync(BASELINE) && process.argv[3] !== "--force") {
    console.error("scope-baseline.json already exists; refusing to overwrite (pass --force).");
    process.exit(2);
  }
  const files = walk(ROOT, {});
  writeFileSync(
    BASELINE,
    JSON.stringify({ createdAt: new Date().toISOString(), count: Object.keys(files).length, files }, null, 0),
  );
  console.log(`baseline: ${Object.keys(files).length} files hashed`);
} else if (mode === "check") {
  const base = JSON.parse(readFileSync(BASELINE, "utf8")).files;
  const now = walk(ROOT, {});
  const changed = [], added = [], removed = [];
  for (const [f, h] of Object.entries(now)) {
    if (!(f in base)) added.push(f);
    else if (base[f] !== h) changed.push(f);
  }
  for (const f of Object.keys(base)) if (!(f in now)) removed.push(f);
  const isExc = (f) => NAMED_EXCEPTIONS.has(f);
  const drift = [...changed, ...added, ...removed];
  const volatile = drift.filter(isVolatile);
  const fail = drift.filter((f) => !isVolatile(f) && !isExc(f));
  const pkg = ["package.json", "package-lock.json"].filter((f) => changed.includes(f) || removed.includes(f));
  console.log(JSON.stringify({
    failing: fail,
    volatileWarnings: volatile,
    namedExceptionsTouched: changed.filter(isExc),
    packageFilesChanged: pkg,
  }, null, 2));
  if (fail.length) {
    console.error(`SCOPE GUARD FAIL: ${fail.length} file(s) outside the allowlist drifted`);
    process.exit(1);
  }
  console.log("SCOPE GUARD PASS");
} else {
  console.error("usage: scope-guard.mjs baseline|check");
  process.exit(2);
}
