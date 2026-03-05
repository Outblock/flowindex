import sodium from 'libsodium-wrappers';
import { getInstallationOctokit } from './auth.js';

async function encryptSecret(publicKey: string, secretValue: string): Promise<string> {
  await sodium.ready;
  const binKey = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const binSec = sodium.from_string(secretValue);
  const encBytes = sodium.crypto_box_seal(binSec, binKey);
  return sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
}

export async function setRepoSecret(
  installationId: number,
  owner: string,
  repo: string,
  secretName: string,
  secretValue: string,
): Promise<void> {
  const octokit = await getInstallationOctokit(installationId);
  const { data: keyData } = await octokit.request(
    'GET /repos/{owner}/{repo}/actions/secrets/public-key',
    { owner, repo },
  );
  const encryptedValue = await encryptSecret(keyData.key, secretValue);
  await octokit.request(
    'PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}',
    { owner, repo, secret_name: secretName, encrypted_value: encryptedValue, key_id: keyData.key_id },
  );
}
