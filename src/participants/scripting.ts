import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { scanWorkspace, type EndpointInfo } from "../services/codeScanner.js";
import {
  generatePlaywright,
  generateK6,
  generateSelenium,
  generateLoadRunner,
  type GeneratedScript,
  type ScriptType,
} from "../services/scriptGenerator.js";

export function registerScriptingParticipant(
  context: vscode.ExtensionContext
): void {
  const participant = vscode.chat.createChatParticipant(
    "perf-agents.scripting",
    handler
  );
  participant.iconPath = new vscode.ThemeIcon("beaker");
  context.subscriptions.push(participant);
}

async function handler(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  const command = request.command || "";

  switch (command) {
    case "playwright":
      return handleGenerate(request, stream, token, "playwright");
    case "k6":
      return handleGenerate(request, stream, token, "k6");
    case "selenium":
      return handleGenerate(request, stream, token, "selenium");
    case "loadrunner":
      return handleGenerate(request, stream, token, "loadrunner");
    case "testcases":
      return handleTestCases(request, stream, token);
    case "all":
      return handleGenerateAll(request, stream, token);
    default:
      return handleDefault(request, stream, token);
  }
}

async function handleGenerate(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  type: ScriptType
): Promise<vscode.ChatResult> {
  stream.progress(`Scanning workspace for endpoints...`);

  const scan = await scanWorkspace();
  if (scan.endpoints.length === 0) {
    stream.markdown(
      "No API endpoints found in the workspace. Make sure source files with route definitions are present."
    );
    return {};
  }

  const baseUrl =
    request.prompt?.match(/https?:\/\/[^\s]+/)?.[0] ||
    "http://localhost:8080";

  stream.progress(
    `Found ${scan.endpoints.length} endpoints. Generating ${type} scripts...`
  );

  const scripts = generateScriptsForType(type, scan.endpoints, baseUrl);
  await writeScripts(scripts, type, stream);

  const enhancedScripts = await enhanceWithLLM(
    scan,
    type,
    baseUrl,
    request.prompt || "",
    stream,
    token
  );

  if (enhancedScripts) {
    stream.markdown(`\n\n**AI-enhanced ${type} scripts:**\n\n`);
    stream.markdown(enhancedScripts);
  }

  return {};
}

async function handleGenerateAll(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  stream.progress("Scanning workspace for endpoints...");

  const scan = await scanWorkspace();
  if (scan.endpoints.length === 0) {
    stream.markdown("No API endpoints found in the workspace.");
    return {};
  }

  const baseUrl =
    request.prompt?.match(/https?:\/\/[^\s]+/)?.[0] ||
    "http://localhost:8080";

  const types: ScriptType[] = ["playwright", "k6", "selenium", "loadrunner"];

  for (const type of types) {
    if (token.isCancellationRequested) break;

    stream.progress(`Generating ${type} scripts...`);
    const scripts = generateScriptsForType(type, scan.endpoints, baseUrl);
    await writeScripts(scripts, type, stream);
  }

  stream.markdown(
    `\n\nGenerated scripts for all 4 types across ${scan.endpoints.length} endpoints.`
  );
  return {};
}

async function handleTestCases(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  stream.progress("Scanning workspace for endpoints and forms...");

  const scan = await scanWorkspace();
  if (scan.endpoints.length === 0) {
    stream.markdown("No endpoints found to generate test cases from.");
    return {};
  }

  stream.progress("Generating test cases with AI...");

  const endpointList = scan.endpoints
    .map((ep) => `${ep.method} ${ep.path} (${ep.handler})`)
    .join("\n");

  const prompt = `Generate comprehensive positive and negative test cases for these API endpoints.

Framework: ${scan.framework}
Language: ${scan.language}
${request.prompt ? `Focus: ${request.prompt}` : ""}

Endpoints:
${endpointList}

Output as CSV with columns: test_id,type,test_name,page_or_endpoint,method,input_data,expected_result,priority,description

type should be "positive" or "negative".
priority should be "high", "medium", or "low".
Generate at least 3 positive and 3 negative cases per endpoint.`;

  const models = await vscode.lm.selectChatModels({
    vendor: "copilot",
    family: "gpt-4o",
  });

  if (models.length === 0) {
    stream.markdown("No Copilot model available.");
    return {};
  }

  const [model] = models;
  const messages = [
    vscode.LanguageModelChatMessage.User(
      "You are a QA engineer generating test cases. Output clean CSV data."
    ),
    vscode.LanguageModelChatMessage.User(prompt),
  ];

  let csvContent = "";
  const response = await model.sendRequest(messages, {}, token);
  for await (const chunk of response.text) {
    csvContent += chunk;
    stream.markdown(chunk);
  }

  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder) {
    const csvMatch = csvContent.match(/```(?:csv)?\n?([\s\S]*?)```/);
    const rawCsv = csvMatch ? csvMatch[1] : csvContent;

    const tcDir = path.join(wsFolder.uri.fsPath, "test_cases");
    if (!fs.existsSync(tcDir)) fs.mkdirSync(tcDir, { recursive: true });

    const csvPath = path.join(tcDir, "test_cases.csv");
    fs.writeFileSync(csvPath, rawCsv.trim(), "utf-8");

    stream.markdown(`\n\nSaved to: \`test_cases/test_cases.csv\``);
  }

  return {};
}

