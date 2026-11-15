import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  WidthType,
  ImageRun,
} from 'docx';
import { isTauri } from '@tauri-apps/api/core';
import { prepareDiagramSvg, rasterizeDiagram } from './diagram-export';

export interface ReportConfig {
  modelName: string;
  studyName?: string;
  datasetName?: string;
  plsResults: any;
  modelSpec?: any;
  analysisResultsMap?: Record<string, any>;
  svgElement?: SVGSVGElement | null;
  getConstructName?: (id: string) => string;
  getIndicatorName?: (id: string) => string;
  includeDiagram?: boolean;
  includeMeasurement?: boolean;
  includeStructural?: boolean;
  includeCollinearity?: boolean;
  includeFit?: boolean;
  includeAdvanced?: boolean;
  includeSettings?: boolean;
  formatNumber?: (val: any, decimals?: number) => string;
}

export interface ReportSectionData {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
}

/**
 * Sanitizes text for jsPDF's built-in standard Helvetica font (WinAnsiEncoding / 8-bit).
 * Replaces non-ASCII symbols and multi-byte UTF-8 characters (which cause jsPDF font
 * spacing glitches and letter-spreading) with clean, standard ASCII equivalents.
 */
export function sanitizePdfText(str: any): string {
  if (str == null) return '';
  return String(str)
    .replace(/[✓✔]/g, 'Yes')
    .replace(/[✗✘]/g, 'No')
    .replace(/→/g, ' -> ')
    .replace(/←/g, ' <- ')
    .replace(/↔/g, ' <-> ')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/•/g, '|')
    .replace(/β/g, 'Beta')
    .replace(/α/g, 'Alpha')
    .replace(/ρ_?A/gi, 'rho_A')
    .replace(/ρ_?c/gi, 'rho_c')
    .replace(/ρ/g, 'rho')
    .replace(/λ²/g, 'Loading^2')
    .replace(/λ/g, 'Loading')
    .replace(/χ²/g, 'Chi-Square')
    .replace(/R²/g, 'R^2')
    .replace(/f²/g, 'f^2')
    .replace(/²/g, '^2')
    .replace(/×/g, 'x')
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Extracts all report tables and sections from model calculation results.
 */
