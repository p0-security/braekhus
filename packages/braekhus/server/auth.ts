import * as jose from "jose";
import { createLogger } from "log/index.js";
import { pino } from "pino";

import { PublicKeyGetter } from "../types/index.js";

const AUTH_PATTERN = /Bearer (.*)/;
const ALG = "ES384";

const logger = createLogger({ name: "auth" });
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

// Errors would be logged on every attempt from the braekhus proxy to connect, only log with debug level
export const validateAuth = async (
  authorization: string | undefined,
  publicKeyGetter: PublicKeyGetter
) => {
  if (!authorization) throw new AuthorizationError();
  const match = authorization.match(AUTH_PATTERN);
  if (!match || !match[1]) {
    logger.debug("Bearer token not found");
    throw new AuthorizationError();
  }
  const jwt = match[1];
  const clientId = jose.decodeJwt(jwt).sub;
  logger.debug({ clientId }, "Validating client ID");
  if (!clientId) {
    logger.debug({ clientId }, "Client ID not found");
    throw new AuthorizationError();
  }
  const key = await publicKeyGetter(clientId);
  if (!key) {
    logger.debug({ clientId }, "Public key not found");
    throw new AuthorizationError();
  }
  const jwk = await jose.importJWK(key as any, ALG);
  try {
    await jose.jwtVerify(jwt, jwk, { subject: clientId, audience: "p0.dev" });
  } catch (error: any) {
    logger.debug({ clientId, error }, "Error during verification");
    throw new AuthorizationError();
  }
};
