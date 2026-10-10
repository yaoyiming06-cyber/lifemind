import { cpSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as buildFrontend } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(projectRoot, "out");
const tempOutPrefix = path.join(projectRoot, ".out-build-");
const staleBuildDirs = readdirSync(projectRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith(".out-build-"))
  .map((entry) => path.join(projectRoot, entry.name));
const tempOutDir = mkdtempSync(tempOutPrefix);
const assetsDir = path.join(tempOutDir, "assets");
const backupOutDir = `${outDir}.previous`;

// Keep the packaging helper predictable on memory-constrained desktop builders.
process.env.GOMAXPROCS ??= "1";

for (const staleBuildDir of staleBuildDirs) {
  try {
    rmSync(staleBuildDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err) {
    console.warn(`无法删除旧构建目录 ${staleBuildDir}，将继续构建：${err.message}`);
  }
}
mkdirSync(assetsDir, { recursive: true });

try {
  await buildFrontend({
    entryPoints: [path.join(projectRoot, "src", "main.tsx")],
    bundle: true,
    format: "esm",
    target: "es2020",
    outfile: path.join(assetsDir, "index.js"),
    loader: { ".tsx": "tsx", ".ts": "ts", ".css": "css" },
    external: ["/fonts/*"],
    minify: false,
    absWorkingDir: projectRoot,
    logLevel: "info",
  });

  cpSync(path.join(projectRoot, "public"), tempOutDir, { recursive: true, force: true });
  writeFileSync(
    path.join(tempOutDir, "index.html"),
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LifeMind</title>
    <link rel="stylesheet" href="./assets/index.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./assets/index.js"></script>
  </body>
</html>
`,
  );

  rmSync(backupOutDir, { recursive: true, force: true });
  const hadPreviousBuild = fsExists(outDir);
  if (hadPreviousBuild) {
    renameSync(outDir, backupOutDir);
  }
  try {
    renameSync(tempOutDir, outDir);
    rmSync(backupOutDir, { recursive: true, force: true });
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true });
    if (hadPreviousBuild) {
      renameSync(backupOutDir, outDir);
    }
    throw error;
  }
} catch (error) {
  try {
    rmSync(tempOutDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (cleanupErr) {
    console.warn(`无法清理临时目录 ${tempOutDir}：${cleanupErr.message}`);
  }
  throw error;
}

function fsExists(targetPath) {
  try {
    readdirSync(targetPath);
    return true;
  } catch {
    return false;
  }
}
