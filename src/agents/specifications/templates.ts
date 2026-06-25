/**
 * Replace `{{PLACEHOLDER}}` tokens in a template with provided values.
 *
 * Unknown tokens (present in the template but absent from `values`)
 * are left as-is rather than silently removed.
 */
export function fillTemplate(template: string, values?: Record<string, string>): string {
  let result = template;
  if (values) {
    for (const [key, value] of Object.entries(values)) {
      result = result.replaceAll(`{{${key}}}`, value);
    }
  }
  return result;
}
