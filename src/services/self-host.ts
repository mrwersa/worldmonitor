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

const FLAG = import.meta.env.VITE_SELF_HOST as string | undefined;

/** True when this client build is running in self-host mode. */
export const isSelfHost: boolean = (() => {
  if (!FLAG) return false;
  const v = String(FLAG).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
})();