export function compileReportData(config: ReportConfig): {
  metadata: {
    modelName: string;
    studyName: string;
    datasetName: string;
    timestamp: string;
    nSamples: number;
    iterations: number;
    converged: boolean;
    isConsistent: boolean;
    weighting: string;
  };
  sections: ReportSectionData[];
} {
  const {
    plsResults,
    modelName,
    studyName = 'Study',
    datasetName = 'Dataset',
    formatNumber = (v: any) => (v != null && Number.isFinite(Number(v)) ? Number(v).toFixed(3) : String(v ?? '-')),
  } = config;
  const fmt = formatNumber;

  // Resolve Construct Name (Never show raw internal node IDs)
  const getCName = (id: string): string => {
    if (!id) return '';
    if (config.getConstructName) {
      const name = config.getConstructName(id);
      if (name && !name.startsWith('node_') && !name.startsWith('id_')) return name;
    }
    if (config.modelSpec?.constructs && Array.isArray(config.modelSpec.constructs)) {
      const found = config.modelSpec.constructs.find((c: any) => c.id === id || c.name === id);
      if (found?.name && !found.name.startsWith('node_') && !found.name.startsWith('id_')) return found.name;
    }
    if (plsResults?.construct_names?.[id]) {
      const name = plsResults.construct_names[id];
      if (name && !name.startsWith('node_') && !name.startsWith('id_')) return name;
    }
    if (Array.isArray(plsResults?.latent_variables)) {
      const lv = plsResults.latent_variables.find((v: any) => v.id === id || v.name === id);
      if (lv?.name && !lv.name.startsWith('node_') && !lv.name.startsWith('id_')) return lv.name;
    }
    if (id.includes(' x ')) {
      return id.split(' x ').map(part => getCName(part.trim())).join(' x ');
    }
    return id;
  };

  // Resolve Indicator Name (Never show raw internal indicator IDs)
  const getIName = (id: string): string => {
    if (!id) return '';
    if (config.getIndicatorName) {
      const name = config.getIndicatorName(id);
      if (name && !name.startsWith('id_') && !name.startsWith('ind_')) return name;
    }
    if (config.modelSpec?.indicators && Array.isArray(config.modelSpec.indicators)) {
      const found = config.modelSpec.indicators.find((i: any) => i.id === id || i.column === id || i.name === id);
      if (found?.column || found?.name) return found.column || found.name;
    }
    if (plsResults?.indicator_names?.[id]) {
      const name = plsResults.indicator_names[id];
      if (name && !name.startsWith('id_') && !name.startsWith('ind_')) return name;
    }
    return id;
  };

  const metadata = {
    modelName: modelName || 'Model',
    studyName: studyName || 'Study',
    datasetName: datasetName || 'Dataset',
    timestamp: new Date().toLocaleString(),
    nSamples: plsResults?.n_samples ?? 0,
    iterations: plsResults?.iterations ?? 0,
    converged: plsResults?.converged !== false,
    isConsistent: !!plsResults?.is_consistent,
    weighting: plsResults?.settings?.inner_weighting || 'Path',
  };

  const sections: ReportSectionData[] = [];

  // 1. Structural Model: Path Coefficients (Direct Effects)
  if (config.includeStructural !== false && plsResults?.structural?.path_coefficients) {
    const rows: string[][] = [];
    const paths = plsResults.structural.path_coefficients || {};
    const f2Map = plsResults.structural.f_squared || {};
    const innerVif = plsResults.structural.inner_vif || {};
    const bootstrapPaths = config.analysisResultsMap?.bootstrap?.structural?.path_coefficients || {};

    Object.entries(paths).forEach(([target, preds]: [string, any]) => {
      Object.entries(preds || {}).forEach(([pred, betaVal]: [string, any]) => {
        const beta = Number(betaVal);
        const f2 = f2Map[target]?.[pred];
        const vif = innerVif[target]?.[pred];
        const boot = bootstrapPaths[target]?.[pred] || {};

        rows.push([
          `${getCName(pred)} -> ${getCName(target)}`,
          fmt(beta),
          boot.mean != null ? fmt(boot.mean) : '-',
          boot.std_error != null ? fmt(boot.std_error) : '-',
          boot.t_statistic != null ? fmt(boot.t_statistic) : '-',
          boot.p_value != null ? (Number(boot.p_value) < 0.001 ? '< 0.001' : fmt(boot.p_value)) : '-',
          f2 != null ? fmt(f2) : '-',
          vif != null ? fmt(vif) : '-',
        ]);
      });
    });

    if (rows.length > 0) {
      sections.push({
        title: 'Path Coefficients (Structural Model - Direct Effects)',
        subtitle: 'Standardized beta coefficients, hypothesis tests, effect sizes (f^2), and inner collinearity (VIF).',
        headers: ['Path', 'Beta', 'Sample Mean', 'Std. Error', 't-Statistic', 'p-Value', 'f^2', 'Inner VIF'],
        rows,
      });
    }
  }

  // 2. Specific Indirect Effects (if mediation analysis was calculated or present in results)
  if (config.includeStructural !== false) {
    const mediationData = config.analysisResultsMap?.mediation || plsResults?.structural?.specific_indirect;
    if (Array.isArray(mediationData) && mediationData.length > 0) {
      const rows: string[][] = [];
      mediationData.forEach((item: any) => {
        const pathStr = Array.isArray(item.path)
          ? item.path.map(getCName).join(' -> ')
          : String(item.path || item.name || '').split('->').map((p: string) => getCName(p.trim())).join(' -> ');
        rows.push([
          pathStr,
          item.beta != null ? fmt(item.beta) : (item.estimate != null ? fmt(item.estimate) : '-'),
          item.mean != null ? fmt(item.mean) : '-',
          item.std_error != null ? fmt(item.std_error) : '-',
          item.t_statistic != null ? fmt(item.t_statistic) : '-',
          item.p_value != null ? (Number(item.p_value) < 0.001 ? '< 0.001' : fmt(item.p_value)) : '-',
        ]);
      });
      if (rows.length > 0) {
        sections.push({
          title: 'Specific Indirect Effects (Mediation)',
          subtitle: 'Specific indirect path estimates and significance through intermediary mediating constructs.',
          headers: ['Specific Indirect Path', 'Indirect Beta', 'Sample Mean', 'Std. Error', 't-Statistic', 'p-Value'],
          rows,
        });
      }
    }
  }

  // 3. Endogenous Constructs: R-squared and R-squared Adjusted
  if (config.includeStructural !== false && plsResults?.structural?.r_squared) {
    const rows: string[][] = [];
    Object.entries(plsResults.structural.r_squared).forEach(([cid, val]: [string, any]) => {
      const r2 = Number(val);
      const r2Adj = plsResults.structural?.r_squared_adj?.[cid] ?? r2;
      const interp = r2 >= 0.75 ? 'Substantial (>= 0.75)' : r2 >= 0.50 ? 'Moderate (>= 0.50)' : r2 >= 0.25 ? 'Weak (>= 0.25)' : 'Low (< 0.25)';
      rows.push([getCName(cid), fmt(r2), fmt(r2Adj), interp]);
    });

    if (rows.length > 0) {
      sections.push({
        title: 'Explained Variance (R^2 and Adjusted R^2)',
        subtitle: 'Proportion of variance explained for each endogenous latent construct (Hair et al., 2022).',
        headers: ['Endogenous Construct', 'R^2', 'Adjusted R^2', 'Interpretation'],
        rows,
      });
    }
  }

  // 4. Indirect & Total Effects
  if (config.includeStructural !== false && Array.isArray(plsResults?.structural?.effects)) {
    const indirectRows: string[][] = [];
    const totalRows: string[][] = [];

    plsResults.structural.effects.forEach((eff: any) => {
      const pathLabel = `${getCName(eff.from)} -> ${getCName(eff.to)}`;
      if (eff.indirect != null && Number(eff.indirect) !== 0) {
        indirectRows.push([pathLabel, fmt(eff.indirect)]);
      }
      totalRows.push([pathLabel, fmt(eff.direct ?? 0), fmt(eff.indirect ?? 0), fmt(eff.total ?? 0)]);
    });

    if (indirectRows.length > 0) {
      sections.push({
        title: 'Total Indirect Effects',
        subtitle: 'Mediated structural relationships across all intermediary constructs.',
        headers: ['Relationship', 'Total Indirect Effect (Beta)'],
        rows: indirectRows,
      });
    }

    if (totalRows.length > 0) {
      sections.push({
        title: 'Total Effects (Direct + Indirect)',
        subtitle: 'Overall impact of exogenous constructs on target outcomes.',
        headers: ['Relationship', 'Direct Effect', 'Indirect Effect', 'Total Effect'],
        rows: totalRows,
      });
    }
  }

  // 5. Structural Effect Sizes (f-squared)
  if (config.includeStructural !== false && plsResults?.structural?.f_squared) {
    const f2Rows: string[][] = [];
    Object.entries(plsResults.structural.f_squared).forEach(([target, preds]: [string, any]) => {
      Object.entries(preds || {}).forEach(([pred, val]: [string, any]) => {
        const f2 = Number(val);
        const interp = f2 >= 0.35 ? 'Large (>= 0.35)' : f2 >= 0.15 ? 'Medium (>= 0.15)' : f2 >= 0.02 ? 'Small (>= 0.02)' : 'No Effect (< 0.02)';
        f2Rows.push([getCName(pred), getCName(target), fmt(f2), interp]);
      });
    });

    if (f2Rows.length > 0) {
      sections.push({
        title: 'f^2 Effect Sizes',
        subtitle: 'Impact of omitting an exogenous construct on endogenous R^2 (Cohen, 1988: 0.02 small, 0.15 medium, 0.35 large).',
        headers: ['Predictor Construct', 'Target Construct', 'f^2 Effect Size', 'Evaluation'],
        rows: f2Rows,
      });
    }
  }

  // 6. Measurement Model: Construct Reliability and Convergent Validity
  if (config.includeMeasurement !== false && (plsResults?.reliability_and_validity || plsResults?.construct_reliability)) {
    const rv = plsResults.reliability_and_validity || plsResults.construct_reliability || {};
    const rows: string[][] = [];
    const constructs = Array.isArray(plsResults?.latent_variables) ? plsResults.latent_variables : Object.keys(rv.ave || {});

    constructs.forEach((c: any) => {
      const cid = typeof c === 'string' ? c : c.id || c.name;
      const isFormative = typeof c === 'object' && String(c.type || '').toLowerCase() === 'formative';
      const alpha = isFormative ? null : rv.cronbachs_alpha?.[cid];
      const cr = isFormative ? null : rv.composite_reliability?.[cid];
      const rhoA = isFormative ? null : rv.rho_a?.[cid];
      const ave = isFormative ? null : rv.ave?.[cid];

      let evalText = 'Meets criteria';
      if (isFormative) evalText = 'Formative construct (N/A)';
      else if (cr != null && ave != null) {
        if (cr < 0.70 || ave < 0.50) evalText = 'Caution: Below threshold';
      }

      rows.push([
        getCName(cid),
        alpha != null ? fmt(alpha) : '-',
        rhoA != null ? fmt(rhoA) : '-',
        cr != null ? fmt(cr) : '-',
        ave != null ? fmt(ave) : '-',
        evalText,
      ]);
    });

    if (rows.length > 0) {
      sections.push({
        title: 'Construct Reliability and Convergent Validity',
        subtitle: 'Evaluation of internal consistency reliability (Alpha, rho_A, Composite Reliability >= 0.70) and convergent validity (AVE >= 0.50).',
        headers: ['Construct', "Cronbach's Alpha", 'rho_A', 'Composite Reliability (CR)', 'AVE', 'Assessment'],
        rows,
      });
    }
  }

  // 7. Discriminant Validity: HTMT (Heterotrait-Monotrait Ratio)
  if (config.includeMeasurement !== false) {
    const htmt = plsResults?.reliability_and_validity?.htmt || plsResults?.discriminant_validity?.htmt;
    if (htmt && typeof htmt === 'object') {
      const cids = Object.keys(htmt);
      if (cids.length > 0) {
        const rows: string[][] = [];
        for (let i = 0; i < cids.length; i++) {
          for (let j = i + 1; j < cids.length; j++) {
            const c1 = cids[i];
            const c2 = cids[j];
            const val = htmt[c1]?.[c2] ?? htmt[c2]?.[c1];
            if (val !== undefined && val !== null) {
              const num = Number(val);
              const status = num < 0.85 ? 'Established (< 0.85)' : num < 0.90 ? 'Acceptable (< 0.90)' : 'Potential Issue (>= 0.90)';
              rows.push([getCName(c1), getCName(c2), fmt(num), status]);
            }
          }
        }

        if (rows.length > 0) {
          sections.push({
            title: 'Discriminant Validity: Heterotrait-Monotrait Ratio (HTMT)',
            subtitle: 'HTMT values must be strictly below 0.85 (conservative) or 0.90 (liberal) to confirm discriminant validity (Henseler et al., 2015).',
            headers: ['Construct 1', 'Construct 2', 'HTMT Ratio', 'Evaluation (< 0.85 / 0.90)'],
            rows,
          });
        }
      }
    }
  }

  // 8. Discriminant Validity: Fornell-Larcker Criterion
  if (config.includeMeasurement !== false) {
    const fl = plsResults?.reliability_and_validity?.fornell_larcker || plsResults?.discriminant_validity?.fornell_larcker;
    if (fl && typeof fl === 'object') {
      const cids = Object.keys(fl);
      if (cids.length > 0) {
        const headers = ['Construct', ...cids.map(getCName)];
        const rows: string[][] = [];

        cids.forEach(rId => {
          const rowCells = [getCName(rId)];
          cids.forEach(cId => {
            const val = fl[rId]?.[cId] ?? fl[cId]?.[rId];
            rowCells.push(val != null ? fmt(val) : '-');
          });
          rows.push(rowCells);
        });

        sections.push({
          title: 'Discriminant Validity: Fornell-Larcker Criterion',
          subtitle: 'The square root of AVE (on diagonal) must be strictly greater than inter-construct correlations (Fornell & Larcker, 1981).',
          headers,
          rows,
        });
      }
    }
  }

  // 9. Discriminant Validity: Cross Loadings
  if (config.includeMeasurement !== false) {
    const cross = plsResults?.measurement?.cross_loadings || plsResults?.reliability_and_validity?.cross_loadings;
    if (cross && typeof cross === 'object') {
      const indKeys = Object.keys(cross);
      if (indKeys.length > 0) {
        const cids = Array.from(new Set(indKeys.flatMap(k => Object.keys(cross[k] || {}))));
        if (cids.length > 0) {
          const headers = ['Indicator', ...cids.map(getCName)];
          const rows: string[][] = [];

          indKeys.forEach(iid => {
            const rowCells = [getIName(iid)];
            cids.forEach(cid => {
              const val = cross[iid]?.[cid];
              rowCells.push(val != null ? fmt(val) : '-');
            });
            rows.push(rowCells);
          });

          sections.push({
            title: 'Discriminant Validity: Cross Loadings',
            subtitle: 'Indicator loadings on their assigned construct should be higher than all cross-loadings on other constructs.',
            headers,
            rows,
          });
        }
      }
    }
  }

  // 10. Measurement Model: Outer Loadings and Indicator Reliability
  if (config.includeMeasurement !== false && plsResults?.measurement?.outer_loadings) {
    const loadings = plsResults.measurement.outer_loadings;
    const rows: string[][] = [];

    Object.entries(loadings).forEach(([cid, inds]: [string, any]) => {
      Object.entries(inds || {}).forEach(([iid, val]: [string, any]) => {
        const load = Number(val);
        const rel = plsResults.measurement?.indicator_reliability?.[cid]?.[iid] ?? load * load;
        const interp = load >= 0.708 ? 'Acceptable (>= 0.708)' : load >= 0.50 ? 'Marginal (0.50-0.70)' : 'Review / Drop (< 0.50)';
        rows.push([getCName(cid), getIName(iid), fmt(load), fmt(rel), interp]);
      });
    });

    if (rows.length > 0) {
      sections.push({
        title: 'Outer Loadings and Indicator Reliability',
        subtitle: 'Standardized indicator outer loadings and reliability (squared loading >= 0.50).',
        headers: ['Construct', 'Indicator', 'Outer Loading', 'Indicator Reliability (Loading^2)', 'Assessment'],
        rows,
      });
    }
  }

  // 11. Measurement Model: Outer Weights
  if (config.includeMeasurement !== false && plsResults?.measurement?.outer_weights) {
    const weights = plsResults.measurement.outer_weights;
    const rows: string[][] = [];

    Object.entries(weights).forEach(([cid, inds]: [string, any]) => {
      Object.entries(inds || {}).forEach(([iid, val]: [string, any]) => {
        const w = Number(val);
        rows.push([getCName(cid), getIName(iid), fmt(w)]);
      });
    });

    if (rows.length > 0) {
      sections.push({
        title: 'Outer Weights',
        subtitle: 'Relative contribution of indicators to their respective construct scores.',
        headers: ['Construct', 'Indicator', 'Outer Weight'],
        rows,
      });
    }
  }

  // 12. Multicollinearity: Inner Model VIF
  if (config.includeCollinearity !== false && plsResults?.structural?.inner_vif) {
    const rows: string[][] = [];
    Object.entries(plsResults.structural.inner_vif).forEach(([target, preds]: [string, any]) => {
      Object.entries(preds || {}).forEach(([pred, val]: [string, any]) => {
        const vif = Number(val);
        const ok = vif < 3.3;
        rows.push([
          getCName(target),
          getCName(pred),
          fmt(vif),
          ok ? 'No Collinearity Issue (VIF < 3.3)' : 'Potential Multicollinearity (VIF >= 3.3)',
        ]);
      });
    });

    if (rows.length > 0) {
      sections.push({
        title: 'Inner Model Collinearity (Inner VIF)',
        subtitle: 'Multicollinearity diagnostics among predictor constructs of endogenous variables (threshold < 3.3 / 5.0).',
        headers: ['Target Construct', 'Predictor Construct', 'Inner VIF', 'Evaluation'],
        rows,
      });
    }
  }

  // 13. Multicollinearity: Outer Model VIF
  if (config.includeCollinearity !== false && plsResults?.measurement?.outer_vif) {
    const rows: string[][] = [];
    Object.entries(plsResults.measurement.outer_vif).forEach(([cid, vifs]: [string, any]) => {
      Object.entries(vifs || {}).forEach(([iid, val]: [string, any]) => {
        const vif = Number(val);
        const ok = vif < 3.3;
        rows.push([
          getCName(cid),
          getIName(iid),
          fmt(vif),
          ok ? 'No Collinearity Issue (VIF < 3.3)' : 'Potential Multicollinearity (VIF >= 3.3)',
        ]);
      });
    });

    if (rows.length > 0) {
      sections.push({
        title: 'Outer Model Collinearity (Outer VIF)',
        subtitle: 'Multicollinearity diagnostics among indicator items for formative and reflective constructs (threshold < 3.3 / 5.0).',
        headers: ['Construct', 'Indicator', 'Outer VIF', 'Evaluation'],
        rows,
      });
    }
  }

  // 14. Model Fit & Quality Criteria
  if (config.includeFit !== false) {
    const fit = plsResults?.fit || plsResults?.model_fit;
    if (fit && typeof fit === 'object') {
      const sat = fit.saturated_model || fit.saturated || {};
      const est = fit.estimated_model || fit.estimated || {};
      const rows = [
        ['SRMR (Standardized Root Mean Square Residual)', sat.srmr != null ? fmt(sat.srmr) : (fit.srmr != null ? fmt(fit.srmr) : '-'), est.srmr != null ? fmt(est.srmr) : '-', '< 0.08 indicates good model fit'],
        ['d_ULS (Unweighted Least Squares discrepancy)', sat.d_uls != null ? fmt(sat.d_uls) : (fit.d_uls != null ? fmt(fit.d_uls) : '-'), est.d_uls != null ? fmt(est.d_uls) : '-', 'Lower is better (< HI95)'],
        ['d_G (Geodesic discrepancy)', sat.d_g != null ? fmt(sat.d_g) : (fit.d_g != null ? fmt(fit.d_g) : '-'), est.d_g != null ? fmt(est.d_g) : '-', 'Lower is better (< HI95)'],
        ['Chi-Square', sat.chi_square != null ? fmt(sat.chi_square) : (fit.chi_square != null ? fmt(fit.chi_square) : '-'), est.chi_square != null ? fmt(est.chi_square) : '-', 'Reference baseline metric'],
        ['NFI (Normed Fit Index)', sat.nfi != null ? fmt(sat.nfi) : (fit.nfi != null ? fmt(fit.nfi) : '-'), est.nfi != null ? fmt(est.nfi) : '-', '> 0.90 indicates acceptable fit'],
      ];

      sections.push({
        title: 'Model Fit Criteria',
        subtitle: 'Evaluation of exact and approximate model fit for saturated and estimated structural models (Henseler et al., 2016).',
        headers: ['Fit Metric', 'Saturated Model', 'Estimated Model', 'Guideline / Benchmark'],
        rows,
      });
    }
  }

  // 15. Execution Settings and Run Details
  if (config.includeSettings !== false) {
    const settings = plsResults?.settings || {};
    const rows = [
      ['Estimation Algorithm', plsResults?.is_consistent ? 'Consistent PLS (PLSc)' : 'Partial Least Squares (PLS)'],
      ['Structural Weighting Scheme', String(settings.inner_weighting || 'Path weighting').toUpperCase()],
      ['Maximum PLS Iterations', String(settings.max_iter || 300)],
      ['Convergence Tolerance', String(settings.tolerance || '1.0e-7')],
      ['Actual Iterations to Convergence', String(plsResults?.iterations || '-')],
      ['Convergence Status', plsResults?.converged !== false ? 'Converged successfully' : 'Did not converge'],
      ['Sample Size (Observations N)', String(plsResults?.n_samples || '-')],
      ['Missing Value Treatment', String(settings.missing_treatment || 'Indicator mean replacement')],
      ['Report Generation Date', metadata.timestamp],
    ];

    sections.push({
      title: 'Algorithm & Execution Settings',
      subtitle: 'Complete technical run parameters and convergence diagnostics.',
      headers: ['Configuration Parameter', 'Value'],
      rows,
    });
  }

  return { metadata, sections };
}

