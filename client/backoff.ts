import { createLogger } from "../log/index";
import { deferral } from "../util/deferral";

const logger = createLogger({ name: "backoff" });

export class Backoff {
  #startMillis;
  #maxMillis;
  #count = 0;

  constructor(startMillis: number, maxMillis: number) {
    if (startMillis <= 0) {
      throw new Error("startMillis must be greater than 0");
    }
    if (maxMillis < startMillis) {
      throw new Error("maxMillis must be greater than or equal to startMillis");
    }
    this.#startMillis = startMillis;
    this.#maxMillis = maxMillis;
  }

  next() {
    this.#count++;
    return Math.min(
      this.#startMillis * Math.pow(2, this.#count - 1),
      this.#maxMillis
    );
  }

  reset() {
    this.#count = 0;
  }
}

export type RetryOptions = {
  startMillis: number;
  maxMillis: number;
  maxRetries: number;
};

export const sleep = (millis: number): Promise<void> => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, millis);
  });
};

export const retryWithBackoff = async <T>(
  options: RetryOptions,
  func: () => Promise<T>
) => {
  const result = deferral<T>();

  const run = async () => {
    const { startMillis, maxMillis, maxRetries } = options;
    const backoff = new Backoff(startMillis, maxMillis);
    let count = 0;
    while (true) {
      try {
        result.resolve(await func());
        return;
      } catch (e: any) {
        count++;
        if (count > maxRetries) {
          result.reject(e);
          return;
        }
        const timeout = backoff.next();
        logger.debug(
          { nextTimeout: timeout, count, error: e },
          "Retrying with backoff timeout"
        );
        await sleep(timeout);
      }
    }
  };

  run();

  return result.promise;
};
