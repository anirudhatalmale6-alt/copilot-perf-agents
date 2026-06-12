import * as vscode from "vscode";
import * as mammoth from "mammoth";
import * as path from "path";

export interface UseCase {
  id: string;
  name: string;
  description: string;
  steps: string[];
}

export interface DataEntity {
  name: string;
  fields: string[];
}

export interface HLDData {
  projectName: string;
  businessSummary: string;
  objectives: string[];
  solutionSummary: string;
  inScope: string[];
  outOfScope: string[];
  useCases: UseCase[];
  assumptions: string[];
  risks: string[];
  constraints: string[];
  dataEntities: DataEntity[];
  securityRequirements: string[];
  deploymentApproach: string;
  architectureComponents: string[];
  nfrAvailability: string;
  nfrResponseTime: string;
  rawText: string;
}

export async function parseHLD(docxPath: string): Promise<HLDData> {
  const buffer = await vscode.workspace.fs.readFile(
    vscode.Uri.file(docxPath)
  );
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(buffer),
  });
  const text = result.value;

  return parseHLDText(text);
}

export function parseHLDText(text: string): HLDData {
  const hld: HLDData = {
    projectName: "",
    businessSummary: "",
    objectives: [],
    solutionSummary: "",
    inScope: [],
    outOfScope: [],
    useCases: [],
    assumptions: [],
    risks: [],
    constraints: [],
    dataEntities: [],
    securityRequirements: [],
    deploymentApproach: "",
    architectureComponents: [],
    nfrAvailability: "",
    nfrResponseTime: "",
    rawText: text,
  };

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return hld;

  hld.projectName = lines[0].split("\n")[0].trim();

  let currentSection = "";

  for (const line of lines) {
    const sectionKey = classifySection(line);
    if (sectionKey) {
      currentSection = sectionKey;
      continue;
    }

    collectLine(hld, currentSection, line);
  }

  extractDataEntities(hld);
  return hld;
}

export async function findHLDFiles(): Promise<string[]> {
  const docxFiles = await vscode.workspace.findFiles(
    "**/*.docx",
    "**/node_modules/**",
    20
  );

  const hldFiles: string[] = [];
  for (const file of docxFiles) {
    const name = path.basename(file.fsPath).toLowerCase();
    if (
      name.includes("hld") ||
      name.includes("high") ||
      name.includes("design")
    ) {
      hldFiles.unshift(file.fsPath);
    } else {
      hldFiles.push(file.fsPath);
    }
  }

  return hldFiles;
}

function classifySection(text: string): string {
  const t = text.toLowerCase();

  if (t.includes("business solution summary") || /^1\.1\s/.test(text))
    return "business_summary";
  if (t.includes("project objectives") || /^1\.2\s/.test(text))
    return "objectives";
  if (t.includes("solution summary") || /^1\.3\s/.test(text))
    return "solution_summary";
  if (t.includes("in scope") && !t.includes("out")) return "in_scope";
  if (t.includes("out of scope") || t.includes("out-of-scope"))
    return "out_of_scope";
  if (t.includes("use cases in scope") || /^1\.4\.3\s/.test(text))
    return "use_cases";
  if (t.includes("use cases out") || /^1\.4\.4\s/.test(text))
    return "use_cases_out";
  if (t.includes("assumption")) return "assumptions";
  if (t.includes("risk") && !t.includes("constraint")) return "risks";
  if (
    t.includes("constraint") ||
    t.includes("dependencies") ||
    t.includes("limitation")
  )
    return "constraints";
  if (t.includes("security") && t.includes("architecture"))
    return "security";
  if (t.includes("deployment") && t.includes("approach"))
    return "deployment";
  if (t.includes("data architecture") || t.includes("information model"))
    return "data";
  if (
    t.includes("availability") ||
    t.includes("scalability") ||
    t.includes("reliability")
  )
    return "nfr_availability";
  if (t.includes("response time")) return "nfr_response_time";
  if (t.includes("solution architecture") || t.includes("project context"))
    return "architecture";

  return "";
}

function collectLine(hld: HLDData, section: string, text: string): void {
  if (text.length < 5) return;

  switch (section) {
    case "business_summary":
      hld.businessSummary += " " + text;
      break;
    case "objectives":
      if (!text.startsWith("The project") && !text.startsWith("1."))
        hld.objectives.push(text);
      break;
    case "solution_summary":
      hld.solutionSummary += " " + text;
      break;
    case "in_scope":
      if (text.length > 10 && !text.startsWith("1."))
        hld.inScope.push(text);
      break;
    case "out_of_scope":
      if (text.length > 10 && !text.startsWith("1."))
        hld.outOfScope.push(text);
      break;
    case "use_cases":
      extractUseCase(hld, text);
      break;
    case "assumptions":
      if (text.length > 10 && !text.startsWith("1."))
        hld.assumptions.push(text);
      break;
    case "risks":
      if (text.length > 10) hld.risks.push(text);
      break;
    case "constraints":
      if (text.length > 10) hld.constraints.push(text);
      break;
    case "security":
      if (text.length > 10) hld.securityRequirements.push(text);
      break;
    case "deployment":
      hld.deploymentApproach += " " + text;
      break;
    case "architecture":
      if (text.length > 15) hld.architectureComponents.push(text);
      break;
    case "nfr_availability":
      hld.nfrAvailability += " " + text;
      break;
    case "nfr_response_time":
      hld.nfrResponseTime += " " + text;
      break;
  }
}

function extractUseCase(hld: HLDData, text: string): void {
  const ucMatch = text.match(/^(UC[-\s]?\d+)\s*[:\-–]\s*(.+)/i);
  if (ucMatch) {
    hld.useCases.push({
      id: ucMatch[1].trim(),
      name: ucMatch[2].trim(),
      description: ucMatch[2].trim(),
      steps: [],
    });
  } else if (hld.useCases.length > 0 && text.length > 10) {
    hld.useCases[hld.useCases.length - 1].steps.push(text);
  }
}

function extractDataEntities(hld: HLDData): void {
  const textLower = hld.rawText.toLowerCase();
  const entityPatterns: [RegExp, string, string[]][] = [
    [/\busers?\b.*\b(?:name|email|id)\b/, "Users", ["id", "name", "email"]],
    [
      /\bproducts?\b.*\b(?:name|price|stock)\b/,
      "Products",
      ["id", "name", "description", "price", "stock"],
    ],
    [
      /\borders?\b.*\b(?:user.?id|product.?id|quantity)\b/,
      "Orders",
      ["id", "user_id", "created_at"],
    ],
    [
      /\border.?items?\b/,
      "OrderItems",
      ["id", "order_id", "product_id", "quantity"],
    ],
  ];

  for (const [pattern, name, defaultFields] of entityPatterns) {
    if (pattern.test(textLower)) {
      const exists = hld.dataEntities.some((e) => e.name === name);
      if (!exists) {
        hld.dataEntities.push({ name, fields: defaultFields });
      }
    }
  }
}
