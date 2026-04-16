import { Amplify } from 'aws-amplify';
import { signUp, signIn, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import type { AwsConfig } from '../config/aws-config';

export function configureAuth(config: AwsConfig): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
      },
    },
  });
}

export async function handleSignUp(username: string, password: string) {
  return await signUp({ username, password });
}

export async function handleSignIn(username: string, password: string) {
  try {
    return await signIn({ username, password });
  } catch (err: any) {
    if (err.name === 'UserAlreadyAuthenticatedException') {
      await signOut();
      return await signIn({ username, password });
    }
    throw err;
  }
}

export async function handleSignOut() {
  await signOut();
}

export async function checkSession(): Promise<{ username: string; tokens: any; groups: string[] } | null> {
  try {
    const user = await getCurrentUser();
    const session = await fetchAuthSession();
    const groups = (session.tokens?.idToken?.payload?.['cognito:groups'] as string[] | undefined) ?? [];
    return {
      username: user.username,
      tokens: session.tokens,
      groups,
    };
  } catch (error) {
    return null;
  }
}
