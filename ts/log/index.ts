import pinoLogger, { Bindings, Logger } from "pino";
import {
  err as serializeError,
  req as serializeRequest,
  res as serializeResponse,
} from "pino-std-serializers";

/**
 * Logger with error serializer and levels displayed as text
 */
const rootLogger = pinoLogger({
  level: process.env.LOG_LEVEL || "info",
  serializers: {
    error: serializeError,
    req: serializeRequest,
    res: serializeResponse,
  },
  // Redact the authrozition header that may contains secret token
  redact: ["[*].authorization", "[*].Authorization"],
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

export const createLogger = (bindings: Bindings): Logger => {
  return rootLogger.child(bindings);
};
