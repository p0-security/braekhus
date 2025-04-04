import pinoLogger, { Logger, LoggerOptions } from "pino";
import {
  err as serializeError,
  req as serializeRequest,
  res as serializeResponse,
} from "pino-std-serializers";

/**
 *  Logger with error serializer and levels displayed as text
 */
export const createLogger = <T extends LoggerOptions>(options: T): Logger => {
  const logger = pinoLogger({
    ...options,
    name: `braekhus.${options.name}`,
    level: process.env.LOG_LEVEL || "info",
    serializers: {
      error: serializeError,
      req: serializeRequest,
      res: serializeResponse,
    },
    hooks: {
      // Redact the authorization header that may contain a secret bearer token with <REDACTED> label
      streamWrite: (output) => {
        // Match if:
        // - the word authorization with or without trailing quotes, but require colon
        // - followed by scheme (e.g. Bearer, Basic, etc.) with or without trailing quotes, and surrounded by whitespace
        // - followed by any number of non-whitespace characters, and also not a quote (to preserve parsable json)
        // Some schemes tolerate whitespaces in the token. Further improvement is to spell out scheme-specific patterns.
        return output.replace(
          /(authorization["']?:\s*["']?\w+\s+)[^\s"']+/gi,
          "$1<REDACTED>"
        );
      },
    },
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
  });
  return logger;
};
