// Shared static import-graph machinery for the Dockerfile/container guard
// tests (#5231 review follow-up). Single home for the comment-stripping
// tokenizer, edge extraction, resolution, and BFS walks that were previously
// hand-copied across three guards:
//   - tests/resilience-validation-import-graph.test.mjs (walkContainerGraph)
//   - tests/dockerfile-relay-imports.test.mjs (collectRelativeImports/resolveImport)
//   - tests/dockerfile-digest-notifications-imports.test.mjs (same scanner, copied)
// A fix to an extraction edge case lands here once and covers all three.
//
// This module is test infrastructure only — it lives under tests/ and is
// never COPY'd into any container image.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

// Structure-preserving comment strip. A state machine, not regexes: naive
// regex stripping misreads `/*` inside comment text or strings (a comment
// mentioning `@upstash/*` swallowed everything to the next `*/`, silently
// deleting real imports from extraction) and misreads `//` inside string
// literals. Comments are removed exactly; string/template contents and line
// structure are preserved. Known limit: a bare `//` inside a regex literal's
// character class would be misread — no such shape exists in the walked
// graphs, and the guards' deep-node canaries backstop it.
export function stripComments(src) {
  let out = '';
  let state = 'code'; // code | line | block | squote | dquote | template
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === "'") state = 'squote';
      else if (c === '"') state = 'dquote';
      else if (c === '`') state = 'template';
      out += c; i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; i += 2; continue; }
      if (c === '\n') out += c;
      i += 1; continue;
    }
    // Inside a string or template literal: pass through, honor escapes.
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if ((state === 'squote' && c === "'") || (state === 'dquote' && c === '"') || (state === 'template' && c === '`')) {
      state = 'code';
    }
    out += c; i += 1;
  }
  return out;
}

// True when a named-import/export clause consists ONLY of `type` bindings
// (`{ type Foo, type Bar }`). tsx/esbuild erase those at runtime, so the
// specifier is not a runtime edge. A mixed clause (`{ type Foo, real }`) or
// any default/namespace binding keeps the edge.
function isAllTypeNamedClause(clause) {
  const inner = clause.trim();
  if (!inner.startsWith('{') || !inner.endsWith('}')) return false;
  const bindings = inner.slice(1, -1).split(',').map((b) => b.trim()).filter(Boolean);
  return bindings.length > 0 && bindings.every((b) => /^type\s/.test(b));
}

