import type { EndpointInfo } from "./codeScanner.js";

export type ScriptType = "playwright" | "k6" | "selenium" | "loadrunner";

export interface GeneratedScript {
  filename: string;
  content: string;
  type: ScriptType;
  isJourney: boolean;
}

export function generatePlaywright(
  endpoints: EndpointInfo[],
  baseUrl: string
): GeneratedScript[] {
  const scripts: GeneratedScript[] = [];

  for (const ep of endpoints) {
    const safeName = ep.path.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "");
    scripts.push({
      filename: `test_${ep.method.toLowerCase()}_${safeName}.spec.ts`,
      type: "playwright",
      isJourney: false,
      content: `import { test, expect } from '@playwright/test';

test('${ep.method} ${ep.path} — response and performance', async ({ request }) => {
  const start = Date.now();
  const response = await request.${ep.method.toLowerCase()}('${baseUrl}${ep.path}');
  const duration = Date.now() - start;

  expect(response.status()).toBeLessThan(400);
  expect(duration).toBeLessThan(3000);
});

test('${ep.method} ${ep.path} — concurrent load', async ({ request }) => {
  const requests = Array.from({ length: 10 }, () =>
    request.${ep.method.toLowerCase()}('${baseUrl}${ep.path}')
  );
  const responses = await Promise.all(requests);
  for (const r of responses) {
    expect(r.status()).toBeLessThan(500);
  }
});
`,
    });
  }

  scripts.push({
    filename: "full_journey.spec.ts",
    type: "playwright",
    isJourney: true,
    content: generatePlaywrightJourney(endpoints, baseUrl),
  });

  return scripts;
}

export function generateK6(
  endpoints: EndpointInfo[],
  baseUrl: string
): GeneratedScript[] {
  const scripts: GeneratedScript[] = [];

  for (const ep of endpoints) {
    const safeName = ep.path.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "");
    scripts.push({
      filename: `test_${ep.method.toLowerCase()}_${safeName}_k6.js`,
      type: "k6",
      isJourney: false,
      content: `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const res = http.${ep.method.toLowerCase()}('${baseUrl}${ep.path}');
  check(res, {
    'status < 400': (r) => r.status < 400,
    'duration < 2s': (r) => r.timings.duration < 2000,
  });
  sleep(1);
}
`,
    });
  }

  scripts.push({
    filename: "full_journey_k6.js",
    type: "k6",
    isJourney: true,
    content: generateK6Journey(endpoints, baseUrl),
  });

  return scripts;
}

export function generateSelenium(
  endpoints: EndpointInfo[],
  baseUrl: string
): GeneratedScript[] {
  const scripts: GeneratedScript[] = [];

  for (const ep of endpoints) {
    if (ep.method.toUpperCase() !== "GET") continue;
    const safeName = ep.path.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "");
    const className = `Test${toPascalCase(safeName)}`;

    scripts.push({
      filename: `${className}.java`,
      type: "selenium",
      isJourney: false,
      content: `import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

public class ${className} {
    private WebDriver driver;

    @BeforeEach
    void setup() {
        driver = new ChromeDriver();
        driver.manage().timeouts().pageLoadTimeout(java.time.Duration.ofSeconds(10));
    }

    @AfterEach
    void teardown() { driver.quit(); }

    @Test
    void testPageLoad() {
        long start = System.currentTimeMillis();
        driver.get("${baseUrl}${ep.path}");
        long duration = System.currentTimeMillis() - start;
        assertTrue(duration < 5000, "Page load exceeded 5s: " + duration + "ms");
        assertFalse(driver.getTitle().contains("Error"));
    }
}
`,
    });
  }

  scripts.push({
    filename: "FullJourneyTest.java",
    type: "selenium",
    isJourney: true,
    content: generateSeleniumJourney(endpoints, baseUrl),
  });

  return scripts;
}

