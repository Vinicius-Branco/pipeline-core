const esbuild = require("esbuild");

esbuild
  .build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    outfile: "dist/index.js",
    platform: "node",
    target: "node16",
    format: "cjs",
    external: ["tslib", "esbuild"],
    sourcemap: true,
    minify: false,
    treeShaking: true,
    metafile: true,
  })
  .catch(() => process.exit(1));
