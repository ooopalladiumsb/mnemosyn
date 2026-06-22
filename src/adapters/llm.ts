/**
 * LLMProvider — the Brain seam. OUT OF L0 SCOPE: declared only so the seam exists. The Brain
 * decides WHAT to remember; it NEVER touches the deterministic spine or the hashed root.
 * Implementations arrive with the autonomous-agent mode (post-L0).
 */
export interface LLMProvider {
  readonly name: string;
  /** Reserved. No L0 method surface. */
}