// Extract import edges from one source file (comments already stripped).
export function extractEdges(src) {
  const staticSpecs = [];
  const dynamicSpecs = [];
  const requireSpecs = [];

  // import ... from '...' (multi-line safe; skips `import type` and clauses
  // whose named bindings are all inline `type` modifiers — tsx erases both)
  for (const m of src.matchAll(/^[ \t]*import\s+(?!type\s)([^'";]*?)\bfrom\s*['"]([^'"]+)['"]/gms)) {
    if (isAllTypeNamedClause(m[1])) continue;
    staticSpecs.push(m[2]);
  }
  // side-effect: import '...'
  for (const m of src.matchAll(/^[ \t]*import\s*['"]([^'"]+)['"]/gm)) {
    staticSpecs.push(m[1]);
  }
  // export { ... } from '...' / export * from '...' (skips `export type` and
  // all-inline-type clauses)
  for (const m of src.matchAll(/^[ \t]*export\s+(?!type\b)(\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/gms)) {
    if (m[1].startsWith('{') && isAllTypeNamedClause(m[1])) continue;
    staticSpecs.push(m[2]);
  }
  // dynamic import('...') literals
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)) {
    dynamicSpecs.push(m[1]);
  }
  // require('...') literals (plain require in .cjs, or a createRequire-bound
  // local named require)
  for (const m of src.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    requireSpecs.push(m[1]);
  }
  // createRequire(import.meta.url)('...') — immediately-invoked form; the
  // plain require regex cannot see it (no lowercase `require(` substring)
  for (const m of src.matchAll(/\bcreateRequire\([^)]*\)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    requireSpecs.push(m[1]);
  }
  return { staticSpecs, dynamicSpecs, requireSpecs };
}

export function isBare(spec) {
  return !spec.startsWith('.') && !spec.startsWith('/');
}

// Relative specifiers a file mentions via static import / export-from /
// require / createRequire (dynamic import() literals are deliberately NOT
// included — the COPY-closure guards never followed those). Used by the
// relay and digest-notifications Dockerfile guards.
export function collectRelativeImports(filePath) {
  const src = stripComments(readFileSync(filePath, 'utf-8'));
  const { staticSpecs, requireSpecs } = extractEdges(src);
  const imports = new Set();
  for (const spec of [...staticSpecs, ...requireSpecs]) {
    if (spec.startsWith('.')) imports.add(spec);
  }
  return imports;
}

// Resolve a relative specifier against an extension candidate list (COPY-
// closure guard style). Skips directory hits — a bare directory match is
// never what plain node loads.
export function resolveImport(fromFile, relImport, exts = ['.mjs', '.cjs', '.js']) {
  const abs = resolve(dirname(fromFile), relImport);
  if (existsSync(abs) && !statSync(abs).isDirectory()) return abs;
  for (const ext of exts) {
    if (existsSync(abs + ext)) return abs + ext;
  }
  return null;
}

// Resolve a relative specifier the way node+tsx would inside a container.
export function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.mts`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    join(base, 'index.ts'),
    join(base, 'index.js'),
    join(base, 'index.mjs'),
  ];
  // TS-style: an explicit .js specifier may map to a .ts source.
  if (spec.endsWith('.js')) candidates.push(base.replace(/\.js$/, '.ts'));
  if (spec.endsWith('.mjs')) candidates.push(base.replace(/\.mjs$/, '.mts'));
  return candidates.find((p) => existsSync(p) && statSync(p).isFile()) ?? null;
}

// Extensions plain node (no tsx loader) can load as an explicit specifier.
// .ts/.mts are deliberately excluded even though node:24 type-strips
// erasable syntax natively — non-erasable syntax still crashes, so the
// guard fails loud (a false red a dev can fix by writing the runtime
// extension) instead of green-while-red.
const PLAIN_NODE_EXTS = new Set(['.mjs', '.cjs', '.js', '.json']);

// Walk the container-reachable graph from `rootFiles` under `contract`:
//   contract.repoRoot        — absolute path imports may not escape reporting-wise
//   contract.copyRootDirs    — absolute dirs the image COPYs (containment set)
//   contract.dynamicRootDirs — absolute dirs dynamic import() literals are
//                              followed into (executed-unconditionally set)
//   contract.installedPackages — bare-specifier budget beyond node builtins
//   contract.hasTsx          — false = the container runs plain node: no
//                              extension guessing, no index resolution, no
//                              TypeScript. Omitted/true = tsx-shaped resolution.
// Returns violations/unresolved (each with the import chain from a root) and
// the visited set for reachability assertions.
export function walkContainerGraph(rootFiles, contract) {
  const parent = new Map();
  const visited = new Set();
  const queue = [...rootFiles];
  const violations = [];
  const unresolved = [];
  const hasTsx = contract.hasTsx !== false;

  const chainOf = (file) => {
    const chain = [];
    for (let f = file; f; f = parent.get(f)) chain.unshift(relative(contract.repoRoot, f));
    return chain.join('\n    -> ');
  };

  const inside = (dirs, p) => dirs.some((d) => p.startsWith(d + sep));

  const followRelative = (file, spec) => {
    const resolved = resolveRelative(file, spec);
    if (!resolved) {
      unresolved.push(`'${spec}' imported from\n    ${chainOf(file)}`);
      return;
    }
    if (!hasTsx) {
      // Plain node resolves ONLY the literal specifier, and only for
      // extensions it can load. An edge that needed extension guessing or
      // TypeScript would work under tsx elsewhere in the repo yet crash
      // this container at import time.
      const literal = resolve(dirname(file), spec);
      if (resolved !== literal || !PLAIN_NODE_EXTS.has(extname(resolved))) {
        violations.push(
          `'${spec}' resolves only under a tsx loader (extension guessing / TypeScript -> ${relative(contract.repoRoot, resolved)}), but this container runs plain node via\n    ${chainOf(file)}`,
        );
        return;
      }
    }
    if (!inside(contract.copyRootDirs, resolved)) {
      violations.push(
        `'${spec}' resolves in the repo but OUTSIDE the container COPY set (${relative(contract.repoRoot, resolved)}) via\n    ${chainOf(file)}`,
      );
      return;
    }
    if (!visited.has(resolved) && !parent.has(resolved)) parent.set(resolved, file);
    queue.push(resolved);
  };

  const checkBare = (file, spec, how) => {
    const pkg = spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
    if (!isBuiltin(spec) && !contract.installedPackages.has(pkg)) {
      violations.push(`'${spec}' ${how} via\n    ${chainOf(file)}`);
    }
  };

  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (extname(file) === '.json') continue; // data, no imports

    const src = stripComments(readFileSync(file, 'utf-8'));
    const { staticSpecs, dynamicSpecs, requireSpecs } = extractEdges(src);

    for (const spec of staticSpecs) {
      if (isBare(spec)) checkBare(file, spec, 'statically imported');
      else followRelative(file, spec);
    }
    for (const spec of requireSpecs) {
      // A top-level require in a walked file loads eagerly at startup (e.g.
      // _seed-utils.mjs createRequire()s _proxy-utils.cjs at module scope),
      // so bare requires get the same budget check as static imports. The
      // walked graph is require-clean today; if a genuinely-lazy bare
      // require ever appears, exempt that one site explicitly.
      if (isBare(spec)) checkBare(file, spec, 'require()d');
      else followRelative(file, spec);
    }
    for (const spec of dynamicSpecs) {
      if (isBare(spec)) continue; // lazy; cannot classify statically
      const resolved = resolveRelative(file, spec);
      if (resolved && inside(contract.dynamicRootDirs, resolved)) {
        if (!visited.has(resolved) && !parent.has(resolved)) parent.set(resolved, file);
        queue.push(resolved);
      }
    }
  }

  return { violations, unresolved, visited };
}
