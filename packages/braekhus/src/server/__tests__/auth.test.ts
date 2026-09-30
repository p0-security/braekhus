import * as jose from "jose";
import { describe, expect, it } from "vitest";

import { AuthorizationError, validateAuth } from "../auth.ts";

const signToken = async (
  privateKey: jose.KeyLike,
  alg: string,
  clientId: string
) =>
  new jose.SignJWT({})
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setAudience("p0.dev")
    .setSubject(clientId)
    .sign(privateKey);

describe("validateAuth", () => {
  it("accepts a valid ES384 token verified against the matching EC public key", async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair("ES384");
    const publicJwk = await jose.exportJWK(publicKey);
    const token = await signToken(privateKey, "ES384", "test-client");

    await expect(
      validateAuth(`Bearer ${token}`, async () => publicJwk)
    ).resolves.toBe("test-client");
  });

  it("rejects a token signed by a different key than the one returned by publicKeyGetter", async () => {
    const { privateKey } = await jose.generateKeyPair("ES384");
    const { publicKey: otherPublicKey } = await jose.generateKeyPair("ES384");
    const otherPublicJwk = await jose.exportJWK(otherPublicKey);
    const token = await signToken(privateKey, "ES384", "test-client");

    await expect(
      validateAuth(`Bearer ${token}`, async () => otherPublicJwk)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects when no public key is found for the client", async () => {
    const { privateKey } = await jose.generateKeyPair("ES384");
    const token = await signToken(privateKey, "ES384", "test-client");

    await expect(
      validateAuth(`Bearer ${token}`, async () => undefined)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects when the Authorization header is missing", async () => {
    await expect(
      validateAuth(undefined, async () => ({ kty: "EC" }))
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
