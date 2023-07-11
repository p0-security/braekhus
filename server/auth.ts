import * as jose from "jose";
import pinoLogger from "pino";
import { PublicKeyGetter } from "braekhus/types";

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

export const validateAuth = async (
  xClientId: string | string[] | undefined,
  authorization: string | undefined,
  publicKeyGetter: PublicKeyGetter
) => {
  const clientId = Array.isArray(xClientId) ? xClientId[0] : xClientId;
  if (!clientId) {
    throw new AuthorizationError();
  }
  if (!authorization) throw new AuthorizationError();
  const match = authorization.match(AUTH_PATTERN);
  if (!match || !match[1]) throw new AuthorizationError();
  logger.info({ clientId }, "Validating client ID");
  const jwt = match[1];
  const key = await publicKeyGetter(clientId);
  if (!key) throw new AuthorizationError();
  const jwk = await jose.importJWK(key as any, ALG);
  try {
    await jose.jwtVerify(jwt, jwk, { subject: clientId, audience: "p0.dev" });
  } catch (error: any) {
    logger.warn("Error during verification", error.message);
    throw new AuthorizationError();
  }
};
