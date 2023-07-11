import * as jose from "jose";
import * as fs from "node:fs/promises";
import pinoLogger from "pino";

import { privateKeyFile, publicKeyFile } from "../util/jwk-file";

const ALG = "ES384"; // Elliptic curve with 384-bit SHA

const logger = pinoLogger({ name: "jwks" });

const loadKey = async () => {
  try {
    const data = await fs.readFile(privateKeyFile(), {
      encoding: "utf-8",
    });
    const key = jose.importJWK(JSON.parse(data));
    return key;
  } catch (error: any) {
    logger.warn(error);
    return undefined;
  }
};

const generateKey = async () => {
  const { publicKey, privateKey } = await jose.generateKeyPair(ALG);
  await fs.writeFile(
    privateKeyFile(),
    JSON.stringify(await jose.exportJWK(privateKey), undefined, 2),
    {
      encoding: "utf-8",
    }
  );
  await fs.chmod(privateKeyFile(), "600");
  await fs.writeFile(
    publicKeyFile(),
    JSON.stringify(await jose.exportJWK(publicKey), undefined, 2),
    {
      encoding: "utf-8",
    }
  );
  return privateKey;
};

const ensureKey = async () => {
  const existing = await loadKey();
  if (existing) return existing;
  return await generateKey();
};

export const jwt = async (clientId: string) => {
  const key = await ensureKey();
  const jwt = await new jose.SignJWT({ "tunnel-id": "my-tunnel-id" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt(Math.floor(Date.now() * 1e-3))
    .setExpirationTime(Math.floor(Date.now() * 1e-3 + 7 * 86400)) // One week
    .setAudience("p0.dev") // TODO: Make environment-specific
    .setSubject(clientId)
    .setIssuer("kd-client")
    .sign(key);

  return jwt;
};
