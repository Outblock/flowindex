import { App } from '@octokit/app';

const GITHUB_APP_ID = process.env.GITHUB_APP_ID || '';
const GITHUB_APP_PRIVATE_KEY = (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const GITHUB_APP_CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID || '';
const GITHUB_APP_CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET || '';

let githubApp: App | null = null;

export function getGitHubApp(): App {
  if (!githubApp) {
    if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY) {
      throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set');
    }
    githubApp = new App({
      appId: GITHUB_APP_ID,
      privateKey: GITHUB_APP_PRIVATE_KEY,
      oauth: {
        clientId: GITHUB_APP_CLIENT_ID,
        clientSecret: GITHUB_APP_CLIENT_SECRET,
      },
    });
  }
  return githubApp;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getInstallationOctokit(installationId: number): Promise<any> {
  const app = getGitHubApp();
  return app.getInstallationOctokit(installationId);
}
