import { cpSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { defineConfig, searchForWorkspaceRoot, type Connect, type Plugin } from "vite";
import solid from "vite-plugin-solid";

const PDFJS_DIR = resolve(import.meta.dirname, "node_modules/pdfjs-dist");
const PDFJS_ASSETS = ["cmaps", "standard_fonts", "wasm", "iccs"];
const OUT_DIR = resolve(import.meta.dirname, "../out");
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

/** Dev only: serves the generated test PDFs from ../out as /samples/*, listed at /samples/index.json. */
function devSamples(): Plugin {
  return {
    name: "dev-samples",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/samples/index.json", (_req, res) => {
        const list = (dir: string) =>
          existsSync(join(OUT_DIR, dir))
            ? readdirSync(join(OUT_DIR, dir)).filter((f) => f.endsWith(".pdf")).map((f) => join(dir, f))
            : [];
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([...list("."), ...list("fixtures")].sort()));
      });
      server.middlewares.use(serveDir("/samples/", OUT_DIR));
    },
  };
}

export default defineConfig({
  plugins: [solid(), pdfjsAssets(), devSamples()],
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
