export class RetryBackoff {
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
