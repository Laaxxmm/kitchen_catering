import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The permission matrix (tests/e2e/access/matrix.test.ts) proves every
 * action in src/server/actions admits exactly the desks it should — and
 * fails the build when a new one isn't registered. It never looks at the
 * 59 page files that carry their own `"use server"` functions, so an
 * inline action with no gate was invisible to the one test that guards
 * everything else.
 *
 * This is the net under those. Every inline server function must either
 * gate itself (requireRole / requireSession / gateRolePage) or delegate
 * to something that does — a function imported from src/server/actions,
 * which the matrix already covers. Anything else fails here by name.
 */

const APP_DIR = path.resolve(process.cwd(), "src/app");
const GATES = ["requireRole(", "requireSession(", "gateRolePage(", "requireMobileAuth(", "signIn(", "signOut("];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Comments off, so a doc-comment saying `"use server"` isn't a directive. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** Names imported from server-action modules — calling one of them IS the gate. */
function importedActionNames(source: string): Set<string> {
  const names = new Set<string>();
  const re = /import\s*\{([^}]*)\}\s*from\s*["'](@\/server\/actions\/[^"']+|@\/server\/[^"']*-core|@\/server\/auth)["']/g;
  for (const m of source.matchAll(re)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** A lazy `const { x } = await import("@/server/actions/…")` inside the body
 *  is the same delegation, just deferred to keep the page's bundle small. */
const DYNAMIC_ACTION_IMPORT = /await\s+import\(\s*["']@\/server\/actions\/[^"']+["']\s*\)/;

/** The body of the function enclosing the directive at `at`. */
function enclosingBody(source: string, at: number): { name: string; body: string } | null {
  const open = source.lastIndexOf("{", at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      const head = source.slice(Math.max(0, open - 200), open);
      const name = head.match(/(?:function\s+(\w+)|(?:const|let)\s+(\w+)\s*=)[^{]*$/);
      return { name: name?.[1] ?? name?.[2] ?? "<anonymous>", body: source.slice(open, i + 1) };
    }
  }
  return null;
}

function ungated(file: string): string[] {
  const source = stripComments(readFileSync(file, "utf8"));
  const actions = importedActionNames(source);
  const failures: string[] = [];

  // A file-level directive makes every export an action; a function-level
  // one marks just that function. Both are checked the same way.
  const fileLevel = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(source);
  const bodies: Array<{ name: string; body: string }> = [];
  if (fileLevel) {
    for (const m of source.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
      const b = enclosingBody(source, source.indexOf("{", m.index!));
      if (b) bodies.push({ name: m[1], body: b.body });
    }
  } else {
    for (const m of source.matchAll(/["']use server["']/g)) {
      const b = enclosingBody(source, m.index!);
      if (b) bodies.push(b);
    }
  }

  for (const { name, body } of bodies) {
    const gated = GATES.some((g) => body.includes(g));
    const delegates =
      [...actions].some((a) => new RegExp(`\\b${a}\\s*\\(`).test(body)) ||
      DYNAMIC_ACTION_IMPORT.test(body);
    if (!gated && !delegates) failures.push(`${path.relative(process.cwd(), file)} → ${name}()`);
  }
  return failures;
}

describe("inline server actions", () => {
  it("every one gates itself or delegates to a gated action", () => {
    const failures = walk(APP_DIR).flatMap(ungated);
    expect(failures).toEqual([]);
  });
});
