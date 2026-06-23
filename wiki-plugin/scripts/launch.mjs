#!/usr/bin/env node
// MCP launcher. Plugins ship without their node_modules (gitignored, no install
// step in the plugin lifecycle), so on first run we install production deps,
// then hand off to the tsx-run server over stdio.
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Markers for the runtime deps the server imports. If any is missing we
// (re)install — npm install is idempotent, so this is safe to repeat.
const required = [
  path.join(root, "node_modules", "@huggingface", "transformers"),
  path.join(root, "node_modules", "@modelcontextprotocol", "sdk"),
  path.join(root, "node_modules", "tsx"),
];

if (!required.every((p) => existsSync(p))) {
  process.stderr.write("[wiki] installing dependencies (first run, ~minutes)…\n");
  const res = spawnSync(
    "npm",
    ["install", "--omit=dev", "--no-audit", "--no-fund"],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );
  if (res.status !== 0) {
    process.stderr.write(
      "[wiki] dependency install failed; wiki_search is unavailable. " +
        "Run `npm install` in the wiki-plugin directory manually.\n",
    );
    process.exit(1);
  }
}

// stdio is inherited so the child speaks the MCP protocol directly with the host.
const tsx = path.join(root, "node_modules", ".bin", "tsx");
const child = spawn(tsx, [path.join(root, "src", "index.ts")], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
