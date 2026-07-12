import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..", "..");
const extensionPath = join(root, "dist");
const extensionPathArg = extensionPath.replaceAll("\\", "/");
const fixtureUrl = pathToFileURL(join(root, "tests", "fixtures", "professor-simple.html")).href;
  const userDataDir = await mkdtemp(join(tmpdir(), "gradledger-extension-smoke-"));
const errors = [];
const executableCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
];
const executablePath = executableCandidates.find((candidate) => existsSync(candidate));

async function waitForFile(candidates, timeoutMs = 10000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`None of these files appeared: ${candidates.join(", ")}`);
}

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  executablePath,
  ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"],
  args: [
    `--disable-extensions-except=${extensionPathArg}`,
    `--load-extension=${extensionPathArg}`,
    "--disable-first-run-ui",
    "--no-first-run"
  ]
});

try {
  context.on("page", (page) => {
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`console: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  });

  await context.newPage();
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const preferencesPath = await waitForFile([join(userDataDir, "Default", "Preferences"), join(userDataDir, "Preferences")]);
  const preferences = JSON.parse(readFileSync(preferencesPath, "utf8"));
  const extensionSettings = preferences.extensions?.settings ?? {};
  const extensionEntry = Object.entries(extensionSettings).find(([, value]) => {
    const manifestName = value?.manifest?.name;
    const extensionLocation = value?.path;
    return manifestName === "GradLedger" || extensionLocation === extensionPath;
  });

  if (!extensionEntry) {
    throw new Error("GradLedger was not found in Chrome extension preferences.");
  }

  const [extensionId] = extensionEntry;
  const fixturePage = await context.newPage();
  await fixturePage.goto(fixtureUrl);
  await fixturePage.waitForLoadState("domcontentloaded");

  const uiPage = await context.newPage();
  await uiPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await uiPage.getByRole("heading", { name: "GradLedger" }).waitFor({ timeout: 10000 });

  const analyzeButtonVisible = await uiPage.getByRole("button", { name: /analyze/i }).first().isVisible();
  const detailsButtonVisible = await uiPage.getByRole("button", { name: "Details" }).isVisible();

  await uiPage.waitForTimeout(1500);

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        extensionId,
        fixtureUrl,
        sidepanelLoaded: true,
        analyzeButtonVisible,
        detailsButtonVisible
      },
      null,
      2
    )
  );
} finally {
  await context.close();
}
