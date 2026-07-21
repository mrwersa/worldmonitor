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
 *
 * SELF_HOST_ENTITLEMENT / SELF_HOST_PREMIUM_IDENTITY are typed directly
 * against the real interfaces (type-only imports, so no runtime circularity
 * with entitlement-check.ts / premium-check.ts, which import isSelfHost from
 * here) rather than `as const` + `as unknown as` at each call site — that
 * pattern would silently stop catching drift if either interface changes.
 */

import type { CachedEntitlements } from './entitlement-check';
import type { PremiumCallerIdentity } from './premium-check';

const FLAG = process.env.WM_SELF_HOST;

/** True when this server is running in self-host mode. */
export const isSelfHost = (() => {
  if (!FLAG) return false;
  const v = FLAG.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
})();

/** A synthetic enterprise-tier entitlement row used to bypass all gates. */
export const SELF_HOST_ENTITLEMENT: CachedEntitlements = {
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
};

/**
 * A synthetic premium caller identity for self-host mode. userId is null,
 * matching the real 'enterprise' variant (see premium-check.ts's other two
 * `kind: 'enterprise'` returns) rather than a placeholder string — nothing
 * downstream should key spend/quota tracking off a self-host sentinel id.
 */
export const SELF_HOST_PREMIUM_IDENTITY: PremiumCallerIdentity = {
  isPremium: true,
  userId: null,
  kind: 'enterprise',
  quotaExempt: true,
};