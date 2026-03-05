import { initWasm } from '@trustwallet/wallet-core';

const FLOW_BIP44_PATH = "m/44'/539'/0'/0/0";

function hexToBytes(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function stringToBytes(str) {
  return new TextEncoder().encode(str);
}

function stripUncompressedPrefix(hex) {
  if (hex.startsWith('04') && hex.length === 130) return hex.slice(2);
  return hex;
}

async function main() {
  const core = await initWasm();

  const mnemonic = 'tourist term mean any helmet hobby sun wage future hammer raw inform';
  const expectedSecp = '5b8b4ebfee6f7cb81a19187c66c88af33a837a5007331efe4be34c3a8f8a051dca0aa0da5ae66d5ab6fc536c137003ddb8ab07ebb4abb4df2243643d0931c7cb';
  const expectedP256 = 'b99c4c3f9a4efe53db41aaf7adf1fdda0816fd8c19f0449ac10d67145347ce9cfbad60c89fd4b383f892ebd147505929388f316b9b9e2193043943662d18a14b';

  console.log('=== Step 1: Derive from mnemonic ===');
  const wallet = core.HDWallet.createWithMnemonic(mnemonic, '');
  const privateKey = wallet.getKeyByCurve(core.Curve.nist256p1, FLOW_BIP44_PATH);
  const privHex = bytesToHex(privateKey.data());
  console.log('Private key hex:', privHex);

  // P256
  const pubP256 = privateKey.getPublicKeyNist256p1();
  const pubP256U = pubP256.uncompressed();
  const p256Hex = stripUncompressedPrefix(bytesToHex(pubP256U.data()));
  console.log('P256 pubkey:', p256Hex);
  console.log('P256 match:', p256Hex === expectedP256 ? 'YES ✓' : 'NO ✗');
  pubP256U.delete();
  pubP256.delete();

  // secp256k1
  const pubSecp = privateKey.getPublicKeySecp256k1(false);
  const secpHex = stripUncompressedPrefix(bytesToHex(pubSecp.data()));
  console.log('secp256k1 pubkey:', secpHex);
  console.log('secp256k1 match:', secpHex === expectedSecp ? 'YES ✓' : 'NO ✗');
  pubSecp.delete();

  console.log('\n=== Step 2: Encrypt mnemonic to keystore ===');
  const password = 'testpassword123';
  const pwBytes = stringToBytes(password);

  const storedKey = core.StoredKey.importHDWallet(mnemonic, 'flow-mnemonic', pwBytes, core.CoinType.ethereum);
  const json = new TextDecoder().decode(storedKey.exportJSON());
  storedKey.delete();
  console.log('Keystore JSON length:', json.length);

  console.log('\n=== Step 3: Decrypt mnemonic from keystore ===');
  const jsonBytes = stringToBytes(json);
  const storedKey2 = core.StoredKey.importJSON(jsonBytes);
  const decryptedMnemonic = storedKey2.decryptMnemonic(pwBytes);
  console.log('Decrypted mnemonic:', decryptedMnemonic ? `"${decryptedMnemonic}"` : 'NULL/EMPTY');
  console.log('Mnemonic match:', decryptedMnemonic === mnemonic ? 'YES ✓' : 'NO ✗');

  storedKey2.delete();

  if (decryptedMnemonic === mnemonic) {
    console.log('\n=== Step 5: Re-derive from decrypted mnemonic ===');
    const wallet2 = core.HDWallet.createWithMnemonic(decryptedMnemonic, '');
    const pk2 = wallet2.getKeyByCurve(core.Curve.nist256p1, FLOW_BIP44_PATH);
    const privHex2 = bytesToHex(pk2.data());
    console.log('Re-derived private key match:', privHex2 === privHex ? 'YES ✓' : 'NO ✗');
    const pubSecp2 = pk2.getPublicKeySecp256k1(false);
    const secpHex2 = stripUncompressedPrefix(bytesToHex(pubSecp2.data()));
    console.log('Re-derived secp256k1 pubkey match:', secpHex2 === expectedSecp ? 'YES ✓' : 'NO ✗');
    pubSecp2.delete();
    pk2.delete();
    wallet2.delete();
  }

  console.log('\n=== Step 6: Dual-curve derivation (the fix) ===');
  const wallet3 = core.HDWallet.createWithMnemonic(mnemonic, '');

  // P256 key from nist256p1 curve
  const p256Key = wallet3.getKeyByCurve(core.Curve.nist256p1, FLOW_BIP44_PATH);
  const p256Pub = p256Key.getPublicKeyNist256p1();
  const p256PubU = p256Pub.uncompressed();
  const p256PubHex = stripUncompressedPrefix(bytesToHex(p256PubU.data()));
  console.log('P256 pubkey (nist256p1 curve):', p256PubHex === expectedP256 ? 'MATCH ✓' : 'NO ✗');
  p256PubU.delete();
  p256Pub.delete();
  p256Key.delete();

  // secp256k1 key from secp256k1 curve
  const secpKey = wallet3.getKeyByCurve(core.Curve.secp256k1, FLOW_BIP44_PATH);
  const secpPub2 = secpKey.getPublicKeySecp256k1(false);
  const secpPubHex2 = stripUncompressedPrefix(bytesToHex(secpPub2.data()));
  console.log('secp256k1 pubkey (secp256k1 curve):', secpPubHex2 === expectedSecp ? 'MATCH ✓' : 'NO ✗');
  secpPub2.delete();
  secpKey.delete();

  wallet3.delete();

  privateKey.delete();
  wallet.delete();

  console.log('\nDone.');
}

main().catch(console.error);
