/**
 * `{{token}}` template substitution for flow strings.
 *
 * Pure string-level substitution: no I/O, no logging, no imports outside
 * this module. Callers supply a lookup function and decide what a missing
 * token means (keep it, blank it, or throw).
 */

/**
 * Resolves a single template token (already trimmed) to its substitution.
 *
 * Returning `undefined` (or `null`) signals "token unknown - keep it in place".
 * Returning `""` is a valid substitution and is honored verbatim.
 */
export type TemplateLookup = (token: string) => string | undefined;

/**
 * Replaces every `{{token}}` occurrence in `template`.
 *
 * - Every `{{token}}` occurrence is replaced by `lookup(token.trim())`.
 * - A defined return value is substituted verbatim (empty string is a valid
 *   substitution).
 * - `undefined` or `null` keeps the token in place, verbatim: `{{` + trimmed token +
 *   `}}` (no normalization beyond trimming: inner whitespace is preserved -
 *   e.g. `{{ a b }}` keeps `{{a b}}`).
 * - The regex is `/\{\{([^}]+)\}\}/g` - single pass, left-to-right, no
 *   recursion, no nested-brace handling (a token containing `}` cannot be
 *   expressed).
 * - Tokens are trimmed before lookup; multi-token templates substitute each
 *   independently.
 * - Unknown tokens are preserved so template-authoring mistakes surface in
 *   the rendered output (never silently blanked); callers that need blanking
 *   return `""` from their lookup.
 * - An empty token (`{{}}`) contains no token text: the regex requires at
 *   least one character between the braces, so `{{}}` never matches and
 *   passes through unchanged (the lookup is not called). A whitespace-only
 *   token (`{{ }}`) trims to an empty key and is looked up as `""`; if the
 *   lookup returns `undefined` the token is kept in its trimmed form
 *   (`{{}}`).
 * - Text with a lone `{{` or `}}` (no complete pair) passes through
 *   unchanged, as does a template with no tokens at all.
 */
export function resolveTemplate(template: string, lookup: TemplateLookup): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, token: string) => {
    const key = token.trim();
    const value = lookup(key);
    return value == null ? `{{${key}}}` : value;
  });
}
