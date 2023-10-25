import * as jose from "jose";
import pinoLogger from "pino";

import { PublicKeyGetter } from "../types";

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
  authorization: string | undefined,
  publicKeyGetter: PublicKeyGetter
) => {
  if (!authorization) throw new AuthorizationError();
  const match = authorization.match(AUTH_PATTERN);
  if (!match || !match[1]) throw new AuthorizationError();
  const jwt = match[1];
  const clientId = jose.decodeJwt(jwt).sub;
  logger.debug({ clientId }, "Validating client ID");
  if (!clientId) {
    throw new AuthorizationError();
  }
  const key = await publicKeyGetter(clientId);
  if (!key) throw new AuthorizationError();
  const jwk = await jose.importJWK(key as any, ALG);
  try {
    await jose.jwtVerify(jwt, jwk, { subject: clientId, audience: "p0.dev" });
  } catch (error: any) {
    logger.error({ clientId, error }, "Error during verification");
    throw new AuthorizationError();
  }
};
