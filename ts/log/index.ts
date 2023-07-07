import pinoLogger, { Logger, LoggerOptions } from "pino";
import {
  err as serializeError,
  req as serializeRequest,
  res as serializeResponse,
} from "pino-std-serializers";

/**
 *  Logger with error serializer and levels displayed as text
 */
export const createLogger = <T extends LoggerOptions>(
  options: T
): Logger<T> => {
  const logger = pinoLogger({
    ...options,
    level: process.env.LOG_LEVEL || "info",
    serializers: {
      error: serializeError,
      req: serializeRequest,
      res: serializeResponse,
    },
    // Redact the authrozition header that may contains secret token
    redact: [
      "response.config.headers.authorization", // Axios intercepted response object
      "request.headers.authorization", // Axios intercepted request object + forwarded request object
    ],
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
  });
  return logger;
};
