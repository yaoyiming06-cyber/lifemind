import { cpSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(projectRoot, "out");
const esbuild = path.join(projectRoot, "node_modules", ".bin", "esbuild");
const tempOutPrefix = path.join(projectRoot, ".out-build-");
const staleBuildDirs = readdirSync(projectRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith(".out-build-"))
  .map((entry) => path.join(projectRoot, entry.name));
const tempOutDir = mkdtempSync(tempOutPrefix);
const assetsDir = path.join(tempOutDir, "assets");
const backupOutDir = `${outDir}.previous`;

for (const staleBuildDir of staleBuildDirs) {
  rmSync(staleBuildDir, { recursive: true, force: true });
}
mkdirSync(assetsDir, { recursive: true });

try {
  const result = spawnSync(
    esbuild,
    [
      path.join(projectRoot, "src", "main.tsx"),
      "--bundle",
      "--format=esm",
      "--target=es2020",
      `--outfile=${path.join(assetsDir, "index.js")}`,
      "--loader:.tsx=tsx",
      "--loader:.ts=ts",
      "--loader:.css=css",
      "--minify=false",
    ],
    {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        // 限制 esbuild 的并发，避免 macOS 在内存压力下直接终止打包进程。
        GOMAXPROCS: process.env.GOMAXPROCS ?? "1",
      },
    },
  );

  if (result.status !== 0 || result.signal) {
    throw new Error(`前端构建失败${result.signal ? `：${result.signal}` : ""}`);
  }

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
  rmSync(tempOutDir, { recursive: true, force: true });
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
