import * as vscode from "vscode";
import { scanFile, getGitDiff, scanWorkspace } from "../services/codeScanner.js";

const PERF_REVIEW_SYSTEM = `You are a senior performance engineer reviewing code for performance issues.

Focus on these categories:
1. ALGORITHMIC — O(n^2) or worse, unnecessary iterations, missing early exits
2. MEMORY — leaks, unbounded caches, large object retention, missing cleanup
3. I/O — N+1 queries, missing connection pooling, synchronous blocking, no pagination
4. CONCURRENCY — race conditions, lock contention, thread-unsafe patterns
5. RESOURCE — unclosed streams/connections, missing timeouts, unbounded queues

For each finding, provide:
- SEVERITY: CRITICAL / HIGH / MEDIUM / LOW
- LOCATION: file and line number if visible
- ISSUE: what the performance problem is
- IMPACT: how it affects production (latency, memory, CPU, throughput)
- RECOMMENDATION: specific code-level fix with example

Be precise. Only report real issues, not style preferences. If the code has no performance issues, say so.`;

export function registerPerfReviewParticipant(
  context: vscode.ExtensionContext
): void {
  const participant = vscode.chat.createChatParticipant(
    "perf-agents.review",
    handler
  );
  participant.iconPath = new vscode.ThemeIcon("zap");
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
    case "scan":
      return handleScanFile(request, stream, token);
    case "diff":
      return handleDiff(request, stream, token);
    case "workspace":
      return handleWorkspace(request, stream, token);
    default:
      return handleDefault(request, stream, token);
  }
}

async function handleScanFile(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    stream.markdown(
      "No file is currently open. Open a file and try again."
    );
    return {};
  }

  const filePath = editor.document.uri.fsPath;
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  stream.progress(`Scanning ${fileName} for performance issues...`);

  const code = editor.document.getText();
  const language = editor.document.languageId;

  const prompt = `Review this ${language} code for performance issues.

File: ${fileName}
${request.prompt ? `Additional context: ${request.prompt}` : ""}

\`\`\`${language}
${truncate(code, 15000)}
\`\`\``;

  await streamLLMResponse(prompt, stream, token);
  return {};
}

async function handleDiff(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  stream.progress("Getting git diff...");

  const diff = await getGitDiff();
  if (!diff) {
    stream.markdown("No uncommitted changes found.");
    return {};
  }

  stream.progress("Reviewing diff for performance regressions...");

  const prompt = `Review this git diff for performance regressions. Focus on newly introduced issues, not pre-existing ones.

${request.prompt ? `Additional context: ${request.prompt}` : ""}

\`\`\`diff
${truncate(diff, 15000)}
\`\`\``;

  await streamLLMResponse(prompt, stream, token);
  return {};
}

async function handleWorkspace(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  stream.progress("Scanning workspace for source files...");

  const result = await scanWorkspace();
  if (result.sourceFiles.length === 0) {
    stream.markdown("No source files found in the workspace.");
    return {};
  }

  stream.progress(
    `Found ${result.sourceFiles.length} files, ${result.endpoints.length} endpoints. Analyzing...`
  );

  const fileList = result.sourceFiles.slice(0, 30).map((f) => {
    const parts = f.split(/[\\/]/);
    return parts.slice(-2).join("/");
  });

  const endpointList = result.endpoints.slice(0, 30).map(
    (ep) => `${ep.method} ${ep.path} (${ep.file.split(/[\\/]/).pop()}:${ep.line})`
  );

  const codeSnippets: string[] = [];
  for (const filePath of result.sourceFiles.slice(0, 10)) {
    try {
      const content = await scanFile(filePath);
      const name = filePath.split(/[\\/]/).pop() || filePath;
      codeSnippets.push(
        `--- ${name} ---\n${truncate(content, 2000)}`
      );
    } catch {
      continue;
    }
  }

  const prompt = `Review this ${result.language} ${result.framework} project for performance issues.

${request.prompt ? `Focus area: ${request.prompt}` : ""}

Source files (${result.sourceFiles.length} total):
${fileList.join("\n")}

Endpoints detected (${result.endpoints.length} total):
${endpointList.join("\n")}

Code samples:
${codeSnippets.join("\n\n")}`;

  await streamLLMResponse(prompt, stream, token);
  return {};
}

async function handleDefault(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
  if (!request.prompt) {
    stream.markdown(
      "**Performance Review Agent**\n\n" +
        "Commands:\n" +
        "- `/scan` — Scan the current file\n" +
        "- `/diff` — Review uncommitted changes\n" +
        "- `/workspace` — Scan all source files\n\n" +
        "Or just describe what you want me to review."
    );
    return {};
  }

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    return handleScanFile(request, stream, token);
  }

  const prompt = `${request.prompt}\n\nProvide performance engineering guidance.`;
  await streamLLMResponse(prompt, stream, token);
  return {};
}

async function streamLLMResponse(
  userPrompt: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const models = await vscode.lm.selectChatModels({
    vendor: "copilot",
    family: "gpt-4o",
  });

  if (models.length === 0) {
    stream.markdown(
      "No Copilot language model available. Make sure GitHub Copilot is active."
    );
    return;
  }

  const [model] = models;
  const messages = [
    vscode.LanguageModelChatMessage.User(PERF_REVIEW_SYSTEM),
    vscode.LanguageModelChatMessage.User(userPrompt),
  ];

  const response = await model.sendRequest(messages, {}, token);
  for await (const chunk of response.text) {
    stream.markdown(chunk);
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return (
    text.substring(0, maxLen) + `\n\n... (truncated, ${text.length} total chars)`
  );
}
