import { Logger, LoggerOptions, pino as pinoLogger } from "pino";
import {
  err as serializeError,
  req as serializeRequest,
  res as serializeResponse,
} from "pino-std-serializers";

const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

/** Sanitization masks the token in common authorization header schemes "bearer" and "basic".
 *
 * Sanitization is implemented by overriding the default write method of stdout and stderr
 * instead of customizing pino because some third-party libraries use console.log directly.
 */
const sanitizeOutput = (data: string) => {
  // Match if:
  // - the word "bearer" or "basic" is followed by whitespace,
  // - followed by any number of non-whitespace characters, and also not a quote (to preserve parsable json)
  return data.replace(/(bearer|basic)(\s+)[^\s"']+/gi, "$1$2<REDACTED>");
};

process.stdout.write = (data) =>
  originalStdoutWrite.call(process.stdout, sanitizeOutput(data.toString()));

process.stderr.write = (data) =>
  originalStderrWrite.call(process.stdout, sanitizeOutput(data.toString()));

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
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
  });
  return logger;
};
