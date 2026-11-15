export type GroupTermOperator =
  | 'is equal to'
  | 'is not equal to'
  | 'is greater than'
  | 'is less than'
  | 'is between'
  | 'is not between';

export interface GroupTerm {
  column: string;
  operator: GroupTermOperator;
  value1: any;
  value2?: any;
}

export interface DataGroup {
  id: string;
  name: string;
  conditionLinkType: 'AND' | 'OR';
  terms: GroupTerm[];
  recordCount: number;
  rowIds?: number[];
}

export interface UniqueValueItem {
  label: string;
  raw: any;
  count: number;
}

export interface EligibleGroupColumn {
  name: string;
  uniqueCount: number;
  values: UniqueValueItem[];
}

export interface GroupWarning {
  kind: 'min_sample_size' | 'comparable_size';
  severity: 'warning';
  message: string;
  groupNames: string[];
}

export interface PlsSettings {
  weightingScheme: 'path' | 'centroid' | 'factor';
  maxIterations: number;
  stopCriterionExponent: number;
  missingValues: 'mean' | 'casewise' | 'pairwise';
  consistent?: boolean;
}

export interface PermutationSettings {
  groupAId: string;
  groupBId: string;
  permutations: number;
  testType: 'two-tailed' | 'one-tailed';
  significanceLevel: number;
  parallelProcessing: boolean;
  seed: number | null;
  plsSettings: PlsSettings;
}

export interface MgaSettings {
  groupAId: string;
  groupBId: string;
  subsamples: number;
  testType: 'two-tailed' | 'one-tailed';
  significanceLevel: number;
  parallelProcessing: boolean;
  seed: number | null;
  plsSettings: PlsSettings;
}

export interface PermutationParamRow {
  key: string;
  parameter: string;
  construct?: string;
  indicator?: string;
  originalA: number;
  originalB: number;
  originalDifference: number;
  permutationMeanDifference: number;
  ciLower: number;
  ciUpper: number;
  pValue: number;
  significant: boolean;
}

export interface MicomStep1Check {
  label: string;
  passed: boolean;
  detail: string;
}

export interface MicomStep2Row {
  constructId: string;
  constructName: string;
  singleIndicator: boolean;
  originalCorrelation: number;
  permutationMean: number;
  quantile5Pct: number;
  pValue: number;
  passed: boolean;
  note?: string;
}

export interface MicomStep3Row {
  constructId: string;
  constructName: string;
  originalDifference: number;
  permutationMeanDifference: number;
  ciLower: number;
  ciUpper: number;
  pValue: number;
  passed: boolean;
}

export interface MicomSummaryRow {
  constructId: string;
  constructName: string;
  configural: boolean;
  compositional: boolean;
  equalMean: boolean | null;
  equalVariance: boolean | null;
  verdict: 'Full measurement invariance' | 'Partial measurement invariance' | 'No invariance';
  explanation: string;
}

export interface MicomResult {
  step1: {
    passed: boolean;
    checks: MicomStep1Check[];
    qualitativeNote: string;
    stopMessage?: string | null;
  };
  step2: MicomStep2Row[];
  step3Means: MicomStep3Row[];
  step3Variances: MicomStep3Row[];
  summary: MicomSummaryRow[];
  failedCompositionalConstructs: string[];
  anyNoInvariance: boolean;
  allInvariant: boolean;
}

export interface PermutationReport {
  id: string;
  reportType: 'permutation';
  title: string;
  createdAt: string;
  modelId: string;
  datasetId?: string;
  groupAName: string;
  groupBName: string;
  nA: number;
  nB: number;
  permutationsRequested: number;
  permutationsCompleted: number;
  failedRuns: number;
  failedRunWarning?: string | null;
  testType: 'two-tailed' | 'one-tailed';
  significanceLevel: number;
  parallelProcessing?: boolean;
  seed: number;
  plsSettings: PlsSettings;
  pathCoefficients: PermutationParamRow[];
  outerLoadings: PermutationParamRow[];
  outerWeights: PermutationParamRow[];
  micom: MicomResult;
}

export interface MgaParamRow {
  key: string;
  parameter: string;
  construct?: string;
  indicator?: string;
  originalA: number;
  originalB: number;
  difference: number;
  absDifference: number;
  henselerPGreater: number;
  henselerResult: 'A > B' | 'A < B' | 'n.s.';
  henselerP1Tailed?: number;
  henselerP2Tailed?: number;
  henselerSignificant?: boolean;
  parametricT: number;
  parametricDf: number;
  parametricP: number;
  parametricSignificant: boolean;
  welchT: number;
  welchDf: number;
  welchP: number;
  welchSignificant: boolean;
  ciLowerA?: number;
  ciUpperA?: number;
  ciLowerB?: number;
  ciUpperB?: number;
  meanA: number;
  seA: number;
  meanB: number;
  seB: number;
  tValueA?: number;
  pValueA?: number;
  tValueB?: number;
  pValueB?: number;
}

export interface MgaReport {
  id: string;
  reportType: 'mga';
  title: string;
  createdAt: string;
  modelId: string;
  datasetId?: string;
  groupAName: string;
  groupBName: string;
  nA: number;
  nB: number;
  subsamplesRequested: number;
  subsamplesCompletedA: number;
  subsamplesCompletedB: number;
  testType: 'two-tailed' | 'one-tailed';
  significanceLevel: number;
  parallelProcessing?: boolean;
  seed: number;
  plsSettings: PlsSettings;
  pathCoefficients: MgaParamRow[];
  totalIndirectEffects?: MgaParamRow[];
  specificIndirectEffects?: MgaParamRow[];
  totalEffects?: MgaParamRow[];
  outerLoadings: MgaParamRow[];
  outerWeights: MgaParamRow[];
}

export interface MgaReportSummary {
  id: string;
  reportType: 'permutation' | 'mga';
  title: string;
  modelKey?: string;
  datasetId?: string;
  createdAt: string;
}

