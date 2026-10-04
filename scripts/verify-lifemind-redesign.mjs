import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const baseUrl = process.argv[2] ?? process.env.LIFEMIND_URL ?? "http://127.0.0.1:3001";
const artifactDir = process.env.LIFEMIND_QA_DIR ?? path.join(os.tmpdir(), "lifemind-redesign-qa");
const bundledPlaywright = path.join(
  os.homedir(),
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
);

let playwright;
try {
  playwright = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
} catch (error) {
  if (process.env.PLAYWRIGHT_MODULE) throw error;
  playwright = await import(pathToFileURL(bundledPlaywright).href);
}

await fs.mkdir(artifactDir, { recursive: true });
const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROME_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
    : { channel: "chrome" }),
});
const report = { baseUrl, viewports: [], interactions: [], browserErrors: [], fonts: {} };
let activePage;

async function requireVisible(locator, message) {
  await locator.waitFor({ state: "visible" });
  assert(await locator.isVisible(), message);
}

async function sidebarClick(page, label, expectedPage, expectedSelection = label) {
  const expand = page.getByRole("button", { name: "展开侧栏", exact: true });
  if (await expand.count()) await expand.click();
  const navigation = page.locator(".workflow-nav");
  const button = navigation.getByRole("button", { name: label, exact: true, includeHidden: true });
  await button.click();
  assert.equal(await navigation.getAttribute("data-page"), expectedPage, `${label} must open ${expectedPage}`);
  const selected = navigation.locator('[aria-current="page"]');
  assert.equal(await selected.count(), 1, `${expectedPage} must have one selected sidebar item`);
  assert.equal(await selected.getAttribute("title"), expectedSelection, `${expectedSelection} must be current`);
}

async function selectGlobalPage(page, label) {
  const trigger = page.getByRole("button", { name: "切换页面", exact: true });
  await trigger.click();
  assert.equal(await trigger.getAttribute("aria-expanded"), "true", "island dropdown opens");
  const menu = page.getByRole("menu");
  await requireVisible(menu, "global menu should be visible");
  await menu.getByRole("menuitem", { name: label, exact: true }).click();
  assert.equal(await trigger.getAttribute("aria-expanded"), "false", "page selection closes menu");
  await requireVisible(page.getByRole("navigation", { name: `${label}侧栏` }), `${label} must have its own sidebar`);
}

async function checkIslandInteractions(page) {
  const trigger = page.getByRole("button", { name: "切换页面", exact: true });
  const menu = page.getByRole("menu", { name: "页面" });
  await page.mouse.move(10, 10);
  await page.getByRole("button", { name: "选取文件", exact: true }).focus();
  const collapsedWidth = (await trigger.boundingBox()).width;
  await trigger.hover();
  await page.waitForFunction((initialWidth) => {
    const element = document.querySelector(".island-trigger");
    return element && element.getBoundingClientRect().width > initialWidth + 12;
  }, collapsedWidth);
  await page.mouse.move(10, 10);
  await trigger.focus();
  assert((await trigger.boundingBox()).width > collapsedWidth + 12, "keyboard focus must reveal the page label");
  await page.keyboard.press("ArrowDown");
  await requireVisible(menu, "keyboard should open the dropdown");
  assert.equal(await menu.getByRole("menuitem", { name: "入库", exact: true }).evaluate((element) => document.activeElement === element), true, "ArrowDown must focus the first page");
  await page.keyboard.press("Shift+Tab");
  await menu.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true, "Shift+Tab from the first menu item must close the menu and restore trigger focus");
  await page.keyboard.press("ArrowDown");
  await requireVisible(menu, "keyboard should reopen the dropdown after Shift+Tab");
  await page.keyboard.press("End");
  const textToggle = menu.getByRole("menuitemcheckbox", { name: "导航文字常显" });
  assert.equal(await textToggle.evaluate((element) => document.activeElement === element), true, "End must focus the text display preference");
  assert.equal(await textToggle.getAttribute("aria-checked"), "false", "navigation starts icon-only");
  await textToggle.click();
  assert.equal(await textToggle.getAttribute("aria-checked"), "true", "text display preference must toggle");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true, "Escape must restore trigger focus");
  await page.getByRole("button", { name: "选取文件", exact: true }).focus();
  await page.mouse.move(10, 10);
  assert((await trigger.boundingBox()).width > collapsedWidth + 12, "text preference must keep the island expanded without hover or focus");
  await trigger.click();
  await textToggle.click();
  await page.keyboard.press("Escape");
  report.interactions.push("island reveals current label on hover and keyboard focus", "keyboard menu navigation and Escape focus recovery", "navigation text can remain visible");
}

