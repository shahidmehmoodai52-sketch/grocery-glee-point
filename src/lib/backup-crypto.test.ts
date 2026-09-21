import { describe, expect, it } from "vitest";
import {
  decryptBackupWithContentKey,
  decryptBackupWithDeviceKey,
  encryptBackup,
  encryptBackupWithContentKey,
  exportDeviceKeyToBase64,
  extractAdminWrappedKey,
  generateDeviceKey,
  importDeviceKeyFromBase64,
  unwrapContentKeyRSA,
  wrapContentKeyRSA,
} from "./backup-crypto";

function textToBuf(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}
function bufToText(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

describe("backup-crypto", () => {
  it("round-trips via the shop's device key", async () => {
    const deviceKey = await generateDeviceKey();
    const plaintext = textToBuf("workbook bytes go here");
    const container = await encryptBackup(plaintext, deviceKey);
    const containerBuf = await container.arrayBuffer();
    const recovered = await decryptBackupWithDeviceKey(containerBuf, deviceKey);
    expect(bufToText(recovered)).toBe("workbook bytes go here");
  });

  it("round-trips a device key exported/imported as a recovery key (different PC)", async () => {
    const deviceKey = await generateDeviceKey();
    const recoveryKeyBase64 = await exportDeviceKeyToBase64(deviceKey);
    const plaintext = textToBuf("recovered elsewhere");
    const container = await encryptBackup(plaintext, deviceKey);
    const containerBuf = await container.arrayBuffer();

    const reimportedKey = await importDeviceKeyFromBase64(recoveryKeyBase64);
    const recovered = await decryptBackupWithDeviceKey(containerBuf, reimportedKey);
    expect(bufToText(recovered)).toBe("recovered elsewhere");
  });

  it("rejects the wrong device key with a clear error", async () => {
    const deviceKey = await generateDeviceKey();
    const wrongKey = await generateDeviceKey();
    const container = await encryptBackup(textToBuf("secret"), deviceKey);
    const containerBuf = await container.arrayBuffer();
    await expect(decryptBackupWithDeviceKey(containerBuf, wrongKey)).rejects.toThrow(
      "Wrong key or corrupted file",
    );
  });

  it("rejects a tampered container", async () => {
    const deviceKey = await generateDeviceKey();
    const container = await encryptBackup(textToBuf("secret"), deviceKey);
    const bytes = new Uint8Array(await container.arrayBuffer());
    bytes[bytes.length - 1] ^= 0xff; // flip a byte inside the GCM-authenticated ciphertext
    await expect(decryptBackupWithDeviceKey(bytes.buffer, deviceKey)).rejects.toThrow(
      "Wrong key or corrupted file",
    );
  });

  it("rejects a file that isn't a Tillix backup container", async () => {
    const deviceKey = await generateDeviceKey();
    const garbage = textToBuf("not a backup file at all, just some text");
    await expect(decryptBackupWithDeviceKey(garbage, deviceKey)).rejects.toThrow(
      "Not a Tillix backup file",
    );
  });

  it("rejects a malformed recovery key string", async () => {
    await expect(importDeviceKeyFromBase64("not-valid-base64!!!")).rejects.toThrow();
    await expect(importDeviceKeyFromBase64("dG9vc2hvcnQ=")).rejects.toThrow("Invalid recovery key");
  });

  it("extracts an admin-wrapped key of the expected fixed RSA-OAEP-2048 size", async () => {
    const deviceKey = await generateDeviceKey();
    const container = await encryptBackup(textToBuf("secret"), deviceKey);
    const containerBuf = await container.arrayBuffer();
    const adminWrapBase64 = extractAdminWrappedKey(containerBuf);
    const decoded = Uint8Array.from(atob(adminWrapBase64), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(256); // RSA-OAEP-2048 ciphertext is always exactly 256 bytes
  });

  it("admin recovery: server-side unwrap primitive round-trips against a throwaway keypair", async () => {
    // Simulates the Supabase Edge Function's unwrap step. Uses a throwaway
    // keypair generated here, never Tillix's real embedded/private key, so
    // no secret material appears in test code.
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["encrypt", "decrypt"],
    );
    const rawK = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapContentKeyRSA(rawK.buffer as ArrayBuffer, publicKey);
    const unwrapped = await unwrapContentKeyRSA(wrapped, privateKey);
    expect(new Uint8Array(unwrapped)).toEqual(rawK);
  });

  it("admin recovery: once the server returns the unwrapped key, the file decrypts", async () => {
    // Full pipeline test using a throwaway keypair in place of the real
    // admin keypair: wrap K for the throwaway "admin", have the throwaway
    // "server" unwrap it, then feed the recovered K into
    // decryptBackupWithContentKey() — exactly the sequence the real admin
    // panel + edge function will run, minus the network hop.
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["encrypt", "decrypt"],
    );
    const deviceKey = await generateDeviceKey();
    const rawK = crypto.getRandomValues(new Uint8Array(32));
    const container = await encryptBackupWithContentKey(
      textToBuf("shop data for admin recovery"),
      deviceKey,
      rawK,
    );
    const containerBuf = await container.arrayBuffer();

    // Stand-in for what the real embedded admin public key would have done
    // inside encryptBackup() — wrap the same K for the throwaway "admin".
    const wrapped = await wrapContentKeyRSA(rawK.buffer as ArrayBuffer, publicKey);
    // Stand-in for the Supabase Edge Function unwrapping with the private key.
    const serverReturnedK = await unwrapContentKeyRSA(wrapped, privateKey);
    const serverReturnedKBase64 = btoa(String.fromCharCode(...new Uint8Array(serverReturnedK)));

    const recovered = await decryptBackupWithContentKey(containerBuf, serverReturnedKBase64);
    expect(bufToText(recovered)).toBe("shop data for admin recovery");
  });

  it("admin recovery rejects a wrong/unrelated content key", async () => {
    const deviceKey = await generateDeviceKey();
    const container = await encryptBackup(textToBuf("secret"), deviceKey);
    const containerBuf = await container.arrayBuffer();
    const unrelatedKBase64 = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
    );
    await expect(decryptBackupWithContentKey(containerBuf, unrelatedKBase64)).rejects.toThrow(
      "Wrong key or corrupted file",
    );
  });
});
