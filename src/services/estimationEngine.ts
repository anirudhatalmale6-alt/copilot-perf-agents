import * as vscode from "vscode";
import {
  PERF_ACTIVITIES,
  COMPLEXITY_MULTIPLIERS,
  DEFAULT_UNITS,
  PROJECT_SIZE_RULES,
  MINUTES_PER_DAY,
} from "../config/estimationRules.js";
import type { HLDData } from "./hldParser.js";

export interface ActivityEstimate {
  activityId: string;
  name: string;
  complexity: string;
  executionType: string;
  execTimeDays: number;
  units: int;
  totalDays: number;
}

type int = number;

export interface EstimationResult {
  projectName: string;
  projectSize: string;
  activities: ActivityEstimate[];
  totalUnits: number;
  totalDaysBefore: number;
  totalHoursBefore: number;
  efficiencyPct: number;
  efficiencySavingDays: number;
  totalDaysAfter: number;
  totalHoursAfter: number;
  costPerPD: number;
  totalCost: number;
  scopeCount: number;
  useCaseCount: number;
  entityCount: number;
  llmAdjustments: string;
}

export function classifyProjectSize(hld: HLDData): string {
  const scope = hld.inScope.length;
  const uc = hld.useCases.length;
  const ent = hld.dataEntities.length;

  const small = PROJECT_SIZE_RULES.small;
  if (
    scope <= small.maxEndpoints &&
    uc <= small.maxUseCases &&
    ent <= small.maxDataEntities
  ) {
    return "small";
  }

  const medium = PROJECT_SIZE_RULES.medium;
  if (scope <= medium.maxEndpoints && uc <= medium.maxUseCases) {
    return "medium";
  }

  return "large";
}

export async function estimateFromHLD(
  hld: HLDData,
  llmAdjustments?: Record<string, number>
): Promise<EstimationResult> {
  const config = vscode.workspace.getConfiguration("perfAgents.estimation");
  const efficiencyPct = config.get<number>("efficiencyPercentage", 19);
  const costPerPD = config.get<number>("costPerPersonDay", 250);

  const projectSize = classifyProjectSize(hld);
  const defaultUnits = DEFAULT_UNITS[projectSize] || DEFAULT_UNITS.medium;

  const activities: ActivityEstimate[] = [];
  let totalUnits = 0;
  let totalMinutes = 0;

  for (const actDef of PERF_ACTIVITIES) {
    const multiplier =
      COMPLEXITY_MULTIPLIERS[actDef.defaultComplexity] ?? 1.0;
    const execTimeMin = actDef.baseTimeMinutes * multiplier;
    const execTimeDays = execTimeMin / MINUTES_PER_DAY;

    let units = defaultUnits[actDef.id] ?? 1;

    if (llmAdjustments) {
      if (
        actDef.id === "SCRIPT_DESIGN" &&
        llmAdjustments.scriptDesignAdj
      ) {
        units = Math.max(1, units + llmAdjustments.scriptDesignAdj);
      }
      if (
        (actDef.id === "EXEC_PEAK_LOAD" ||
          actDef.id === "EXEC_STRESS") &&
        llmAdjustments.executionAdj
      ) {
        units = Math.max(1, units + llmAdjustments.executionAdj);
      }
    }

    const totalDays = execTimeDays * units;
    totalUnits += units;
    totalMinutes += execTimeMin * units;

    activities.push({
      activityId: actDef.id,
      name: actDef.name,
      complexity: actDef.defaultComplexity,
      executionType: actDef.executionType,
      execTimeDays: round(execTimeDays),
      units,
      totalDays: round(totalDays),
    });
  }

  const totalDaysBefore = totalMinutes / MINUTES_PER_DAY;
  const totalHoursBefore = totalMinutes / 60;
  const savingDays = totalDaysBefore * (efficiencyPct / 100);
  const totalDaysAfter = totalDaysBefore - savingDays;
  const totalHoursAfter = totalDaysAfter * 8;
  const totalCost = totalDaysAfter * costPerPD;

  return {
    projectName: hld.projectName,
    projectSize,
    activities,
    totalUnits,
    totalDaysBefore: round(totalDaysBefore),
    totalHoursBefore: round(totalHoursBefore),
    efficiencyPct,
    efficiencySavingDays: round(savingDays),
    totalDaysAfter: round(totalDaysAfter),
    totalHoursAfter: round(totalHoursAfter),
    costPerPD,
    totalCost: round(totalCost),
    scopeCount: hld.inScope.length,
    useCaseCount: hld.useCases.length,
    entityCount: hld.dataEntities.length,
    llmAdjustments: "",
  };
}

export function formatEstimationReport(est: EstimationResult): string {
  const sep = "=".repeat(70);
  const dash = "-".repeat(70);

  const lines = [
    sep,
    `  PERF ESTIMATION REPORT - ${est.projectName}`,
    sep,
    "",
    `  Project Size     : ${est.projectSize.toUpperCase()}`,
    `  In-Scope Items   : ${est.scopeCount}`,
    `  Use Cases        : ${est.useCaseCount}`,
    `  Data Entities    : ${est.entityCount}`,
    "",
    dash,
    `  ${"PERF Activity".padEnd(25)} ${"Complexity".padEnd(12)} ${"Time(days)".padEnd(12)} ${"Units".padEnd(8)} ${"Total(days)".padEnd(12)}`,
    dash,
  ];

  for (const a of est.activities) {
    lines.push(
      `  ${a.name.padEnd(25)} ${a.complexity.padEnd(12)} ${a.execTimeDays.toFixed(2).padEnd(12)} ${String(a.units).padEnd(8)} ${a.totalDays.toFixed(2).padEnd(12)}`
    );
  }

  lines.push(
    dash,
    "",
    `  Vendor Effort (Before ${est.efficiencyPct}% Efficiency):`,
    `    ${est.totalHoursBefore.toFixed(2)} hrs = ${est.totalDaysBefore.toFixed(2)} PD`,
    "",
    `  Vendor Effort (After ${est.efficiencyPct}% Efficiency):`,
    `    ${est.totalHoursAfter.toFixed(2)} hrs = ${est.totalDaysAfter.toFixed(2)} PD`,
    "",
    `  Efficiency Saving: ${est.efficiencySavingDays.toFixed(2)} PD`,
    "",
    `  Cost @ $${est.costPerPD}/PD = $${est.totalCost.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    ""
  );

  if (est.llmAdjustments) {
    lines.push(`  AI Adjustments: ${est.llmAdjustments}`, "");
  }

  lines.push(sep);
  return lines.join("\n");
}

function round(n: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
