export interface InferenceValues {
  standard_error?: number | null;
  se?: number | null;
  t_statistic?: number | null;
  t_stat?: number | null;
  p_value?: number | null;
  ci_lower?: number | null;
  ci_upper?: number | null;
  ci_low?: number | null;
  ci_high?: number | null;
}

export interface IndirectPath extends InferenceValues {
  path: string;
  path_nodes?: string[];
  effect?: number | null;
  original_effect?: number | null;
}

export interface SimpleSlope extends InferenceValues {
  moderator_level?: string;
  slope?: number | null;
}

export interface ModerationEffect {
  id?: string;
  source: string;
  target: string;
  moderator: string;
  interaction_term?: string;
  simple_slopes?: SimpleSlope[];
}

export interface ModerationData {
  moderating_effects?: ModerationEffect[];
  conditional_indirect_effects?: Array<{
    chain?: string;
    moderator: string;
    conditional_effects?: Array<{ w_label?: string; indirect_effect?: number | null }>;
  }>;
}

export interface FitData {
  saturated_model?: { srmr?: number | null; d_uls?: number | null; d_g?: number | null };
  estimated_model?: { srmr?: number | null; d_uls?: number | null; d_g?: number | null };
  srmr_saturated?: number | null; srmr_estimated?: number | null; srmr?: number | null;
  d_uls_saturated?: number | null; d_uls?: number | null;
  d_g_saturated?: number | null; d_g?: number | null;
  rms_theta?: number | null; nfi?: number | null;
  gof?: number | { gof?: number | null } | null;
}

export interface ResultsData {
  fit?: FitData;
  model_fit?: FitData;
  effects_decomposition?: { specific_indirect?: IndirectPath[] };
  structural?: { specific_indirect?: IndirectPath[] };
  significance?: { parameter_summary?: Record<string, InferenceValues> };
  bootstrap?: { parameter_summary?: Record<string, InferenceValues> };
  construct_names?: Record<string, string>;
  moderation?: ModerationData;
  nonlinear_effects?: unknown[];
  quadratic_effects?: unknown[];
  gaussian_copula?: unknown;
  results_pls_original?: ResultsData;
  converged?: boolean;
  iterations?: number;
  n_samples?: number;
  sample_size?: number;
  stop_criterion_history?: number[];
  algorithm?: string;
  is_consistent?: boolean;
}

export interface MediationData { specific_indirect_effects?: IndirectPath[] }
