import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

describe('self-host UI entitlement surfaces', () => {
  it('Docker production and dev builds enable self-host mode by default', () => {
    const prod = read('docker-compose.yml');
    const dev = read('docker-compose.dev.yml');
    assert.match(prod, /VITE_SELF_HOST: "\$\{WM_SELF_HOST:-1\}"/);
    assert.match(prod, /WM_SELF_HOST: "\$\{WM_SELF_HOST:-1\}"/);
    assert.match(dev, /VITE_SELF_HOST: "\$\{WM_SELF_HOST:-1\}"/);
    assert.match(dev, /WM_SELF_HOST: "\$\{WM_SELF_HOST:-1\}"/);
  });

  it('panel and Settings PRO badges disappear when access is already granted', () => {
    const panel = read('src/components/Panel.ts');
    const settings = read('src/components/UnifiedSettings.ts');
    assert.match(panel, /options\.premium && !hasPremiumAccess\(\)/);
    assert.match(panel, /if \(hasPremiumAccess\(\)\) \{\s*this\.unlockPanel\(\);/);
    assert.match(settings, /resolvedPanel\.premium && !pro/);
    assert.match(settings, /API Keys \$\{isSelfHost \? '' : '<span class="panel-pro-badge">PRO<\/span>'\}/);
  });

  it('self-host Notifications explains its hosted persistence dependency without an upgrade CTA', () => {
    const notifications = read('src/services/notifications-settings.ts');
    const branch = notifications.match(/if \(isSelfHost\) \{([\s\S]*?)\} else if \(isPro\)/)?.[1] ?? '';
    assert.match(branch, /Self-host notification delivery is not configured yet/);
    assert.doesNotMatch(branch, /Upgrade to Pro|usNotifUpgradeBtn/);
    assert.match(notifications, /if \(isSelfHost\) return \(\) => ac\.abort\(\)/);
  });

  it('does not advertise hosted MCP account management in self-host Settings', () => {
    const settings = read('src/components/UnifiedSettings.ts');
    assert.match(settings, /showMcpClientsTab = !isSelfHost && hasFeature\('mcpAccess'\)/);
  });
});
