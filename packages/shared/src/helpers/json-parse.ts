export function jsonParse<T = unknown>(value: string) {
  return JSON.parse(value) as T;
}
