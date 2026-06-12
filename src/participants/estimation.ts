import * as vscode from "vscode";
import { parseHLD, findHLDFiles } from "../services/hldParser.js";
import {
  estimateFromHLD,
  formatEstimationReport,
  classifyProjectSize,
} from "../services/estimationEngine.js";
import { JiraClient } from "../services/jiraClient.js";
import {
  PERF_ACTIVITIES,
  DEFAULT_UNITS,
  COMPLEXITY_MULTIPLIERS,
} from "../config/estimationRules.js";

export function registerEstimationParticipant(
  context: vscode.ExtensionContext
): void {
  const participant = vscode.chat.createChatParticipant(
    "perf-agents.estimation",
    handler
  );
  participant.iconPath = new vscode.ThemeIcon("graph");
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
    case "analyze":
      return handleAnalyze(request, stream, token);
    case "ticket":
      return handleTicket(request, stream, token);
    case "rules":
      return handleRules(stream);
    case "calibrate":
      return handleCalibrate(request, stream, token);
    default:
      return handleDefault(request, stream, token);
  }
}

async function handleAnalyze(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  stream.progress("Searching for HLD documents in workspace...");

  let hldPath: string | undefined;

  if (request.prompt) {
    const match = request.prompt.match(/[\w/\\.-]+\.docx/i);
    if (match) {
      const files = await vscode.workspace.findFiles(
        `**/${match[0]}`,
        "**/node_modules/**",
        1
      );
      if (files.length > 0) hldPath = files[0].fsPath;
    }
  }

  if (!hldPath) {
    const hldFiles = await findHLDFiles();
    if (hldFiles.length === 0) {
      stream.markdown(
        "No .docx files found in the workspace. Place your HLD document in the workspace and try again."
      );
      return {};
    }

    if (hldFiles.length === 1) {
      hldPath = hldFiles[0];
    } else {
      const picked = await vscode.window.showQuickPick(
        hldFiles.map((f) => ({
          label: f.split(/[\\/]/).pop() || f,
          detail: f,
        })),
        { placeHolder: "Select the HLD document to analyze" }
      );
      if (!picked) return {};
      hldPath = picked.detail;
    }
  }

  stream.progress(`Parsing ${hldPath.split(/[\\/]/).pop()}...`);

  const hld = await parseHLD(hldPath);
  stream.markdown(`**Project:** ${hld.projectName}\n\n`);
  stream.markdown(
    `| Metric | Count |\n|--------|-------|\n` +
      `| In-Scope Items | ${hld.inScope.length} |\n` +
      `| Use Cases | ${hld.useCases.length} |\n` +
      `| Data Entities | ${hld.dataEntities.length} |\n` +
      `| Security Reqs | ${hld.securityRequirements.length} |\n\n`
  );

  stream.progress("Calculating PERF estimation...");

  const llmAdj = await getLLMAdjustments(hld, stream, token);
  const result = await estimateFromHLD(hld, llmAdj);

  const report = formatEstimationReport(result);
  stream.markdown(`\`\`\`\n${report}\n\`\`\``);

  if (result.llmAdjustments) {
    stream.markdown(`\n**AI Adjustments:** ${result.llmAdjustments}\n`);
  }

  return {};
}

async function handleTicket(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  const client = new JiraClient();

  if (!client.isConfigured) {
    stream.markdown(
      "Jira is not configured. Set these in VS Code settings:\n\n" +
        "- `perfAgents.jira.url` — Your Jira server URL\n" +
        "- `perfAgents.jira.email` — Your username\n" +
        "- `perfAgents.jira.apiToken` — Your API token/password\n\n" +
        'Open Settings (Ctrl+,) and search for "perfAgents.jira".'
    );
    return {};
  }

  const ticketKey =
    request.prompt?.match(/[A-Z]{2,10}-\d+/)?.[0] || "";

  if (!ticketKey) {
    stream.markdown(
      "Please provide a PET ticket key, e.g.: `@estimation /ticket PET-120`"
    );
    return {};
  }

  stream.progress(`Fetching HLD from Jira ticket ${ticketKey}...`);

  try {
    const hldPath = await client.getHLDFromTicket(ticketKey);
    stream.progress(`Downloaded HLD. Parsing...`);

    const hld = await parseHLD(hldPath);
    stream.markdown(`**Project:** ${hld.projectName}\n\n`);

    stream.progress("Calculating estimation...");
    const llmAdj = await getLLMAdjustments(hld, stream, token);
    const result = await estimateFromHLD(hld, llmAdj);

    const report = formatEstimationReport(result);
    stream.markdown(`\`\`\`\n${report}\n\`\`\``);

    const shouldUpdate = await vscode.window.showInformationMessage(
      `Post estimation to ${ticketKey}?`,
      "Yes",
      "No"
    );

    if (shouldUpdate === "Yes") {
      stream.progress(`Updating ${ticketKey}...`);
      await client.postComment(ticketKey, report);
      stream.markdown(`\nEstimation posted to ${ticketKey}.`);
    }
  } catch (err: any) {
    stream.markdown(`Error: ${err.message}`);
  }

  return {};
}

