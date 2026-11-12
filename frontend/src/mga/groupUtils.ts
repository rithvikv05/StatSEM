import type { DataGroup, EligibleGroupColumn, GroupTerm, GroupWarning, PlsSettings, UniqueValueItem } from './types';
import type { ModelCalculationSettings } from '../components/ModelCalculationModal';

// Hair et al. (2014), Table 10.1 — Minimum sample size for 80% statistical power
// Indexed by arrows (2..10), sigLevel (0.01, 0.05, 0.10), R2 (0.10, 0.25, 0.50, 0.75)
export const MIN_N_TABLE: Record<number, Record<'0.01' | '0.05' | '0.10', Record<'0.10' | '0.25' | '0.50' | '0.75', number>>> = {
  2: { '0.01': { '0.10': 158, '0.25': 75, '0.50': 47, '0.75': 38 }, '0.05': { '0.10': 110, '0.25': 52, '0.50': 33, '0.75': 26 }, '0.10': { '0.10': 88, '0.25': 41, '0.50': 26, '0.75': 21 } },
  3: { '0.01': { '0.10': 176, '0.25': 84, '0.50': 53, '0.75': 42 }, '0.05': { '0.10': 124, '0.25': 59, '0.50': 38, '0.75': 30 }, '0.10': { '0.10': 100, '0.25': 48, '0.50': 30, '0.75': 25 } },
  4: { '0.01': { '0.10': 191, '0.25': 91, '0.50': 58, '0.75': 46 }, '0.05': { '0.10': 137, '0.25': 65, '0.50': 42, '0.75': 33 }, '0.10': { '0.10': 111, '0.25': 53, '0.50': 34, '0.75': 27 } },
  5: { '0.01': { '0.10': 205, '0.25': 98, '0.50': 62, '0.75': 50 }, '0.05': { '0.10': 147, '0.25': 70, '0.50': 45, '0.75': 36 }, '0.10': { '0.10': 120, '0.25': 58, '0.50': 37, '0.75': 30 } },
  6: { '0.01': { '0.10': 217, '0.25': 103, '0.50': 66, '0.75': 53 }, '0.05': { '0.10': 157, '0.25': 75, '0.50': 48, '0.75': 39 }, '0.10': { '0.10': 128, '0.25': 62, '0.50': 40, '0.75': 32 } },
  7: { '0.01': { '0.10': 228, '0.25': 109, '0.50': 69, '0.75': 56 }, '0.05': { '0.10': 166, '0.25': 80, '0.50': 51, '0.75': 41 }, '0.10': { '0.10': 136, '0.25': 66, '0.50': 42, '0.75': 35 } },
  8: { '0.01': { '0.10': 238, '0.25': 114, '0.50': 73, '0.75': 59 }, '0.05': { '0.10': 174, '0.25': 84, '0.50': 54, '0.75': 44 }, '0.10': { '0.10': 143, '0.25': 69, '0.50': 45, '0.75': 37 } },
  9: { '0.01': { '0.10': 247, '0.25': 119, '0.50': 76, '0.75': 62 }, '0.05': { '0.10': 181, '0.25': 88, '0.50': 57, '0.75': 46 }, '0.10': { '0.10': 150, '0.25': 73, '0.50': 47, '0.75': 39 } },
  10: { '0.01': { '0.10': 256, '0.25': 123, '0.50': 79, '0.75': 64 }, '0.05': { '0.10': 189, '0.25': 91, '0.50': 59, '0.75': 48 }, '0.10': { '0.10': 156, '0.25': 76, '0.50': 49, '0.75': 41 } },
};

export function lookupMinSampleSize(arrows: number, sigLevel: '0.01' | '0.05' | '0.10', minR2: '0.10' | '0.25' | '0.50' | '0.75'): number {
  const clamped = Math.min(10, Math.max(2, Math.round(arrows || 2)));
  return MIN_N_TABLE[clamped][sigLevel][minR2];
}

