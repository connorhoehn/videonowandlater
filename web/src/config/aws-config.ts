export interface AwsConfig {
  userPoolId: string;
  userPoolClientId: string;
  region: string;
  apiUrl: string;
}

let config: AwsConfig | null = null;

export async function loadConfig(): Promise<AwsConfig | null> {
  try {
    const response = await fetch('/aws-config.json');
    if (!response.ok) {
      console.warn('Failed to load aws-config.json: stack not deployed');
      return null;
    }
    config = await response.json();
    return config;
  } catch (error) {
    console.warn('Failed to fetch aws-config.json:', error);
    return null;
  }
}

export function getConfig(): AwsConfig | null {
  return config;
}
