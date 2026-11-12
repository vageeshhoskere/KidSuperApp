const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const ADDRESS = /\b\d{1,5}(?:\s+[a-z]+){1,3}\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|way(?!\s+(?:up|down|over|around|to)\b)|boulevard|blvd)\b/gi; // "10 cubes all the way up" is not an address
const PHONE = /\+?\(?\d[\d\s().-]*\d/g;

export function findPii(text: string): { found: boolean; masked: string } {
  const masked = text
    .replace(EMAIL, "[email]")
    .replace(ADDRESS, "[address]")
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 7 ? "[phone]" : m));
  return { found: masked !== text, masked };
}