async function checkViewport(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const expand = page.getByRole("button", { name: "展开侧栏", exact: true });
  if (await expand.count()) await expand.click();
  await requireVisible(page.getByRole("navigation", { name: "入库侧栏" }), "workflow sidebar must coexist with global island");
  const trigger = page.getByRole("button", { name: "切换页面", exact: true });
  await requireVisible(trigger, "island trigger must be visible");
  assert.equal(await page.locator('aside[aria-label="检查与操作面板"]').count(), 0, "removed right panel must stay absent");
  assert.equal(await page.getByText("本地知识入库审阅台", { exact: true }).count(), 0, "removed brand block must stay absent");
  if (width <= 760) await page.getByRole("button", { name: "收起侧栏", exact: true }).click();

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    background: getComputedStyle(document.body).backgroundColor,
    fontFaces: [...document.fonts].map(({ family, status }) => ({ family: family.replaceAll('"', ""), status })),
  }));
  assert(dimensions.documentWidth <= width + 1, `document must not overflow at ${width}px`);
  assert(dimensions.bodyWidth <= width + 1, `body must not overflow at ${width}px`);
  assert.equal(dimensions.background, "rgb(255, 255, 255)", "content background must be pure white");
  const notoLoaded = dimensions.fontFaces.some(({ family, status }) => family === "Noto Serif SC" && status === "loaded");
  // Maghfirea is unavailable until an authorized local font file is supplied; report it without failing QA.
  const maghfireaLoaded = dimensions.fontFaces.some(({ family, status }) => family === "Maghfirea" && status === "loaded");
  assert(notoLoaded, `Noto Serif SC should load at ${width}px`);
  report.fonts = { notoSerifSC: notoLoaded, maghfirea: maghfireaLoaded };

  const controls = [trigger, page.getByRole("button", { name: "选取文件", exact: true }), page.getByRole("button", { name: "开始审理", exact: true })];
  for (const control of controls) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    assert(box && box.width > 0 && box.height >= 28, "primary controls must have stable usable bounds");
    assert(box.x >= -1 && box.x + box.width <= width + 1, "primary controls must fit viewport width");
    assert(box.y >= -1 && box.y + box.height <= height + 1, "primary controls must be reachable in viewport");
    assert(await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const topmost = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return topmost === element || element.contains(topmost);
    }), "app chrome must not occlude primary controls");
  }

  await trigger.click();
  const menu = page.getByRole("menu");
  await requireVisible(menu, "dropdown should be usable at every viewport");
  const menuBox = await menu.boundingBox();
  assert(menuBox.x >= -1 && menuBox.x + menuBox.width <= width + 1, "dropdown must fit mobile and desktop width");
  assert(menuBox.y >= -1 && menuBox.y + menuBox.height <= height + 1, "dropdown must fit viewport height");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await trigger.evaluate((element) => element.blur());
  await page.screenshot({ path: path.join(artifactDir, `intake-${width}x${height}.png`), fullPage: true });
  report.viewports.push({ width, height, ...dimensions });
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  activePage = page;
  page.on("pageerror", (error) => report.browserErrors.push(error.message));
  await page.route("https://api.deepseek.com/**", (route) => route.abort());
  for (const [width, height] of [[1440, 960], [1024, 768], [390, 844], [360, 740]]) {
    await checkViewport(page, width, height);
  }

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await checkIslandInteractions(page);
  await sidebarClick(page, "AI 审理", "审理");
  await requireVisible(page.getByText("等待审理结果", { exact: true }), "AI review should have an empty state");
  await sidebarClick(page, "Obsidian 预览", "入库");
  await requireVisible(page.getByText("等待 Obsidian 预览", { exact: true }).first(), "preview should have an empty state");
  await sidebarClick(page, "设置", "设置", "Vault");
  await requireVisible(page.getByRole("textbox", { name: "真实 Obsidian Vault 路径" }), "settings must preserve vault configuration");
  await requireVisible(page.getByRole("button", { name: "测试 API 连接", exact: true }), "settings must preserve API test");
  await page.getByRole("button", { name: "测试 API 连接", exact: true }).click();
  await requireVisible(page.getByText(/请先.*API Key|API Key.*为空|请填写.*API Key/), "missing API key should give feedback");
  await selectGlobalPage(page, "扫描");
  await requireVisible(page.getByRole("button", { name: "扫描范围", exact: true }), "scan sidebar must show scan-specific navigation");
  await requireVisible(page.getByRole("button", { name: /生成.*连接|扫描.*生成/ }), "scan workspace must remain accessible");
  await selectGlobalPage(page, "入库");
  assert.equal(await page.getByRole("button", { name: "扫描范围", exact: true }).count(), 0, "scan sidebar must leave with scan page");
  report.interactions.push("sidebar stages and global pages are independently reachable", "settings API validation and scan actions remain available");

  await page.getByRole("button", { name: "开始审理", exact: true }).click();
  await requireVisible(page.getByText("请先粘贴学习材料，或上传一个待审理文件。", { exact: true }), "empty submission must not get stuck loading");
  assert.equal(await page.locator(".lifemind-loading-overlay").count(), 0, "empty intake does not block the app");

  await page.locator('input[type="file"]').setInputFiles({
    name: "navigation-smoke.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# React 状态更新\nReact 的状态更新会触发重新渲染。useState 保存组件的状态，事件处理函数通过 setter 更新状态。"),
  });
  await requireVisible(page.getByText("navigation-smoke", { exact: true }).first(), "file selection should enqueue metadata");
  assert.equal(await page.locator(".lifemind-loading-overlay").count(), 0, "selecting a file must not start review");
  await page.getByRole("button", { name: "开始审理", exact: true }).click();
  await page.locator(".lifemind-loading-overlay").waitFor({ state: "visible" });
  await page.locator(".lifemind-loading-overlay").waitFor({ state: "hidden", timeout: 20000 });
  await requireVisible(page.getByRole("button", { name: "整批确认", exact: true }), "review must preserve confirmation action");
  await requireVisible(page.getByRole("button", { name: "删除本批次", exact: true }), "review must preserve deletion action");
  assert(!(await page.getByRole("button", { name: "整批确认", exact: true }).isDisabled()), "draft confirmation must be enabled");
  await sidebarClick(page, "Obsidian 预览", "审理");
  await requireVisible(page.getByRole("region", { name: "预览确认上下文" }), "preview keeps original source and AI output for confirmation");
  await page.setViewportSize({ width: 390, height: 844 });
  const collapseSidebar = page.getByRole("button", { name: "收起侧栏", exact: true });
  if (await collapseSidebar.count() && await collapseSidebar.isVisible()) {
    await collapseSidebar.click();
  }
  const closeSidebarScrim = page.getByRole("button", { name: "关闭侧栏", exact: true });
  if (await closeSidebarScrim.count() && await closeSidebarScrim.isVisible()) {
    // The scrim sits behind the drawer, so its locator center can be covered by the sidebar.
    await closeSidebarScrim.click({ position: { x: 320, y: 160 } });
  }
  const confirm = page.getByRole("button", { name: "整批确认", exact: true });
  await confirm.scrollIntoViewIfNeeded();
  const confirmBox = await confirm.boundingBox();
  assert(confirmBox.x >= 0 && confirmBox.x + confirmBox.width <= 391, "batch actions must remain reachable on mobile");
  await page.screenshot({ path: path.join(artifactDir, "preview-mobile.png"), fullPage: true });
  await confirm.click();
  await requireVisible(page.getByRole("textbox", { name: "真实 Obsidian Vault 路径" }), "confirmation without vault must send user to settings");
  await page.setViewportSize({ width: 1440, height: 960 });
  await sidebarClick(page, "AI 审理", "审理");
  await page.getByRole("button", { name: "删除本批次", exact: true }).click();
  await requireVisible(page.getByRole("button", { name: "开始审理", exact: true }), "draft deletion should return to intake");
  assert.equal(await page.getByRole("button", { name: "整批确认", exact: true }).count(), 0, "deleted batch should no longer be confirmable");
  report.interactions.push("empty submission recovers", "file selection queues until explicit review", "review generates a draft with confirmation and deletion", "preview keeps review context", "mobile confirmation validates missing vault", "draft deletion returns to intake without writing a vault");
  assert.deepEqual(report.browserErrors, [], "app must not throw browser errors");
  await context.close();
  console.log(`LifeMind redesign smoke passed. Artifacts: ${artifactDir}`);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(artifactDir, "failure.png"), fullPage: true });
  }
  throw error;
} finally {
  await fs.writeFile(path.join(artifactDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