/**
 * Generates a clean PNG Data URL from the live SVG model canvas with true full bounding box.
 */
async function captureDiagramDataUrl(svgElement: SVGSVGElement | null): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!svgElement) return null;
  try {
    const bounds = svgElement.getBoundingClientRect();
    const width = Math.max(Math.round(bounds.width), 800);
    const height = Math.max(Math.round(bounds.height), 500);

    const prepared = prepareDiagramSvg(svgElement, {
      width,
      height,
      appearance: 'color',
      background: 'white',
      includeIndicators: true,
    });

    const finalW = Number(prepared.getAttribute('width')) || width;
    const finalH = Number(prepared.getAttribute('height')) || height;

    const svgBlob = new Blob([new XMLSerializer().serializeToString(prepared)], { type: 'image/svg+xml;charset=utf-8' });
    const rasterBlob = await rasterizeDiagram(svgBlob, finalW * 2, finalH * 2, 'png');

    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({
          dataUrl: reader.result as string,
          width: finalW,
          height: finalH,
        });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(rasterBlob);
    });
  } catch (err) {
    console.warn('Could not rasterize diagram for report:', err);
    return null;
  }
}

/**
 * Downloads or saves a file across Web and Desktop (Tauri).
 */
async function saveReportFile(blob: Blob, filename: string, filterName: string, ext: string): Promise<void> {
  if (isTauri()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const destination = await save({
        defaultPath: filename,
        filters: [{ name: filterName, extensions: [ext] }],
      });
      if (!destination) return;
      const { writeFile } = await import('@tauri-apps/plugin-fs');
      await writeFile(destination, new Uint8Array(await blob.arrayBuffer()));
      return;
    } catch (err) {
      console.warn('Tauri save failed, falling back to browser download:', err);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * ═══ EXPORT PDF REPORT ═══
 * Generates a publication-quality PDF report with cover, diagram, and all tables.
 */
export async function exportPdfReport(config: ReportConfig): Promise<void> {
  const { metadata, sections } = compileReportData(config);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  let diagramInfo: { dataUrl: string; width: number; height: number } | null = null;
  if (config.includeDiagram !== false && config.svgElement) {
    diagramInfo = await captureDiagramDataUrl(config.svgElement);
  }

  // --- Title / Header Banner ---
  doc.setFillColor(30, 41, 59); // Slate-800
  doc.rect(margin, margin, contentWidth, 68, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(sanitizePdfText('StatSEM | PLS-SEM Analysis Report'), margin + 16, margin + 28);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225);
  doc.text(
    sanitizePdfText(`Model: ${metadata.modelName}  |  Study: ${metadata.studyName}  |  Generated: ${metadata.timestamp}`),
    margin + 16,
    margin + 48
  );

  let cursorY = margin + 84;

  // --- Executive Summary Box ---
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, cursorY, contentWidth, 48, 4, 4, 'FD');

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'bold');
  doc.text('SAMPLE SIZE', margin + 14, cursorY + 18);
  doc.text('ESTIMATION', margin + 110, cursorY + 18);
  doc.text('CONVERGENCE', margin + 230, cursorY + 18);
  doc.text('ITERATIONS', margin + 350, cursorY + 18);
  doc.text('WEIGHTING', margin + 440, cursorY + 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`N = ${metadata.nSamples}`, margin + 14, cursorY + 36);
  doc.text(metadata.isConsistent ? 'Consistent PLS' : 'Standard PLS', margin + 110, cursorY + 36);
  doc.setTextColor(metadata.converged ? 22 : 220, metadata.converged ? 101 : 38, metadata.converged ? 52 : 38);
  doc.text(metadata.converged ? 'Converged' : 'Not Converged', margin + 230, cursorY + 36);
  doc.setTextColor(15, 23, 42);
  doc.text(`${metadata.iterations} passes`, margin + 350, cursorY + 36);
  doc.text(sanitizePdfText(metadata.weighting), margin + 440, cursorY + 36);

  cursorY += 62;

  // --- Model Diagram (Embedded with preserved aspect ratio) ---
  if (diagramInfo) {
    try {
      const boxWidth = contentWidth - 24;
      const aspect = diagramInfo.width / Math.max(diagramInfo.height, 1);
      const maxImgHeight = 240;
      let imgWidth = boxWidth;
      let imgHeight = imgWidth / aspect;
      if (imgHeight > maxImgHeight) {
        imgHeight = maxImgHeight;
        imgWidth = imgHeight * aspect;
      }
      const imgX = margin + 12 + (boxWidth - imgWidth) / 2;
      const cardHeight = imgHeight + 36;

      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, cursorY, contentWidth, cardHeight, 4, 4, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(30, 41, 59);
      doc.text('Structural and Measurement Model Diagram', margin + 12, cursorY + 16);

      doc.addImage(diagramInfo.dataUrl, 'PNG', imgX, cursorY + 24, imgWidth, imgHeight, undefined, 'FAST');
      cursorY += cardHeight + 20;
    } catch (e) {
      console.warn('Failed to embed diagram in PDF:', e);
    }
  }

  // --- Render Sections via AutoTable ---
  sections.forEach((section, sIdx) => {
    // If we're near the bottom of page, advance to new page
    if (cursorY > pageHeight - 120) {
      doc.addPage();
      cursorY = margin + 10;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text(sanitizePdfText(`${sIdx + 1}. ${section.title}`), margin, cursorY);
    cursorY += 14;

    if (section.subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(sanitizePdfText(section.subtitle), margin, cursorY);
      cursorY += 12;
    }

    const sanitizedHeaders = section.headers.map(sanitizePdfText);
    const sanitizedRows = section.rows.map(row => row.map(sanitizePdfText));

    autoTable(doc, {
      startY: cursorY,
      head: [sanitizedHeaders],
      body: sanitizedRows,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: {
        fontSize: 8.5,
        cellPadding: 5,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [51, 65, 85],
        fontStyle: 'bold',
        lineWidth: 0.5,
        lineColor: [203, 213, 225],
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      didDrawPage: () => {
        const pageNum = (doc as any).internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);

        // Header
        doc.text(sanitizePdfText(`StatSEM | PLS-SEM Report: ${metadata.modelName}`), margin, 24);
        doc.text(sanitizePdfText(metadata.timestamp), pageWidth - margin, 24, { align: 'right' });

        // Footer
        doc.text(`Page ${pageNum}`, pageWidth / 2, pageHeight - 20, { align: 'center' });
      },
    });

    cursorY = (doc as any).lastAutoTable.finalY + 24;
  });

  const pdfBlob = doc.output('blob');
  const filename = `${metadata.modelName.replace(/[\\/:*?"<>|\s]+/g, '_')}_PLS_Report.pdf`;
  await saveReportFile(pdfBlob, filename, 'PDF Document', 'pdf');
}

/**
 * ═══ EXPORT WORD (DOCX) REPORT ═══
 * Generates an editable Microsoft Word document (.docx) with formatted tables and diagram.
 */
export async function exportDocxReport(config: ReportConfig): Promise<void> {
  const { metadata, sections } = compileReportData(config);

  let diagramBytes: Uint8Array | null = null;
  let diagramAspect = 1.6;
  if (config.includeDiagram !== false && config.svgElement) {
    try {
      const diagramInfo = await captureDiagramDataUrl(config.svgElement);
      if (diagramInfo) {
        diagramAspect = diagramInfo.width / Math.max(diagramInfo.height, 1);
        const base64 = diagramInfo.dataUrl.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        diagramBytes = bytes;
      }
    } catch (e) {
      console.warn('Failed to extract diagram bytes for DOCX:', e);
    }
  }

  const docChildren: any[] = [];

  // Title & Metadata
  docChildren.push(
    new Paragraph({
      text: 'StatSEM • PLS-SEM Analysis Report',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Model: `, bold: true }),
        new TextRun({ text: `${metadata.modelName}   ` }),
        new TextRun({ text: `Study: `, bold: true }),
        new TextRun({ text: `${metadata.studyName}   ` }),
        new TextRun({ text: `Dataset: `, bold: true }),
        new TextRun({ text: `${metadata.datasetName}` }),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Date Generated: `, bold: true }),
        new TextRun({ text: `${metadata.timestamp}   ` }),
        new TextRun({ text: `Sample Size (N): `, bold: true }),
        new TextRun({ text: `${metadata.nSamples}   ` }),
        new TextRun({ text: `Algorithm: `, bold: true }),
        new TextRun({ text: metadata.isConsistent ? 'Consistent PLS (PLSc)' : 'Standard PLS' }),
      ],
      spacing: { after: 200 },
    })
  );

  // Embedded Diagram
  if (diagramBytes) {
    const docxWidth = 580;
    const docxHeight = Math.round(docxWidth / diagramAspect);
    docChildren.push(
      new Paragraph({
        text: 'Model Diagram',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      }),
      new Paragraph({
        children: [
          new ImageRun({
            data: diagramBytes,
            transformation: {
              width: docxWidth,
              height: Math.min(docxHeight, 400),
            },
          } as any),
        ],
        spacing: { after: 240 },
      })
    );
  }

  // Sections and Tables
  sections.forEach((sec, idx) => {
    docChildren.push(
      new Paragraph({
        text: `${idx + 1}. ${sec.title}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 60 },
      })
    );

    if (sec.subtitle) {
      docChildren.push(
        new Paragraph({
          children: [new TextRun({ text: sec.subtitle, italics: true, color: '64748B' })],
          spacing: { after: 120 },
        })
      );
    }

    const tableRows: TableRow[] = [];

    // Header row
    if (sec.headers.length > 0) {
      tableRows.push(
        new TableRow({
          tableHeader: true,
          children: sec.headers.map(
            h =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF' })] })],
                shading: { fill: '1E293B' },
                margins: { top: 120, bottom: 120, left: 140, right: 140 },
              })
          ),
        })
      );
    }

    // Data rows
    sec.rows.forEach((r, rIdx) => {
      const bg = rIdx % 2 === 1 ? 'F8FAFC' : 'FFFFFF';
      tableRows.push(
        new TableRow({
          children: r.map(
            (c, cIdx) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: c, bold: cIdx === 0 })],
                    alignment: cIdx === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
                  }),
                ],
                shading: { fill: bg },
                margins: { top: 100, bottom: 100, left: 140, right: 140 },
              })
          ),
        })
      );
    });

    docChildren.push(
      new Table({
        rows: tableRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      })
    );

    docChildren.push(new Paragraph({ text: '', spacing: { after: 180 } }));
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const filename = `${metadata.modelName.replace(/[\\/:*?"<>|\s]+/g, '_')}_PLS_Report.docx`;
  await saveReportFile(blob, filename, 'Word Document', 'docx');
}

/**
 * ═══ PRINTABLE / HTML REPORT PREVIEW ═══
 * Opens a print-formatted interactive window or triggers browser print-to-PDF.
 */
export async function openPrintableReport(config: ReportConfig): Promise<void> {
  const { metadata, sections } = compileReportData(config);
  let diagramDataUrl: string | null = null;
  if (config.includeDiagram !== false && config.svgElement) {
    const diag = await captureDiagramDataUrl(config.svgElement);
    if (diag) diagramDataUrl = diag.dataUrl;
  }

  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${metadata.modelName} - PLS-SEM Report</title>
  <style>
    @page { size: A4 portrait; margin: 18mm 16mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      line-height: 1.5;
      padding: 32px;
      max-width: 900px;
      margin: 0 auto;
    }
    .header-banner {
      background: #1e293b;
      color: #ffffff;
      padding: 24px;
      border-radius: 8px;
      margin-bottom: 24px;
    }
    .header-banner h1 { margin: 0 0 6px; font-size: 22px; font-weight: 700; }
    .header-banner p { margin: 0; font-size: 13px; color: #cbd5e1; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 28px;
    }
    .kpi-item span { display: block; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; }
    .kpi-item strong { display: block; font-size: 16px; color: #0f172a; margin-top: 4px; }
    .diagram-container {
      text-align: center;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 32px;
      background: #ffffff;
    }
    .diagram-container img { max-width: 100%; height: auto; border-radius: 4px; }
    .section-title { font-size: 16px; font-weight: 700; margin: 28px 0 4px; color: #1e293b; }
    .section-sub { font-size: 12px; color: #64748b; margin: 0 0 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 24px; page-break-inside: avoid; }
    th { background: #f1f5f9; color: #334155; font-weight: 600; text-align: center; padding: 8px 10px; border: 1px solid #cbd5e1; }
    th:first-child { text-align: left; }
    td { padding: 7px 10px; border: 1px solid #e2e8f0; text-align: center; font-variant-numeric: tabular-nums; }
    td:first-child { text-align: left; font-weight: 500; }
    tr:nth-child(even) { background: #f8fafc; }
    .print-actions { position: fixed; top: 16px; right: 16px; display: flex; gap: 8px; }
    .btn { background: #2563eb; color: #ffffff; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 13px; border: none; cursor: pointer; text-decoration: none; }
    @media print {
      body { padding: 0; }
      .print-actions { display: none !important; }
      .header-banner { border-radius: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="print-actions">
    <button class="btn" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="header-banner">
    <h1>StatSEM • PLS-SEM Analysis Report</h1>
    <p>Model: ${escapeHtml(metadata.modelName)}  |  Study: ${escapeHtml(metadata.studyName)}  |  Dataset: ${escapeHtml(metadata.datasetName)}  |  ${metadata.timestamp}</p>
  </div>
  <div class="kpi-grid">
    <div class="kpi-item"><span>Sample Size</span><strong>N = ${metadata.nSamples}</strong></div>
    <div class="kpi-item"><span>Algorithm</span><strong>${metadata.isConsistent ? 'Consistent PLS' : 'Standard PLS'}</strong></div>
    <div class="kpi-item"><span>Convergence</span><strong>${metadata.converged ? 'Converged' : 'Not Converged'}</strong></div>
    <div class="kpi-item"><span>Weighting</span><strong>${metadata.weighting}</strong></div>
  </div>`;

  if (diagramDataUrl) {
    html += `<div class="diagram-container">
      <h3 style="margin: 0 0 12px; font-size: 14px; text-align: left; color: #334155;">Model Diagram</h3>
      <img src="${diagramDataUrl}" alt="Model Diagram" />
    </div>`;
  }

  sections.forEach((sec, idx) => {
    html += `<div class="section-title">${idx + 1}. ${escapeHtml(sec.title)}</div>`;
    if (sec.subtitle) {
      html += `<div class="section-sub">${escapeHtml(sec.subtitle)}</div>`;
    }
    html += `<table><thead><tr>`;
    sec.headers.forEach(h => {
      html += `<th>${escapeHtml(h)}</th>`;
    });
    html += `</tr></thead><tbody>`;
    sec.rows.forEach(r => {
      html += `<tr>`;
      r.forEach(c => {
        html += `<td>${escapeHtml(c)}</td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table>`;
  });

  html += `</body></html>`;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
