import { invalidMessageError } from "../client/technocore-errors.js";

/**
 * Express always populates a named param that matched the route pattern;
 * this narrows away the `undefined` that `noUncheckedIndexedAccess` adds to
 * `ParamsDictionary`'s index signature, with a real runtime check rather
 * than a bare non-null assertion.
 */
export function requireParam(params: Record<string, string | undefined>, name: string): string {
  const value = params[name];
  if (value === undefined) {
    throw invalidMessageError(`Missing required route parameter: ${name}`);
  }
  return value;
}
