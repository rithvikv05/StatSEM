// Generated effect indicators are computational columns, not dataset variables.
// Keep their identifiers for lookup, but use the effect's name for display.
export function makeResultIndicatorNames(results, getConstructName = id => id) {
  const names = {};
  for (const matrix of [results?.measurement?.outer_loadings, results?.measurement?.outer_weights, results?.outer_loadings, results?.outer_weights]) {
    for (const [construct, indicators] of Object.entries(matrix || {})) {
      for (const indicator of Object.keys(indicators || {})) {
        if (!/^(gc|q|int)_/i.test(indicator)) continue;
        const label = String(getConstructName(construct) || construct);
        // Check the owning construct too: a real dataset column can start with q_.
        const isEffect = /^gc\s*\(/i.test(label) || /\s+x\s+/i.test(label) ||
          (results?.latent_variables || []).some(item => (item.id === construct || item.name === construct) && (item.is_interaction || item.is_quadratic));
        if (isEffect) names[indicator] = `${label} indicator`;
      }
    }
  }
  return names;
}
