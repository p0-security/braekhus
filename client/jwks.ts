import { privateKeyFile, publicKeyFile } from "../util/jwk-file";
import * as jose from "jose";
import * as fs from "node:fs/promises";
import pinoLogger from "pino";

const ALG = "ES384"; // Elliptic curve with 384-bit SHA

const logger = pinoLogger({ name: "jwks" });

const loadKey = async (path: string) => {
  try {
    const data = await fs.readFile(privateKeyFile(path), {
      encoding: "utf-8",
    });
    const key = jose.importJWK(JSON.parse(data));
    return key;
  } catch (error: any) {
    logger.warn(error);
    return undefined;
  }
};

const generateKey = async (path: string) => {
  const { publicKey, privateKey } = await jose.generateKeyPair(ALG);
  await fs.writeFile(
    privateKeyFile(path),
    JSON.stringify(await jose.exportJWK(privateKey), undefined, 2),
    {
      encoding: "utf-8",
    }
  );
  await fs.chmod(privateKeyFile(path), "400");
  await fs.writeFile(
    publicKeyFile(path),
    JSON.stringify(await jose.exportJWK(publicKey), undefined, 2),
    {
      encoding: "utf-8",
    }
  );
  return privateKey;
};

const ensureKey = async (path: string) => {
  const existing = await loadKey(path);
  if (existing) return existing;
  return await generateKey(path);
};

export const jwt = async (path: string, clientId: string) => {
  const key = await ensureKey(path);
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
