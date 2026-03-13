import { describe, expect, it } from 'vitest';

import {
  decryptFromKeystore,
  decryptMnemonicFromKeystore,
  deriveFromMnemonic,
  encryptMnemonicToKeystore,
  encryptToKeystore,
} from './localKeyManager';

describe('localKeyManager keystore detection', () => {
  it('decrypts private-key keystores without misclassifying them as mnemonic', async () => {
    const privateKeyHex = '1'.repeat(64);
    const password = 'runner-test';
    const keystoreJson = await encryptToKeystore(privateKeyHex, password);

    await expect(decryptMnemonicFromKeystore(keystoreJson, password)).resolves.toBeNull();
    await expect(decryptFromKeystore(keystoreJson, password, 'ECDSA_P256')).resolves.toBe(privateKeyHex);
    await expect(decryptFromKeystore(keystoreJson, password, 'ECDSA_secp256k1')).resolves.toBe(privateKeyHex);
  });

  it('decrypts mnemonic keystores with curve-specific derived keys', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const password = 'runner-test';
    const keystoreJson = await encryptMnemonicToKeystore(mnemonic, password);
    const derived = await deriveFromMnemonic(mnemonic);

    await expect(decryptMnemonicFromKeystore(keystoreJson, password)).resolves.toBe(mnemonic);
    await expect(decryptFromKeystore(keystoreJson, password, 'ECDSA_P256')).resolves.toBe(derived.privateKeyHex);
    await expect(decryptFromKeystore(keystoreJson, password, 'ECDSA_secp256k1')).resolves.toBe(derived.privateKeyHexSecp256k1);
  });
});
