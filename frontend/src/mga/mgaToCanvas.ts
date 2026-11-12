import type { MgaReport, PermutationReport } from './types';

export function createMgaPlsResults(report: MgaReport | PermutationReport) {
  const isPermutation = report.reportType === 'permutation';
  const pathCoeffs = report.pathCoefficients || [];
  const outerLoadings = report.outerLoadings || [];
  const outerWeights = report.outerWeights || [];

  const structuralDiff: Record<string, Record<string, number>> = {};
  const structuralA: Record<string, Record<string, number>> = {};
  const structuralB: Record<string, Record<string, number>> = {};

  const addPath = (map: Record<string, Record<string, number>>, target: string, source: string, val: number) => {
    if (!target || !source) return;
    const t = target.trim();
    const s = source.trim();
    const targets = Array.from(new Set([t, t.toUpperCase(), t.toLowerCase()]));
    const sources = Array.from(new Set([s, s.toUpperCase(), s.toLowerCase()]));
    for (const tgt of targets) {
      if (!map[tgt]) map[tgt] = {};
      for (const src of sources) {
        map[tgt][src] = val;
      }
    }
  };

  for (const row of pathCoeffs) {
    const diff = isPermutation ? (row as any).originalDifference : (row as any).difference;
    const origA = (row as any).originalA;
    const origB = (row as any).originalB;

    let from = '';
    let to = '';
    if (row.key && row.key.includes('->')) {
      const parts = row.key.split('->');
      if (parts.length >= 2) {
        from = parts[0];
        to = parts[1];
      }
    }
    let pFrom = '';
    let pTo = '';
    if (row.parameter) {
      const parts = row.parameter.split(/\s*→\s*|\s*->\s*/);
      if (parts.length >= 2) {
        pFrom = parts[0];
        pTo = parts[1];
      }
    }

    if (typeof diff === 'number' && Number.isFinite(diff)) {
      if (from && to) addPath(structuralDiff, to, from, diff);
      if (pFrom && pTo) addPath(structuralDiff, pTo, pFrom, diff);
    }
    if (typeof origA === 'number' && Number.isFinite(origA)) {
      if (from && to) addPath(structuralA, to, from, origA);
      if (pFrom && pTo) addPath(structuralA, pTo, pFrom, origA);
    }
    if (typeof origB === 'number' && Number.isFinite(origB)) {
      if (from && to) addPath(structuralB, to, from, origB);
      if (pFrom && pTo) addPath(structuralB, pTo, pFrom, origB);
    }
  }

  const measLoadingsDiff: Record<string, Record<string, number>> = {};
  const measLoadingsA: Record<string, Record<string, number>> = {};
  const measLoadingsB: Record<string, Record<string, number>> = {};

  const addLoading = (map: Record<string, Record<string, number>>, construct: string, indicator: string, val: number) => {
    if (!construct || !indicator) return;
    const c = construct.trim();
    const i = indicator.trim();
    const constructs = Array.from(new Set([c, c.toUpperCase(), c.toLowerCase()]));
    const indicators = Array.from(new Set([i, i.toUpperCase(), i.toLowerCase()]));
    for (const cVal of constructs) {
      if (!map[cVal]) map[cVal] = {};
      for (const iVal of indicators) {
        map[cVal][iVal] = val;
      }
    }
  };

  for (const row of outerLoadings) {
    const diff = isPermutation ? (row as any).originalDifference : (row as any).difference;
    const origA = (row as any).originalA;
    const origB = (row as any).originalB;

    const cid = row.construct || '';
    const iid = row.indicator || '';
    const keyParts = row.key && row.key.includes('->') ? row.key.split('->') : [];
    const kCid = keyParts[0] || '';
    const kIid = keyParts[1] || '';

    const applyLoading = (c: string, i: string) => {
      if (!c || !i) return;
      if (typeof diff === 'number' && Number.isFinite(diff)) addLoading(measLoadingsDiff, c, i, diff);
      if (typeof origA === 'number' && Number.isFinite(origA)) addLoading(measLoadingsA, c, i, origA);
      if (typeof origB === 'number' && Number.isFinite(origB)) addLoading(measLoadingsB, c, i, origB);
    };

    if (cid && iid) applyLoading(cid, iid);
    if (kCid && kIid) applyLoading(kCid, kIid);
  }

  const measWeightsDiff: Record<string, Record<string, number>> = {};
  const measWeightsA: Record<string, Record<string, number>> = {};
  const measWeightsB: Record<string, Record<string, number>> = {};

  const addWeight = (map: Record<string, Record<string, number>>, construct: string, indicator: string, val: number) => {
    if (!construct || !indicator) return;
    const c = construct.trim();
    const i = indicator.trim();
    const constructs = Array.from(new Set([c, c.toUpperCase(), c.toLowerCase()]));
    const indicators = Array.from(new Set([i, i.toUpperCase(), i.toLowerCase()]));
    for (const cVal of constructs) {
      if (!map[cVal]) map[cVal] = {};
      for (const iVal of indicators) {
        map[cVal][iVal] = val;
      }
    }
  };

  for (const row of outerWeights) {
    const diff = isPermutation ? (row as any).originalDifference : (row as any).difference;
    const origA = (row as any).originalA;
    const origB = (row as any).originalB;

    const cid = row.construct || '';
    const iid = row.indicator || '';
    const keyParts = row.key && row.key.includes('->') ? row.key.split('->') : [];
    const kCid = keyParts[0] || '';
    const kIid = keyParts[1] || '';

    const applyWeight = (c: string, i: string) => {
      if (!c || !i) return;
      if (typeof diff === 'number' && Number.isFinite(diff)) addWeight(measWeightsDiff, c, i, diff);
      if (typeof origA === 'number' && Number.isFinite(origA)) addWeight(measWeightsA, c, i, origA);
      if (typeof origB === 'number' && Number.isFinite(origB)) addWeight(measWeightsB, c, i, origB);
    };

    if (cid && iid) applyWeight(cid, iid);
    if (kCid && kIid) applyWeight(kCid, kIid);
  }

  return {
    is_mga: true,
    mga_type: report.reportType,
    mga_report: report,
    groupAName: report.groupAName,
    groupBName: report.groupBName,
    active_canvas_mode: 'group_a',
    structural: {
      path_coefficients: structuralA, // Default to Group A (Contract Plan) to match SmartPLS canvas
    },
    measurement: {
      outer_loadings: measLoadingsA,
      outer_weights: measWeightsA,
    },
    structural_diff: {
      path_coefficients: structuralDiff,
    },
    measurement_diff: {
      outer_loadings: measLoadingsDiff,
      outer_weights: measWeightsDiff,
    },
    structural_group_a: {
      path_coefficients: structuralA,
    },
    measurement_group_a: {
      outer_loadings: measLoadingsA,
      outer_weights: measWeightsA,
    },
    structural_group_b: {
      path_coefficients: structuralB,
    },
    measurement_group_b: {
      outer_loadings: measLoadingsB,
      outer_weights: measWeightsB,
    },
    settings: (report as any).plsSettings || {},
    converged: true,
    iterations: 1,
  };
}

export function getMgaCanvasResultForMode(plsResults: any, mode: 'group_a' | 'group_b' | 'difference') {
  if (!plsResults || !plsResults.is_mga) return plsResults;
  if (mode === 'difference') {
    return {
      ...plsResults,
      active_canvas_mode: 'difference',
      structural: plsResults.structural_diff || plsResults.structural,
      measurement: plsResults.measurement_diff || plsResults.measurement,
    };
  }
  if (mode === 'group_b') {
    return {
      ...plsResults,
      active_canvas_mode: 'group_b',
      structural: plsResults.structural_group_b || plsResults.structural,
      measurement: plsResults.measurement_group_b || plsResults.measurement,
    };
  }
  return {
    ...plsResults,
    active_canvas_mode: 'group_a',
    structural: plsResults.structural_group_a || plsResults.structural,
    measurement: plsResults.measurement_group_a || plsResults.measurement,
  };
}
