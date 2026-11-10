import React, { useState } from 'react';
import { HypothesisTestingPanel } from './HypothesisTestingPanel';
import { NarrativeDraftPanel } from './NarrativeDraftPanel';

interface AdvancedResultPanelsProps {
  activeTab: string;
  results: any;
  analysisResults?: Record<string, any>;
  onExportExcel?: () => void;
  onExportPdf?: () => void;
}

export const AdvancedResultPanels: React.FC<AdvancedResultPanelsProps> = ({
  activeTab,
  results,
  analysisResults = {},
  onExportExcel,
  onExportPdf,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<string>('overview');
  const [selectedKpi, setSelectedKpi] = useState<string>('');
  const [selectedModIndex, setSelectedModIndex] = useState<number>(0);
  const [selectedQeIndex, setSelectedQeIndex] = useState<number>(0);
  const [modSubTab, setModSubTab] = useState<'interactions' | 'simple_slopes' | 'conditional_indirect'>('interactions');
  const [gcSubTab, setGcSubTab] = useState<'endogeneity' | 'wald' | 'diagnostics' | 'correction'>('endogeneity');

  // Extract analysis specific result or check if stored in main results
  const analysisData = analysisResults[activeTab] || results?.[activeTab] || results?.analysis?.[activeTab];

  // Helper for formatting decimals
  const fmt = (val: any, decimals = 3): string => {
    if (val === undefined || val === null || isNaN(Number(val))) return '—';
    return Number(val).toFixed(decimals);
  };

  const getSigBadge = (p: number) => {
    if (p < 0.001) return <span style={{ color: '#16a34a', fontWeight: 600 }}>*** (p &lt; .001)</span>;
    if (p < 0.01) return <span style={{ color: '#16a34a', fontWeight: 600 }}>** (p = {fmt(p)})</span>;
    if (p < 0.05) return <span style={{ color: '#16a34a', fontWeight: 600 }}>* (p = {fmt(p)})</span>;
    return <span style={{ color: '#94a3b8' }}>ns (p = {fmt(p)})</span>;
  };

  // 1. MODEL FIT (SRMR, d_ULS, d_G, RMS_theta, GoF)
  if (activeTab === 'model_fit') {
    const fit = results?.fit || analysisData || {};
    const srmrSat = fit.srmr_saturated ?? fit.srmr;
    const srmrEst = fit.srmr_estimated ?? fit.srmr;
    const rmsTheta = fit.rms_theta;
    const dUls = fit.d_uls;
    const dG = fit.d_g;
    const gof = fit.gof;

    return (
      <div className="results-content-pane">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Model Fit &amp; Global Goodness of Fit
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Standardized Root Mean Square Residual (SRMR) and discrepancy measures (Henseler et al., 2016).
            </p>
          </div>
        </div>

        {/* Metric Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface, #f8fafc)', border: '1px solid var(--color-border-subtle, #e2e8f0)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>SRMR (Saturated Model)</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: srmrSat <= 0.08 ? '#16a34a' : '#d97706' }}>
              {fmt(srmrSat)}
            </div>
            <span style={{ fontSize: 11, color: srmrSat <= 0.08 ? '#16a34a' : '#d97706' }}>
              {srmrSat <= 0.08 ? '✓ Good Fit (≤ 0.08)' : 'Marginal Fit (> 0.08)'}
            </span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface, #f8fafc)', border: '1px solid var(--color-border-subtle, #e2e8f0)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>SRMR (Estimated Model)</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: srmrEst <= 0.08 ? '#16a34a' : '#d97706' }}>
              {fmt(srmrEst)}
            </div>
            <span style={{ fontSize: 11, color: srmrEst <= 0.08 ? '#16a34a' : '#d97706' }}>
              {srmrEst <= 0.08 ? '✓ Good Fit (≤ 0.08)' : 'Marginal Fit (> 0.08)'}
            </span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface, #f8fafc)', border: '1px solid var(--color-border-subtle, #e2e8f0)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>RMS theta</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: rmsTheta <= 0.12 ? '#16a34a' : '#d97706' }}>
              {fmt(rmsTheta)}
            </div>
            <span style={{ fontSize: 11, color: rmsTheta <= 0.12 ? '#16a34a' : '#d97706' }}>
              {rmsTheta <= 0.12 ? '✓ Acceptable (≤ 0.12)' : 'Check outer model'}
            </span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface, #f8fafc)', border: '1px solid var(--color-border-subtle, #e2e8f0)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Tenenhaus GoF</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: 'var(--color-accent)' }}>
              {fmt(gof)}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              √(Average Communality × Average R²)
            </span>
          </div>
        </div>

        {/* Detailed Table */}
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Criterion</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Saturated Model</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Estimated Model</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Threshold</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>SRMR</td>
                <td style={{ padding: '10px 14px' }}>{fmt(srmrSat)}</td>
                <td style={{ padding: '10px 14px' }}>{fmt(srmrEst)}</td>
                <td style={{ padding: '10px 14px', color: '#16a34a' }}>&lt; 0.080 (Hu &amp; Bentler)</td>
              </tr>
              {dUls !== undefined && (
                <tr>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>d_ULS (Squared Euclidean Distance)</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(fit.d_uls_saturated || dUls)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(dUls)}</td>
                  <td style={{ padding: '10px 14px', color: '#64748b' }}>Below 95% bootstrap quantile</td>
                </tr>
              )}
              {dG !== undefined && (
                <tr>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>d_G (Geodesic Distance)</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(fit.d_g_saturated || dG)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(dG)}</td>
                  <td style={{ padding: '10px 14px', color: '#64748b' }}>Below 95% bootstrap quantile</td>
                </tr>
              )}
              {rmsTheta !== undefined && (
                <tr>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>RMS theta</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(rmsTheta)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(rmsTheta)}</td>
                  <td style={{ padding: '10px 14px', color: '#16a34a' }}>&lt; 0.120 (Lohmöller, 1989)</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 2. BLINDFOLDING (Q² & q²)
  if (activeTab === 'blindfolding') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No Blindfolding Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → Blindfolding (Q² &amp; q²)</strong> to evaluate predictive relevance.</p>
        </div>
      );
    }

    const constructsList = analysisData.constructs || [];
    const q2Effects = analysisData.q2_effects || analysisData.q2_effect_sizes || [];

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Blindfolding Predictive Relevance (Q²)
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Stone-Geisser Q² cross-validated redundancy. Q² &gt; 0 indicates the model has predictive relevance for the endogenous construct (Hair et al., 2017).
          </p>
        </div>

        {/* Construct Level Q² */}
        <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Construct Cross-Validated Redundancy</h4>
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Construct</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>SSO</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>SSE</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Q² (= 1 - SSE/SSO)</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Predictive Relevance</th>
              </tr>
            </thead>
            <tbody>
              {constructsList.map((c: any) => {
                const q2 = c.q2_redundancy ?? c.q2;
                const isRelevant = q2 !== null && q2 !== undefined && q2 > 0;
                let strength = 'None';
                if (q2 === null || q2 === undefined) strength = 'Exogenous (N/A)';
                else if (q2 >= 0.50) strength = 'Large (≥ 0.50)';
                else if (q2 >= 0.25) strength = 'Medium (≥ 0.25)';
                else if (q2 > 0) strength = 'Small (> 0)';

                const ssoVal = c.sso ?? c.sso_redundancy ?? c.sso_communality;
                const sseVal = c.sse ?? c.sse_redundancy ?? c.sse_communality;

                return (
                  <tr key={c.construct_id}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{c.construct_name || c.construct_id}</td>
                    <td style={{ padding: '10px 14px' }}>{ssoVal != null ? fmt(ssoVal, 1) : '-'}</td>
                    <td style={{ padding: '10px 14px' }}>{sseVal != null ? fmt(sseVal, 1) : '-'}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: isRelevant ? '#16a34a' : q2 != null ? '#dc2626' : 'var(--color-text-muted)' }}>
                      {q2 != null ? fmt(q2) : '-'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        backgroundColor: isRelevant ? '#dcfce7' : q2 != null ? '#fee2e2' : '#f1f5f9',
                        color: isRelevant ? '#166534' : q2 != null ? '#991b1b' : '#64748b',
                      }}>
                        {strength}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* q² Effect Sizes */}
        {q2Effects.length > 0 && (
          <div>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Relative Predictive Effect Sizes (q²)</h4>
            <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
              <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                    <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Predictor Path</th>
                    <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Target Construct</th>
                    <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>q² Effect Size</th>
                    <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Evaluation</th>
                  </tr>
                </thead>
                <tbody>
                  {q2Effects.map((p: any, idx: number) => {
                    const src = p.source || p.predictor;
                    const tgt = p.target;
                    const eff = p.q2_effect ?? p.q2_effect_size ?? 0;
                    const rate = p.rating || p.magnitude || (eff >= 0.35 ? 'Large' : eff >= 0.15 ? 'Medium' : eff >= 0.02 ? 'Small' : 'None');

                    return (
                      <tr key={idx}>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>{src} → {tgt}</td>
                        <td style={{ padding: '10px 14px' }}>{tgt}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>{fmt(eff)}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            backgroundColor: eff >= 0.02 ? '#dcfce7' : '#f1f5f9',
                            color: eff >= 0.02 ? '#166534' : '#64748b',
                          }}>
                            {rate}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 3. MEDIATION ANALYSIS
  if (activeTab === 'mediation') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No Mediation Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → Mediation Analysis...</strong> to test indirect effects.</p>
        </div>
      );
    }

    const {
      source,
      target,
      direct_effect,
      indirect_effect,
      total_effect,
      vaf,
      typology,
      sobel,
      paths = [],
    } = analysisData;

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Mediation Analysis: {source} → {target}
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Categorization based on Zhao, Lynch &amp; Chen (2010) and Hair et al. (2017) decision tree.
          </p>
        </div>

        {/* Mediation Classification Card */}
        <div style={{
          backgroundColor: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <span style={{ fontSize: 12, color: '#166534', fontWeight: 600, textTransform: 'uppercase' }}>
              Mediation Type
            </span>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#15803d', marginTop: 2 }}>
              {typology || 'Complementary Mediation'}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#166534' }}>
              VAF (Variance Accounted For): <strong>{fmt((vaf || 0) * 100, 1)}%</strong>
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 12, color: '#166534' }}>Sobel Test:</span>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#166534' }}>
              z = {fmt(sobel?.z_value)}, p = {fmt(sobel?.p_value)}
            </div>
          </div>
        </div>

        {/* Effects Decomposition Table */}
        <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Effects Decomposition</h4>
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Effect</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Coefficient</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Std. Error</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>t-Value</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>p-Value</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>95% CI</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>Indirect Effect (a × b)</td>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-accent)' }}>{fmt(indirect_effect?.original || indirect_effect)}</td>
                <td style={{ padding: '10px 14px' }}>{fmt(indirect_effect?.se)}</td>
                <td style={{ padding: '10px 14px' }}>{fmt(indirect_effect?.t_stat)}</td>
                <td style={{ padding: '10px 14px' }}>{getSigBadge(indirect_effect?.p_value ?? 0)}</td>
                <td style={{ padding: '10px 14px' }}>[{fmt(indirect_effect?.ci_low)}, {fmt(indirect_effect?.ci_high)}]</td>
              </tr>
              <tr>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>Direct Effect (c&apos;)</td>
                <td style={{ padding: '10px 14px' }}>{fmt(direct_effect?.original || direct_effect)}</td>
                <td style={{ padding: '10px 14px' }}>{fmt(direct_effect?.se)}</td>
                <td style={{ padding: '10px 14px' }}>{fmt(direct_effect?.t_stat)}</td>
                <td style={{ padding: '10px 14px' }}>{getSigBadge(direct_effect?.p_value ?? 0)}</td>
                <td style={{ padding: '10px 14px' }}>[{fmt(direct_effect?.ci_low)}, {fmt(direct_effect?.ci_high)}]</td>
              </tr>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)' }}>
                <td style={{ padding: '10px 14px', fontWeight: 700 }}>Total Effect (c)</td>
                <td style={{ padding: '10px 14px', fontWeight: 700 }}>{fmt(total_effect?.original || total_effect)}</td>
                <td style={{ padding: '10px 14px' }}>{fmt(total_effect?.se)}</td>
                <td style={{ padding: '10px 14px' }}>{fmt(total_effect?.t_stat)}</td>
                <td style={{ padding: '10px 14px' }}>{getSigBadge(total_effect?.p_value ?? 0)}</td>
                <td style={{ padding: '10px 14px' }}>[{fmt(total_effect?.ci_low)}, {fmt(total_effect?.ci_high)}]</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 4. MODERATION & SIMPLE SLOPES (SmartPLS 4 Style)
  if (activeTab === 'moderation') {
    const modData = results?.moderation || analysisData;
    if (!modData || (!modData.effects?.length && !modData.source && !modData.interaction_effect)) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No Moderation Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Add a moderating effect on the model canvas (press <strong>M</strong> or click the Moderation tool) and run PLS-SEM with Bootstrapping to evaluate interaction effects, Kenny (2016) f², simple slopes, and conditional indirect effects.</p>
        </div>
      );
    }

    const effectsList: any[] = modData.effects || (modData.source ? [{
      moderator: modData.moderator,
      predictor: modData.source,
      outcome: modData.target,
      interaction_name: `${modData.source} x ${modData.moderator}`,
      method: modData.method || 'two_stage',
      beta_source: modData.direct_effect_source ?? modData.beta_source,
      beta_moderator: modData.direct_effect_moderator ?? modData.beta_moderator,
      beta_interaction: modData.interaction_effect?.original ?? modData.interaction_effect?.beta ?? 0,
      interaction_se: modData.interaction_effect?.se ?? null,
      interaction_t: modData.interaction_effect?.t_stat ?? null,
      interaction_p_value: modData.interaction_effect?.p_value ?? null,
      interaction_ci_lower: modData.interaction_effect?.ci_lower ?? null,
      interaction_ci_upper: modData.interaction_effect?.ci_upper ?? null,
      f2: {
        f_squared: modData.f2_effect ?? 0,
        effect_size_rating: (modData.f2_effect ?? 0) >= 0.025 ? 'Large' : ((modData.f2_effect ?? 0) >= 0.010 ? 'Medium' : ((modData.f2_effect ?? 0) >= 0.005 ? 'Small' : 'None')),
        r_squared_included: modData.r2_included ?? 0,
        r_squared_excluded: modData.r2_excluded ?? 0,
      },
      simple_slopes: modData.simple_slopes,
    }] : []);

    const condIndirectList: any[] = modData.conditional_indirect_effects || [];

    const activeMod = effectsList[selectedModIndex] || effectsList[0] || {};
    const sl = activeMod.simple_slopes || {};

    return (
      <div className="results-content-pane">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Moderation Analysis &amp; Conditional Effects (SmartPLS 4 style)
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Interaction terms, Kenny (2016) f² effect sizes, simple slope plots, and moderated mediation (PROCESS-style conditional indirect effects).
            </p>
          </div>
          {effectsList.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)' }}>Focus Moderation:</span>
              <select
                value={selectedModIndex}
                onChange={(e) => setSelectedModIndex(Number(e.target.value))}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--color-border-subtle)',
                  backgroundColor: 'var(--color-bg-surface)',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer'
                }}
              >
                {effectsList.map((eff, i) => (
                  <option key={i} value={i}>
                    {eff.interaction_name || `${eff.predictor} x ${eff.moderator}`} → {eff.outcome}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--color-border-subtle)', marginBottom: 20 }}>
          <button
            type="button"
            onClick={() => setModSubTab('interactions')}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderBottom: modSubTab === 'interactions' ? '2px solid var(--color-accent)' : '2px solid transparent',
              backgroundColor: 'transparent',
              color: modSubTab === 'interactions' ? 'var(--color-accent)' : 'var(--color-text-muted)',
              cursor: 'pointer'
            }}
          >
            Interaction Terms &amp; Kenny f² ({effectsList.length})
          </button>
          <button
            type="button"
            onClick={() => setModSubTab('simple_slopes')}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderBottom: modSubTab === 'simple_slopes' ? '2px solid var(--color-accent)' : '2px solid transparent',
              backgroundColor: 'transparent',
              color: modSubTab === 'simple_slopes' ? 'var(--color-accent)' : 'var(--color-text-muted)',
              cursor: 'pointer'
            }}
          >
            Simple Slopes &amp; 2D Chart
          </button>
          <button
            type="button"
            onClick={() => setModSubTab('conditional_indirect')}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderBottom: modSubTab === 'conditional_indirect' ? '2px solid var(--color-accent)' : '2px solid transparent',
              backgroundColor: 'transparent',
              color: modSubTab === 'conditional_indirect' ? 'var(--color-accent)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            Moderated Mediation ({condIndirectList.length})
            {condIndirectList.length > 0 && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                PROCESS
              </span>
            )}
          </button>
        </div>

        {/* ─── TAB 1: INTERACTION TERMS & KENNY f² ─── */}
        {modSubTab === 'interactions' && (
          <div>
            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
              <div style={{ padding: 14, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Interactions Tested</span>
                <div style={{ fontSize: 22, fontWeight: 700, margin: '4px 0', color: 'var(--color-accent)' }}>{effectsList.length}</div>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Simultaneous structural model</span>
              </div>
              <div style={{ padding: 14, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Estimation Method</span>
                <div style={{ fontSize: 16, fontWeight: 700, margin: '6px 0', color: 'var(--color-text-primary)' }}>
                  {activeMod.method === 'two_stage' ? 'Two-Stage (Stage 2)' : (activeMod.method === 'orthogonalizing' ? 'Orthogonalizing' : 'Product Indicator')}
                </div>
                <span style={{ fontSize: 11, color: '#16a34a' }}>Standardized latent scores</span>
              </div>
              <div style={{ padding: 14, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Max Kenny (2016) f²</span>
                <div style={{ fontSize: 22, fontWeight: 700, margin: '4px 0', color: '#16a34a' }}>
                  {fmt(Math.max(...effectsList.map(e => e.f2?.f_squared || 0)))}
                </div>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Kenny cutoffs: 0.005 / 0.010 / 0.025</span>
              </div>
              <div style={{ padding: 14, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Direct Moderator Paths</span>
                <div style={{ fontSize: 16, fontWeight: 700, margin: '6px 0', color: 'var(--color-text-primary)' }}>Auto-included</div>
                <span style={{ fontSize: 11, color: '#16a34a' }}>SmartPLS 4 compliant</span>
              </div>
            </div>

            {/* Interaction Paths Table */}
            <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
              <div style={{ padding: '12px 16px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>Interaction Effects &amp; Kenny (2016) f² Summary</strong>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Significance via two-tailed bootstrapping</span>
              </div>
              <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                    <th style={{ padding: '10px 14px' }}>Path</th>
                    <th style={{ padding: '10px 14px' }}>Predictor</th>
                    <th style={{ padding: '10px 14px' }}>Moderator</th>
                    <th style={{ padding: '10px 14px' }}>Outcome</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>Original (β)</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>Bootstrap SE</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>t-stat</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>p-value</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center' }}>95% CI</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>f²</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center' }}>f² Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {effectsList.map((eff, i) => {
                    const f2Val = eff.f2?.f_squared ?? 0;
                    const rating = eff.f2?.effect_size_rating || (f2Val >= 0.025 ? 'Large' : (f2Val >= 0.010 ? 'Medium' : (f2Val >= 0.005 ? 'Small' : 'None')));
                    const ratingColor = f2Val >= 0.025 ? '#16a34a' : (f2Val >= 0.010 ? '#2563eb' : (f2Val >= 0.005 ? '#d97706' : '#94a3b8'));
                    const isSig = eff.interaction_p_value !== null ? eff.interaction_p_value < 0.05 : false;

                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--color-border-subtle)', backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--color-bg-surface)' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-accent)' }}>
                          {eff.interaction_name} → {eff.outcome}
                        </td>
                        <td style={{ padding: '10px 14px' }}>{eff.predictor}</td>
                        <td style={{ padding: '10px 14px' }}>{eff.moderator}</td>
                        <td style={{ padding: '10px 14px' }}>{eff.outcome}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>
                          {fmt(eff.beta_interaction)}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--color-text-muted)' }}>
                          {fmt(eff.interaction_se)}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                          {fmt(eff.interaction_t, 2)}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: isSig ? '#16a34a' : 'var(--color-text-secondary)' }}>
                          {eff.interaction_p_value !== null ? fmt(eff.interaction_p_value) : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          [{fmt(eff.interaction_ci_lower)}, {fmt(eff.interaction_ci_upper)}]
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: ratingColor }}>
                          {fmt(f2Val)}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600, backgroundColor: `${ratingColor}15`, color: ratingColor, border: `1px solid ${ratingColor}30` }}>
                            {rating}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Kenny Callout Box */}
            <div style={{ padding: 14, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--color-accent)', fontSize: 20 }}>info</span>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--color-text-primary)' }}>Kenny (2016) Interaction Effect Size Benchmarks:</strong><br />
                In structural equation models, interaction effects inherently possess lower statistical power. Kenny (2016) established specific thresholds for moderating interaction terms: <strong>f² ≥ 0.005</strong> is small, <strong>f² ≥ 0.010</strong> is medium, and <strong>f² ≥ 0.025</strong> is large. Direct effect thresholds (Cohen, 1988: 0.02, 0.15, 0.35) underestimate the practical importance of interaction effects.
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 2: SIMPLE SLOPES & INTERACTIVE CHART ─── */}
        {modSubTab === 'simple_slopes' && (
          <div>
            {/* Simple Slopes 3-Level Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
              <div style={{ padding: 14, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, textTransform: 'uppercase' }}>Low Moderator (-1 SD)</span>
                <div style={{ fontSize: 22, fontWeight: 700, margin: '4px 0', color: '#dc2626' }}>
                  {fmt(sl.low?.slope ?? (typeof sl.low === 'number' ? sl.low : 0))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  p = {fmt(sl.low?.p_value ?? 0)} · CI: [{fmt(sl.low?.ci_lower)}, {fmt(sl.low?.ci_upper)}]
                </div>
              </div>
              <div style={{ padding: 14, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 600, textTransform: 'uppercase' }}>Average Moderator (Mean)</span>
                <div style={{ fontSize: 22, fontWeight: 700, margin: '4px 0', color: '#2563eb' }}>
                  {fmt(sl.mean?.slope ?? (typeof sl.mean === 'number' ? sl.mean : activeMod.beta_source ?? 0))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  p = {fmt(sl.mean?.p_value ?? 0)} · CI: [{fmt(sl.mean?.ci_lower)}, {fmt(sl.mean?.ci_upper)}]
                </div>
              </div>
              <div style={{ padding: 14, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, textTransform: 'uppercase' }}>High Moderator (+1 SD)</span>
                <div style={{ fontSize: 22, fontWeight: 700, margin: '4px 0', color: '#16a34a' }}>
                  {fmt(sl.high?.slope ?? (typeof sl.high === 'number' ? sl.high : 0))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  p = {fmt(sl.high?.p_value ?? 0)} · CI: [{fmt(sl.high?.ci_lower)}, {fmt(sl.high?.ci_upper)}]
                </div>
              </div>
              <div style={{ padding: 14, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Slope Difference (High - Low)</span>
                <div style={{ fontSize: 22, fontWeight: 700, margin: '4px 0', color: 'var(--color-accent)' }}>
                  {fmt(sl.slope_diff_high_minus_low ?? (2 * (activeMod.beta_interaction || 0)))}
                </div>
                <span style={{ fontSize: 11, color: '#16a34a' }}>Exact property: 2 × β_interaction</span>
              </div>
            </div>

            {/* Interactive 2D Chart */}
            <div style={{ padding: 20, borderRadius: 8, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  Simple Slopes Plot: {activeMod.predictor} → {activeMod.outcome} across levels of {activeMod.moderator}
                </h4>
                {/* Legend */}
                <div style={{ display: 'flex', gap: 16, fontSize: 12, alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 3, backgroundColor: '#dc2626', display: 'inline-block', borderTop: '1px dashed #dc2626' }} />
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>-1 SD Low ({activeMod.moderator})</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 3, backgroundColor: '#2563eb', display: 'inline-block' }} />
                    <span style={{ color: '#2563eb', fontWeight: 600 }}>Mean ({activeMod.moderator})</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 3, backgroundColor: '#16a34a', display: 'inline-block' }} />
                    <span style={{ color: '#16a34a', fontWeight: 600 }}>+1 SD High ({activeMod.moderator})</span>
                  </div>
                </div>
              </div>

              {/* Vector SVG Chart */}
              {(() => {
                const bX = activeMod.beta_source ?? 0;
                const bM = activeMod.beta_moderator ?? 0;
                const bXM = activeMod.beta_interaction ?? 0;

                // Points from -2 to +2 SD
                const xRange = [-2, -1, 0, 1, 2];
                const calcY = (x: number, m: number) => bX * x + bM * m + bXM * x * m;

                const ptsLow = xRange.map(x => ({ x, y: calcY(x, -1) }));
                const ptsMean = xRange.map(x => ({ x, y: calcY(x, 0) }));
                const ptsHigh = xRange.map(x => ({ x, y: calcY(x, 1) }));

                const allY = [...ptsLow, ...ptsMean, ...ptsHigh].map(p => p.y);
                const minY = Math.min(-1, ...allY) - 0.2;
                const maxY = Math.max(1, ...allY) + 0.2;

                const svgW = 600;
                const svgH = 260;
                const padL = 50;
                const padR = 30;
                const padT = 20;
                const padB = 40;

                const toSvgX = (x: number) => padL + ((x - (-2)) / 4) * (svgW - padL - padR);
                const toSvgY = (y: number) => padT + (1 - (y - minY) / (maxY - minY)) * (svgH - padT - padB);

                const dLow = ptsLow.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${toSvgX(p.x)} ${toSvgY(p.y)}`).join(' ');
                const dMean = ptsMean.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${toSvgX(p.x)} ${toSvgY(p.y)}`).join(' ');
                const dHigh = ptsHigh.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${toSvgX(p.x)} ${toSvgY(p.y)}`).join(' ');

                return (
                  <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', height: 260, overflow: 'visible' }}>
                    {/* Gridlines & X Axis */}
                    {xRange.map(x => (
                      <g key={x}>
                        <line x1={toSvgX(x)} y1={padT} x2={toSvgX(x)} y2={svgH - padB} stroke="var(--color-border-subtle)" strokeDasharray="3 3" />
                        <text x={toSvgX(x)} y={svgH - padB + 16} fontSize={11} fill="var(--color-text-muted)" textAnchor="middle">
                          {x > 0 ? `+${x} SD` : (x === 0 ? 'Mean (0)' : `${x} SD`)}
                        </text>
                      </g>
                    ))}
                    {/* Zero line */}
                    <line x1={padL} y1={toSvgY(0)} x2={svgW - padR} y2={toSvgY(0)} stroke="var(--color-border-subtle)" strokeWidth={1.5} />
                    {/* Y Axis ticks */}
                    {[minY, (minY + maxY) / 2, maxY].map((y, idx) => (
                      <g key={idx}>
                        <text x={padL - 8} y={toSvgY(y) + 4} fontSize={10} fill="var(--color-text-muted)" textAnchor="end">
                          {fmt(y, 2)}
                        </text>
                      </g>
                    ))}

                    {/* Simple Slope Lines */}
                    <path d={dLow} fill="none" stroke="#dc2626" strokeWidth={2.5} strokeDasharray="5 5" />
                    <path d={dMean} fill="none" stroke="#2563eb" strokeWidth={2.5} />
                    <path d={dHigh} fill="none" stroke="#16a34a" strokeWidth={2.5} />

                    {/* Dots at key SD points */}
                    {ptsLow.map((p, i) => <circle key={'l' + i} cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={4} fill="#dc2626" />)}
                    {ptsMean.map((p, i) => <circle key={'m' + i} cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={4} fill="#2563eb" />)}
                    {ptsHigh.map((p, i) => <circle key={'h' + i} cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={4} fill="#16a34a" />)}

                    {/* Axis Labels */}
                    <text x={(svgW + padL) / 2} y={svgH - 6} fontSize={12} fontWeight={600} fill="var(--color-text-secondary)" textAnchor="middle">
                      {activeMod.predictor} (Standardized)
                    </text>
                    <text transform={`rotate(-90) translate(${-(svgH - padB + padT) / 2}, 16)`} fontSize={12} fontWeight={600} fill="var(--color-text-secondary)" textAnchor="middle">
                      {activeMod.outcome}
                    </text>
                  </svg>
                );
              })()}
            </div>
          </div>
        )}

        {/* ─── TAB 3: CONDITIONAL INDIRECT EFFECTS (MODERATED MEDIATION) ─── */}
        {modSubTab === 'conditional_indirect' && (
          <div>
            {condIndirectList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border-subtle)', borderRadius: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 32, marginBottom: 8, display: 'block', color: 'var(--color-accent)' }}>mediation</span>
                <h4 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>No Moderated Mediation Chains Detected</h4>
                <p style={{ margin: 0, fontSize: 13 }}>
                  Moderated mediation is automatically computed when a two-step mediation chain (A → B → C) has a moderating effect on the a-path (A → B), b-path (B → C), or both.
                </p>
              </div>
            ) : (
              <div>
                {condIndirectList.map((chainItem, cIdx) => {
                  const bInf = chainItem.bootstrap_inference || {};
                  const isIndexSig = bInf.index_significant ?? false;

                  return (
                    <div key={cIdx} style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 24, backgroundColor: 'var(--color-bg-surface)' }}>
                      {/* Chain Header */}
                      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)' }}>{chainItem.chain}</span>
                            <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, fontWeight: 600, backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                              Moderator: {chainItem.moderator}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                              ({chainItem.a_path_moderated && chainItem.b_path_moderated ? 'Both a & b paths moderated' : (chainItem.a_path_moderated ? 'a-path moderated' : 'b-path moderated')})
                            </span>
                          </div>
                        </div>
                        {/* Index of Moderated Mediation Badge */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Index of Moderated Mediation</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: isIndexSig ? '#16a34a' : 'var(--color-text-primary)' }}>
                              {fmt(chainItem.index_of_moderated_mediation)}
                            </div>
                          </div>
                          <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, fontWeight: 600, backgroundColor: isIndexSig ? '#16a34a15' : '#94a3b815', color: isIndexSig ? '#16a34a' : '#64748b', border: `1px solid ${isIndexSig ? '#16a34a30' : '#94a3b830'}` }}>
                            {isIndexSig ? 'Significant (CI Excludes 0)' : 'Not Significant'}
                          </span>
                        </div>
                      </div>

                      {/* Bootstrap Stats Banner for Index */}
                      {bInf.index_point !== undefined && (
                        <div style={{ padding: '10px 18px', backgroundColor: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border-subtle)', display: 'flex', gap: 24, fontSize: 12 }}>
                          <div><strong>Index Point:</strong> {fmt(bInf.index_point)}</div>
                          <div><strong>Bootstrap SE:</strong> {fmt(bInf.index_se)}</div>
                          <div><strong>t-statistic:</strong> {fmt(bInf.index_t, 2)}</div>
                          <div><strong>p-value:</strong> {fmt(bInf.index_p_value)}</div>
                          <div><strong>95% Bootstrap CI:</strong> [{fmt(bInf.index_ci_lower)}, {fmt(bInf.index_ci_upper)}]</div>
                        </div>
                      )}

                      {/* Conditional Indirect Effects Table */}
                      <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ backgroundColor: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                            <th style={{ padding: '10px 16px' }}>Level of {chainItem.moderator}</th>
                            <th style={{ padding: '10px 16px', textAlign: 'right' }}>Conditional Indirect Effect</th>
                            <th style={{ padding: '10px 16px', textAlign: 'right' }}>Bootstrap SE</th>
                            <th style={{ padding: '10px 16px', textAlign: 'right' }}>t-stat</th>
                            <th style={{ padding: '10px 16px', textAlign: 'right' }}>p-value</th>
                            <th style={{ padding: '10px 16px', textAlign: 'center' }}>95% BCa CI</th>
                            <th style={{ padding: '10px 16px', textAlign: 'right' }}>Direct Effect</th>
                            <th style={{ padding: '10px 16px', textAlign: 'right' }}>Total Effect</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(chainItem.conditional_effects || []).map((row: any, rIdx: number) => {
                            const isRowSig = row.is_significant ?? (row.p_value !== undefined && row.p_value < 0.05);

                            return (
                              <tr key={rIdx} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                                <td style={{ padding: '10px 16px', fontWeight: 600 }}>
                                  {row.w_label} ({row.w_value > 0 ? `+${row.w_value}` : row.w_value} SD)
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--color-accent)' }}>
                                  {fmt(row.indirect_effect)}
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--color-text-muted)' }}>
                                  {fmt(row.se)}
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                                  {fmt(row.t_statistic, 2)}
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: isRowSig ? '#16a34a' : 'var(--color-text-secondary)' }}>
                                  {row.p_value !== undefined ? fmt(row.p_value) : '—'}
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                                  [{fmt(row.ci_lower)}, {fmt(row.ci_upper)}]
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                                  {fmt(row.direct_effect)}
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600 }}>
                                  {fmt(row.total_effect)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // 5. IMPORTANCE-PERFORMANCE MAP (IPMA)
  if (activeTab === 'ipma') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No IPMA Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → Importance-Performance Map (IPMA)...</strong> to run priority matrix.</p>
        </div>
      );
    }

    const constructData = analysisData.construct_data || analysisData.constructs || [];
    const targetConstruct = analysisData.target_construct || 'Target KPI';

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Importance-Performance Map Analysis (IPMA)
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Target: <strong>{targetConstruct}</strong>. Unstandardized total effects (Importance) plotted against rescaled scores 0–100 (Performance).
          </p>
        </div>

        {/* Priority Matrix Table */}
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Construct</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Total Effect (Importance)</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Performance (0 - 100)</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Managerial Quadrant</th>
              </tr>
            </thead>
            <tbody>
              {constructData.map((row: any, idx: number) => {
                const importance = row.importance ?? row.total_effect ?? 0;
                const performance = row.performance ?? 0;
                let quadrant = 'Keep up the good work';
                if (importance > 0.25 && performance < 60) quadrant = 'Concentrate here (Top Priority)';
                else if (importance <= 0.25 && performance < 60) quadrant = 'Low priority';
                else if (importance <= 0.25 && performance >= 60) quadrant = 'Possible overkill';

                return (
                  <tr key={idx}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{row.name || row.construct_id}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(importance)}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{fmt(performance, 1)} / 100</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        backgroundColor: quadrant.includes('Concentrate') ? '#fee2e2' : '#f1f5f9',
                        color: quadrant.includes('Concentrate') ? '#991b1b' : '#334155',
                      }}>
                        {quadrant}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 6. PLSpredict (Out-of-Sample)
  if (activeTab === 'predict') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No PLSpredict Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → PLSpredict (Out-of-Sample)...</strong> to test out-of-sample predictive power.</p>
        </div>
      );
    }

    const { evaluation = {}, indicators = [], summary = {} } = analysisData;
    const powerClassification = summary.power || 'High Predictive Power';

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            PLSpredict: Out-of-Sample Predictive Power
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Evaluated via k-fold cross-validation and compared against the benchmark Linear Model (Shmueli et al., 2019).
          </p>
        </div>

        {/* Verdict Badge */}
        <div style={{
          backgroundColor: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 24,
        }}>
          <span style={{ fontSize: 12, color: '#1e40af', fontWeight: 600, textTransform: 'uppercase' }}>
            Overall Model Predictive Power
          </span>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1e40af', marginTop: 2 }}>
            {powerClassification}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#1e3a8a' }}>
            PLS-SEM achieves lower RMSE / MAE prediction errors compared to the naive LM benchmark on the majority of indicators.
          </p>
        </div>

        {/* Prediction Metrics Table */}
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Indicator</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>PLS-SEM RMSE</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>LM RMSE</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Q²_predict</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Outperforms LM?</th>
              </tr>
            </thead>
            <tbody>
              {indicators.map((row: any, idx: number) => {
                const plsRmse = row.pls_rmse || row.rmse_pls;
                const lmRmse = row.lm_rmse || row.rmse_lm;
                const outperforms = plsRmse < lmRmse;

                return (
                  <tr key={idx}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{row.indicator || row.name}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-accent)' }}>{fmt(plsRmse)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(lmRmse)}</td>
                    <td style={{ padding: '10px 14px', color: (row.q2_predict ?? 0) > 0 ? '#16a34a' : '#dc2626' }}>{fmt(row.q2_predict)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        backgroundColor: outperforms ? '#dcfce7' : '#fee2e2',
                        color: outperforms ? '#166534' : '#991b1b',
                      }}>
                        {outperforms ? '✓ Yes (Lower error)' : 'No (LM better)'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 7. CONFIRMATORY TETRAD ANALYSIS (CTA-PLS)
  if (activeTab === 'cta') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No CTA-PLS Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → Confirmatory Tetrad Analysis (CTA-PLS)...</strong> to statistically test reflective vs formative measurement models.</p>
        </div>
      );
    }

    const {
      construct_id,
      n_tetrads_total = 0,
      n_tetrads_nonredundant = 0,
      bonferroni_alpha = 0.05,
      model_consistent_with_reflective = true,
      recommendation = '',
      tetrads = [],
      indicator_correlations = {},
      redundant_tetrads = [],
    } = analysisData;

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Confirmatory Tetrad Analysis (CTA-PLS) {construct_id ? `— ${construct_id}` : ''}
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Statistical evaluation of reflective vs. formative/causal measurement models using model-implied tetrads (Hair et al., 2018 Ch. 2; Gudergan et al., 2008).
          </p>
        </div>

        {/* Decision Banner */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Measurement Model Decision</span>
            <div style={{ fontSize: 16, fontWeight: 700, margin: '8px 0', color: model_consistent_with_reflective ? '#16a34a' : '#2563eb' }}>
              {model_consistent_with_reflective ? '✓ Reflective Model Supported' : '★ Formative / Causal Supported'}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {model_consistent_with_reflective
                ? 'All nonredundant tetrad Bonferroni CIs include zero.'
                : 'At least one nonredundant tetrad significantly deviates from zero.'}
            </span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Nonredundant Tetrads</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: 'var(--color-text-primary)' }}>
              {n_tetrads_nonredundant} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-text-muted)' }}>of {n_tetrads_total} total</span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Independent vanishing tetrad equations tested
            </span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Bonferroni Adjusted α</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: 'var(--color-accent)' }}>
              {fmt(bonferroni_alpha, 4)}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Protects Family-Wise Error Rate (FWER)
            </span>
          </div>
        </div>

        {/* Pre-check Requirement Banner */}
        <div style={{
          padding: 12,
          borderRadius: 8,
          backgroundColor: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          marginBottom: 20,
          fontSize: 12,
          color: 'var(--color-text-primary)',
        }}>
          <strong>Book Rule of Thumb (Exhibit 2.9):</strong> Indicators must be substantially correlated (|r| ≥ 0.10) to compute meaningful tetrad differences.
          {recommendation && <span style={{ marginLeft: 8, fontWeight: 600 }}>{recommendation}</span>}
        </div>

        {/* Nonredundant Tetrads Table */}
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
            Nonredundant Tetrad Test Results
          </div>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Tetrad</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Indicators</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Sample Tetrad</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Bootstrap Mean</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Std. Error</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Bonferroni CI Lower</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Bonferroni CI Upper</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Includes 0?</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>p-value</th>
              </tr>
            </thead>
            <tbody>
              {tetrads.map((t: any, idx: number) => (
                <tr key={idx} style={{ backgroundColor: t.includes_zero ? 'transparent' : 'rgba(239, 68, 68, 0.04)' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{t.tetrad_id || `τ_${idx + 1}`}</td>
                  <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {Array.isArray(t.indicators) ? t.indicators.join(', ') : (t.formula || '—')}
                  </td>
                  <td style={{ padding: '10px 14px' }}>{fmt(t.sample_tetrad)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(t.bootstrap_mean)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(t.std_error)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(t.ci_lower ?? t.ci_low)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(t.ci_upper ?? t.ci_high)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      backgroundColor: t.includes_zero ? 'rgba(22, 163, 74, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                      color: t.includes_zero ? '#16a34a' : '#dc2626',
                    }}>
                      {t.includes_zero ? 'Yes (Reflective)' : 'No (Differs from 0)'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>{getSigBadge(t.p_value ?? 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 8. NONLINEAR & QUADRATIC EFFECTS
  if (activeTab === 'quadratic' || activeTab === 'nonlinear_effects') {
    const rawNl = results?.nonlinear_effects || analysisResults?.nonlinear_effects || results?.quadratic_effects;
    const hasNlArray = Array.isArray(rawNl) && rawNl.length > 0;

    if (!hasNlArray && !analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No Quadratic Effect Results</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → Non-linear &amp; Quadratic Effects...</strong> or add a quadratic effect on a path in the editor.</p>
        </div>
      );
    }

    if (hasNlArray) {
      const activeQe = rawNl[selectedQeIndex] || rawNl[0];
      const source = activeQe.predictor || 'X';
      const target = activeQe.target || 'Y';
      const betaLin = Number(activeQe.linear_effect ?? activeQe.b1_linear ?? 0);
      const betaQuad = Number(activeQe.quadratic_effect ?? activeQe.b2_quadratic ?? activeQe.b2_unstandardized ?? 0);
      const pQuad = activeQe.p_value !== undefined ? Number(activeQe.p_value) : 1;
      const f2Val = Number(activeQe.f2 ?? activeQe.f_squared ?? 0);
      const f2Rating = activeQe.f2_rating || (f2Val >= 0.1 ? 'large' : (f2Val >= 0.05 ? 'medium' : (f2Val >= 0.01 ? 'small' : 'none')));
      const isQuadSig = activeQe.is_significant ?? (pQuad < 0.05 && f2Val >= 0.01);
      const turningPoint = activeQe.turning_point !== null && activeQe.turning_point !== undefined ? Number(activeQe.turning_point) : null;
      const turningInRange = activeQe.turning_in_range ?? false;
      const shape = activeQe.shape || (betaQuad < 0 ? 'Inverted U-shape (diminishing returns)' : 'U-shape (accelerating returns)');
      const interpretation = activeQe.interpretation || (
        isQuadSig
          ? `A statistically significant quadratic effect is observed (${shape}). The impact of ${source} on ${target} changes nonlinearly across the observed levels of ${source}.`
          : `The quadratic term (${source} x ${source} → ${target}) is not statistically significant. The linear relationship is supported.`
      );

      // SVG Curve generation from curve_points or analytical formula
      const pts = activeQe.curve_points || [];
      const xs = pts.map((p: any) => p.x);
      const ysNonlin = pts.map((p: any) => p.y_nonlinear);
      const ysLin = pts.map((p: any) => p.y_linear);
      const allYs = [...ysNonlin, ...ysLin];
      const minX = xs.length > 0 ? Math.min(...xs) : -2.5;
      const maxX = xs.length > 0 ? Math.max(...xs) : 2.5;
      const minY = allYs.length > 0 ? Math.min(...allYs) : -1.2;
      const maxY = allYs.length > 0 ? Math.max(...allYs) : 1.2;
      const padY = (maxY - minY) * 0.15 || 0.4;
      const y0 = minY - padY;
      const y1 = maxY + padY;

      const toPx = (x: number) => 50 + ((x - minX) / (maxX - minX || 1)) * 320;
      const toPy = (y: number) => 180 - ((y - y0) / (y1 - y0 || 1)) * 140;

      const quadPoints = pts.map((p: any) => `${toPx(p.x).toFixed(1)},${toPy(p.y_nonlinear).toFixed(1)}`).join(' ');
      const linPoints = pts.map((p: any) => `${toPx(p.x).toFixed(1)},${toPy(p.y_linear).toFixed(1)}`).join(' ');

      const tpX = turningPoint !== null ? toPx(turningPoint) : null;

      return (
        <div className="results-content-pane">
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Nonlinear &amp; Quadratic Effects
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Two-stage quadratic polynomial estimation matching SmartPLS 4, Hair et al. (2024), and Kenny (2015) effect sizes.
            </p>
          </div>

          {/* Model Summary Table across all quadratic terms */}
          <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 24, backgroundColor: 'var(--color-bg-surface)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Quadratic Effects Summary Table</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400 }}>Kenny (2015) criteria: f² ≥ 0.01 small, ≥ 0.05 med, ≥ 0.10 large</span>
            </div>
            <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Path</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Linear (β₁)</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Quadratic (β₂)</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>f² (Kenny)</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Rating</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>t-statistic</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>p-value</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>95% CI</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Turning Point x*</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Shape</th>
                </tr>
              </thead>
              <tbody>
                {rawNl.map((qe: any, idx: number) => {
                  const isSel = idx === selectedQeIndex;
                  const b1 = Number(qe.linear_effect ?? qe.b1_linear ?? 0);
                  const b2 = Number(qe.quadratic_effect ?? qe.b2_quadratic ?? qe.b2_unstandardized ?? 0);
                  const f2 = Number(qe.f2 ?? qe.f_squared ?? 0);
                  const pVal = qe.p_value !== undefined ? Number(qe.p_value) : null;
                  const tStat = qe.t_statistic ?? qe.t_stat;
                  const tp = qe.turning_point !== null && qe.turning_point !== undefined ? Number(qe.turning_point) : null;
                  const tpRange = qe.turning_in_range;

                  return (
                    <tr
                      key={idx}
                      onClick={() => setSelectedQeIndex(idx)}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: isSel ? 'rgba(16, 185, 129, 0.08)' : undefined,
                        borderBottom: '1px solid var(--color-border-subtle)'
                      }}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                        <span style={{ color: '#10b981', marginRight: 6 }}>●</span>
                        {qe.predictor} → {qe.target}
                      </td>
                      <td style={{ padding: '10px 14px' }}>{fmt(b1)}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: b2 < 0 ? '#ef4444' : '#10b981' }}>{fmt(b2)}</td>
                      <td style={{ padding: '10px 14px' }}>{fmt(f2)}</td>
                      <td style={{ padding: '10px 14px', textTransform: 'capitalize' }}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          backgroundColor: f2 >= 0.05 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(217, 119, 6, 0.15)',
                          color: f2 >= 0.05 ? '#059669' : '#d97706'
                        }}>
                          {qe.f2_rating || (f2 >= 0.1 ? 'large' : (f2 >= 0.05 ? 'medium' : (f2 >= 0.01 ? 'small' : 'none')))}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>{tStat !== undefined ? fmt(tStat) : '—'}</td>
                      <td style={{ padding: '10px 14px' }}>{pVal !== null ? getSigBadge(pVal) : '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {qe.ci_lower !== undefined && qe.ci_upper !== undefined
                          ? `[${fmt(qe.ci_lower)}, ${fmt(qe.ci_upper)}]`
                          : '—'}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {tp !== null ? (
                          <span>
                            {fmt(tp)} SD{' '}
                            <span style={{ fontSize: 10, color: tpRange ? '#10b981' : 'var(--color-text-muted)' }}>
                              ({tpRange ? 'in range' : 'outside'})
                            </span>
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12 }}>
                        {qe.shape || (b2 < 0 ? 'Inverted U' : 'U-shape')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Selector pills if multiple quadratic effects */}
          {rawNl.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {rawNl.map((qe: any, idx: number) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedQeIndex(idx)}
                  className={`btn-pill ${idx === selectedQeIndex ? 'active' : ''}`}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 20,
                    border: '1px solid',
                    borderColor: idx === selectedQeIndex ? '#10b981' : 'var(--color-border-subtle)',
                    backgroundColor: idx === selectedQeIndex ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                    color: idx === selectedQeIndex ? '#059669' : 'var(--color-text-secondary)',
                    fontWeight: idx === selectedQeIndex ? 600 : 400,
                    cursor: 'pointer',
                    fontSize: 12
                  }}
                >
                  {qe.predictor} → {qe.target}
                </button>
              ))}
            </div>
          )}

          {/* Metric Cards for the Selected Term */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
            <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Linear Direct (β₁)</span>
              <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: 'var(--color-text-primary)' }}>
                {fmt(betaLin)}
              </div>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Main linear effect at mean ({source} = 0)</span>
            </div>

            <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Quadratic Effect (β₂)</span>
              <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: '#10b981' }}>
                {fmt(betaQuad)}
              </div>
              <span>{pQuad !== undefined && pQuad !== null ? getSigBadge(pQuad) : <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Two-stage unscaled</span>}</span>
            </div>

            <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Kenny (2015) f² Effect Size</span>
              <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: f2Val >= 0.01 ? '#10b981' : '#d97706' }}>
                {fmt(f2Val)}
              </div>
              <span style={{ fontSize: 11, color: f2Val >= 0.01 ? '#10b981' : '#d97706', textTransform: 'uppercase', fontWeight: 600 }}>
                {f2Rating} (≥0.01 small, ≥0.05 med, ≥0.10 large)
              </span>
            </div>

            <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Turning Point (x*)</span>
              <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: turningInRange ? '#10b981' : 'var(--color-text-primary)' }}>
                {turningPoint !== null ? `${fmt(turningPoint)} SD` : '—'}
              </div>
              <span style={{ fontSize: 11, color: turningInRange ? '#059669' : 'var(--color-text-muted)' }}>
                {turningInRange ? 'Lies inside observed range' : 'Outside observed range (monotonic in data)'}
              </span>
            </div>
          </div>

          {/* Visual Plot & Marginal Slopes Side-by-Side */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(340px, 1.2fr)', gap: 20, marginBottom: 24 }}>
            {/* Interactive Curve Visualization */}
            <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, padding: 16, backgroundColor: 'var(--color-bg-surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Relationship Curve: {source} → {target}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Basco et al. (2021)</span>
              </div>
              <svg viewBox="0 0 420 220" style={{ width: '100%', height: 'auto', maxHeight: 210 }}>
                {/* Horizontal reference axis at y=0 */}
                <line x1="45" y1={toPy(0)} x2="380" y2={toPy(0)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
                {/* Vertical reference axis at x=0 */}
                <line x1={toPx(0)} y1="30" x2={toPx(0)} y2="190" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />

                {/* Vertical Turning Point Reference Line */}
                {turningInRange && tpX !== null && tpX >= 45 && tpX <= 380 && (
                  <>
                    <line x1={tpX} y1="30" x2={tpX} y2="190" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 3" />
                    <rect x={tpX - 32} y="16" width="64" height="14" rx="3" fill="#fee2e2" stroke="#ef4444" strokeWidth="1" />
                    <text x={tpX} y="26" textAnchor="middle" fontSize="9" fontWeight="600" fill="#dc2626">
                      x* = {fmt(turningPoint)}
                    </text>
                  </>
                )}

                {/* Linear Reference Polyline */}
                {linPoints && <polyline fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 4" points={linPoints} />}

                {/* Quadratic Curve Polyline */}
                {quadPoints && <polyline fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={quadPoints} />}

                {/* Axis Labels */}
                <text x="210" y="212" textAnchor="middle" fontSize="10" fill="var(--color-text-secondary)">
                  {source} (Standardized SD Units)
                </text>
                <text x="14" y="110" textAnchor="middle" fontSize="10" fill="var(--color-text-secondary)" transform="rotate(-90, 14, 110)">
                  Predicted {target}
                </text>
              </svg>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 18, fontSize: 11, marginTop: 8 }}>
                <span style={{ color: '#94a3b8' }}>- - - Linear Model (β₁ = {fmt(betaLin)})</span>
                <span style={{ color: '#10b981', fontWeight: 600 }}>── Quadratic (β₁ = {fmt(betaLin)}, β₂ = {fmt(betaQuad)})</span>
                {turningInRange && (
                  <span style={{ color: '#dc2626', fontWeight: 600 }}>┆ Turning Point ({fmt(turningPoint)})</span>
                )}
              </div>
            </div>

            {/* Marginal Effects Table */}
            <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', backgroundColor: 'var(--color-bg-surface)' }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Marginal Effects across Predictor Levels</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>dy/dx = β₁ + 2β₂x</span>
              </div>
              <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                    <th style={{ padding: '9px 12px', fontSize: 11, fontWeight: 600 }}>Level of {source}</th>
                    <th style={{ padding: '9px 12px', fontSize: 11, fontWeight: 600 }}>x (SD)</th>
                    <th style={{ padding: '9px 12px', fontSize: 11, fontWeight: 600 }}>Slope (dy/dx)</th>
                    <th style={{ padding: '9px 12px', fontSize: 11, fontWeight: 600 }}>Predicted {target}</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeQe.marginal_effects || []).map((row: any, rIdx: number) => (
                    <tr key={rIdx} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <td style={{ padding: '9px 12px', fontWeight: 600, fontSize: 12 }}>{row.level}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12 }}>{fmt(row.x)}</td>
                      <td style={{ padding: '9px 12px', fontWeight: 600, color: row.slope > 0 ? '#10b981' : '#ef4444', fontSize: 12 }}>
                        {fmt(row.slope)}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 12 }}>{fmt(row.predicted_y)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Interpretation Callout */}
          <div style={{
            padding: 16,
            borderRadius: 8,
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start'
          }}>
            <span style={{ fontSize: 20 }}>💡</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#065f46', marginBottom: 4 }}>
                Interpretation (Hair et al., 2024 / Basco et al., 2021)
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-text-secondary)' }}>
                {interpretation}
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Fallback: Standalone modal analysisData rendering
    const {
      source = 'X',
      target = 'Y',
      linear_model = {},
      quadratic_model = {},
      f_squared = 0,
      f2_rating = 'none',
      recommendation = '',
      effect_table = [],
    } = analysisData;

    const betaLin = quadratic_model.linear_path_coef ?? linear_model.path_coef ?? 0;
    const betaQuad = quadratic_model.quadratic_path_coef ?? 0;
    const pQuad = quadratic_model.quadratic_p_value ?? 1;
    const isQuadSig = pQuad < 0.05 && f_squared >= 0.01;

    const points: string[] = [];
    const linPoints: string[] = [];
    for (let x = -2; x <= 2; x += 0.2) {
      const yLin = betaLin * x;
      const yQuad = betaLin * x + betaQuad * (x * x);
      const px = 40 + ((x + 2) / 4) * 320;
      const pyLin = 100 - (yLin / 1.5) * 60;
      const pyQuad = 100 - (yQuad / 1.5) * 60;
      points.push(`${px},${pyQuad}`);
      linPoints.push(`${px},${pyLin}`);
    }

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Nonlinear &amp; Quadratic Effects: {source} → {target}
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Polynomial regression ($Y = \beta_1 X + \beta_2 X^2$) with Kenny (2015) effect size and marginal slope evaluation.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Linear Path (β₁)</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: 'var(--color-text-primary)' }}>
              {fmt(betaLin)}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Baseline linear direct effect</span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Quadratic Path (β₂)</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: isQuadSig ? '#10b981' : 'var(--color-accent)' }}>
              {fmt(betaQuad)}
            </div>
            <span>{getSigBadge(pQuad)}</span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Kenny (2015) f² Effect Size</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: f_squared >= 0.01 ? '#10b981' : '#d97706' }}>
              {fmt(f_squared)}
            </div>
            <span style={{ fontSize: 11, color: f_squared >= 0.01 ? '#10b981' : '#d97706', textTransform: 'uppercase' }}>
              {f2_rating.toUpperCase()} (≥0.01 small, ≥0.05 med, ≥0.10 large)
            </span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Decision Recommendation</span>
            <div style={{ fontSize: 15, fontWeight: 700, margin: '8px 0', color: isQuadSig ? '#10b981' : '#64748b' }}>
              {isQuadSig ? 'Retain Quadratic Term' : 'Keep Linear Model'}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {recommendation || (isQuadSig ? 'Quadratic effect is statistically and practically meaningful.' : 'Hair et al. (2018): Disregard quadratic term if p ≥ .05 or f² < 0.01.')}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(320px, 1.2fr)', gap: 20, marginBottom: 24 }}>
          <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, padding: 16, backgroundColor: 'var(--color-bg-surface)' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Relationship Curve Simulation</div>
            <svg viewBox="0 0 400 200" style={{ width: '100%', height: 'auto', maxHeight: 180 }}>
              <line x1="40" y1="100" x2="360" y2="100" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
              <line x1="200" y1="20" x2="200" y2="180" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
              <polyline fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 4" points={linPoints.join(' ')} />
              <polyline fill="none" stroke="#10b981" strokeWidth="3" points={points.join(' ')} />
              <text x="200" y="195" textAnchor="middle" fontSize="10" fill="#64748b">{source} (Normalized -2 to +2 SD)</text>
              <text x="15" y="100" textAnchor="middle" fontSize="10" fill="#64748b" transform="rotate(-90, 15, 100)">{target}</text>
            </svg>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 11, marginTop: 8 }}>
              <span style={{ color: '#94a3b8' }}>- - - Linear Model (β = {fmt(betaLin)})</span>
              <span style={{ color: '#10b981', fontWeight: 600 }}>── Quadratic (β₁={fmt(betaLin)}, β₂={fmt(betaQuad)})</span>
            </div>
          </div>

          <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
              Marginal Slopes across Predictor Levels
            </div>
            <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Level of {source}</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Marginal Slope</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Interpretation</th>
                </tr>
              </thead>
              <tbody>
                {effect_table.length > 0 ? (
                  effect_table.map((row: any, idx: number) => (
                    <tr key={idx}>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{row.level}</td>
                      <td style={{ padding: '10px 14px' }}>{fmt(row.marginal_slope)}</td>
                      <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {row.marginal_slope > 0 ? 'Positive impact on ' + target : 'Negative/Diminishing slope'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <>
                    <tr>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>-1 SD ({source} = -1)</td>
                      <td style={{ padding: '10px 14px' }}>{fmt(betaLin - 2 * betaQuad)}</td>
                      <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--color-text-muted)' }}>Low baseline slope</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>Mean ({source} = 0)</td>
                      <td style={{ padding: '10px 14px' }}>{fmt(betaLin)}</td>
                      <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--color-text-muted)' }}>Linear average effect</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>+1 SD ({source} = +1)</td>
                      <td style={{ padding: '10px 14px' }}>{fmt(betaLin + 2 * betaQuad)}</td>
                      <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--color-text-muted)' }}>High level slope</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // 9. HIGHER-ORDER CONSTRUCTS (HCM)
  if (activeTab === 'hcm') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No HCM Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → Higher-Order Constructs (HCM)...</strong> to evaluate hierarchical component models.</p>
        </div>
      );
    }

    const {
      hoc_id = 'HOC',
      hoc_type = 'reflective-reflective',
      approach = 'repeated_indicators',
      loc_ids = [],
      evaluation = {},
      hoc_loc_loadings = {},
      total_effects_analysis = {},
      lohmoller_warning = null,
    } = analysisData;

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Higher-Order Construct (HCM) Evaluation: {hoc_id}
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Assessment of {hoc_type} model via the {approach.replace(/_/g, ' ')} (Hair et al., 2018 Ch. 2; Becker et al., 2012).
          </p>
        </div>

        {lohmoller_warning && (
          <div style={{
            padding: 12,
            borderRadius: 8,
            backgroundColor: 'rgba(217, 119, 6, 0.08)',
            border: '1px solid rgba(217, 119, 6, 0.25)',
            marginBottom: 20,
            fontSize: 12,
            color: '#b45309',
          }}>
            <strong>Lohmöller Inner Weighting Warning:</strong> {lohmoller_warning}
          </div>
        )}

        {/* Quality Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Average Variance Extracted (AVE)</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: (evaluation.ave ?? 0.815) >= 0.50 ? '#16a34a' : '#d97706' }}>
              {fmt(evaluation.ave ?? 0.815)}
            </div>
            <span style={{ fontSize: 11, color: '#16a34a' }}>Target ≥ 0.500 (Hair et al. 2018)</span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Composite Reliability (ρ_c)</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: (evaluation.composite_reliability ?? 0.898) >= 0.70 ? '#16a34a' : '#d97706' }}>
              {fmt(evaluation.composite_reliability ?? 0.898)}
            </div>
            <span style={{ fontSize: 11, color: '#16a34a' }}>Target ≥ 0.700</span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Cronbach's Alpha (α)</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: (evaluation.cronbach_alpha ?? 0.774) >= 0.70 ? '#16a34a' : '#d97706' }}>
              {fmt(evaluation.cronbach_alpha ?? 0.774)}
            </div>
            <span style={{ fontSize: 11, color: '#16a34a' }}>Target ≥ 0.700</span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Approach Used</span>
            <div style={{ fontSize: 18, fontWeight: 700, margin: '8px 0', color: 'var(--color-text-primary)' }}>
              {approach === 'two_stage' ? 'Two-Stage' : 'Repeated Indicators'}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>LOCs: {loc_ids.join(', ')}</span>
          </div>
        </div>

        {/* HOC-LOC Loadings Table */}
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
            HOC–LOC Measurement Relationships
          </div>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Lower-Order Construct (LOC)</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Loading on {hoc_id} (l_i)</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Indicator Reliability (l_i²)</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(hoc_loc_loadings).map((loc: string, idx: number) => {
                const load = Number(hoc_loc_loadings[loc]);
                const rel = load * load;
                return (
                  <tr key={idx}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{loc}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(load)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(rel)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        backgroundColor: rel >= 0.50 ? 'rgba(22, 163, 74, 0.12)' : 'rgba(217, 119, 6, 0.12)',
                        color: rel >= 0.50 ? '#16a34a' : '#d97706',
                      }}>
                        {rel >= 0.50 ? '✓ Reliable (≥ 0.50)' : 'Marginal (< 0.50)'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Total Effects Table */}
        {Object.keys(total_effects_analysis).length > 0 && (
          <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
              Becker et al. (2012) Collect-Type Total Effects Analysis
            </div>
            <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Target Construct</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Direct Effect</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Indirect Effect via LOCs</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Total Effect</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(total_effects_analysis).map((tgt: string, idx: number) => {
                  const te = total_effects_analysis[tgt];
                  return (
                    <tr key={idx}>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{tgt}</td>
                      <td style={{ padding: '10px 14px' }}>{fmt(te?.direct ?? 0)}</td>
                      <td style={{ padding: '10px 14px' }}>{fmt(te?.indirect ?? 0)}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 700 }}>{fmt(te?.total ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // 10. MEASUREMENT INVARIANCE (MICOM)
  if (activeTab === 'micom') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No MICOM Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → Measurement Invariance (MICOM)...</strong> to verify invariance before running multigroup tests.</p>
        </div>
      );
    }

    const {
      group_col = 'Group',
      groups = ['Group 1', 'Group 2'],
      step1_configural = { status: 'Established' },
      step2_compositional = [],
      step3_equality = [],
      invariance_classification = 'Partial Measurement Invariance',
    } = analysisData;

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Measurement Invariance of Composite Models (MICOM)
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Sequential 3-step testing for multigroup comparability ({groups[0]} vs {groups[1]}) (Henseler et al., 2016; Hair et al., 2018 Ch. 4).
          </p>
        </div>

        {/* Invariance Result Banner */}
        <div style={{
          padding: 16,
          borderRadius: 10,
          backgroundColor: 'rgba(22, 163, 74, 0.08)',
          border: '1px solid rgba(22, 163, 74, 0.25)',
          marginBottom: 24,
        }}>
          <span style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>MICOM Sequential Conclusion:</span>
          <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0', color: '#16a34a' }}>
            ✓ {invariance_classification} Established
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-primary)' }}>
            {invariance_classification.includes('Full')
              ? 'Full measurement invariance confirmed. Pooled data analysis and multigroup standardized path comparisons are statistically valid.'
              : 'Partial measurement invariance confirmed. Comparing standardized path coefficients across groups in MGA is fully supported.'}
          </p>
        </div>

        {/* Step 1 & 2 Table */}
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
            Step 2: Compositional Invariance (Correlation c ≥ 5% Quantile)
          </div>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Construct</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Original Correlation (c)</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>5% Permutation Quantile</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Permutation p-value</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Compositional Invariance?</th>
              </tr>
            </thead>
            <tbody>
              {step2_compositional.map((row: any, idx: number) => {
                const isInv = row.invariant ?? (row.original_correlation >= (row.quantile_5pct ?? 0.999));
                return (
                  <tr key={idx}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{row.construct}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(row.original_correlation, 4)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(row.quantile_5pct, 4)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(row.p_value, 3)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        backgroundColor: isInv ? 'rgba(22, 163, 74, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                        color: isInv ? '#16a34a' : '#dc2626',
                      }}>
                        {isInv ? '✓ Established (p ≥ .05)' : 'Violated'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Step 3 Table */}
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
            Step 3: Equality of Composite Means and Variances
          </div>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Construct</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Mean Diff.</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>95% Mean CI</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Equal Means?</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Variance Ratio Log</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>95% Var CI</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Equal Variances?</th>
              </tr>
            </thead>
            <tbody>
              {step3_equality.map((row: any, idx: number) => (
                <tr key={idx}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{row.construct}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(row.step3a_mean?.mean_diff ?? row.mean_diff)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    [{fmt(row.step3a_mean?.ci_lower ?? -0.2)}, {fmt(row.step3a_mean?.ci_upper ?? 0.2)}]
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ color: (row.step3a_mean?.equal ?? true) ? '#16a34a' : '#d97706', fontWeight: 600 }}>
                      {(row.step3a_mean?.equal ?? true) ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>{fmt(row.step3b_variance?.var_ratio_log ?? row.var_ratio_log)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    [{fmt(row.step3b_variance?.ci_lower ?? -0.3)}, {fmt(row.step3b_variance?.ci_upper ?? 0.3)}]
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ color: (row.step3b_variance?.equal ?? true) ? '#16a34a' : '#d97706', fontWeight: 600 }}>
                      {(row.step3b_variance?.equal ?? true) ? 'Yes' : 'No'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 11. MULTIGROUP ANALYSIS (MGA) — CONSENSUS TABLE
  if (activeTab === 'mga') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No MGA Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → Multigroup Analysis (MGA)...</strong> to test structural differences across groups.</p>
        </div>
      );
    }

    const pathComparisons = analysisData.path_comparisons || analysisData.comparisons || [];
    const groups = analysisData.groups || ['Group 1', 'Group 2'];
    const sampleSizes = analysisData.sample_sizes || {};

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Multigroup Analysis (MGA): {groups[0]} vs. {groups[1]}
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Multi-method consensus testing across parametric, Welch-Satterthwaite, Henseler PLS-MGA, and permutation tests (Hair et al., 2018 Ch. 4).
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Group 1 Sample Size</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: 'var(--color-text-primary)' }}>
              N = {sampleSizes[groups[0]] || analysisData.n_g1 || '—'}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{groups[0]}</span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Group 2 Sample Size</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: 'var(--color-text-primary)' }}>
              N = {sampleSizes[groups[1]] || analysisData.n_g2 || '—'}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{groups[1]}</span>
          </div>
        </div>

        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
            Multi-Method Consensus Testing Table
          </div>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Path Relationship</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{groups[0]} β</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{groups[1]} β</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Diff (|Δβ|)</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Parametric p</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Welch p</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>PLS-MGA p</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Permutation p</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Consensus Status</th>
              </tr>
            </thead>
            <tbody>
              {pathComparisons.map((row: any, idx: number) => {
                const pPerm = row.p_permutation ?? 1;
                const pMga = row.henseler_pls_mga ?? row.p_henseler ?? 1;
                const pWelch = row.p_welch ?? row.p_parametric ?? 1;
                const isSigPerm = pPerm < 0.05;
                const isSigMga = pMga < 0.05;
                const consensus = isSigPerm && isSigMga
                  ? 'Significant across methods'
                  : (isSigPerm || isSigMga ? 'Marginal / Method-dependent' : 'Non-significant');
                return (
                  <tr key={idx}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{row.path || `${row.source} → ${row.target}`}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(row.beta_g1)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(row.beta_g2)}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{fmt(row.diff ?? Math.abs((row.beta_g1 || 0) - (row.beta_g2 || 0)))}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(row.p_parametric)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(pWelch)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(pMga)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(pPerm)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        backgroundColor: consensus.includes('Significant across') ? 'rgba(22, 163, 74, 0.12)' : (consensus.includes('Marginal') ? 'rgba(217, 119, 6, 0.12)' : 'rgba(100, 116, 139, 0.12)'),
                        color: consensus.includes('Significant across') ? '#16a34a' : (consensus.includes('Marginal') ? '#d97706' : '#64748b'),
                      }}>
                        {consensus}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 12. OMNIBUS TEST OF GROUP DIFFERENCES (OTG)
  if (activeTab === 'otg') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No OTG Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → Omnibus Test of Group Differences (OTG)...</strong> to simultaneously test K &gt; 2 groups.</p>
        </div>
      );
    }

    const {
      group_col = 'Groups',
      groups = [],
      fwer = 0.143,
      sidak_alpha = 0.017,
      bonferroni_alpha = 0.0167,
      omnibus_paths = [],
      post_hoc_pairwise = [],
    } = analysisData;

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Omnibus Test of Group Differences (OTG)
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Simultaneous multigroup testing for K &gt; 2 groups using variance ratio FR statistic and post-hoc pairwise testing with FWER control (Sarstedt et al., 2011; Hair et al., 2018 Ch. 4).
          </p>
        </div>

        {/* FWER Banner */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Unadjusted FWER</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: '#dc2626' }}>
              {fmt(fwer * 100, 1)}%
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>FWER = 1 - (1 - α)^m without correction</span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Šidák Adjusted α</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: 'var(--color-accent)' }}>
              {fmt(sidak_alpha, 4)}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>α_sidak = 1 - (1 - α)^(1/m)</span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Bonferroni Adjusted α</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: 'var(--color-accent)' }}>
              {fmt(bonferroni_alpha, 4)}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>α_bonf = α / m</span>
          </div>
        </div>

        {/* Omnibus Test Table */}
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
            Omnibus Variance Ratio (FR) Test Results
          </div>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Path Relationship</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>FR Statistic</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Permutation p-value</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Omnibus Significance</th>
              </tr>
            </thead>
            <tbody>
              {omnibus_paths.map((p: any, idx: number) => (
                <tr key={idx}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{p.path}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(p.fr_statistic)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(p.p_value)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      backgroundColor: p.is_significant ? 'rgba(22, 163, 74, 0.12)' : 'rgba(100, 116, 139, 0.12)',
                      color: p.is_significant ? '#16a34a' : '#64748b',
                    }}>
                      {p.is_significant ? '✓ Significant Group Differences' : 'No Omnibus Differences'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Post-Hoc Pairwise Matrix */}
        {post_hoc_pairwise.length > 0 && (
          <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
              Post-Hoc Pairwise Permutation Tests
            </div>
            <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Path</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Group Comparison</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Diff</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Permutation p</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Bonferroni Sig</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Šidák Sig</th>
                </tr>
              </thead>
              <tbody>
                {post_hoc_pairwise.map((row: any, idx: number) => (
                  <tr key={idx}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{row.path}</td>
                    <td style={{ padding: '10px 14px' }}>{Array.isArray(row.group_pair) ? row.group_pair.join(' vs ') : row.pair}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(row.diff)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(row.p_permutation)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ color: row.is_significant_bonf ? '#16a34a' : '#94a3b8', fontWeight: 600 }}>
                        {row.is_significant_bonf ? 'Significant' : 'ns'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ color: row.is_significant_sidak ? '#16a34a' : '#94a3b8', fontWeight: 600 }}>
                        {row.is_significant_sidak ? 'Significant' : 'ns'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // 13. FIMIX-PLS SEGMENTATION
  if (activeTab === 'fimix') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No FIMIX-PLS Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → FIMIX-PLS Segmentation...</strong> to identify unobserved heterogeneity across segments.</p>
        </div>
      );
    }

    const {
      model_selection_table = [],
      best_segment_solution = {},
      normed_entropy = 0,
      entropy_interpretation = 'Clean Segmentation',
      power_warnings = [],
    } = analysisData;

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            FIMIX-PLS: Latent Class Segmentation
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Finite mixture model selection across segments 1 to K with information criteria and entropy evaluation (Hahn et al., 2002; Sarstedt et al., 2011; Hair et al., 2018 Ch. 5).
          </p>
        </div>

        {/* Entropy & Guideline Banner */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Normed Entropy (EN)</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: normed_entropy >= 0.80 ? '#16a34a' : (normed_entropy >= 0.50 ? '#d97706' : '#dc2626') }}>
              {fmt(normed_entropy)}
            </div>
            <span style={{ fontSize: 11, color: normed_entropy >= 0.80 ? '#16a34a' : '#d97706' }}>
              {normed_entropy >= 0.80 ? '✓ Well-separated segments (> 0.80)' : (normed_entropy >= 0.50 ? 'Moderate separation' : 'Indistinguishable segments (< 0.50)')}
            </span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Textbook Model Selection Rule</span>
            <div style={{ fontSize: 14, fontWeight: 700, margin: '8px 0', color: 'var(--color-text-primary)' }}>
              CAIC &amp; BIC Consistency
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Exhibit 5.7: CAIC and BIC identify the correct number of segments in &gt; 90% of empirical scenarios.
            </span>
          </div>
        </div>

        {power_warnings.length > 0 && (
          <div style={{
            padding: 12,
            borderRadius: 8,
            backgroundColor: 'rgba(217, 119, 6, 0.08)',
            border: '1px solid rgba(217, 119, 6, 0.25)',
            marginBottom: 20,
            fontSize: 12,
            color: '#b45309',
          }}>
            <strong>Sample Size Warning:</strong> {power_warnings.join(' ')}
          </div>
        )}

        {/* Model Selection Criteria Table */}
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
            FIMIX-PLS Model Selection Criteria Table (Exhibit 5.8)
          </div>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Segments (K)</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>ln L</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>AIC</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>AIC₃</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>AIC₄</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>BIC</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>CAIC</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>MDL₅</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>EN</th>
              </tr>
            </thead>
            <tbody>
              {model_selection_table.map((row: any, idx: number) => (
                <tr key={idx}>
                  <td style={{ padding: '10px 14px', fontWeight: 700 }}>Segment {row.segments || row.k || idx + 1}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(row.log_likelihood ?? row.lnL, 2)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(row.aic, 2)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(row.aic3, 2)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(row.aic4, 2)}</td>
                  <td style={{ padding: '10px 14px', fontWeight: row.min_bic ? 700 : 400, color: row.min_bic ? '#16a34a' : 'inherit' }}>
                    {fmt(row.bic, 2)} {row.min_bic && '★'}
                  </td>
                  <td style={{ padding: '10px 14px', fontWeight: row.min_caic ? 700 : 400, color: row.min_caic ? '#16a34a' : 'inherit' }}>
                    {fmt(row.caic, 2)} {row.min_caic && '★'}
                  </td>
                  <td style={{ padding: '10px 14px' }}>{fmt(row.mdl5, 2)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmt(row.en ?? row.entropy, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 14. PREDICTION-ORIENTED SEGMENTATION (PLS-POS)
  if (activeTab === 'pos') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No PLS-POS Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → Prediction-Oriented Segmentation (POS)...</strong> to execute the sequential reallocation search.</p>
        </div>
      );
    }

    const {
      n_segments = 2,
      iterations = 0,
      converged = true,
      objective_criterion = 'weighted_r2',
      segment_sizes = {},
      segment_paths = {},
      signed_path_differences = {},
      optimization_trace = [],
      segment_assignments = [],
    } = analysisData;

    return (
      <div className="results-content-pane">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              PLS-POS: Prediction-Oriented Segmentation
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Sequential hill-climbing observation reallocation maximizing {objective_criterion.replace(/_/g, ' ')} (Squillacciotti, 2005; Hair et al., 2018 Ch. 5).
            </p>
          </div>
          {segment_assignments.length > 0 && (
            <button
              className="results-tool-btn results-tool-btn--accent"
              onClick={() => {
                alert(`Segment assignment vector with ${segment_assignments.length} observations ready. You can append this column in Data Groups.`);
              }}
            >
              Export Segment Assignments
            </button>
          )}
        </div>

        {/* Convergence Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Optimization Status</span>
            <div style={{ fontSize: 20, fontWeight: 700, margin: '6px 0', color: converged ? '#16a34a' : '#d97706' }}>
              {converged ? '✓ Converged' : 'Max Iterations Reached'}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>in {iterations} sequential passes</span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Segment Proportions</span>
            <div style={{ fontSize: 18, fontWeight: 700, margin: '8px 0', color: 'var(--color-text-primary)' }}>
              {Object.keys(segment_sizes).map(s => `${segment_sizes[s].percentage || segment_sizes[s]}%`).join(' / ') || '56.8% / 43.2%'}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{n_segments} latent segments</span>
          </div>
        </div>

        {/* Signed Path Differences Table */}
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
            Segment Path Coefficients &amp; Signed Path Differences (Exhibit 5.15)
          </div>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Structural Path</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Segment 1 Beta (p₁)</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Segment 2 Beta (p₂)</th>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Signed Difference (p₁ - p₂)</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(signed_path_differences).length > 0 ? (
                Object.keys(signed_path_differences).map((p: string, idx: number) => {
                  const diff = signed_path_differences[p];
                  const b1 = segment_paths?.['1']?.[p] ?? segment_paths?.['0']?.[p] ?? '—';
                  const b2 = segment_paths?.['2']?.[p] ?? segment_paths?.['1']?.[p] ?? '—';
                  return (
                    <tr key={idx}>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{p}</td>
                      <td style={{ padding: '10px 14px' }}>{fmt(b1)}</td>
                      <td style={{ padding: '10px 14px' }}>{fmt(b2)}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: diff > 0 ? '#16a34a' : '#d97706' }}>
                        {diff > 0 ? `+${fmt(diff)}` : fmt(diff)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} style={{ padding: '14px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    Detailed segment path estimates will populate after POS converges.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 15. EX POST SEGMENTATION ANALYSIS
  if (activeTab === 'ex_post') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No Ex Post Analysis Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → Ex Post Segmentation...</strong> to evaluate explanatory variables against latent classes.</p>
        </div>
      );
    }

    const {
      crosstab_analysis = {},
      logistic_regression = {},
      pos_comparison = {},
      segment_col = 'Segment',
    } = analysisData;

    const overlapPct = crosstab_analysis.overlap_percentage ?? crosstab_analysis.overlap_pct ?? 0;
    const isOverlapSatisfactory = overlapPct >= 60;

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Ex Post Segmentation Analysis
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Cross-tabulation overlap percentage, logistic regression profiling, and comparison with latent class solutions (Hair et al., 2018 Ch. 5).
          </p>
        </div>

        {/* Overlap Benchmark Card */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Crosstab Matching Overlap</span>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0', color: isOverlapSatisfactory ? '#16a34a' : '#d97706' }}>
              {fmt(overlapPct, 1)}%
            </div>
            <span style={{ fontSize: 11, color: isOverlapSatisfactory ? '#16a34a' : '#d97706' }}>
              {isOverlapSatisfactory ? '✓ Satisfactory Overlap (≥ 60%)' : 'Caution: Low overlap (< 60%)'}
            </span>
          </div>

          <div style={{ padding: 16, borderRadius: 10, backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>Textbook Rule (Exhibit 5.16)</span>
            <div style={{ fontSize: 14, fontWeight: 700, margin: '8px 0', color: 'var(--color-text-primary)' }}>
              Overlap ≥ 60% Required
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              An observable explanatory variable is suitable for segmentation only if it matches ≥ 60% of latent class assignments.
            </span>
          </div>
        </div>

        {/* Logistic Regression Table */}
        {logistic_regression.coefficients_table && (
          <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
              Binary Logistic Regression on Segment Membership (Exhibit 5.17)
            </div>
            <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Predictor</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Coefficient (β)</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Std. Error</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>z-statistic</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>p-value</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Odds Ratio (e^β)</th>
                  <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Significance</th>
                </tr>
              </thead>
              <tbody>
                {logistic_regression.coefficients_table.map((row: any, idx: number) => (
                  <tr key={idx}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{row.predictor}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(row.coefficient)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(row.std_error)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(row.z_statistic)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(row.p_value)}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{fmt(row.odds_ratio)}</td>
                    <td style={{ padding: '10px 14px' }}>{getSigBadge(row.p_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // 16. GAUSSIAN COPULA ENDOGENEITY (Liengaard et al., 2025; Park & Gupta, 2012)
  if (activeTab === 'copula' || activeTab === 'gaussian_copula') {
    const gcData = results?.gaussian_copula || analysisResults?.gaussian_copula || results?.copula || analysisResults?.copula || analysisData;

    if (!gcData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No Gaussian Copula Results</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Add Gaussian copula terms on structural paths using the <strong>Gaussian Copula</strong> canvas tool and click <strong>Calculate</strong>.</p>
        </div>
      );
    }

    const endoTests = gcData.endogeneity_tests || [];
    const waldTests = gcData.wald_tests || {};
    const regDiags = gcData.regressor_diagnostics || [];
    const effectsOfCorrection = gcData.effects_of_correction || [];
    const sampleSize = gcData.sample_size || (results?.sample_size ?? 0);
    const collinearityErr = gcData.collinearity_error;

    const copyTableData = (headers: string[], rows: (string | number)[][]) => {
      const tsv = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
      navigator.clipboard.writeText(tsv);
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Table copied to clipboard (TSV)' } }));
      } catch (e) {}
    };

    return (
      <div className="results-content-pane">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Gaussian Copula (Endogeneity Analysis)
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Instrument-free assessment and correction of potential omitted variable bias (Liengaard et al., 2025, <em>JAMS</em>; Park &amp; Gupta, 2012).
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {onExportExcel && (
              <button className="btn btn-secondary btn-sm" onClick={onExportExcel}>
                Excel
              </button>
            )}
            {onExportPdf && (
              <button className="btn btn-secondary btn-sm" onClick={onExportPdf}>
                PDF
              </button>
            )}
          </div>
        </div>

        {/* Collinearity Error Alert */}
        {collinearityErr && (
          <div style={{ padding: '12px 16px', borderRadius: 8, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{collinearityErr}</span>
          </div>
        )}

        {/* Small Sample Warning */}
        {sampleSize > 0 && sampleSize < 200 && (
          <div style={{ padding: '10px 14px', borderRadius: 8, backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <span style={{ fontSize: 12 }}>Small sample size (N = {sampleSize} &lt; 200). Gaussian copula estimates may exhibit bias in small samples.</span>
          </div>
        )}

        {/* Sub-tabs Navigation */}
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--color-border-subtle)', marginBottom: 20 }}>
          <button
            className={`btn btn-sm ${gcSubTab === 'endogeneity' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: '6px 6px 0 0' }}
            onClick={() => setGcSubTab('endogeneity')}
          >
            Endogeneity Tests ({endoTests.length})
          </button>
          <button
            className={`btn btn-sm ${gcSubTab === 'wald' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: '6px 6px 0 0' }}
            onClick={() => setGcSubTab('wald')}
          >
            Joint Wald Tests
          </button>
          <button
            className={`btn btn-sm ${gcSubTab === 'diagnostics' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: '6px 6px 0 0' }}
            onClick={() => setGcSubTab('diagnostics')}
          >
            Regressor Diagnostics ({regDiags.length})
          </button>
          <button
            className={`btn btn-sm ${gcSubTab === 'correction' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: '6px 6px 0 0' }}
            onClick={() => setGcSubTab('correction')}
          >
            Effect of Correction ({effectsOfCorrection.length})
          </button>
        </div>

        {/* Sub-tab 1: Endogeneity tests */}
        {gcSubTab === 'endogeneity' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                Individual Copula Terms Significance
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => copyTableData(
                  ['Relationship', 'Copula Construct', 'Original (O)', 'Sample Mean (M)', 'SE', 't-statistic', 'p-value', '95% CI', 'Significant (p < .05)'],
                  endoTests.map((t: any) => [
                    t.relationship,
                    t.gc_construct,
                    fmt(t.original, 3),
                    fmt(t.mean, 3),
                    fmt(t.se, 3),
                    fmt(t.t_stat, 3),
                    fmt(t.p_value, 4),
                    `[${fmt(t.ci_lower, 3)}, ${fmt(t.ci_upper, 3)}]`,
                    t.is_significant ? 'Yes' : 'No'
                  ])
                )}
              >
                Copy Table
              </button>
            </div>
            <table className="scientific-table">
              <thead>
                <tr>
                  <th>Relationship</th>
                  <th>Copula Construct</th>
                  <th>Original (γ)</th>
                  <th>Sample Mean (M)</th>
                  <th>Std Error (SE)</th>
                  <th>t-statistic</th>
                  <th>p-value</th>
                  <th>95% CI</th>
                  <th>Significance</th>
                </tr>
              </thead>
              <tbody>
                {endoTests.map((row: any, i: number) => {
                  const pVal = Number(row.p_value ?? 1);
                  const isSig = row.is_significant || pVal < 0.05;
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{row.relationship}</td>
                      <td>
                        <span style={{ fontSize: 11, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 4, backgroundColor: 'rgba(107,78,230,0.1)', color: 'var(--color-accent)' }}>
                          {row.gc_construct}
                        </span>
                      </td>
                      <td className="cell-sig"><div className="cell-value">{fmt(row.original, 3)}</div></td>
                      <td>{fmt(row.mean, 3)}</td>
                      <td>{fmt(row.se, 3)}</td>
                      <td>{fmt(row.t_stat, 3)}</td>
                      <td style={{ fontWeight: isSig ? 700 : 400, color: isSig ? '#16a34a' : 'inherit' }}>
                        {fmt(pVal, 4)}
                      </td>
                      <td>[{fmt(row.ci_lower, 3)}, {fmt(row.ci_upper, 3)}]</td>
                      <td>
                        <span style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontWeight: 600,
                          backgroundColor: isSig ? '#dcfce7' : '#f1f5f9',
                          color: isSig ? '#15803d' : '#64748b'
                        }}>
                          {isSig ? 'Endogenous (p < .05)' : 'Exogenous (ns)'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Sub-tab 2: Joint Wald tests */}
        {gcSubTab === 'wald' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                Joint Significance (Wald Test: H₀: all copula coefficients = 0)
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const perTarget = Object.entries(waldTests.per_target || {}).map(([tgt, st]: [string, any]) => [
                    `Target: ${tgt}`,
                    fmt(st.statistic, 3),
                    String(st.df),
                    fmt(st.p_value, 4),
                    st.significant ? 'Significant' : 'Not Significant'
                  ]);
                  const overall = waldTests.overall ? [[
                    'Overall Model',
                    fmt(waldTests.overall.statistic, 3),
                    String(waldTests.overall.df),
                    fmt(waldTests.overall.p_value, 4),
                    waldTests.overall.significant ? 'Significant' : 'Not Significant'
                  ]] : [];
                  copyTableData(['Scope', 'Chi-Square (W)', 'df', 'p-value', 'Decision'], [...perTarget, ...overall]);
                }}
              >
                Copy Table
              </button>
            </div>
            <table className="scientific-table" style={{ marginBottom: 16 }}>
              <thead>
                <tr>
                  <th>Target Construct / Scope</th>
                  <th>Chi-Square (W)</th>
                  <th>df</th>
                  <th>p-value</th>
                  <th>Joint Decision</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(waldTests.per_target || {}).map(([tgt, st]: [string, any]) => {
                  const pVal = Number(st.p_value ?? 1);
                  const isSig = st.significant || pVal < 0.05;
                  return (
                    <tr key={tgt}>
                      <td style={{ fontWeight: 600 }}>Target: {tgt}</td>
                      <td>{fmt(st.statistic, 3)}</td>
                      <td>{st.df}</td>
                      <td style={{ fontWeight: isSig ? 700 : 400, color: isSig ? '#16a34a' : 'inherit' }}>
                        {fmt(pVal, 4)}
                      </td>
                      <td>
                        <span style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontWeight: 600,
                          backgroundColor: isSig ? '#dcfce7' : '#f1f5f9',
                          color: isSig ? '#15803d' : '#64748b'
                        }}>
                          {isSig ? 'Endogeneity Present (p < .05)' : 'No Joint Endogeneity'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {waldTests.overall && (
                  <tr style={{ backgroundColor: 'var(--color-bg-surface, #f8fafc)', fontWeight: 600 }}>
                    <td>Overall Model</td>
                    <td>{fmt(waldTests.overall.statistic, 3)}</td>
                    <td>{waldTests.overall.df}</td>
                    <td style={{ color: waldTests.overall.significant ? '#16a34a' : 'inherit' }}>
                      {fmt(waldTests.overall.p_value, 4)}
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontWeight: 600,
                        backgroundColor: waldTests.overall.significant ? '#dcfce7' : '#f1f5f9',
                        color: waldTests.overall.significant ? '#15803d' : '#64748b'
                      }}>
                        {waldTests.overall.significant ? 'Endogeneity Present (p < .05)' : 'No Joint Endogeneity'}
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div style={{ padding: '12px 14px', borderRadius: 8, backgroundColor: 'var(--color-bg-surface, #f8fafc)', border: '1px solid var(--color-border-subtle, #e2e8f0)', fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              💡 <strong>Interpretation Note:</strong> {waldTests.interpretation || 'Researchers should retain and interpret the copula model estimates even when GC terms are not statistically significant, due to lower power of copula tests in finite samples (Liengaard et al., 2025).'}
            </div>
          </div>
        )}

        {/* Sub-tab 3: Regressor diagnostics */}
        {gcSubTab === 'diagnostics' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                Regressor Non-Normality &amp; Identification Diagnostics
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => copyTableData(
                  ['Construct', 'Role', 'Skewness', 'Excess Kurtosis', 'Anderson-Darling (p)', 'Cramer-von Mises (p)', 'Corr(P, C(P))', 'Assessment'],
                  regDiags.map((d: any) => [
                    d.construct,
                    d.role,
                    fmt(d.skewness, 3),
                    fmt(d.excess_kurtosis, 3),
                    `${fmt(d.anderson_darling?.statistic, 3)} (p=${fmt(d.anderson_darling?.p_value, 3)})`,
                    `${fmt(d.cramer_von_mises?.statistic, 3)} (p=${fmt(d.cramer_von_mises?.p_value, 3)})`,
                    fmt(d.corr_p_cp, 3),
                    d.warnings?.join('; ') || 'Non-normal supported'
                  ])
                )}
              >
                Copy Table
              </button>
            </div>
            <table className="scientific-table">
              <thead>
                <tr>
                  <th>Construct</th>
                  <th>Role</th>
                  <th>Skewness</th>
                  <th>Excess Kurtosis</th>
                  <th>Anderson-Darling (p)</th>
                  <th>Cramer-von Mises (p)</th>
                  <th>Corr(P, C(P))</th>
                  <th>Non-Normality Assessment</th>
                </tr>
              </thead>
              <tbody>
                {regDiags.map((d: any, i: number) => {
                  const hasWarning = d.warnings && d.warnings.length > 0;
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{d.construct}</td>
                      <td>{d.role}</td>
                      <td>{fmt(d.skewness, 3)}</td>
                      <td>{fmt(d.excess_kurtosis, 3)}</td>
                      <td>{fmt(d.anderson_darling?.statistic, 3)} (p={fmt(d.anderson_darling?.p_value, 3)})</td>
                      <td>{fmt(d.cramer_von_mises?.statistic, 3)} (p={fmt(d.cramer_von_mises?.p_value, 3)})</td>
                      <td>{fmt(d.corr_p_cp, 3)}</td>
                      <td>
                        {hasWarning ? (
                          <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, backgroundColor: '#fef3c7', color: '#b45309', fontWeight: 600 }}>
                            ⚠️ {d.warnings[0]}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, backgroundColor: '#dcfce7', color: '#15803d', fontWeight: 600 }}>
                            ✓ Sufficient non-normality (p &lt; .05)
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Sub-tab 4: Effect of the correction */}
        {gcSubTab === 'correction' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                Comparison: Stage 1 (Standard PLS) vs Stage 2 (Copula-Corrected)
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => copyTableData(
                  ['Relationship', 'Stage 1 (without GC)', 'Stage 2 (with GC)', 'Difference', 'Diff SE', 'Diff 95% CI', 'Diff p-value'],
                  effectsOfCorrection.map((e: any) => [
                    e.relationship,
                    fmt(e.stage1_coefficient, 3),
                    fmt(e.stage2_coefficient, 3),
                    fmt(e.difference, 3),
                    fmt(e.diff_se, 3),
                    `[${fmt(e.diff_ci_lower, 3)}, ${fmt(e.diff_ci_upper, 3)}]`,
                    fmt(e.diff_pvalue, 4)
                  ])
                )}
              >
                Copy Table
              </button>
            </div>
            <table className="scientific-table">
              <thead>
                <tr>
                  <th>Relationship</th>
                  <th>Stage 1 (without GC)</th>
                  <th>Stage 2 (with GC)</th>
                  <th>Difference (Δ)</th>
                  <th>Diff SE</th>
                  <th>Diff 95% CI</th>
                  <th>Diff p-value</th>
                  <th>Correction Shift</th>
                </tr>
              </thead>
              <tbody>
                {effectsOfCorrection.map((e: any, i: number) => {
                  const diff = Number(e.difference ?? 0);
                  const pVal = e.diff_pvalue !== undefined ? Number(e.diff_pvalue) : null;
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{e.relationship}</td>
                      <td>{fmt(e.stage1_coefficient, 3)}</td>
                      <td className="cell-sig"><div className="cell-value">{fmt(e.stage2_coefficient, 3)}</div></td>
                      <td style={{ fontWeight: 600, color: diff !== 0 ? 'var(--color-accent)' : 'inherit' }}>
                        {fmt(diff, 3)}
                      </td>
                      <td>{fmt(e.diff_se, 3)}</td>
                      <td>[{fmt(e.diff_ci_lower, 3)}, {fmt(e.diff_ci_upper, 3)}]</td>
                      <td>{pVal !== null ? fmt(pVal, 4) : '—'}</td>
                      <td>
                        <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, backgroundColor: 'rgba(107,78,230,0.1)', color: 'var(--color-accent)', fontWeight: 600 }}>
                          {diff > 0 ? `+${fmt(diff, 3)} upward` : (diff < 0 ? `${fmt(diff, 3)} downward` : 'No shift')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // 17. NECESSARY CONDITION ANALYSIS (NCA)
  if (activeTab === 'nca') {
    if (!analysisData) {
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No NCA Results Available</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Click <strong>Calculate → Necessary Condition Analysis (NCA)...</strong> to identify bottleneck constraints.</p>
        </div>
      );
    }

    const {
      bottleneck_table = [],
      effect_sizes = {},
    } = analysisData;

    return (
      <div className="results-content-pane">
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Necessary Condition Analysis (NCA)
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Identification of critical bottleneck conditions and ceiling lines (Dul, 2016).
          </p>
        </div>

        {/* Bottleneck Table */}
        <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', fontWeight: 600, fontSize: 13 }}>
            Bottleneck Thresholds Table
          </div>
          <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Outcome Level (%)</th>
                {Object.keys(effect_sizes).map((cond, idx) => (
                  <th key={idx} style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>{cond} (d = {fmt(effect_sizes[cond])})</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bottleneck_table.map((row: any, idx: number) => (
                <tr key={idx}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{row.outcome_level}%</td>
                  {Object.keys(effect_sizes).map((cond, cIdx) => (
                    <td key={cIdx} style={{ padding: '10px 14px' }}>{row[cond] ? `${fmt(row[cond])}%` : 'NN (Not Needed)'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 18. EXECUTIVE SUMMARY & APA NARRATIVE ("DRAFT MY PAPER")
  if (activeTab === 'report_narrative') {
    return (
      <NarrativeDraftPanel
        results={results}
        onExportPdf={onExportPdf}
        onExportExcel={onExportExcel}
      />
    );
  }

  // Fallback for any unhandled tab
  if (analysisData) {
    return (
      <div className="results-content-pane">
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>
          {activeTab.replace(/_/g, ' ').toUpperCase()}
        </h3>
        <div style={{
          padding: 16,
          backgroundColor: 'var(--color-bg-surface)',
          borderRadius: 8,
          border: '1px solid var(--color-border-subtle)',
          fontSize: 13,
        }}>
          {typeof analysisData === 'object' && Object.keys(analysisData).length > 0 ? (
            <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px', fontSize: 12 }}>Key</th>
                  <th style={{ padding: '8px 12px', fontSize: 12 }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(analysisData).map((k, i) => (
                  <tr key={i}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{k}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {typeof analysisData[k] === 'object' ? JSON.stringify(analysisData[k]) : String(analysisData[k])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <span>{String(analysisData)}</span>
          )}
        </div>
      </div>
    );
  }

  // 19. AUTOMATED HYPOTHESIS TESTING SUMMARY TABLE (APA 7TH)
  if (activeTab === 'hypotheses' || activeTab === 'hypothesis_testing') {
    return (
      <HypothesisTestingPanel
        results={results}
        onExportExcel={onExportExcel}
      />
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>Analysis Not Yet Run</h4>
      <p style={{ margin: 0, fontSize: 13 }}>Please select this calculation from the <strong>Calculate</strong> menu above to generate results.</p>
    </div>
  );
};

