import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Checkbox } from './Checkbox';

export interface AnalysisModalProps {
  isOpen: boolean;
  analysisType: string;
  projectPath: string;
  modelId?: string;
  datasetId?: string;
  spec?: any;
  datasetHeaders?: string[];
  datasetRows?: any[][];
  datasetName?: string;
  onComplete: (type: string, results: any) => void;
  onClose: () => void;
}

const ANALYSIS_TITLES: Record<string, { title: string; subtitle: string }> = {
  consistent_pls: {
    title: 'Consistent PLS-SEM (PLSc)',
    subtitle: 'Dijkstra-Henseler correction for common factor / reflective models',
  },
  blindfolding: {
    title: 'Blindfolding (Q² & q²)',
    subtitle: 'Sample-reuse cross-validated redundancy & predictive relevance',
  },
  mediation: {
    title: 'Mediation Analysis',
    subtitle: 'Zhao, Lynch & Chen (2010) indirect effects, Sobel test & VAF',
  },
  moderation: {
    title: 'Moderation Analysis',
    subtitle: 'Interaction effects, Kenny f² effect size & Simple Slopes analysis',
  },
  quadratic: {
    title: 'Non-linear & Quadratic Effects',
    subtitle: 'Polynomial interaction estimation, turning points & curve visualization',
  },
  ipma: {
    title: 'Importance-Performance Map Analysis (IPMA)',
    subtitle: 'Priority quadrant matrix combining unstandardized total effects and 0-100 performance',
  },
  hcm: {
    title: 'Higher-Order Constructs (HCM)',
    subtitle: 'Repeated-indicators and two-stage approaches for 2nd order models',
  },
  cta: {
    title: 'Confirmatory Tetrad Analysis (CTA-PLS)',
    subtitle: 'Statistical evaluation of reflective vs. formative measurement models',
  },
  micom: {
    title: 'Measurement Invariance (MICOM)',
    subtitle: 'Three-step procedure for configurational, compositional & equality tests',
  },
  mga: {
    title: 'Multigroup Analysis (MGA)',
    subtitle: 'Compare structural paths across groups (PLS-MGA, Permutation, Welch)',
  },
  fimix: {
    title: 'FIMIX-PLS Segmentation',
    subtitle: 'Finite mixture clustering for unobserved heterogeneity',
  },
  pos: {
    title: 'PLS-POS Segmentation',
    subtitle: 'Prediction-oriented segmentation search algorithm',
  },
  otg: {
    title: 'Omnibus Test of Group Differences (OTG)',
    subtitle: 'Simultaneous multigroup testing for K > 2 groups with FWER control (Sarstedt et al. 2011)',
  },
  ex_post: {
    title: 'Ex Post Segmentation Analysis',
    subtitle: 'Cross-tabulation overlap, logistic regression, and explanatory vs latent class comparison',
  },
  predict: {
    title: 'PLSpredict (Out-of-Sample)',
    subtitle: 'k-fold cross-validation compared against naive Linear Model benchmark',
  },
  power: {
    title: 'Sample Size & Statistical Power',
    subtitle: '10-times rule, inverse square root method, and exact power curve solver',
  },
  copula: {
    title: 'Gaussian Copula Endogeneity',
    subtitle: 'Instrument-free empirical CDF inversion test for omitted variable bias',
  },
  nca: {
    title: 'Necessary Condition Analysis (NCA)',
    subtitle: 'CE-FDH and CR-FDH ceiling lines, bottleneck tables & effect size d',
  },
  report: {
    title: 'Generate Executive Report',
    subtitle: 'Publication-ready PDF report with automated APA narrative and summary tables',
  },
};

