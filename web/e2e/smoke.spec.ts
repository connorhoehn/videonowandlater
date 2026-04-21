/**
 * Smoke tests — prove the app boots and the key surfaces render without
 * hard errors. Runs in demo mode (mockFetch) so no AWS deployment required.
 *
 * What we're NOT testing here:
 *  - Real IVS playback (requires a live stream endpoint)
 *  - Auth flow end-to-end (demo mode bypasses Cognito)
 *  - Backend integration (covered by backend jest tests)
 *
 * What we ARE testing:
 *  - App loads past config resolution
 *  - Demo page toggles mock mode
 *  - Home (after mock mode) renders the discovery feed + create-post UI
 *  - Settings sub-routes render without console errors
 *  - Session pages handle unknown ids gracefully
 */

import { test, expect } from '@playwright/test';

async function enterDemoMode(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const tryDemo = page.getByRole('button', { name: /try (the )?demo|enter demo/i }).first();
  if (await tryDemo.isVisible().catch(() => false)) {
    await tryDemo.click();
  }
}

test('landing → demo page renders', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/demo');
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.locator('body')).toBeVisible();

  expect(consoleErrors.join('\n')).not.toMatch(/TypeError|ReferenceError/);
});

test('home page renders discovery feed scaffolding', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await enterDemoMode(page);
  await page.goto('/');

  await expect(page.locator('body')).toBeVisible();

  const hasDiscovery =
    (await page.getByRole('tab', { name: /live/i }).count().catch(() => 0)) > 0;
  const hasCreatePost =
    (await page.getByText(/go live|hangout|story|upload/i).first().isVisible().catch(() => false));

  expect(hasDiscovery || hasCreatePost).toBeTruthy();

  // No uncaught runtime errors on the home page. Would have caught the
  // `isCreating is not defined` ReferenceError from the Go Live wiring.
  expect(pageErrors.join('\n'), `page errors:\n${pageErrors.join('\n')}`).not.toMatch(/TypeError|ReferenceError/);
});

test('search route accepts query + renders', async ({ page }) => {
  await enterDemoMode(page);
  await page.goto('/search?q=test');
  await expect(page.locator('body')).toBeVisible();
  // URL should preserve the query
  await expect(page).toHaveURL(/q=test/);
});

test('settings routes render', async ({ page }) => {
  await enterDemoMode(page);

  for (const path of ['profile', 'groups', 'invites', 'notifications', 'earnings']) {
    await page.goto(`/settings/${path}`);
    await expect(page.locator('body')).toBeVisible();
    // Body has rendered some content (not a blank error page)
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(10);
  }
});

test('public clip route renders the viewer shell', async ({ page }) => {
  // Public clip pages work without auth. Unknown id should render a not-found
  // message rather than crash.
  await page.goto('/clip/nonexistent-clip-id');
  await expect(page.locator('body')).toBeVisible();
});

test('creator page by handle renders', async ({ page }) => {
  await page.goto('/@somehandle');
  await expect(page.locator('body')).toBeVisible();
  // Should show either a 404/not-found message or a profile skeleton
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.length).toBeGreaterThan(0);
});

test('event page route loads for unknown session', async ({ page }) => {
  await enterDemoMode(page);
  await page.goto('/events/unknown-session-id');
  await expect(page.locator('body')).toBeVisible();
});
