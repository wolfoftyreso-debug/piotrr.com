/**
 * Safe JSON-LD embedding.
 *
 * `JSON.stringify` does not escape `<`, so a company name containing
 * `</script><script>…` breaks out of the tag and executes. Company names
 * are supplier-controlled, which makes that stored XSS on a public page.
 * Escaping the characters that can terminate or reopen a tag closes it
 * without changing how a JSON parser reads the value.
 */
export function jsonLdScript(data: unknown): string {
  return (
    JSON.stringify(data)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      // U+2028/U+2029 are literal line terminators in JavaScript but legal
      // inside a JSON string, so they can break the surrounding script.
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029")
  );
}
