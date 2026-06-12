import * as vscode from "vscode";

export interface EndpointInfo {
  method: string;
  path: string;
  file: string;
  line: number;
  handler: string;
}

export interface ScanResult {
  endpoints: EndpointInfo[];
  sourceFiles: string[];
  language: string;
  framework: string;
}

const ROUTE_PATTERNS: Record<string, RegExp[]> = {
  java: [
    /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["']([^"']+)["']\s*\)/gi,
    /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["'].*method\s*=\s*RequestMethod\.(\w+)/gi,
  ],
  python: [
    /@app\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']\s*\)/gi,
    /app\.route\s*\(\s*["']([^"']+)["'].*methods\s*=\s*\[["'](\w+)["']\]/gi,
  ],
  typescript: [
    /@(Get|Post|Put|Delete|Patch)\s*\(\s*["']([^"']*?)["']\s*\)/gi,
    /router\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/gi,
    /app\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/gi,
  ],
  csharp: [
    /\[Http(Get|Post|Put|Delete|Patch)\s*\(\s*["']([^"']+)["']\s*\)\]/gi,
  ],
};

export async function scanWorkspace(): Promise<ScanResult> {
  const result: ScanResult = {
    endpoints: [],
    sourceFiles: [],
    language: "unknown",
    framework: "unknown",
  };

  const patterns = [
    "**/*.java",
    "**/*.py",
    "**/*.ts",
    "**/*.js",
    "**/*.cs",
    "**/*.go",
  ];

  for (const pattern of patterns) {
    const files = await vscode.workspace.findFiles(
      pattern,
      "**/node_modules/**",
      200
    );
    for (const file of files) {
      result.sourceFiles.push(file.fsPath);
    }
  }

  if (result.sourceFiles.length === 0) {
    return result;
  }

  const ext = result.sourceFiles[0].split(".").pop() || "";
  const langMap: Record<string, string> = {
    java: "java",
    py: "python",
    ts: "typescript",
    js: "typescript",
    cs: "csharp",
    go: "go",
  };
  result.language = langMap[ext] || "unknown";

  for (const filePath of result.sourceFiles.slice(0, 50)) {
    try {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(filePath)
      );
      const content = doc.getText();
      const endpoints = extractEndpoints(
        content,
        filePath,
        result.language
      );
      result.endpoints.push(...endpoints);
    } catch {
      continue;
    }
  }

  result.framework = detectFramework(result.sourceFiles, result.language);
  return result;
}

export async function scanFile(filePath: string): Promise<string> {
  const doc = await vscode.workspace.openTextDocument(
    vscode.Uri.file(filePath)
  );
  return doc.getText();
}

export async function getGitDiff(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return "";
  }

  try {
    const { exec } = require("child_process");
    return new Promise((resolve) => {
      exec(
        "git diff HEAD",
        { cwd: workspaceFolder.uri.fsPath, maxBuffer: 1024 * 1024 },
        (err: Error | null, stdout: string) => {
          resolve(err ? "" : stdout);
        }
      );
    });
  } catch {
    return "";
  }
}

function extractEndpoints(
  content: string,
  filePath: string,
  language: string
): EndpointInfo[] {
  const endpoints: EndpointInfo[] = [];
  const patterns = ROUTE_PATTERNS[language] || [];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const line =
        content.substring(0, match.index).split("\n").length;
      endpoints.push({
        method: (match[1] || "GET").toUpperCase(),
        path: match[2] || match[1] || "/",
        file: filePath,
        line,
        handler: extractHandlerName(content, match.index),
      });
    }
  }

  return endpoints;
}

function extractHandlerName(content: string, matchIndex: number): string {
  const after = content.substring(matchIndex, matchIndex + 500);
  const funcMatch = after.match(
    /(?:public\s+\w+\s+|def\s+|async\s+|function\s+)(\w+)/
  );
  return funcMatch ? funcMatch[1] : "handler";
}

function detectFramework(files: string[], language: string): string {
  const fileNames = files.map((f) => f.split("/").pop() || "");

  if (language === "java") {
    if (files.some((f) => f.includes("pom.xml") || f.includes("build.gradle"))) {
      return "Spring Boot";
    }
  }
  if (language === "python") {
    if (fileNames.some((f) => f === "manage.py")) return "Django";
    if (files.some((f) => f.includes("flask") || f.includes("app.py")))
      return "Flask";
    if (files.some((f) => f.includes("fastapi"))) return "FastAPI";
  }
  if (language === "typescript" || language === "javascript") {
    if (files.some((f) => f.includes("nest"))) return "NestJS";
    if (files.some((f) => f.includes("next.config"))) return "Next.js";
    if (fileNames.some((f) => f === "express" || f.includes("app.ts")))
      return "Express";
  }
  if (language === "csharp") return ".NET";

  return "unknown";
}