async function handleDefault(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  if (!request.prompt) {
    stream.markdown(
      "**Test Scripting Agent**\n\n" +
        "Commands:\n" +
        "- `/playwright` — Generate Playwright test scripts\n" +
        "- `/k6` — Generate k6 load test scripts\n" +
        "- `/selenium` — Generate Selenium WebDriver tests\n" +
        "- `/loadrunner` — Generate LoadRunner C scripts\n" +
        "- `/testcases` — Generate test cases CSV\n" +
        "- `/all` — Generate all test types\n\n" +
        "Add a base URL after the command, e.g.:\n" +
        "`@scripting /playwright http://localhost:3000`"
    );
    return {};
  }

  return handleGenerateAll(request, stream, token);
}

function generateScriptsForType(
  type: ScriptType,
  endpoints: EndpointInfo[],
  baseUrl: string
): GeneratedScript[] {
  switch (type) {
    case "playwright":
      return generatePlaywright(endpoints, baseUrl);
    case "k6":
      return generateK6(endpoints, baseUrl);
    case "selenium":
      return generateSelenium(endpoints, baseUrl);
    case "loadrunner":
      return generateLoadRunner(endpoints, baseUrl);
  }
}

async function writeScripts(
  scripts: GeneratedScript[],
  type: ScriptType,
  stream: vscode.ChatResponseStream
): Promise<void> {
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (!wsFolder) {
    stream.markdown(`\n**${type} scripts (${scripts.length} files):**\n`);
    for (const s of scripts) {
      stream.markdown(`\n\`${s.filename}\`:\n\`\`\`\n${s.content}\`\`\`\n`);
    }
    return;
  }

  const config = vscode.workspace.getConfiguration("perfAgents.scripting");
  const outBase = config.get<string>("outputDir", "perf-scripts");
  const outDir = path.join(wsFolder.uri.fsPath, outBase, type);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const s of scripts) {
    const filePath = path.join(outDir, s.filename);
    fs.writeFileSync(filePath, s.content, "utf-8");
  }

  const perEndpoint = scripts.filter((s) => !s.isJourney).length;
  const journeys = scripts.filter((s) => s.isJourney).length;
  stream.markdown(
    `\n**${type}**: ${perEndpoint} per-endpoint + ${journeys} journey file(s) -> \`${outBase}/${type}/\`\n`
  );
}

async function enhanceWithLLM(
  scan: { endpoints: EndpointInfo[]; framework: string; language: string },
  type: ScriptType,
  baseUrl: string,
  userPrompt: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<string | null> {
  try {
    const models = await vscode.lm.selectChatModels({
      vendor: "copilot",
      family: "gpt-4o",
    });

    if (models.length === 0) return null;

    const [model] = models;
    const endpointList = scan.endpoints
      .slice(0, 20)
      .map((ep) => `${ep.method} ${ep.path}`)
      .join("\n");

    const prompt = `Generate advanced ${type} performance test scenarios for this ${scan.framework} application.

Base URL: ${baseUrl}
${userPrompt ? `Focus: ${userPrompt}` : ""}

Endpoints:
${endpointList}

Include: data-driven tests, error handling, realistic think times, correlation, and parameterization. Output production-ready code.`;

    const messages = [
      vscode.LanguageModelChatMessage.User(
        `You are a performance test engineer specializing in ${type}.`
      ),
      vscode.LanguageModelChatMessage.User(prompt),
    ];

    let result = "";
    const response = await model.sendRequest(messages, {}, token);
    for await (const chunk of response.text) {
      result += chunk;
    }
    return result;
  } catch {
    return null;
  }
}
