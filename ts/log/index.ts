import pinoLogger, { Logger, LoggerOptions } from "pino";
import {
  err as serializeError,
  req as serializeRequest,
  res as serializeResponse,
} from "pino-std-serializers";

/**
 * Logger with error serializer and levels displayed as text
 */
export const createLogger = <T extends LoggerOptions>(
  options: T
): Logger<T> => {
  const serializers = options.serializers;
  const logger = pinoLogger({
    ...options,
    serializers: {
      error: serializeError,
      req: serializeRequest,
      res: serializeResponse,
      ...serializers,
    },
    // Redact the authrozition header that may contains secret token
    redact: ["[*].authorization", "[*].Authorization"],
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
  });
  return logger;
};