export const AnalysisModal: React.FC<AnalysisModalProps> = ({
  isOpen,
  analysisType,
  projectPath,
  modelId = 'default',
  datasetId,
  spec,
  datasetHeaders = [],
  datasetRows = [],
  datasetName,
  onComplete,
  onClose,
}) => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form states
  const [source, setSource] = useState<string>('');
  const [moderator, setModerator] = useState<string>('');
  const [target, setTarget] = useState<string>('');
  const [method, setMethod] = useState<string>('two_stage');
  const [nBoot, setNBoot] = useState<number>(500);
  const [seed, setSeed] = useState<number>(42);
  const [alpha, setAlpha] = useState<number>(0.05);
  const [omissionDistance, setOmissionDistance] = useState<number>(7);
  const [computeQ2Effects, setComputeQ2Effects] = useState<boolean>(true);
  const [includeSobel, setIncludeSobel] = useState<boolean>(true);
  const [groupCol, setGroupCol] = useState<string>('');
  const [groupVal1, setGroupVal1] = useState<string>('');
  const [groupVal2, setGroupVal2] = useState<string>('');
  const [nPermutations, setNPermutations] = useState<number>(500);
  const [minSegments, setMinSegments] = useState<number>(1);
  const [maxSegments, setMaxSegments] = useState<number>(4);
  const [nSegments, setNSegments] = useState<number>(2);
  const [kFolds, setKFolds] = useState<number>(10);
  const [repetitions, setRepetitions] = useState<number>(10);
  const [hocId, setHocId] = useState<string>('');
  const [locIds, setLocIds] = useState<string[]>([]);
  const [hocType, setHocType] = useState<string>('RR');
  const [approach, setApproach] = useState<string>('repeated_indicators');
  const [reportTitle, setReportTitle] = useState<string>('PLS-SEM Analysis Report');
  const [reportAuthor, setReportAuthor] = useState<string>('SmartPLS Desktop');

  // Extract constructs from spec
  const constructs: Array<{ id: string; name: string }> = React.useMemo(() => {
    if (!spec?.constructs) return [];
    return spec.constructs.map((c: any) => ({
      id: c.id || c.name,
      name: c.name || c.id,
    }));
  }, [spec]);

  // Set intelligent defaults when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsRunning(false);
      setErrorMsg(null);
      if (constructs.length >= 2) {
        setSource(constructs[0]?.id || '');
        setTarget(constructs[constructs.length - 1]?.id || constructs[1]?.id || '');
        if (constructs.length >= 3) {
          setModerator(constructs[1]?.id || '');
        }
      }
      if (datasetHeaders.length > 0) {
        // Look for common group column names
        const candidateGroup = datasetHeaders.find(h =>
          /group|gender|sex|cohort|type|segment|class/i.test(h)
        ) || datasetHeaders[0];
        setGroupCol(candidateGroup || '');
      }
      if (constructs.length >= 2) {
        setHocId(constructs[0]?.id || '');
        setLocIds(constructs.slice(1, 3).map(c => c.id));
      }
    }
  }, [isOpen, analysisType, constructs, datasetHeaders]);

  if (!isOpen) return null;

  const meta = ANALYSIS_TITLES[analysisType] || {
    title: 'Advanced Analysis',
    subtitle: 'Run specialized PLS-SEM estimation',
  };

  const handleRun = async () => {
    setIsRunning(true);
    setErrorMsg(null);

    try {
      let res: any = null;

      switch (analysisType) {
        case 'consistent_pls': {
          res = await api.runPlsModel(projectPath, spec, {
            scheme: 'path',
            columns: datasetHeaders,
            rows: datasetRows,
            dataset_name: datasetName,
            model_id: modelId,
          });
          break;
        }
        case 'blindfolding': {
          res = await api.runBlindfolding({
            projectPath,
            modelId,
            datasetId,
            omissionDistance,
            computeQ2Effects,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'mediation': {
          if (!source || !target || source === target) {
            throw new Error('Please select different source and target constructs.');
          }
          res = await api.analyzeMediation({
            projectPath,
            modelId,
            source,
            target,
            datasetId,
            nBoot,
            seed,
            alpha,
            includeSobel,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'moderation': {
          if (!source || !moderator || !target || source === moderator || source === target) {
            throw new Error('Please select valid, distinct source, moderator, and target constructs.');
          }
          res = await api.analyzeModeration({
            projectPath,
            modelId,
            source,
            moderator,
            target,
            datasetId,
            method,
            nBoot,
            seed,
            alpha,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'quadratic': {
          if (!source || !target || source === target) {
            throw new Error('Please select different source and target constructs.');
          }
          res = await api.analyzeQuadratic({
            projectPath,
            modelId,
            source,
            target,
            datasetId,
            nBoot,
            seed,
            alpha,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'ipma': {
          if (!target) {
            throw new Error('Please select a target construct.');
          }
          res = await api.analyzeIpma({
            projectPath,
            modelId,
            target,
            datasetId,
            level: 'both',
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'hcm': {
          if (!hocId || locIds.length < 2) {
            throw new Error('Please choose a HOC and at least 2 Lower-Order Constructs (LOCs).');
          }
          res = await api.analyzeHcm({
            projectPath,
            modelId,
            hocId,
            locIds,
            datasetId,
            hocType,
            approach,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'cta': {
          res = await api.analyzeCta({
            projectPath,
            modelId,
            constructId: source || undefined,
            datasetId,
            nBoot,
            seed,
            alpha,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'micom': {
          if (!groupCol) throw new Error('Please select a group variable.');
          const gVals = groupVal1 && groupVal2 ? [groupVal1, groupVal2] : undefined;
          res = await api.analyzeMicom({
            projectPath,
            modelId,
            groupCol,
            groupValues: gVals,
            datasetId,
            nPermutations,
            alpha,
            seed,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'mga': {
          if (!groupCol) throw new Error('Please select a group variable.');
          const gVals = groupVal1 && groupVal2 ? [groupVal1, groupVal2] : undefined;
          res = await api.analyzeMga({
            projectPath,
            modelId,
            groupCol,
            groupValues: gVals,
            datasetId,
            nBoot,
            nPermutations,
            seed,
            alpha,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'fimix': {
          res = await api.analyzeFimix({
            projectPath,
            modelId,
            minSegments,
            maxSegments,
            datasetId,
            seed,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'pos': {
          res = await api.analyzePos({
            projectPath,
            modelId,
            nSegments,
            datasetId,
            seed,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'otg': {
          if (!groupCol) throw new Error('Please select a group variable.');
          res = await api.analyzeOtg({
            projectPath,
            modelId,
            groupCol,
            datasetId,
            nBoot,
            nPermutations,
            seed,
            alpha,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'ex_post': {
          if (!groupCol) throw new Error('Please select an explanatory grouping column.');
          res = await api.analyzeExPost({
            projectPath,
            modelId,
            segmentCol: groupCol,
            explanatoryCols: datasetHeaders.filter(h => h !== groupCol).slice(0, 5),
            crosstabCatCol: groupCol,
            runPosComparison: true,
            minSampleSize: 54,
            datasetId,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'predict': {
          res = await api.analyzePredict({
            projectPath,
            modelId,
            datasetId,
            kFolds,
            repetitions,
            seed,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'power': {
          res = await api.calculatePower({
            rSquared: 0.25,
            targetPower: 0.80,
            alpha: 0.05,
            nPredictors: 3,
          });
          break;
        }
        case 'copula': {
          if (!source || !target) throw new Error('Please select predictor and target constructs.');
          res = await api.analyzeCopula({
            projectPath,
            modelId,
            candidatePredictor: source,
            targetConstruct: target,
            datasetId,
            nBoot: 200,
            seed,
            alpha,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'nca': {
          if (!source || !target) throw new Error('Please select predictor and outcome constructs.');
          res = await api.analyzeNca({
            projectPath,
            modelId,
            predictor: source,
            outcome: target,
            datasetId,
            nPermutations: 500,
            seed,
            alpha,
            spec,
            columns: datasetHeaders,
            rows: datasetRows,
          });
          break;
        }
        case 'report': {
          const blob = await api.exportReportPdf({
            projectPath,
            modelId,
            datasetId,
            projectName: reportTitle,
            modelName: spec?.name || 'Path Model',
            author: reportAuthor,
          });
          if ('error' in blob) {
            throw new Error(blob.error);
          }
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(spec?.name || 'PLS_SEM').replace(/\s+/g, '_')}_Report.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          setIsRunning(false);
          onClose();
          return;
        }
        default:
          throw new Error(`Unsupported analysis type: ${analysisType}`);
      }

      if (res?.error) {
        throw new Error(res.error);
      }

      const resultsData = res?.results || res;
      setIsRunning(false);
      onComplete(analysisType, resultsData);
      onClose();
    } catch (err: any) {
      setIsRunning(false);
      setErrorMsg(err?.message || 'Calculation failed. Please verify inputs.');
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div style={{
        backgroundColor: 'var(--color-bg-base, #ffffff)',
        borderRadius: '14px',
        width: '540px',
        maxWidth: '92vw',
        maxHeight: '90vh',
        boxShadow: 'var(--shadow-float, 0 20px 25px -5px rgba(0, 0, 0, 0.2))',
        border: '1px solid var(--color-border-subtle, #e2e8f0)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid var(--color-border-subtle, #f1f5f9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--color-bg-surface, #f8fafc)',
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary, #0f172a)' }}>
              {meta.title}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--color-text-muted, #64748b)' }}>
              {meta.subtitle}
            </p>
          </div>
          {!isRunning && (
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                color: 'var(--color-text-muted, #94a3b8)',
                padding: '4px 8px',
                borderRadius: '6px',
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          {errorMsg && (
            <div style={{
              backgroundColor: '#fee2e2',
              border: '1px solid #fca5a5',
              color: '#991b1b',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              marginBottom: '16px',
            }}>
              {errorMsg}
            </div>
          )}

          {/* Book 2018 Reference Preset Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            backgroundColor: 'rgba(37, 99, 235, 0.06)',
            border: '1px solid rgba(37, 99, 235, 0.2)',
            borderRadius: '8px',
            marginBottom: '18px',
          }}>
            <div>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#1e40af' }}>
                Hair et al. (2018) Benchmark Standards
              </span>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>
                Quickly apply 5,000 resamples, seed 42, α = 0.05, factor weighting defaults from the textbook.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setNBoot(5000);
                setNPermutations(5000);
                setSeed(42);
                setAlpha(0.05);
                setMethod('two_stage');
                setApproach('repeated_indicators');
              }}
              style={{
                backgroundColor: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Apply Book 2018 Preset
            </button>
          </div>


          {/* Form Controls for Specific Analyses */}
          {analysisType === 'blindfolding' && (
            <div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Omission Distance (D)
                </label>
                <input
                  type="number"
                  value={omissionDistance}
                  onChange={(e) => setOmissionDistance(parseInt(e.target.value) || 7)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                  }}
                />
                <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                  Standard practice is D = 7 (must be between 5 and 12, and sample size N should not be an exact multiple of D).
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                <Checkbox
                  id="computeQ2"
                  checked={computeQ2Effects}
                  onChange={(checked) => setComputeQ2Effects(checked)}
                />
                <label htmlFor="computeQ2" style={{ fontSize: '13px', color: 'var(--color-text-primary, #334155)', cursor: 'pointer' }}>
                  Compute relative q² predictive effect sizes for structural paths
                </label>
              </div>
            </div>
          )}

          {(analysisType === 'mediation' || analysisType === 'quadratic' || analysisType === 'copula' || analysisType === 'nca') && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    {analysisType === 'nca' ? 'Condition (X)' : 'Independent / Predictor (X)'}
                  </label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      backgroundColor: '#fff',
                    }}
                  >
                    {constructs.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    {analysisType === 'nca' ? 'Outcome (Y)' : 'Target Construct (Y)'}
                  </label>
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      backgroundColor: '#fff',
                    }}
                  >
                    {constructs.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                    ))}
                  </select>
                </div>
              </div>

              {analysisType === 'mediation' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                  <Checkbox
                    id="sobelTest"
                    checked={includeSobel}
                    onChange={(checked) => setIncludeSobel(checked)}
                  />
                  <label htmlFor="sobelTest" style={{ fontSize: '13px', color: 'var(--color-text-primary, #334155)', cursor: 'pointer' }}>
                    Include Sobel test z-statistic alongside Zhao et al. bootstrapped decision tree
                  </label>
                </div>
              )}
            </div>
          )}

          {analysisType === 'moderation' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Exogenous Predictor (X)
                  </label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      backgroundColor: '#fff',
                    }}
                  >
                    {constructs.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Moderator Variable (W)
                  </label>
                  <select
                    value={moderator}
                    onChange={(e) => setModerator(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      backgroundColor: '#fff',
                    }}
                  >
                    {constructs.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Target / Endogenous Construct (Y)
                </label>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    backgroundColor: '#fff',
                  }}
                >
                  {constructs.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Moderation Calculation Method
                </label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    backgroundColor: '#fff',
                  }}
                >
                  <option value="two_stage">Two-Stage Approach (Recommended for reflective &amp; formative)</option>
                  <option value="product_indicator">Product-Indicator Approach (Reflective models only)</option>
                  <option value="orthogonalizing">Orthogonalizing Approach (Minimizes collinearity)</option>
                </select>
              </div>
            </div>
          )}

          {analysisType === 'ipma' && (
            <div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Target Key Performance Indicator (Y)
                </label>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    backgroundColor: '#fff',
                  }}
                >
                  {constructs.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                  ))}
                </select>
                <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                  Select the key endogenous outcome construct to evaluate relative importance vs. actual performance.
                </span>
              </div>
            </div>
          )}

          {analysisType === 'hcm' && (
            <div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Higher-Order Construct (HOC)
                </label>
                <select
                  value={hocId}
                  onChange={(e) => setHocId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    backgroundColor: '#fff',
                  }}
                >
                  {constructs.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Lower-Order Dimensions (LOCs)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  {constructs.filter(c => c.id !== hocId).map(c => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                      <Checkbox
                        checked={locIds.includes(c.id)}
                        onChange={(checked) => {
                          if (checked) setLocIds([...locIds, c.id]);
                          else setLocIds(locIds.filter(id => id !== c.id));
                        }}
                      />
                      <span>{c.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Measurement Type
                  </label>
                  <select
                    value={hocType}
                    onChange={(e) => setHocType(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  >
                    <option value="RR">Type I: Reflective-Reflective</option>
                    <option value="RF">Type II: Reflective-Formative</option>
                    <option value="FR">Type III: Formative-Reflective</option>
                    <option value="FF">Type IV: Formative-Formative</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Estimation Approach
                  </label>
                  <select
                    value={approach}
                    onChange={(e) => setApproach(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  >
                    <option value="repeated_indicators">Repeated Indicators</option>
                    <option value="two_stage">Disjoint Two-Stage</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {(analysisType === 'micom' || analysisType === 'mga' || analysisType === 'otg' || analysisType === 'ex_post') && (
            <div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  {analysisType === 'ex_post' ? 'Observable Grouping / Segmentation Variable' : 'Group Variable in Dataset'}
                </label>
                <select
                  value={groupCol}
                  onChange={(e) => setGroupCol(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    backgroundColor: '#fff',
                  }}
                >
                  {datasetHeaders.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Group 1 Label / Value (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 1 or Female"
                    value={groupVal1}
                    onChange={(e) => setGroupVal1(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Group 2 Label / Value (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 2 or Male"
                    value={groupVal2}
                    onChange={(e) => setGroupVal2(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>
              </div>
            </div>
          )}

          {analysisType === 'predict' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  k-Folds Cross-Validation
                </label>
                <input
                  type="number"
                  value={kFolds}
                  onChange={(e) => setKFolds(parseInt(e.target.value) || 10)}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Repetitions
                </label>
                <input
                  type="number"
                  value={repetitions}
                  onChange={(e) => setRepetitions(parseInt(e.target.value) || 10)}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>
          )}

          {analysisType === 'fimix' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Minimum Segments
                </label>
                <input
                  type="number"
                  value={minSegments}
                  onChange={(e) => setMinSegments(parseInt(e.target.value) || 1)}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Maximum Segments
                </label>
                <input
                  type="number"
                  value={maxSegments}
                  onChange={(e) => setMaxSegments(parseInt(e.target.value) || 4)}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>
          )}

          {analysisType === 'report' && (
            <div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Report Document Title
                </label>
                <input
                  type="text"
                  value={reportTitle}
                  onChange={(e) => setReportTitle(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Lead Researcher / Author
                </label>
                <input
                  type="text"
                  value={reportAuthor}
                  onChange={(e) => setReportAuthor(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>
          )}

          {/* Standard Resampling settings for bootstrap-based analyses */}
          {(analysisType === 'mediation' || analysisType === 'moderation' || analysisType === 'quadratic' || analysisType === 'cta' || analysisType === 'mga' || analysisType === 'otg') && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Bootstrap Resamples
                  </label>
                  <select
                    value={nBoot}
                    onChange={(e) => setNBoot(parseInt(e.target.value) || 500)}
                    style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  >
                    <option value={500}>500 (Fast check)</option>
                    <option value={1000}>1,000 (Standard)</option>
                    <option value={2000}>2,000 (Research)</option>
                    <option value={5000}>5,000 (Publication &amp; Hair et al. 2018 Preset)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Random Seed
                  </label>
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(parseInt(e.target.value) || 42)}
                    style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--color-border-subtle, #f1f5f9)',
          backgroundColor: 'var(--color-bg-surface, #f8fafc)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
        }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isRunning}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid var(--color-border-subtle, #cbd5e1)',
              backgroundColor: 'var(--color-bg-base, #ffffff)',
              color: 'var(--color-text-secondary, #475569)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: isRunning ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'var(--color-accent)',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isRunning ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {isRunning ? (
              <>
                <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid #ffffff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span>Running Calculation...</span>
              </>
            ) : (
              <span>{analysisType === 'report' ? 'Download PDF Report' : 'Run Calculation'}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