async function handleRules(
  stream: vscode.ChatResponseStream
): Promise<vscode.ChatResult> {
  const config = vscode.workspace.getConfiguration("perfAgents.estimation");
  const effPct = config.get<number>("efficiencyPercentage", 19);
  const costPD = config.get<number>("costPerPersonDay", 250);

  let table =
    "| Activity | Base (min) | Complexity | Multiplier |\n" +
    "|----------|-----------|------------|------------|\n";

  for (const act of PERF_ACTIVITIES) {
    const mult = COMPLEXITY_MULTIPLIERS[act.defaultComplexity] ?? 1.0;
    table += `| ${act.name} | ${act.baseTimeMinutes} | ${act.defaultComplexity} | ${mult}x |\n`;
  }

  let unitsTable =
    "\n**Default Units per Project Size:**\n\n" +
    "| Activity | Small | Medium | Large |\n" +
    "|----------|-------|--------|-------|\n";

  for (const act of PERF_ACTIVITIES) {
    const s = DEFAULT_UNITS.small[act.id] ?? 1;
    const m = DEFAULT_UNITS.medium[act.id] ?? 1;
    const l = DEFAULT_UNITS.large[act.id] ?? 1;
    unitsTable += `| ${act.name} | ${s} | ${m} | ${l} |\n`;
  }

  stream.markdown("**PERF Estimation Rules**\n\n");
  stream.markdown(table);
  stream.markdown(unitsTable);
  stream.markdown(
    `\n**Efficiency:** ${effPct}%\n` +
      `**Cost per PD:** $${costPD}\n\n` +
      "Adjust in VS Code Settings > PERF Agents > Estimation."
  );

  return {};
}

async function handleCalibrate(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  if (!request.prompt) {
    stream.markdown(
      "**Calibration**\n\n" +
        "Tell me what to adjust, e.g.:\n" +
        '- "Set cost per PD to $300"\n' +
        '- "Change efficiency to 25%"\n' +
        '- "For medium projects, Script Design should be 8 units"\n' +
        '- "The total for HLD_Project1 should be around 40 PD — what needs to change?"'
    );
    return {};
  }

  const models = await vscode.lm.selectChatModels({
    vendor: "copilot",
    family: "gpt-4o",
  });

  if (models.length === 0) {
    stream.markdown("No Copilot model available.");
    return {};
  }

  const [model] = models;

  const currentRules = JSON.stringify(
    {
      activities: PERF_ACTIVITIES.map((a) => ({
        id: a.id,
        name: a.name,
        baseTimeMinutes: a.baseTimeMinutes,
        complexity: a.defaultComplexity,
      })),
      defaultUnits: DEFAULT_UNITS,
      complexityMultipliers: COMPLEXITY_MULTIPLIERS,
    },
    null,
    2
  );

  const prompt = `You are a PERF estimation calibration assistant.

Current estimation rules:
${currentRules}

User request: ${request.prompt}

Analyze the request and suggest specific changes to the estimation rules.
For each change, explain:
1. What parameter to change
2. Current value -> New value
3. How it affects the total estimation
4. The VS Code setting path if applicable

If the user wants a specific total, work backwards to determine what adjustments achieve it.`;

  const messages = [
    vscode.LanguageModelChatMessage.User(prompt),
  ];

  const response = await model.sendRequest(messages, {}, token);
  for await (const chunk of response.text) {
    stream.markdown(chunk);
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
      "**PERF Estimation Agent**\n\n" +
        "Commands:\n" +
        "- `/analyze` — Analyze an HLD document in the workspace\n" +
        "- `/ticket PET-120` — Fetch HLD from Jira and estimate\n" +
        "- `/rules` — Show current estimation rules\n" +
        "- `/calibrate` — Adjust estimation parameters\n\n" +
        "Or describe what you need."
    );
    return {};
  }

  if (request.prompt.match(/[A-Z]{2,10}-\d+/)) {
    return handleTicket(request, stream, token);
  }

  if (
    request.prompt.toLowerCase().includes("hld") ||
    request.prompt.includes(".docx")
  ) {
    return handleAnalyze(request, stream, token);
  }

  if (
    request.prompt.toLowerCase().includes("rule") ||
    request.prompt.toLowerCase().includes("config")
  ) {
    return handleRules(stream);
  }

  return handleCalibrate(request, stream, token);
}

async function getLLMAdjustments(
  hld: any,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<Record<string, number> | undefined> {
  try {
    const models = await vscode.lm.selectChatModels({
      vendor: "copilot",
      family: "gpt-4o",
    });

    if (models.length === 0) return undefined;

    const [model] = models;
    const projectSize = classifyProjectSize(hld);

    const scope = hld.inScope
      .slice(0, 15)
      .map((s: string) => `  - ${s}`)
      .join("\n");
    const ucs = hld.useCases
      .slice(0, 10)
      .map((uc: any) => `  - ${uc.name}`)
      .join("\n");
    const entities = hld.dataEntities
      .map((e: any) => `  - ${e.name}: ${e.fields.join(", ")}`)
      .join("\n");

    const prompt = `Analyze this HLD for performance test estimation adjustments.

Project: ${hld.projectName}
Size: ${projectSize}

In-Scope:
${scope}

Use Cases:
${ucs}

Data Entities:
${entities}

Security: ${hld.securityRequirements.slice(0, 3).join("; ")}

Suggest adjustments as JSON ONLY:
{
  "scriptDesignAdj": 0,
  "executionAdj": 0,
  "reasoning": "1-2 sentences"
}

Rules:
- Many entities (>4): +1-2 script design units
- Security requirements: +1 execution units
- Batch processing: +1 batch job units
- Return ONLY JSON.`;

    const messages = [
      vscode.LanguageModelChatMessage.User(prompt),
    ];

    let response = "";
    const llmResponse = await model.sendRequest(messages, {}, token);
    for await (const chunk of llmResponse.text) {
      response += chunk;
    }

    const start = response.indexOf("{");
    const end = response.lastIndexOf("}") + 1;
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(response.substring(start, end));
      if (parsed.reasoning) {
        stream.markdown(`\n*AI: ${parsed.reasoning}*\n\n`);
      }
      return parsed;
    }
  } catch {
    // LLM adjustments are optional
  }

  return undefined;
}
