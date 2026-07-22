/**
 * Client-side self-host entitlement bypass.
 *
 * When `VITE_SELF_HOST=1` is set at build time, all Pro/enterprise feature
 * gates in the browser short-circuit to "allowed". This lets self-hosters
 * run the full feature set without Clerk + Dodo Payments + Convex.
 *
 * Server-side equivalent: `server/_shared/self-host.ts` (reads `process.env.WM_SELF_HOST`).
 * Client-side: this file (reads `import.meta.env.VITE_SELF_HOST`).
 *
 * For Docker deployments: set both `WM_SELF_HOST=1` (server) and
 * `VITE_SELF_HOST=1` (build arg → client bundle) in your `.env` / compose file.
 */

// Optional chaining on `env` (not just the property) is deliberate: this
// module is reachable from esbuild-bundled test harnesses that don't go
// through Vite's dev/build pipeline (which is what normally populates
// import.meta.env), so import.meta.env itself can be undefined there, not
// just VITE_SELF_HOST. A bare `.VITE_SELF_HOST` access crashed every panel
// test harness that transitively imports entitlements.ts (which imports
// this module) with "Cannot read properties of undefined" — see the sibling
// guard pattern in src/config/map-layer-definitions.ts / data-loader.ts.
const FLAG = import.meta.env?.VITE_SELF_HOST as string | undefined;

/** True when this client build is running in self-host mode. */
export const isSelfHost: boolean = (() => {
  if (!FLAG) return false;
  const v = String(FLAG).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
})();