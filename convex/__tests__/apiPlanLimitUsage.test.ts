import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import { getFeaturesForPlan } from "../lib/entitlements";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const usageFns = (internal as any).apiPlanLimitUsage;

const NOW = 1_800_000_000_000;
const FUTURE = NOW + 30 * 86_400_000;

async function seedEntitlement(t: ReturnType<typeof convexTest>, userId: string, planKey: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("entitlements", {
      userId,
      planKey,
      features: getFeaturesForPlan(planKey),
      validUntil: FUTURE,
      updatedAt: NOW,
    });
  });
}

describe("api plan-limit usage scanner", () => {
  test("dry run reports would-notify without mutating notice state", async () => {
    const t = convexTest(schema, modules);
    await seedEntitlement(t, "user-api", "api_starter");

    const summary = await t.action(usageFns.scanApiPlanLimitUsageInternal, {
      dryRun: true,
      now: NOW,
      rows: [{
        userId: "user-api",
        dimension: "api_daily_requests",
        usage: 850,
        source: "test",
      }],
    });

    expect(summary).toMatchObject({
      dryRun: true,
      evaluated: 1,
      wouldNotify: 1,
      notified: 0,
    });
    const notices = await t.run((ctx) => ctx.db.query("apiPlanLimitNotices").collect());
    expect(notices).toHaveLength(0);
  });

  test("records over-limit API Starter notice and blocks readiness when Business is not self-serve", async () => {
    const t = convexTest(schema, modules);
    await seedEntitlement(t, "user-api", "api_starter");

    const summary = await t.action(usageFns.scanApiPlanLimitUsageInternal, {
      now: NOW,
      rows: [{
        userId: "user-api",
        dimension: "api_daily_requests",
        usage: 1_200,
        source: "test",
      }],
    });

    expect(summary.notified).toBe(1);
    expect(summary.blocked).toContainEqual({
      userId: "user-api",
      dimension: "api_daily_requests",
      reason: "api_business_not_self_serve",
    });

    const notices = await t.run((ctx) => ctx.db.query("apiPlanLimitNotices").collect());
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      state: "over_limit",
      ctaKind: "contact_support",
      blockedReason: "api_business_not_self_serve",
      upgradeTargetPlanKey: "api_business",
    });
  });

  test("does not emit MCP minute notices without durable limiter-hit buckets", async () => {
    const t = convexTest(schema, modules);
    await seedEntitlement(t, "user-pro", "pro_monthly");

    const summary = await t.action(usageFns.scanApiPlanLimitUsageInternal, {
      now: NOW,
      rows: [{
        userId: "user-pro",
        dimension: "mcp_minute_burst",
        usage: 75,
        source: "test",
      }],
    });

    expect(summary).toMatchObject({
      evaluated: 1,
      wouldNotify: 0,
      notified: 0,
    });
    const notices = await t.run((ctx) => ctx.db.query("apiPlanLimitNotices").collect());
    expect(notices).toHaveLength(0);
  });

  test("emits MCP minute notices from durable limiter-hit buckets", async () => {
    const t = convexTest(schema, modules);
    await seedEntitlement(t, "user-pro", "pro_monthly");

    const summary = await t.action(usageFns.scanApiPlanLimitUsageInternal, {
      now: NOW,
      rows: [{
        userId: "user-pro",
        dimension: "mcp_minute_burst",
        usage: 90,
        minuteBuckets: [61, 62, 10, 65, 20],
        source: "axiom:mcp_rate_limit_hit",
      }],
    });

    expect(summary).toMatchObject({
      evaluated: 1,
      wouldNotify: 1,
      notified: 1,
    });
    const notices = await t.run((ctx) => ctx.db.query("apiPlanLimitNotices").collect());
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      dimension: "mcp_minute_burst",
      state: "sustained_burst",
      ctaKind: "checkout",
      upgradeTargetPlanKey: "api_starter",
    });
  });

  test("recovers a lingering burst notice once the burst stops", async () => {
    const t = convexTest(schema, modules);
    await seedEntitlement(t, "user-pro", "pro_monthly");

    // Trip a sustained burst so a current notice exists.
    await t.action(usageFns.scanApiPlanLimitUsageInternal, {
      now: NOW,
      rows: [{
        userId: "user-pro",
        dimension: "mcp_minute_burst",
        usage: 90,
        minuteBuckets: [61, 62, 63, 65, 66],
        source: "axiom:mcp_rate_limit_hit",
      }],
    });
    let notices = await t.run((ctx) => ctx.db.query("apiPlanLimitNotices").collect());
    expect(notices.filter((notice) => notice.current)).toHaveLength(1);

    // Next scan: the burst is gone so no row is produced for this user. The
    // stale-notice sweep must clear the lingering current notice; the per-row
    // recovery path never would (there is no row to recover from).
    const summary = await t.action(usageFns.scanApiPlanLimitUsageInternal, {
      now: NOW + 3_600_000,
      rows: [],
    });
    expect(summary.recovered).toBe(1);
    notices = await t.run((ctx) => ctx.db.query("apiPlanLimitNotices").collect());
    expect(notices.filter((notice) => notice.current)).toHaveLength(0);
  });

  test("a continuing burst reuses one notice across hourly scans and holds the 6h email cadence", async () => {
    const t = convexTest(schema, modules);
    await seedEntitlement(t, "user-pro", "pro_monthly");
    const noticeFns = (internal as any).apiPlanLimitNotices;

    const burstRow = {
      userId: "user-pro",
      dimension: "mcp_minute_burst",
      usage: 90,
      minuteBuckets: [61, 62, 63, 65, 66],
      source: "axiom:mcp_rate_limit_hit",
    };

    // Scan 1: burst tripped -> one pending sustained_burst notice.
    await t.action(usageFns.scanApiPlanLimitUsageInternal, { now: NOW, rows: [burstRow] });
    let notices = await t.run((ctx) => ctx.db.query("apiPlanLimitNotices").collect());
    expect(notices).toHaveLength(1);
    const noticeId = notices[0]._id;

    // Simulate the email-delivery cron sending it.
    await t.mutation(noticeFns.markEmailStatus, { noticeId, emailStatus: "sent", emailedAt: NOW });

    // Scan 2, one hour later, burst still active. The scanner runs HOURLY, so a
    // minute-grained notice window would mint a fresh pending notice every scan
    // (bypassing the 6h cadence + losing dismiss/attempt state). The notice must
    // instead REUSE the same document so lastEmailedAt/emailStatus carry forward.
    await t.action(usageFns.scanApiPlanLimitUsageInternal, { now: NOW + 3_600_000, rows: [burstRow] });

    notices = await t.run((ctx) => ctx.db.query("apiPlanLimitNotices").collect());
    expect(notices).toHaveLength(1); // reused, not re-minted
    expect(String(notices[0]._id)).toBe(String(noticeId));
    expect(notices[0].current).toBe(true);
    expect(notices[0].emailStatus).toBe("sent"); // not flipped back to pending
    expect(notices[0].lastEmailedAt).toBe(NOW); // preserved

    // Cadence: not due again within BURST_EMAIL_CADENCE_MS (6h).
    const due = await t.query(noticeFns.listEmailDue, { now: NOW + 3_600_000 });
    expect(due.map((n: { _id: unknown }) => String(n._id))).not.toContain(String(noticeId));

    // Audit granularity preserved: rollups keep the minute-grained windowKey
    // while the notice carries only the coarse (day) dedupe key.
    const rollups = await t.run((ctx) => ctx.db.query("apiUsageRollups").collect());
    expect(rollups.some((r) => r.windowKey.includes("T"))).toBe(true);
    expect(notices[0].windowKey).not.toContain("T");
  });

  test("a dismissed burst notice stays dismissed across an hourly rescan", async () => {
    const t = convexTest(schema, modules);
    await seedEntitlement(t, "user-pro", "pro_monthly");

    const burstRow = {
      userId: "user-pro",
      dimension: "mcp_minute_burst",
      usage: 90,
      minuteBuckets: [61, 62, 63, 65, 66],
      source: "axiom:mcp_rate_limit_hit",
    };

    await t.action(usageFns.scanApiPlanLimitUsageInternal, { now: NOW, rows: [burstRow] });
    const before = await t.run((ctx) => ctx.db.query("apiPlanLimitNotices").collect());
    expect(before).toHaveLength(1);
    // Simulate the user dismissing it (acknowledgeNotice sets acknowledgedAt).
    await t.run((ctx) => ctx.db.patch(before[0]._id, { acknowledgedAt: NOW }));

    // Burst continues; the hourly rescan must NOT resurrect the dismissed notice.
    await t.action(usageFns.scanApiPlanLimitUsageInternal, { now: NOW + 3_600_000, rows: [burstRow] });
    const after = await t.run((ctx) => ctx.db.query("apiPlanLimitNotices").collect());
    expect(after).toHaveLength(1);
    expect(after[0].acknowledgedAt).toBe(NOW); // dismiss survived
  });

  test("skips rows that cannot be joined to an active entitlement", async () => {
    const t = convexTest(schema, modules);

    const summary = await t.action(usageFns.scanApiPlanLimitUsageInternal, {
      now: NOW,
      rows: [{
        userId: "unknown-user",
        dimension: "api_daily_requests",
        usage: 2_000,
        source: "test",
      }],
    });

    expect(summary.skipped).toContainEqual({
      userId: "unknown-user",
      dimension: "api_daily_requests",
      reason: "unknown_or_inactive_entitlement",
    });
  });
});
