import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, signState, verifyState } from "../src/lib/token-crypto.js";

describe("token-crypto", () => {
  it("round-trips encrypted secrets", () => {
    const secret = "test-encryption-key-32b";
    const encrypted = encryptSecret("refresh-token-value", secret);
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(decryptSecret(encrypted, secret)).toBe("refresh-token-value");
  });

  it("signs and verifies oauth state", () => {
    const secret = "test-encryption-key-32b";
    const token = signState(JSON.stringify({ providerId: "abc" }), secret);
    const raw = verifyState(token, secret);
    expect(JSON.parse(raw)).toEqual({ providerId: "abc" });
  });

  it("rejects tampered state", () => {
    const secret = "test-encryption-key-32b";
    const token = signState("payload", secret);
    expect(() => verifyState(`${token}x`, secret)).toThrow();
  });
});