export function maxArrowsFromSpec(spec: any): number {
  const paths = spec?.paths || [];
  const counts: Record<string, number> = {};
  for (const p of paths) {
    const to = p?.to || p?.to_node || p?.target;
    if (to) counts[to] = (counts[to] || 0) + 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  return Math.min(10, Math.max(2, max || 2));
}

function isEmptyOrMissing(v: any): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return !Number.isFinite(v) || v === -99;
  const s = String(v).trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  return lower === 'na' || lower === 'nan' || lower === 'null' || s === '-99';
}

function tryNumeric(v: any): number | null {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formatGroupValueLabel(v: any): string {
  const num = tryNumeric(v);
  if (num !== null) {
    if (Math.abs(num - Math.trunc(num)) < 1e-12) {
      const rounded = num === 0 ? 0 : Math.trunc(num);
      return rounded.toFixed(1);
    }
    return String(num);
  }
  return v === null || v === undefined ? '' : String(v).trim();
}

function valuesEqual(cell: any, target: any): boolean {
  if (isEmptyOrMissing(cell) || isEmptyOrMissing(target)) return false;
  const a = tryNumeric(cell);
  const b = tryNumeric(target);
  if (a !== null && b !== null) return Math.abs(a - b) < 1e-12;
  return formatGroupValueLabel(cell) === formatGroupValueLabel(target);
}

function evalTerm(row: any[], columns: string[], term: GroupTerm): boolean {
  const idx = columns.indexOf(term.column);
  if (idx < 0) return false;
  const cell = row[idx];
  if (isEmptyOrMissing(cell)) return false;

  switch (term.operator) {
    case 'is equal to':
      return valuesEqual(cell, term.value1);
    case 'is not equal to':
      return !valuesEqual(cell, term.value1);
    case 'is greater than': {
      const a = tryNumeric(cell);
      const b = tryNumeric(term.value1);
      return a !== null && b !== null && a > b;
    }
    case 'is less than': {
      const a = tryNumeric(cell);
      const b = tryNumeric(term.value1);
      return a !== null && b !== null && a < b;
    }
    case 'is between': {
      const a = tryNumeric(cell);
      const b1 = tryNumeric(term.value1);
      const b2 = tryNumeric(term.value2);
      if (a === null || b1 === null || b2 === null) return false;
      const lo = Math.min(b1, b2);
      const hi = Math.max(b1, b2);
      return a >= lo && a <= hi;
    }
    default:
      return false;
  }
}

export function getGroupRows(columns: string[], rows: any[][], group: DataGroup): { indices: number[]; rows: any[][] } {
  const rowIdSet = group.rowIds ? new Set(group.rowIds) : null;
  if ((!group.terms || group.terms.length === 0) && !rowIdSet) {
    return { indices: [], rows: [] };
  }
  const indices: number[] = [];
  const matched: any[][] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rowIdSet && !rowIdSet.has(i)) continue;
    const row = rows[i];
    const ok =
      !group.terms || group.terms.length === 0
        ? true
        : group.conditionLinkType === 'OR'
          ? group.terms.some(t => evalTerm(row, columns, t))
          : group.terms.every(t => evalTerm(row, columns, t));
    if (ok) {
      indices.push(i);
      matched.push(row);
    }
  }
  return { indices, rows: matched };
}

export function getEligibleGroupColumns(columns: string[], rows: any[][]): EligibleGroupColumn[] {
  const out: EligibleGroupColumn[] = [];
  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const map = new Map<string, UniqueValueItem>();
    let tooMany = false;
    for (let r = 0; r < rows.length; r++) {
      const cell = rows[r]?.[colIdx];
      if (isEmptyOrMissing(cell)) continue;
      const label = formatGroupValueLabel(cell);
      if (!label) continue;
      const existing = map.get(label);
      if (existing) {
        existing.count += 1;
      } else {
        if (map.size >= 20) {
          tooMany = true;
          break;
        }
        const num = tryNumeric(cell);
        map.set(label, { label, raw: num !== null ? num : label, count: 1 });
      }
    }
    if (!tooMany && map.size > 0) {
      const values = Array.from(map.values());
      const allNum = values.every(v => tryNumeric(v.raw) !== null);
      if (allNum) {
        values.sort((a, b) => Number(a.raw) - Number(b.raw));
      } else {
        values.sort((a, b) => a.label.localeCompare(b.label));
      }
      out.push({ name: columns[colIdx], uniqueCount: values.length, values });
    }
  }
  return out;
}

