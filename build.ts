import { fileURLToPath } from "node:url";

const pkg = await Bun.file(new URL("./package.json", import.meta.url)).json();

// MV3 扩展 (content.js + service-worker.js + manifest.json)
const ext = await Bun.build({
    entrypoints: [
        fileURLToPath(new URL("./src/entries/content.ts", import.meta.url)),
        fileURLToPath(
            new URL("./src/background/service-worker.ts", import.meta.url),
        ),
    ],
    outdir: fileURLToPath(new URL("./dist", import.meta.url)),
    target: "browser",
    format: "iife",
    minify: true,
    naming: { entry: "[name].[ext]" },
});
if (!ext.success) {
    console.error("扩展构建失败:");
    for (const log of ext.logs) console.error(String(log));
    process.exit(1);
}

const manifest = (
    await Bun.file(new URL("./extension/manifest.json", import.meta.url)).text()
).replace("{{VERSION}}", String(pkg.version));
await Bun.write(
    fileURLToPath(new URL("./dist/manifest.json", import.meta.url)),
    manifest,
);
console.log("扩展构建成功 → dist/ (content.js + service-worker.js + manifest.json)");
