import { Amplify } from 'aws-amplify';
import { signUp, signIn, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { AwsConfig } from '../config/aws-config';

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
  return await signIn({ username, password });
}

export async function handleSignOut() {
  await signOut();
}

export async function checkSession(): Promise<{ username: string; tokens: any } | null> {
  try {
    const user = await getCurrentUser();
    const session = await fetchAuthSession();
    return {
      username: user.username,
      tokens: session.tokens,
    };
  } catch (error) {
    return null;
  }
}
