import pinoLogger, { Logger, LoggerOptions } from "pino";
import { err as serializeError } from "pino-std-serializers";

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
      ...serializers,
    },
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
  });
  return logger;
};
