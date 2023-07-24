import * as jose from "jose";
import * as fs from "node:fs/promises";
import pinoLogger from "pino";

const KEY_FILE = "jwk.private.json";
const PUB_FILE = "jwk.public.json";
const ALG = "ES384"; // Elliptic curve with 384-bit SHA

const logger = pinoLogger({ name: "jwks" });

const loadKey = async () => {
  try {
    const data = await fs.readFile(KEY_FILE, { encoding: "utf-8" });
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
    KEY_FILE,
    JSON.stringify(await jose.exportJWK(privateKey), undefined, 2),
    {
      encoding: "utf-8",
    }
  );
  await fs.chmod(KEY_FILE, "600");
  await fs.writeFile(
    PUB_FILE,
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

export const jwt = async () => {
  const key = await ensureKey();
  const jwt = await new jose.SignJWT({ "tunnel-id": "my-tunnel-id" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt(Math.floor(Date.now() * 1e-3))
    .setExpirationTime(Math.floor(Date.now() * 1e-3 + 7 * 86400)) // One week
    .setAudience("p0.dev") // TODO: Make environment-specific
    .setSubject("my-client-id")
    .setIssuer("kd-client")
    .sign(key);

  return jwt;
};
