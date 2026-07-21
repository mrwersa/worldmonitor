/**
 * Self-host entitlement bypass.
 *
 * When `WM_SELF_HOST=1` is set in the server environment, every Pro/enterprise
 * entitlement gate short-circuits to "allowed". This lets self-hosters run the
 * full feature set without standing up Clerk + Dodo Payments + Convex.
 *
 * The flag is intentionally opt-in (defaults to falsy). Hosted deploys that do
 * not set it keep the original fail-closed behavior unchanged.
 *
 * Server-side equivalent: `server/_shared/self-host.ts` (reads `process.env`).
 * Client-side: `src/services/self-host.ts` (reads `import.meta.env.VITE_SELF_HOST`).
 */

const FLAG = process.env.WM_SELF_HOST;

/** True when this server is running in self-host mode. */
export const isSelfHost = (() => {
  if (!FLAG) return false;
  const v = FLAG.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
})();

/** A synthetic enterprise-tier entitlement row used to bypass all gates. */
export const SELF_HOST_ENTITLEMENT = {
  planKey: 'self-host',
  features: {
    tier: 3,
    apiAccess: true,
    apiRateLimit: 0,
    maxDashboards: 999,
    prioritySupport: false,
    exportFormats: ['csv', 'json', 'pdf'],
    mcpAccess: true,
    apiDailyAllowance: -1,
  },
  validUntil: Number.MAX_SAFE_INTEGER,
} as const;

/** A synthetic premium caller identity for self-host mode. */
export const SELF_HOST_PREMIUM_IDENTITY = {
  isPremium: true,
  userId: 'self-host',
  kind: 'enterprise',
  quotaExempt: true,
} as const;