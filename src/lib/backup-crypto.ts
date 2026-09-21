// Envelope encryption for local backup files (src/lib/backup.ts).
//
// Each backup is encrypted with a fresh random AES-256-GCM content key (K),
// and K itself is wrapped twice so the file can be opened by either
// recipient independently:
//   - the shop's own local Device Key (so unattended nightly auto-backup and
//     same-PC restore never need a password prompt)
//   - Tillix's admin-panel RSA-OAEP public key (so a lost/forgotten device
//     key doesn't strand the shop — Tillix support can recover the file
//     through a separate, server-side-only, logged process)
//
// Only the PUBLIC admin key lives here. The matching private key is a
// Supabase Edge Function secret and never reaches any client bundle.
//
// Container layout (fixed-size header, all fields required):
//   [magic "TLXB"(4)][version(1)][mainIV(12)][shopWrapIV(12)]
//   [shopWrapCiphertext(48)][adminWrap(256)][mainCiphertext(...)]

const MAGIC = new Uint8Array([0x54, 0x4c, 0x58, 0x42]); // "TLXB"
const VERSION = 1;
const MAIN_IV_LEN = 12;
const SHOP_WRAP_IV_LEN = 12;
const CONTENT_KEY_LEN = 32; // AES-256 raw key bytes
const GCM_TAG_LEN = 16;
const SHOP_WRAP_CIPHERTEXT_LEN = CONTENT_KEY_LEN + GCM_TAG_LEN; // 48
const ADMIN_WRAP_LEN = 256; // RSA-OAEP-2048 output is always exactly this size
const HEADER_LEN =
  MAGIC.length + 1 + MAIN_IV_LEN + SHOP_WRAP_IV_LEN + SHOP_WRAP_CIPHERTEXT_LEN + ADMIN_WRAP_LEN; // 333

export const BACKUP_FILE_EXTENSION = "tlxbak";

// Public half of Tillix's admin-recovery keypair. Safe to ship in the client
// bundle — it can only wrap a key, never unwrap one. The private half lives
// only as a Supabase Edge Function secret.
const ADMIN_PUBLIC_KEY_JWK: JsonWebKey = {
  alg: "RSA-OAEP-256",
  kty: "RSA",
  n: "24ZA3l597WNsxZvGWiVUINfZiKE2IzweqHF40SClxKGFoYp7yww8Y6D1uIttK1CnbJtV7hwGAN5ybIiPRTSGYBtHvgeUUYelpY4DDNwc9au_ZhC3qcBsibX4XUqaOVhChPui5yKDUhN98QQzZvYD29loKOz4RRNih3Cn0n9a11RstHQ_A0OofOheKqz6w_DMagmcNQ-He51VRAxPkNsJINHOTNgwU8iHbo5T9RXjjsJn_oUoA7R1eefIekouo-WukqrCQ4TmI6N6vql05AZxgElrZwEEB7TXzwXRfESHf8EKAdcn8Q9O16m7Fcy-Hx75BueX8dCneW-txKwUHl3niw",
  e: "AQAB",
};

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuf(b64: string): ArrayBuffer {
  let binary: string;
  try {
    binary = atob(b64.trim());
  } catch {
    throw new Error("Invalid recovery key");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function concatBuffers(parts: ArrayBuffer[]): ArrayBuffer {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), offset);
    offset += p.byteLength;
  }
  return out.buffer;
}

// ---- Device Key (shop-side, local, unattended) ----

export async function generateDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function exportDeviceKeyToBase64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bufToBase64(raw);
}

export async function importDeviceKeyFromBase64(b64: string): Promise<CryptoKey> {
  const raw = base64ToBuf(b64);
  if (raw.byteLength !== CONTENT_KEY_LEN) {
    throw new Error("Invalid recovery key");
  }
  try {
    return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, [
      "encrypt",
      "decrypt",
    ]);
  } catch {
    throw new Error("Invalid recovery key");
  }
}

async function importAdminPublicKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    ADMIN_PUBLIC_KEY_JWK,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
}

// Low-level RSA-OAEP wrap/unwrap primitives, exported so tests can exercise
// the exact wrap format this module uses against a throwaway keypair —
// without ever needing Tillix's real private key (which never leaves the
// server) inside test code.
export async function wrapContentKeyRSA(
  rawK: BufferSource,
  publicKey: CryptoKey,
): Promise<ArrayBuffer> {
  return crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawK);
}

export async function unwrapContentKeyRSA(
  wrapped: BufferSource,
  privateKey: CryptoKey,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, wrapped);
}

// ---- Encrypt ----

export async function encryptBackup(
  workbookBytes: ArrayBuffer,
  deviceKey: CryptoKey,
): Promise<Blob> {
  const rawK = crypto.getRandomValues(new Uint8Array(CONTENT_KEY_LEN));
  return encryptBackupWithContentKey(workbookBytes, deviceKey, rawK);
}

