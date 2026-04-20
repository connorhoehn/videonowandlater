export interface AwsConfig {
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId?: string;
  region: string;
  apiUrl: string;
  adsBaseUrl?: string;
}

let config: AwsConfig | null = null;

export async function loadConfig(): Promise<AwsConfig | null> {
  // Demo mode: skip AWS config fetch entirely
  try {
    if (localStorage.getItem('vnl_demo_mode') === 'true') {
      config = { userPoolId: 'us-east-1_demo', userPoolClientId: 'demo-client-id', region: 'us-east-1', apiUrl: 'https://api.demo.local' };
      return config;
    }
  } catch { /* ignore */ }

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
