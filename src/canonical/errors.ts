/**
 * Error classes for the canonical layer — vendored from paradigm_terra (D1) so error codes match.
 *
 * NoncanonicalEventError is the hard-validation error from CE v1.3 §9; any condition that violates
 * determinism (non-canonical JSON, invalid UTF-8, dup keys, surrogates, fractional numbers) raises
 * it. CanonicalEncodingError covers structural/encoding faults (range, hex, domain tag).
 */

export class NoncanonicalEventError extends Error {
  override readonly name = "NoncanonicalEventError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.code = code;
  }
}

export class CanonicalEncodingError extends Error {
  override readonly name = "CanonicalEncodingError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.code = code;
  }
}