export function generateLoadRunner(
  endpoints: EndpointInfo[],
  baseUrl: string
): GeneratedScript[] {
  const scripts: GeneratedScript[] = [];

  for (const ep of endpoints) {
    const safeName = ep.path.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "");
    scripts.push({
      filename: `test_${ep.method.toLowerCase()}_${safeName}.c`,
      type: "loadrunner",
      isJourney: false,
      content: `#include "web_api.h"

Action()
{
    lr_start_transaction("${ep.method}_${safeName}");
    web_${ep.method === "GET" ? "url" : "submit_data"}("${safeName}",
        "URL=${baseUrl}${ep.path}",
        "Method=${ep.method}",
        "TargetFrame=",
        "Resource=0",
        "RecContentType=application/json",
        LAST);
    lr_end_transaction("${ep.method}_${safeName}", LR_AUTO);
    lr_think_time(2);
    return 0;
}
`,
    });
  }

  scripts.push({
    filename: "full_journey.c",
    type: "loadrunner",
    isJourney: true,
    content: generateLoadRunnerJourney(endpoints, baseUrl),
  });

  return scripts;
}

function generatePlaywrightJourney(
  endpoints: EndpointInfo[],
  baseUrl: string
): string {
  const steps = endpoints
    .map(
      (ep, i) =>
        `  await test.step('Step ${i + 1}: ${ep.method} ${ep.path}', async () => {
    const response = await request.${ep.method.toLowerCase()}('${baseUrl}${ep.path}');
    expect(response.status()).toBeLessThan(400);
  });`
    )
    .join("\n\n");

  return `import { test, expect } from '@playwright/test';

test('Full API journey', async ({ request }) => {
${steps}
});
`;
}

function generateK6Journey(
  endpoints: EndpointInfo[],
  baseUrl: string
): string {
  const steps = endpoints
    .map(
      (ep) =>
        `  const r_${ep.path.replace(/[^a-zA-Z0-9]/g, "_")} = http.${ep.method.toLowerCase()}('${baseUrl}${ep.path}');
  check(r_${ep.path.replace(/[^a-zA-Z0-9]/g, "_")}, { '${ep.method} ${ep.path} ok': (r) => r.status < 400 });
  sleep(1);`
    )
    .join("\n\n");

  return `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '3m', target: 10 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'],
  },
};

export default function () {
${steps}
}
`;
}

function generateSeleniumJourney(
  endpoints: EndpointInfo[],
  baseUrl: string
): string {
  const getEndpoints = endpoints.filter(
    (ep) => ep.method.toUpperCase() === "GET"
  );
  const steps = getEndpoints
    .map(
      (ep, i) =>
        `        // Step ${i + 1}: ${ep.path}
        driver.get("${baseUrl}${ep.path}");
        assertFalse(driver.getTitle().contains("Error"), "Error on ${ep.path}");`
    )
    .join("\n\n");

  return `import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

public class FullJourneyTest {
    private WebDriver driver;

    @BeforeEach
    void setup() {
        driver = new ChromeDriver();
        driver.manage().timeouts().pageLoadTimeout(java.time.Duration.ofSeconds(10));
    }

    @AfterEach
    void teardown() { driver.quit(); }

    @Test
    void testFullJourney() {
${steps}
    }
}
`;
}

function generateLoadRunnerJourney(
  endpoints: EndpointInfo[],
  baseUrl: string
): string {
  const steps = endpoints
    .map((ep) => {
      const safeName = ep.path.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "");
      return `    lr_start_transaction("${ep.method}_${safeName}");
    web_${ep.method === "GET" ? "url" : "submit_data"}("${safeName}",
        "URL=${baseUrl}${ep.path}",
        "Method=${ep.method}",
        "TargetFrame=",
        "Resource=0",
        "RecContentType=application/json",
        LAST);
    lr_end_transaction("${ep.method}_${safeName}", LR_AUTO);
    lr_think_time(2);`;
    })
    .join("\n\n");

  return `#include "web_api.h"

Action()
{
${steps}

    return 0;
}
`;
}

function toPascalCase(s: string): string {
  return s
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}
