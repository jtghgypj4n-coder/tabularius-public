/** A stored occurrence colour accepted by the graph. Invalid values use the uncoloured header. */
export function occurrenceFill(color: string | undefined): string | undefined {
  const trimmed = color?.trim();
  if (!trimmed) return undefined;
  return /^(?:#[\da-f]{3}(?:[\da-f](?:[\da-f]{2}(?:[\da-f]{2})?)?)?|rgba?\([\d.,/ %]+\)|[a-z]{3,20})$/i.test(trimmed)
    ? trimmed : undefined;
}