// Lower-level variant taking the content key directly, exported so tests can
// drive the pipeline deterministically (e.g. to prove decryptBackupWithContentKey()
// recovers a file once a given K is known, mirroring what the admin path does
// once the server hands K back).
export async function encryptBackupWithContentKey(
  workbookBytes: ArrayBuffer,
  deviceKey: CryptoKey,
  rawK: Uint8Array<ArrayBuffer>,
): Promise<Blob> {
  const contentKey = await crypto.subtle.importKey("raw", rawK, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);

  const mainIV = crypto.getRandomValues(new Uint8Array(MAIN_IV_LEN));
  const mainCiphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: mainIV },
    contentKey,
    workbookBytes,
  );

  const shopWrapIV = crypto.getRandomValues(new Uint8Array(SHOP_WRAP_IV_LEN));
  const shopWrapCiphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: shopWrapIV },
    deviceKey,
    rawK,
  );

  const adminPublicKey = await importAdminPublicKey();
  const adminWrap = await wrapContentKeyRSA(rawK, adminPublicKey);

  const header = concatBuffers([
    MAGIC.buffer,
    new Uint8Array([VERSION]).buffer,
    mainIV.buffer,
    shopWrapIV.buffer,
    shopWrapCiphertext,
    adminWrap,
  ]);

  return new Blob([header, mainCiphertext], { type: "application/octet-stream" });
}

// ---- Parse header ----

type ParsedContainer = {
  mainIV: Uint8Array<ArrayBuffer>;
  shopWrapIV: Uint8Array<ArrayBuffer>;
  shopWrapCiphertext: ArrayBuffer;
  adminWrap: ArrayBuffer;
  mainCiphertext: ArrayBuffer;
};

function parseContainer(container: ArrayBuffer): ParsedContainer {
  if (container.byteLength < HEADER_LEN) {
    throw new Error("Not a Tillix backup file");
  }
  const bytes = new Uint8Array(container);
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error("Not a Tillix backup file");
  }
  if (bytes[MAGIC.length] !== VERSION) {
    throw new Error("Not a Tillix backup file");
  }

  let offset = MAGIC.length + 1;
  const mainIV = bytes.slice(offset, offset + MAIN_IV_LEN);
  offset += MAIN_IV_LEN;
  const shopWrapIV = bytes.slice(offset, offset + SHOP_WRAP_IV_LEN);
  offset += SHOP_WRAP_IV_LEN;
  const shopWrapCiphertext = container.slice(offset, offset + SHOP_WRAP_CIPHERTEXT_LEN);
  offset += SHOP_WRAP_CIPHERTEXT_LEN;
  const adminWrap = container.slice(offset, offset + ADMIN_WRAP_LEN);
  offset += ADMIN_WRAP_LEN;
  const mainCiphertext = container.slice(offset);

  return { mainIV, shopWrapIV, shopWrapCiphertext, adminWrap, mainCiphertext };
}

async function decryptMain(
  mainIV: Uint8Array<ArrayBuffer>,
  mainCiphertext: ArrayBuffer,
  rawK: ArrayBuffer,
): Promise<ArrayBuffer> {
  const contentKey = await crypto.subtle.importKey("raw", rawK, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  try {
    return await crypto.subtle.decrypt({ name: "AES-GCM", iv: mainIV }, contentKey, mainCiphertext);
  } catch {
    throw new Error("Wrong key or corrupted file");
  }
}

// ---- Shop-side restore ----

export async function decryptBackupWithDeviceKey(
  container: ArrayBuffer,
  deviceKey: CryptoKey,
): Promise<ArrayBuffer> {
  const { mainIV, shopWrapIV, shopWrapCiphertext, mainCiphertext } = parseContainer(container);
  let rawK: ArrayBuffer;
  try {
    rawK = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: shopWrapIV },
      deviceKey,
      shopWrapCiphertext,
    );
  } catch {
    throw new Error("Wrong key or corrupted file");
  }
  return decryptMain(mainIV, mainCiphertext, rawK);
}

// ---- Admin-side restore ----

// Pulls out only the small admin-wrapped key blob — never the shop's actual
// data — for sending to the server-side unwrap endpoint.
export function extractAdminWrappedKey(container: ArrayBuffer): string {
  const { adminWrap } = parseContainer(container);
  return bufToBase64(adminWrap);
}

// Used once the server has unwrapped and returned the raw content key.
export async function decryptBackupWithContentKey(
  container: ArrayBuffer,
  rawKBase64: string,
): Promise<ArrayBuffer> {
  const { mainIV, mainCiphertext } = parseContainer(container);
  const rawK = base64ToBuf(rawKBase64);
  if (rawK.byteLength !== CONTENT_KEY_LEN) {
    throw new Error("Wrong key or corrupted file");
  }
  return decryptMain(mainIV, mainCiphertext, rawK);
}
