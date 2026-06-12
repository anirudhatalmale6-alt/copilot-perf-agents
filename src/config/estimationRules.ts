export interface PerfActivityDef {
  id: string;
  name: string;
  description: string;
  baseTimeMinutes: number;
  defaultComplexity: string;
  executionType: string;
}

export const PERF_ACTIVITIES: PerfActivityDef[] = [
  {
    id: "ANALYSIS",
    name: "Analysis",
    description: "Analyze HLD, identify performance test scope, review architecture",
    baseTimeMinutes: 720,
    defaultComplexity: "medium",
    executionType: "MANUAL",
  },
  {
    id: "ASSESSMENT",
    name: "Assessment",
    description: "Assess system readiness, environment, data requirements",
    baseTimeMinutes: 720,
    defaultComplexity: "medium",
    executionType: "MANUAL",
  },
  {
    id: "BATCH_JOB_EXEC",
    name: "Batch Job Execution",
    description: "Execute batch job performance tests",
    baseTimeMinutes: 720,
    defaultComplexity: "medium",
    executionType: "MANUAL",
  },
  {
    id: "DATA_PREP",
    name: "Data Prep",
    description: "Prepare test data, parameterization, correlation",
    baseTimeMinutes: 422,
    defaultComplexity: "medium",
    executionType: "MANUAL",
  },
  {
    id: "DEFECTS_MGMT",
    name: "Defects Management",
    description: "Log, track, retest performance defects",
    baseTimeMinutes: 1920,
    defaultComplexity: "medium",
    executionType: "MANUAL",
  },
  {
    id: "EXEC_PEAK_LOAD",
    name: "Execution - Peak Load",
    description: "Execute peak load tests, monitor, collect results",
    baseTimeMinutes: 845,
    defaultComplexity: "peak_load",
    executionType: "MANUAL",
  },
  {
    id: "EXEC_STRESS",
    name: "Execution - Stress Test",
    description: "Execute stress tests, identify breaking points",
    baseTimeMinutes: 845,
    defaultComplexity: "stress_test",
    executionType: "MANUAL",
  },
  {
    id: "HP_PC_SUPPORT",
    name: "HP PC Support",
    description: "Performance Center/LoadRunner infrastructure support",
    baseTimeMinutes: 480,
    defaultComplexity: "hp_pc_support",
    executionType: "MANUAL",
  },
  {
    id: "PLANNING",
    name: "Planning",
    description: "Create performance test plan, define scenarios, set SLAs",
    baseTimeMinutes: 1440,
    defaultComplexity: "medium",
    executionType: "MANUAL",
  },
  {
    id: "REPORTING",
    name: "Reporting",
    description: "Analyze results, create performance reports, recommendations",
    baseTimeMinutes: 1200,
    defaultComplexity: "medium",
    executionType: "MANUAL",
  },
  {
    id: "SCRIPT_DESIGN",
    name: "Script Design",
    description: "Design, develop, enhance performance test scripts",
    baseTimeMinutes: 960,
    defaultComplexity: "complex",
    executionType: "MANUAL",
  },
];

export const COMPLEXITY_MULTIPLIERS: Record<string, number> = {
  simple: 0.5,
  medium: 1.0,
  complex: 2.0,
  peak_load: 1.0,
  stress_test: 1.0,
  hp_pc_support: 1.0,
};

export const DEFAULT_UNITS: Record<string, Record<string, number>> = {
  small: {
    ANALYSIS: 1,
    ASSESSMENT: 1,
    BATCH_JOB_EXEC: 1,
    DATA_PREP: 1,
    DEFECTS_MGMT: 1,
    EXEC_PEAK_LOAD: 1,
    EXEC_STRESS: 1,
    HP_PC_SUPPORT: 1,
    PLANNING: 1,
    REPORTING: 1,
    SCRIPT_DESIGN: 2,
  },
  medium: {
    ANALYSIS: 2,
    ASSESSMENT: 1,
    BATCH_JOB_EXEC: 2,
    DATA_PREP: 1,
    DEFECTS_MGMT: 2,
    EXEC_PEAK_LOAD: 2,
    EXEC_STRESS: 1,
    HP_PC_SUPPORT: 2,
    PLANNING: 1,
    REPORTING: 2,
    SCRIPT_DESIGN: 6,
  },
  large: {
    ANALYSIS: 3,
    ASSESSMENT: 2,
    BATCH_JOB_EXEC: 3,
    DATA_PREP: 2,
    DEFECTS_MGMT: 3,
    EXEC_PEAK_LOAD: 3,
    EXEC_STRESS: 2,
    HP_PC_SUPPORT: 3,
    PLANNING: 2,
    REPORTING: 3,
    SCRIPT_DESIGN: 10,
  },
};

export const PROJECT_SIZE_RULES = {
  small: { maxEndpoints: 5, maxUseCases: 5, maxDataEntities: 3 },
  medium: { maxEndpoints: 15, maxUseCases: 15, maxDataEntities: 8 },
};

export const MINUTES_PER_DAY = 480;
