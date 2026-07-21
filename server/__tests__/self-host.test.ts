// @vitest-environment node

/**
 * Unit tests for the WM_SELF_HOST entitlement bypass.
 *
 * isSelfHost (server/_shared/self-host.ts) is computed once, at module
 * import time, from process.env.WM_SELF_HOST. That means every test here
 * that needs a specific flag value must set process.env.WM_SELF_HOST BEFORE
 * importing (or re-importing via vi.resetModules()) any module that
 * transitively imports self-host.ts — setting the env var after import has
 * no effect on the already-cached boolean.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../_shared/redis", () => ({
  getCachedJson: vi.fn().mockResolvedValue(null),
  setCachedJson: vi.fn().mockResolvedValue(undefined),
}));

const ORIGINAL_WM_SELF_HOST = process.env.WM_SELF_HOST;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_WM_SELF_HOST === undefined) delete process.env.WM_SELF_HOST;
  else process.env.WM_SELF_HOST = ORIGINAL_WM_SELF_HOST;
  vi.resetModules();
});

describe("isSelfHost flag parsing", () => {
  test.each(["1", "true", "TRUE", "  yes  ", "on"])(
    "WM_SELF_HOST=%j resolves to true",
    async (value) => {
      process.env.WM_SELF_HOST = value;
      const { isSelfHost } = await import("../_shared/self-host");
      expect(isSelfHost).toBe(true);
    },
  );

  test.each([undefined, "", "0", "false", "no", "off", "banana"])(
    "WM_SELF_HOST=%j resolves to false",
    async (value) => {
      if (value === undefined) delete process.env.WM_SELF_HOST;
      else process.env.WM_SELF_HOST = value;
      const { isSelfHost } = await import("../_shared/self-host");
      expect(isSelfHost).toBe(false);
    },
  );
});

describe("checkEntitlementDetailed self-host bypass", () => {
  test("unset WM_SELF_HOST still fails closed on a gated endpoint with no userId (no regression)", async () => {
    delete process.env.WM_SELF_HOST;
    const { checkEntitlementDetailed } = await import("../_shared/entitlement-check");
    const result = await checkEntitlementDetailed(null, "/api/market/v1/analyze-stock", {});
    expect(result.response?.status).toBe(403);
    expect(result.entitlements).toBeNull();
  });

  test("WM_SELF_HOST=1 allows a gated endpoint with no userId and no Redis/Convex round-trip", async () => {
    process.env.WM_SELF_HOST = "1";
    const { getCachedJson } = await import("../_shared/redis");
    const { checkEntitlementDetailed } = await import("../_shared/entitlement-check");

    const result = await checkEntitlementDetailed(null, "/api/market/v1/analyze-stock", {});

    expect(result.response).toBeNull();
    expect(result.entitlements?.features.tier).toBe(3);
    expect(result.entitlements?.features.mcpAccess).toBe(true);
    expect(getCachedJson).not.toHaveBeenCalled();
  });

  test("WM_SELF_HOST=1 still allows unrestricted endpoints (no gate to bypass)", async () => {
    process.env.WM_SELF_HOST = "1";
    const { checkEntitlementDetailed } = await import("../_shared/entitlement-check");
    const result = await checkEntitlementDetailed(null, "/api/seismology/v1/list-earthquakes", {});
    expect(result.response).toBeNull();
    expect(result.entitlements).toBeNull();
  });
});

describe("resolvePremiumCallerIdentity self-host bypass", () => {
  test("WM_SELF_HOST=1 returns a premium enterprise identity for an anonymous request", async () => {
    process.env.WM_SELF_HOST = "1";
    const { resolvePremiumCallerIdentity } = await import("../_shared/premium-check");

    const identity = await resolvePremiumCallerIdentity(new Request("https://example.com/api/chat-analyst"));

    expect(identity).toEqual({
      isPremium: true,
      userId: null,
      kind: "enterprise",
      quotaExempt: true,
    });
  });
});

describe("reserveDirectLlmQuota self-host bypass", () => {
  test("WM_SELF_HOST=1 grants an unmetered reservation without touching the pipeline", async () => {
    process.env.WM_SELF_HOST = "1";
    const { reserveDirectLlmQuota } = await import("../_shared/direct-llm-quota");

    const pipeline = vi.fn();
    const result = await reserveDirectLlmQuota({ userId: "any-user", pipeline });

    expect(result.ok).toBe(true);
    expect(pipeline).not.toHaveBeenCalled();
  });
});
