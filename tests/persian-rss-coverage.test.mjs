import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const client = read('src/config/feeds.ts');
const server = read('server/worldmonitor/news/v1/_feeds.ts');
const docs = read('docs/data-sources.mdx');
const tiers = JSON.parse(read('shared/source-tiers.json'));
const relayTiers = JSON.parse(read('scripts/shared/source-tiers.json'));

const feeds = [
  { name: 'IRNA Persian', url: 'https://irna.ir/rss' },
  { name: 'Mehr News Persian', url: 'https://www.mehrnews.com/rss' },
  { name: 'ISNA Persian', url: 'https://www.isna.ir/rss' },
];

describe('native Persian RSS coverage', () => {
  for (const feed of feeds) {
    it(`${feed.name} is locale-gated and mirrored across client/server`, () => {
      const escapedUrl = feed.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedName = feed.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(client, new RegExp(`name: '${escapedName}', url: rss\\('${escapedUrl}'\\), lang: 'fa'`));
      assert.match(server, new RegExp(`name: '${escapedName}', url: '${escapedUrl}', lang: 'fa'`));
      assert.match(client, new RegExp(`middleeast: \\[[^\\]]*'${escapedName}'`));
      assert.equal(tiers[feed.name], 3);
      assert.equal(relayTiers[feed.name], 3);
      assert.match(docs, new RegExp(`${escapedName} \\(fa\\)`));
    });
  }

  it('keeps state-affiliation metadata visible for operator judgment', () => {
    assert.match(client, /'IRNA Persian': \{ risk: 'high', stateAffiliated: 'Iran'/);
    assert.match(client, /'Mehr News Persian': \{ risk: 'high', stateAffiliated: 'Iran'/);
    assert.match(client, /'ISNA Persian': \{ risk: 'medium', stateAffiliated: 'Iran'/);
  });
});
