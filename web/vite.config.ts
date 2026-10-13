import { cpSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { defineConfig, searchForWorkspaceRoot, type Connect, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import solid from "vite-plugin-solid";

const PDFJS_DIR = resolve(import.meta.dirname, "node_modules/pdfjs-dist");
const PDFJS_ASSETS = ["cmaps", "standard_fonts", "wasm", "iccs"];
/** Dev-only Samples menu: test PDFs, by the name shown in the menu. */
const SAMPLE_ROOTS: Record<string, string> = {
  out: resolve(import.meta.dirname, "../out"),
  corpus: resolve(import.meta.dirname, "../crates/pdf-stamp/tests/corpus"),
  // Written by the corpus test (`cargo test`): every corpus file with a black box stamped on each page.
  "corpus-stamped": resolve(import.meta.dirname, "../target/tmp/corpus"),
};
/** Built by `just wasm`. */
const WASM_PKG = resolve(import.meta.dirname, "../crates/pdf-stamp-wasm/pkg");

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".json": "application/json",
};

/** Serves `/<prefix>/<path>` from `root`, refusing anything that escapes it. */
function serveDir(prefix: string, root: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = decodeURIComponent((req.url ?? "").split("?")[0]);
    if (!url.startsWith(prefix)) return next();
    const file = normalize(join(root, url.slice(prefix.length)));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
    res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  };
}

/**
 * pdf.js loads CMaps, standard fonts, wasm decoders and ICC profiles at runtime.
 * Serve them from node_modules in dev and copy them into the build, so nothing
 * comes from a CDN.
 */
function pdfjsAssets(): Plugin {
  let outDir = "dist";
  return {
    name: "pdfjs-assets",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      for (const dir of PDFJS_ASSETS) {
        server.middlewares.use(serveDir(`/pdfjs/${dir}/`, join(PDFJS_DIR, dir)));
      }
    },
    closeBundle() {
      for (const dir of PDFJS_ASSETS) {
        cpSync(join(PDFJS_DIR, dir), join(outDir, "pdfjs", dir), { recursive: true });
      }
    },
  };
}

/** All PDFs under `dir`, as paths relative to it. */
function listPdfs(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listPdfs(join(dir, e.name), `${prefix}${e.name}/`)
      : e.name.endsWith(".pdf")
        ? [`${prefix}${e.name}`]
        : [],
  );
}

/**
 * Dev only: serves test PDFs as /samples/<root>/<path>, listed at
 * /samples/index.json, for the Samples menu. Roots are in SAMPLE_ROOTS.
 */
function devSamples(): Plugin {
  return {
    name: "dev-samples",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/samples/index.json", (_req, res) => {
        const all = Object.entries(SAMPLE_ROOTS).flatMap(([name, dir]) => listPdfs(dir).sort().map((f) => `${name}/${f}`));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(all));
      });
      for (const [name, dir] of Object.entries(SAMPLE_ROOTS)) server.middlewares.use(serveDir(`/samples/${name}/`, dir));
    },
  };
}

/** Text of a package's licence files (LICENSE, LICENCE, COPYING, OFL…), if any. */
function licenceTexts(dir: string): string {
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|ofl)/i.test(f) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8").trim())
    .join("\n\n");
}

/**
 * Writes dist/licenses.txt: the licence of every third-party package shipped
 * in the build. That is the web app's runtime dependencies (including the
 * OFL text the bundled fonts require), and the Rust crates compiled into the
 * WASM module (collected by crates/pdf-stamp-wasm/licenses.sh during `just wasm`).
 */
function licenses(): Plugin {
  return {
    name: "third-party-licenses",
    apply: "build",
    // Emitted as a bundle asset, so it lands in dist/ with everything else.
    generateBundle() {
      // Many packages share the same licence text, so each distinct text is printed once.
      const entries: { label: string; text: string }[] = [];
      const add = (name: string, version: string, licence: string, text: string) =>
        entries.push({ label: `${name} ${version} (${licence})`, text: text || "(no licence file in the package)" });

      const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"));
      for (const name of Object.keys(pkg.dependencies).sort()) {
        const dir = resolve(import.meta.dirname, "node_modules", name);
        const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        add(name, meta.version, meta.license ?? "unknown", licenceTexts(dir));
      }

      // Crates in the WASM build, listed by crates/pdf-stamp-wasm/licenses.sh when the WASM was built.
      const crateFile = join(WASM_PKG, "crate-licenses.txt");
      if (!existsSync(crateFile)) this.error(`${crateFile} is missing: build the WASM with \`just wasm\` first`);
      for (const block of readFileSync(crateFile, "utf8").split(/^@@@ /m).slice(1)) {
        const newline = block.indexOf("\n");
        const [, name, version, licence] = block.slice(0, newline).match(/^(\S+) (\S+) \((.*)\)$/) ?? [];
        add(`${name} (Rust crate)`, version, licence, block.slice(newline + 1).trim());
      }

      const byText = new Map<string, string[]>();
      for (const { label, text } of entries) byText.set(text, [...(byText.get(text) ?? []), label]);
      const rule = "=".repeat(72);
      const out = [
        "pdf-flex includes the following third-party software:\n",
        ...entries.map((e) => `  ${e.label}`),
        "\nTheir licence texts follow, each once with the packages it covers.\n",
        ...[...byText].map(([text, labels]) => `${rule}\n${labels.join("\n")}\n${rule}\n\n${text}\n`),
      ];
      this.emitFile({ type: "asset", fileName: "licenses.txt", source: out.join("\n") });
    },
  };
}

export default defineConfig({
  plugins: [
    solid(),
    pdfjsAssets(),
    devSamples(),
    licenses(),
    VitePWA({
      // A new version waits until the user chooses to reload (see UpdatePrompt).
      registerType: "prompt",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "pdf-flex",
        short_name: "pdf-flex",
        description: "Sign PDFs in your browser. Nothing leaves your device.",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#e6e7ea",
        theme_color: "#2563eb",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        // The app shell, WASM, fonts and icons work offline from the first visit.
        globPatterns: ["**/*.{html,js,css,wasm,woff2,png,svg}"],
        // pdf.js runtime data (CMaps, standard fonts, decoders) is several MB:
        // cache each file the first time it's used instead.
        globIgnores: ["pdfjs/**"],
        // The pdf.js worker and the stamping WASM are over the 2 MB default.
        maximumFileSizeToCacheInBytes: 8 << 20,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes("/pdfjs/"),
            handler: "CacheFirst",
            options: { cacheName: "pdfjs-data", expiration: { maxEntries: 500 } },
          },
        ],
        // The licence page (opened in a new tab, rarely) is fetched from the server, not precached.
        navigateFallbackDenylist: [/\/licenses\.txt$/],
      },
    }),
  ],
  resolve: {
    alias: { "pdf-stamp-wasm": WASM_PKG },
  },
  // The stamping worker imports the wasm-bindgen ES module glue.
  worker: { format: "es" },
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), WASM_PKG] },
    port: 5173,
    strictPort: true,
    // Reachable through the devcontainer's port forward.
    host: true,
  },
});
