/**
 * Demo mode — lets the app run without AWS credentials.
 * Persisted in localStorage so refreshes stay in demo.
 */

const DEMO_KEY = 'vnl_demo_mode';

export function isDemoMode(): boolean {
  try { return localStorage.getItem(DEMO_KEY) === 'true'; }
  catch { return false; }
}

export function enableDemoMode(): void {
  localStorage.setItem(DEMO_KEY, 'true');
}

export function disableDemoMode(): void {
  localStorage.removeItem(DEMO_KEY);
}

export const DEMO_USER = { username: 'demo_guest' };
export const DEMO_TOKEN = 'demo-token-mock';
export const DEMO_USERNAME = 'demo_guest';

/** Fake AWS config used when demo mode is active — no real infra needed */
export const DEMO_CONFIG = {
  userPoolId: 'us-east-1_demo',
  userPoolClientId: 'demo-client-id',
  region: 'us-east-1',
  apiUrl: 'https://api.demo.local',
};