export function generateDataGroupsLocal(
  columns: string[],
  rows: any[][],
  prefix: string,
  selectedColumns: string[],
  minimumCases: number
): { totalCombinations: number; keptCount: number; prunedCount: number; groups: DataGroup[] } {
  const cleanPrefix = prefix.trim() || 'GROUP';
  const chosen: string[] = [];
  for (const c of selectedColumns) {
    const t = c.trim();
    if (!t || t === 'none') continue;
    if (!chosen.includes(t)) chosen.push(t);
  }
  if (chosen.length === 0) {
    return { totalCombinations: 0, keptCount: 0, prunedCount: 0, groups: [] };
  }
  const eligible = getEligibleGroupColumns(columns, rows);
  const perCol = chosen.map(col => eligible.find(e => e.name === col)?.values || []);
  if (perCol.some(v => v.length === 0)) {
    return { totalCombinations: 0, keptCount: 0, prunedCount: 0, groups: [] };
  }

  let combos: Array<Array<{ col: string; item: UniqueValueItem }>> = [[]];
  for (let i = 0; i < chosen.length; i++) {
    const next: Array<Array<{ col: string; item: UniqueValueItem }>> = [];
    for (const prev of combos) {
      for (const item of perCol[i]) {
        next.push([...prev, { col: chosen[i], item }]);
      }
    }
    combos = next;
  }

  const totalCombinations = combos.length;
  const groups: DataGroup[] = [];
  let prunedCount = 0;

  for (const combo of combos) {
    const terms: GroupTerm[] = combo.map(({ col, item }) => ({
      column: col,
      operator: 'is equal to',
      value1: item.raw,
    }));
    const suffix = combo.map(({ col, item }) => `${col}(${item.label})`).join('_');
    const name = `${cleanPrefix}_${suffix}`;
    const candidate: DataGroup = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      conditionLinkType: 'AND',
      terms,
      recordCount: 0,
    };
    const count = getGroupRows(columns, rows, candidate).indices.length;
    if (count === 0 || count < minimumCases) {
      prunedCount += 1;
      continue;
    }
    candidate.recordCount = count;
    groups.push(candidate);
  }

  return {
    totalCombinations,
    keptCount: groups.length,
    prunedCount,
    groups,
  };
}

export function validateDataGroupsLocal(
  groups: DataGroup[],
  arrows: number,
  sigLevel: '0.01' | '0.05' | '0.10',
  minR2: '0.10' | '0.25' | '0.50' | '0.75'
): { minN: number; warnings: GroupWarning[] } {
  const minN = lookupMinSampleSize(arrows, sigLevel, minR2);
  const warnings: GroupWarning[] = [];

  for (const g of groups) {
    if (g.recordCount < minN) {
      warnings.push({
        kind: 'min_sample_size',
        severity: 'warning',
        message: `Group '${g.name}' has ${g.recordCount} cases; the recommended minimum for 80% power is ${minN}.`,
        groupNames: [g.name],
      });
    }
  }

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const nA = groups[i].recordCount;
      const nB = groups[j].recordCount;
      const minSz = Math.min(nA, nB);
      const maxSz = Math.max(nA, nB);
      if (minSz === 0 || maxSz > 1.5 * minSz) {
        warnings.push({
          kind: 'comparable_size',
          severity: 'warning',
          message: `Group sizes for '${groups[i].name}' (n=${nA}) and '${groups[j].name}' (n=${nB}) differ by more than 50% — results of the group comparison may be biased. Consider randomly removing cases from the larger group or collecting more data.`,
          groupNames: [groups[i].name, groups[j].name],
        });
      }
    }
  }

  return { minN, warnings };
}

