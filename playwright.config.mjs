import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  retries: 1,                                              // the little local file server now and then misses a request when several browsers ask at once
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:4182", trace: "retain-on-failure", acceptDownloads: true },
  webServer: { command: "python3 -m http.server 4182 --bind 127.0.0.1", url: "http://127.0.0.1:4182", reuseExistingServer: !process.env.CI },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["iPhone 13"] } },
  ],
});
