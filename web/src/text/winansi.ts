// WinAnsiEncoding, the character set `pdf-stamp` writes text in. Mirrors
// `winansi` in crates/pdf-stamp/src/text.rs: printable ASCII and Latin-1 map to
// themselves, 0x80–0x9F hold the Windows-1252 extras, and controls have no byte.

const EXTRAS: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/** The WinAnsiEncoding byte for one character, if it has one. */
export function winAnsiByte(char: string): number | undefined {
  const code = char.codePointAt(0)!;
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return code;
  return EXTRAS[char];
}

/** The distinct characters in `text` that can't be written, in order of appearance. Newlines are fine. */
export function unsupportedChars(text: string): string[] {
  const bad = new Set<string>();
  for (const char of text) if (char !== "\n" && winAnsiByte(char) === undefined) bad.add(char);
  return [...bad];
}
