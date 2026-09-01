export function sanitizeText(input: string): string {
  return input.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}
