import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Agent-facing pricing surfaces must not drift from the source of truth,
// convex/config/productCatalog.ts (#4854). The /pro page has its own
// freshness gate; these two files are hand-maintained markdown/MDX with no
// generator, so this guard extracts prices from the catalog SOURCE TEXT
// (no import — convex modules don't load under tsx --test) and asserts each
// USD figure appears in the docs. If a price change lands in the catalog,
// this test names every doc that still shows the old number.
//
// Run: node --test tests/pricing-docs-drift.test.mjs

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(__dirname, '..', p), 'utf-8');

const catalogSrc = read('convex/config/productCatalog.ts');

// Pull { planKey → priceCents } for the publicly-priced subscription plans.
const PLAN_KEYS = ['pro_monthly', 'pro_annual', 'api_starter'];
const priceCentsFor = (planKey) => {
  // Anchor on the object key, then take the first priceCents after it.
  const blockStart = catalogSrc.indexOf(`${planKey}: {`);
  assert.notEqual(blockStart, -1, `productCatalog.ts must contain a "${planKey}" entry`);
  const m = catalogSrc.slice(blockStart).match(/priceCents:\s*(\d+)/);
  assert.ok(m, `no priceCents found for ${planKey}`);
  return Number(m[1]);
};

const usd = (cents) =>
  (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, '');

const DOCS = ['public/pricing.md', 'docs/pricing.mdx'];

for (const doc of DOCS) {
  const content = read(doc);
  for (const planKey of PLAN_KEYS) {
    const cents = priceCentsFor(planKey);
    const dollars = `$${usd(cents)}`;
    test(`${doc} carries the current ${planKey} price (${dollars})`, () => {
      assert.ok(
        content.includes(dollars),
        `${doc} must contain ${dollars} for ${planKey} — productCatalog.ts changed and this doc did not`
      );
    });
  }
}

// The Dodo product IDs are surfaced by GET /api/product-catalog, and
// docs/openapi/CommerceService.openapi.yaml embeds two of them as examples.
// Guard those too — a rotated product ID in the catalog must not leave the
// published OpenAPI example pointing at a dead product.
test('CommerceService.openapi.yaml example product IDs exist in productCatalog.ts', () => {
  const spec = read('docs/openapi/CommerceService.openapi.yaml');
  const exampleIds = [...spec.matchAll(/pdt_[A-Za-z0-9]+/g)].map((m) => m[0]);
  assert.ok(exampleIds.length > 0, 'spec example must include at least one Dodo product ID');
  for (const id of exampleIds) {
    assert.ok(
      catalogSrc.includes(`"${id}"`),
      `spec example product ID ${id} is not present in productCatalog.ts`
    );
  }
});
