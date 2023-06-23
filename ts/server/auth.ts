import * as jose from "jose";
import * as fs from "node:fs/promises";
import pinoLogger from "pino";

const AUTH_PATTERN = /Bearer (.*)/;
const ALG = "ES384";

const logger = pinoLogger({ name: "auth" });

export class AuthorizationError extends Error {
  constructor() {
    super("Unauthorized");
  }
  get code() {
    return 401;
  }
  get reason() {
    return "Unauthorized";
  }
}

let CACHED_KEY: object | undefined = undefined;

const ensureKey = async () => {
  if (!CACHED_KEY) CACHED_KEY = await loadKey();
  return CACHED_KEY;
};

const loadKey = async () => {
  const jwk = await fs.readFile("jwk.public.json", { encoding: "utf-8" });
  return JSON.parse(jwk);
};

export const validateAuth = async (authorization: string | undefined) => {
  if (!authorization) throw new AuthorizationError();
  const match = authorization.match(AUTH_PATTERN);
  if (!match || !match[1]) throw new AuthorizationError();
  const jwt = match[1];
  const key = await ensureKey();
  if (!key) throw new AuthorizationError();
  const jwk = await jose.importJWK(key as any, ALG);
  try {
    await jose.jwtVerify(jwt, jwk);
  } catch (error: any) {
    logger.warn("Error during verification", error.message);
    throw new AuthorizationError();
  }
};
