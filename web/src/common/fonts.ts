// Signature-style fonts (SIL Open Font Licence), bundled locally by Vite; never loaded from a font CDN.
import "@fontsource/allura/400.css";
import "@fontsource/caveat/400.css";
import "@fontsource/dancing-script/400.css";
import "@fontsource/great-vibes/400.css";

// On-screen stand-ins for the standard PDF fonts (SIL Open Font Licence):
// metrically compatible with Helvetica, Times and Courier. Text is written in
// WinAnsiEncoding, which the Latin subset covers.
import "@fontsource/arimo/latin-400.css";
import "@fontsource/arimo/latin-400-italic.css";
import "@fontsource/arimo/latin-700.css";
import "@fontsource/arimo/latin-700-italic.css";
import "@fontsource/tinos/latin-400.css";
import "@fontsource/tinos/latin-400-italic.css";
import "@fontsource/tinos/latin-700.css";
import "@fontsource/tinos/latin-700-italic.css";
import "@fontsource/cousine/latin-400.css";
import "@fontsource/cousine/latin-400-italic.css";
import "@fontsource/cousine/latin-700.css";
import "@fontsource/cousine/latin-700-italic.css";

export const SCRIPT_FONTS = ["Great Vibes", "Dancing Script", "Allura", "Caveat"] as const;
export type ScriptFont = (typeof SCRIPT_FONTS)[number];

export const INK_COLORS = [
  { name: "Black", value: "#111111" },
  { name: "Blue", value: "#1a2a80" },
] as const;
