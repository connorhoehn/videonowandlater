/**
 * Thin wrapper around fetchAuthSession that returns demo credentials
 * when demo mode is active (no AWS connection required).
 */

import { fetchAuthSession } from 'aws-amplify/auth';
import { isDemoMode, DEMO_TOKEN, DEMO_USERNAME } from '../demo/demoMode';

export async function fetchToken(): Promise<{ token: string; username: string }> {
  if (isDemoMode()) {
    return { token: DEMO_TOKEN, username: DEMO_USERNAME };
  }
  const session = await fetchAuthSession();
  return {
    token: session.tokens?.idToken?.toString() || '',
    username: (session.tokens?.idToken?.payload?.['cognito:username'] as string) || '',
  };
}
