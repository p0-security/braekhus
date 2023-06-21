// cf. https://www.scala-lang.org/api/2.13.3/scala/concurrent/Awaitable.html
// cf. https://www.scala-lang.org/api/2.13.3/scala/concurrent/Promise.html
export type Deferral<T> = {
  /** Returns true if either this deferral is resolved or rejected */
  isCompleted: () => boolean;
  /** Returns true if and only if this deferral is resolved */
  isResolved: () => boolean;
  /** Returns true if and only if this deferral is rejected */
  isRejected: () => boolean;
  /** Either resolves or rejects this deferral using the result of a promise
   *
   * This can be useful for lifting a promise's scope:
   * ```
   * const value = deferral<T>();
   * someSynchronousCall(() => {
   *   const somePromise = ...;
   *   value.completeWith(somePromise)
   * });
   * await value.promise;
   * ```
   *
   * It can also be useful for synchronously checking if a promise is completed:
   * ```
   * const value = deferral(someAsynchronousCall());
   * ...
   * // other asynchronous things
   * ...
   * if (value.isCompleted()) {
   *   ...
   * }
   * ```
   */
  completeWith: (promise: Promise<T>) => void;
  /** Returns a promise that resolves (or rejects) when this deferral does */
  promise: Promise<T>;
  /** Resolve this deferral */
  resolve: (result: T) => void;
  /** Reject this deferral */
  reject: (error?: any) => void;
  /** Synchronously get this deferral's state:
   *
   * - If resolved, returns the resolution value
   * - If rejected, throws the rejection error
   * - If neither, returns `undefined`
   */
  value: () => T | undefined;
};

/** Creates a new Deferral, which completes with the specified promise */
export function deferral<T>(promise: Promise<T>): Deferral<T>;
/** Creates a new Deferral
 *
 * This deferral can then be completed with a promise (using `completeWith`),
 * or manually resolved or rejected.
 */
export function deferral<T = void>(): Deferral<T>;
export function deferral<T>(input?: Promise<T>): Deferral<T> {
  let _value: T | undefined = undefined;
  let _error: any | undefined = undefined;
  let _isResolved = false;
  let _isRejected = false;
  let _internalResolve: (result: T) => void;
  let _internalReject: (error?: any) => void;
  const resolve = (result: T) => {
    if (_isRejected) throw new Error("Deferral already rejected");
    _isResolved = true;
    _value = result;
    _internalResolve(result);
  };
  const reject = (error?: any) => {
    if (_isResolved) throw new Error("Deferral already resolved");
    _isRejected = true;
    _error = error;
    _internalReject(error);
  };
  const promise = new Promise<T>((_resolve, _reject) => {
    _internalResolve = _resolve;
    _internalReject = _reject;
  });
  const value = (): T | undefined => {
    if (_error) throw _error;
    return _value;
  };
  const completeWith = (promise: Promise<T>) => {
    promise.then(resolve).catch(reject);
  };
  if (input !== undefined) {
    completeWith(input);
  }
  return {
    isCompleted: () => _isResolved || _isRejected,
    isResolved: () => _isResolved,
    isRejected: () => _isRejected,
    completeWith,
    promise,
    resolve,
    reject,
    value,
  };
}
