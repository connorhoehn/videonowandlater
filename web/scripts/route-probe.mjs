// Quick route health probe — logs in as admin, visits each route,
// captures uncaught errors + non-2xx network responses + a screenshot.
// Usage: node scripts/route-probe.mjs
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'http://localhost:5173';
const USERNAME = 'admin';
const PASSWORD = 'AdminPass123';
const OUT_DIR = '/tmp/vnl-route-probe';

const ROUTES = [
  { label: 'home',      path: '/' },
  { label: 'admin',     path: '/admin' },
  { label: 'rulesets',  path: '/admin/rulesets' },
  { label: 'feed',      path: '/feed' },
  { label: 'search',    path: '/search?q=test' },
  { label: 'settings',  path: '/settings' },
  { label: 'replay',    path: '/replay/8dbdcc0f-3d47-4bfc-8440-3302ae73962e' },
  { label: 'event',     path: '/events/7905f1ed-0e8c-4a2f-8230-5d544fd52e73' },
  { label: 'profile',   path: '/u/admin' },
];

const report = [];

async function login(page) {
  await page.goto(BASE);
  // Wait for login form
  try {
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
  } catch {
    return; // already logged in
  }
  const userInput = await page.$('input[name="username"]') || await page.$('input[type="text"]');
  await userInput?.fill(USERNAME);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(u => u.toString() === `${BASE}/` || !u.toString().includes('login'), { timeout: 15_000 }).catch(() => {}),
    page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first().click(),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function probeRoute(page, route) {
  const errors = [];
  const netFails = [];
  page.removeAllListeners('pageerror');
  page.removeAllListeners('response');
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('response', (resp) => {
    const status = resp.status();
    const url = resp.url();
    if (status >= 400 && !url.includes('cognito-idp') && !url.includes('.css') && !url.includes('.js') && !url.includes('.woff')) {
      netFails.push(`${status} ${resp.request().method()} ${url.slice(0, 120)}`);
    }
  });

  try {
    await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle', timeout: 20_000 });
  } catch (e) {
    errors.push(`navigation: ${e.message}`);
  }
  await page.waitForTimeout(1500);

  // capture visible text + whether page has content
  const visibleText = (await page.locator('body').innerText().catch(() => ''))?.slice(0, 200) || '';
  const bodyHasContent = visibleText.trim().length > 0;

  const shotPath = path.join(OUT_DIR, `${route.label}.png`);
  await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {});

  report.push({
    route: route.path,
    label: route.label,
    blank: !bodyHasContent,
    visibleText: visibleText.replace(/\s+/g, ' ').trim(),
    errors,
    netFails,
    shot: shotPath,
  });
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await login(page);
  } catch (e) {
    console.error('login failed:', e.message);
  }
  for (const r of ROUTES) {
    console.log(`probing ${r.label} (${r.path})...`);
    await probeRoute(page, r);
  }
  await browser.close();

  console.log('\n=== REPORT ===');
  for (const r of report) {
    const tag = r.errors.length ? 'ERR' : r.netFails.length ? 'WARN' : r.blank ? 'BLANK' : 'OK';
    console.log(`\n[${tag}] ${r.label} ${r.route}`);
    if (r.visibleText) console.log(`  visible: "${r.visibleText.slice(0, 140)}"`);
    if (r.errors.length) r.errors.forEach((e) => console.log(`  pageerror: ${e}`));
    if (r.netFails.length) r.netFails.forEach((n) => console.log(`  netfail:   ${n}`));
  }
  await fs.writeFile('/tmp/vnl-route-probe/report.json', JSON.stringify(report, null, 2));
  console.log('\nscreenshots + JSON report in /tmp/vnl-route-probe/');
}

main().catch((e) => { console.error(e); process.exit(1); });