export type InitialPlsLikeSettings = Partial<ModelCalculationSettings> & {
  consistent?: boolean;
  missing_treatment?: string;
};

export function plsSettingsFromInitial(initial?: InitialPlsLikeSettings): PlsSettings {
  const weighting = initial?.inner_weighting;
  const weightingScheme: PlsSettings['weightingScheme'] =
    weighting === 'centroid' || weighting === 'factor' ? weighting : 'path';
  const maxIterations =
    typeof initial?.max_iter === 'number' && Number.isFinite(initial.max_iter)
      ? Math.min(5000, Math.max(1, Math.round(initial.max_iter)))
      : 5000;
  let stopCriterionExponent = 7;
  if (typeof initial?.tolerance === 'number' && initial.tolerance > 0 && Number.isFinite(initial.tolerance)) {
    const exp = Math.round(-Math.log10(initial.tolerance));
    if (Number.isFinite(exp)) {
      stopCriterionExponent = Math.min(12, Math.max(3, exp));
    }
  }
  const missingTreatment: string | undefined = initial?.missing_treatment;
  const missingValues: PlsSettings['missingValues'] =
    missingTreatment === 'listwise' || missingTreatment === 'casewise'
      ? 'casewise'
      : missingTreatment === 'pairwise'
        ? 'pairwise'
        : 'mean';
  return {
    weightingScheme,
    maxIterations,
    stopCriterionExponent,
    missingValues,
    consistent: Boolean(initial?.consistent),
  };
}

export function checkGroupPairPreflight(
  columns: string[],
  rows: any[][],
  spec: any,
  groupA: DataGroup | undefined,
  groupB: DataGroup | undefined,
  significanceLevel: number
): { blockingError: string | null; warnings: GroupWarning[] } {
  if (!groupA || !groupB || groupA.id === groupB.id) {
    return { blockingError: null, warnings: [] };
  }
  const idxA = getGroupRows(columns, rows, groupA).indices;
  const idxB = getGroupRows(columns, rows, groupB).indices;
  const setA = new Set(idxA);
  const overlapCount = idxB.filter(idx => setA.has(idx)).length;
  if (overlapCount > 0) {
    return {
      blockingError: `Groups '${groupA.name}' and '${groupB.name}' share ${overlapCount} overlapping case(s). Groups must be mutually exclusive.`,
      warnings: [],
    };
  }
  const constructs: any[] = Array.isArray(spec?.constructs) ? spec.constructs : [];
  const maxInds = constructs.reduce(
    (max, c) => Math.max(max, Array.isArray(c?.indicators) ? c.indicators.length : 0),
    1
  );
  const minRequired = Math.max(10, maxInds);
  if (idxA.length < minRequired) {
    return {
      blockingError: `Group '${groupA.name}' has ${idxA.length} case(s), fewer than the required minimum of ${minRequired}.`,
      warnings: [],
    };
  }
  if (idxB.length < minRequired) {
    return {
      blockingError: `Group '${groupB.name}' has ${idxB.length} case(s), fewer than the required minimum of ${minRequired}.`,
      warnings: [],
    };
  }
  const sigStr: '0.01' | '0.05' | '0.10' =
    Math.abs(significanceLevel - 0.01) < 0.005
      ? '0.01'
      : Math.abs(significanceLevel - 0.1) < 0.025
        ? '0.10'
        : '0.05';
  const groupAWithCount = { ...groupA, recordCount: idxA.length };
  const groupBWithCount = { ...groupB, recordCount: idxB.length };
  const { warnings } = validateDataGroupsLocal(
    [groupAWithCount, groupBWithCount],
    maxArrowsFromSpec(spec),
    sigStr,
    '0.10'
  );
  return { blockingError: null, warnings };
}

