/**
 * StatSEM Professional Academic SEM Layout Engine v3
 *
 * Produces clean, journal-ready SEM diagrams with:
 *   - Standard left-to-right flow (exogenous → mediators → endogenous)
 *   - Uniform vertical spacing within each column — no "flying" apex mediators
 *   - Indicators consistently left of exogenous, right of endogenous, top/bottom for mediators
 *   - Arrow lengths that always clear the result-coefficient badge (badge-aware spacing)
 *   - Only curved arrows for skip-edges and reciprocal pairs; all others straight
 *   - Gravity-based Y positioning so constructs sit naturally at their neighbour average
 *   - Anti-collision badge resolver tuned to actual formatted-number width
 */

export interface SEMNode {
  id: string;
  name?: string;
  label?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  isLatent?: boolean;
  parentId?: string | null;
  isText?: boolean;
  [key: string]: any;
}

export interface SEMEdge {
  id?: string;
  sourceId: string;
  targetId: string;
  waypoints?: any[];
  curved?: boolean;
  curvature?: number;
  badgeX?: number;
  badgeY?: number;
  [key: string]: any;
}

export interface LayoutOptions {
  containerWidth?: number;
  containerHeight?: number;
  padding?: number;
  indicatorWidth?: number;
  indicatorHeight?: number;
  indicatorGap?: number;
  constructRadius?: number;
  /** Decimal digits currently shown — drives badge-width → arrow-length calculation */
  decimalDigits?: number;
}

export interface BadgeEdgeInput {
  id?: string;
  sourceId: string;
  targetId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  curved?: boolean;
  curvature?: number;
  hasBadge?: boolean;
  [key: string]: any;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Pixel width of a path-coefficient badge at a given decimal precision. */
function badgeWidth(decimalDigits: number): number {
  // E.g. "-0.123" at 3 dp → 6 glyphs × 7.2px + 14px padding ≈ 57 px
  const digits = Math.max(2, decimalDigits ?? 3);
  return Math.ceil((digits + 3) * 7.4 + 14);
}

// ─── Badge Anti-Collision ────────────────────────────────────────────────────

export function resolveBadgePositions(
  edgesWithCoords: BadgeEdgeInput[],
  decimalDigits = 3,
): Map<string, { x: number; y: number; t: number; delta: number }> {
  const badges = edgesWithCoords.filter(e => e.hasBadge !== false);
  if (badges.length === 0) return new Map();

  const BW = badgeWidth(decimalDigits);
  const SAFE_W = BW + 10;   // horizontal exclusion zone per badge
  const SAFE_H = 24;        // vertical exclusion zone

  function evalPt(e: BadgeEdgeInput, t: number, delta = 0) {
    const { x1, y1, x2, y2, curved, curvature } = e;
    let px: number, py: number, tx: number, ty: number;
    if (curved) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const cv = typeof curvature === 'number' ? curvature : 40;
      const cx = mx - (dy / len) * cv, cy = my + (dx / len) * cv;
      const q = 1 - t;
      px = q * q * x1 + 2 * q * t * cx + t * t * x2;
      py = q * q * y1 + 2 * q * t * cy + t * t * y2;
      tx = 2 * q * (cx - x1) + 2 * t * (x2 - cx);
      ty = 2 * q * (cy - y1) + 2 * t * (y2 - cy);
    } else {
      px = (1 - t) * x1 + t * x2;
      py = (1 - t) * y1 + t * y2;
      tx = x2 - x1; ty = y2 - y1;
    }
    if (delta !== 0) {
      const tl = Math.hypot(tx, ty) || 1;
      px += (-ty / tl) * delta;
      py += (tx  / tl) * delta;
    }
    return { x: px, y: py };
  }

  const st = badges.map(e => ({ e, t: 0.5, delta: 0, pos: evalPt(e, 0.5) }));

  // Stagger badges that share a target
  const tgMap = new Map<string, typeof st>();
  st.forEach(s => {
    const k = s.e.targetId;
    if (!tgMap.has(k)) tgMap.set(k, []);
    tgMap.get(k)!.push(s);
  });
  tgMap.forEach(grp => {
    if (grp.length < 2) return;
    grp.sort((a, b) => a.e.y1 - b.e.y1);
    const offs = grp.length === 2 ? [-0.10, 0.10] : [-0.13, 0, 0.13];
    grp.forEach((s, i) => {
      s.t = Math.max(0.28, Math.min(0.72, 0.5 + (offs[i] ?? (i - (grp.length - 1) / 2) * 0.10)));
      s.pos = evalPt(s.e, s.t);
    });
  });

  // Stagger badges that share a source
  const srcMap = new Map<string, typeof st>();
  st.forEach(s => {
    const k = s.e.sourceId;
    if (!srcMap.has(k)) srcMap.set(k, []);
    srcMap.get(k)!.push(s);
  });
  srcMap.forEach(grp => {
    if (grp.length < 2) return;
    grp.sort((a, b) => a.e.y2 - b.e.y2);
    const offs = grp.length === 2 ? [-0.08, 0.08] : [-0.11, 0, 0.11];
    grp.forEach((s, i) => {
      if (s.t === 0.5) {
        s.t = Math.max(0.28, Math.min(0.72, 0.5 + (offs[i] ?? (i - (grp.length - 1) / 2) * 0.08)));
        s.pos = evalPt(s.e, s.t);
      }
    });
  });

  // Iterative pairwise repulsion
  for (let pass = 0; pass < 10; pass++) {
    let any = false;
    for (let i = 0; i < st.length; i++) {
      for (let j = i + 1; j < st.length; j++) {
        const a = st[i], b = st[j];
        if (Math.abs(a.pos.x - b.pos.x) >= SAFE_W || Math.abs(a.pos.y - b.pos.y) >= SAFE_H) continue;
        any = true;
        // Separate along path
        if (Math.abs(a.t - b.t) < 0.18) {
          if (a.t <= b.t) { a.t = Math.max(0.26, a.t - 0.09); b.t = Math.min(0.74, b.t + 0.09); }
          else             { a.t = Math.min(0.74, a.t + 0.09); b.t = Math.max(0.26, b.t - 0.09); }
        }
        a.pos = evalPt(a.e, a.t, a.delta);
        b.pos = evalPt(b.e, b.t, b.delta);
        // Perpendicular nudge if still overlapping
        if (Math.abs(a.pos.x - b.pos.x) < SAFE_W && Math.abs(a.pos.y - b.pos.y) < SAFE_H) {
          a.delta += 16; b.delta -= 16;
          a.pos = evalPt(a.e, a.t, a.delta);
          b.pos = evalPt(b.e, b.t, b.delta);
        }
      }
    }
    if (!any) break;
  }

  const out = new Map<string, { x: number; y: number; t: number; delta: number }>();
  st.forEach(s => {
    out.set(s.e.id ?? `${s.e.sourceId}->${s.e.targetId}`, {
      x: Math.round(s.pos.x), y: Math.round(s.pos.y), t: s.t, delta: s.delta,
    });
  });
  return out;
}

// ─── Main Layout ─────────────────────────────────────────────────────────────

export function performAutoLayout(
  rawNodes: SEMNode[],
  rawEdges: SEMEdge[],
  options: LayoutOptions = {},
): { nodes: SEMNode[]; edges: SEMEdge[] } {
  if (!rawNodes?.length) return { nodes: [], edges: rawEdges ?? [] };

  const nodes: SEMNode[] = JSON.parse(JSON.stringify(rawNodes));
  const edges: SEMEdge[] = JSON.parse(JSON.stringify(rawEdges ?? []));
  edges.forEach(e => { delete e.waypoints; });

  const latents    = nodes.filter(n => n.isLatent !== false && !n.parentId && !n.isText);
  const indicators = nodes.filter(n => !n.isLatent && n.parentId);

  if (latents.length === 0) return { nodes, edges };

  // ── Constants ────────────────────────────────────────────────────────────────
  const dp         = options.decimalDigits ?? 3;
  const BW         = badgeWidth(dp);          // actual badge pixel width
  const R          = options.constructRadius ?? 36;  // construct circle radius
  const IW         = options.indicatorWidth  ?? 72;
  const IH         = options.indicatorHeight ?? 26;
  const IGAP       = options.indicatorGap    ?? 10;

  // Gap between construct rim and nearest indicator edge — must clear badge
  const IND_SIDE_GAP = Math.max(56, Math.ceil(BW / 2) + 14);  // left/right indicator arm
  const IND_TB_GAP   = Math.max(50, Math.ceil(BW / 2) + 10);  // top/bottom indicator arm
  const OFF_SIDE = R + IND_SIDE_GAP;   // construct-centre → indicator-centre (horizontal)
  const OFF_TB   = R + IND_TB_GAP;     // construct-centre → indicator-centre (vertical)

  // Inter-column clearance: must fit badge + visual breathing room on both sides
  const COL_GAP = Math.max(100, BW + 60);

  // ── Latent adjacency ─────────────────────────────────────────────────────────
  const latentSet = new Set(latents.map(n => n.id));
  const inc = new Map<string, string[]>();   // id → [source ids]
  const out = new Map<string, string[]>();   // id → [target ids]
  latents.forEach(l => { inc.set(l.id, []); out.set(l.id, []); });
  edges.forEach(e => {
    if (latentSet.has(e.sourceId) && latentSet.has(e.targetId)) {
      out.get(e.sourceId)?.push(e.targetId);
      inc.get(e.targetId)?.push(e.sourceId);
    }
  });

  // ── 1. Topological layering (longest-path) ───────────────────────────────────
  const depth = new Map<string, number>();
  latents.forEach(l => depth.set(l.id, 0));
  let changed = true;
  for (let it = 0; changed && it < 200; it++) {
    changed = false;
    edges.forEach(e => {
      if (!latentSet.has(e.sourceId) || !latentSet.has(e.targetId)) return;
      const sd = depth.get(e.sourceId) ?? 0;
      const td = depth.get(e.targetId) ?? 0;
      if (td <= sd) { depth.set(e.targetId, sd + 1); changed = true; }
    });
  }

  const maxD = Math.max(0, ...depth.values());
  const layers: SEMNode[][] = Array.from({ length: maxD + 1 }, () => []);
  depth.forEach((d, id) => {
    const n = latents.find(l => l.id === id);
    if (n) layers[d].push(n);
  });

  // ── 2. Within-layer ordering (barycenter, 2 passes) ─────────────────────────
  // Forward pass
  for (let d = 1; d <= maxD; d++) {
    const prevPos = new Map<string, number>();
    layers[d - 1].forEach((n, i) => prevPos.set(n.id, i));
    layers[d].sort((a, b) => {
      const aParents = inc.get(a.id) ?? [];
      const bParents = inc.get(b.id) ?? [];
      const scoreA = aParents.length ? aParents.reduce((s, p) => s + (prevPos.get(p) ?? 0), 0) / aParents.length : 999;
      const scoreB = bParents.length ? bParents.reduce((s, p) => s + (prevPos.get(p) ?? 0), 0) / bParents.length : 999;
      return scoreA - scoreB;
    });
  }
  // Backward pass
  for (let d = maxD - 1; d >= 0; d--) {
    const nextPos = new Map<string, number>();
    layers[d + 1].forEach((n, i) => nextPos.set(n.id, i));
    layers[d].sort((a, b) => {
      const aChildren = out.get(a.id) ?? [];
      const bChildren = out.get(b.id) ?? [];
      const scoreA = aChildren.length ? aChildren.reduce((s, c) => s + (nextPos.get(c) ?? 0), 0) / aChildren.length : 999;
      const scoreB = bChildren.length ? bChildren.reduce((s, c) => s + (nextPos.get(c) ?? 0), 0) / bChildren.length : 999;
      return scoreA - scoreB;
    });
  }

  // ── 3. Vertical (Y) coordinate assignment ───────────────────────────────────
  //
  // PRINCIPLE: Every column is a uniform vertical stack centred at Y=0.
  // Single-node columns are gravity-pulled to the average Y of their neighbours.
  // No "apex elevation" hacks — this was the main source of weird shapes.
  //
  const nodeY = new Map<string, number>();

  /** Height occupied by a construct including its indicator stack */
  function slotH(id: string): number {
    const n = indicators.filter(ind => ind.parentId === id).length;
    if (n === 0) return R * 2 + 20;
    return Math.max(R * 2, n * IH + (n - 1) * IGAP) + 20;
  }

  // Minimum vertical gap: enough to clear overlapping indicators between adjacent constructs
  const MIN_VGAP = Math.max(70, IH * 2 + IGAP + 24);

  // 3a. Multi-node columns: uniform stack, centred at 0
  layers.forEach(col => {
    if (col.length < 2) return;
    const slots = col.map(n => slotH(n.id));
    const total = slots.reduce((a, b) => a + b, 0) + (col.length - 1) * MIN_VGAP;
    let y = -total / 2;
    col.forEach((n, i) => {
      nodeY.set(n.id, Math.round(y + slots[i] / 2));
      y += slots[i] + MIN_VGAP;
    });
  });

  // 3b. Single-node columns: gravity average over already-placed neighbours, 2 passes
  //     (Two passes ensure nodes whose neighbours are set in 3b can also settle)
  for (let pass = 0; pass < 2; pass++) {
    layers.forEach(col => {
      if (col.length !== 1) return;
      const n = col[0];
      const nbrs = [...(inc.get(n.id) ?? []), ...(out.get(n.id) ?? [])];
      const placed = nbrs.filter(id => nodeY.has(id));
      if (placed.length > 0) {
        const avg = placed.reduce((s, id) => s + (nodeY.get(id) ?? 0), 0) / placed.length;
        nodeY.set(n.id, Math.round(avg));
      } else {
        nodeY.set(n.id, 0);
      }
    });
  }

  // 3c. Separation pass: push vertically-overlapping nodes in the same column apart
  //     (shouldn't be needed for multi-node cols which are already stacked, but
  //     guards against edge cases like two single-node cols at the same Y)
  for (let d = 0; d <= maxD; d++) {
    const col = [...layers[d]].sort((a, b) => (nodeY.get(a.id) ?? 0) - (nodeY.get(b.id) ?? 0));
    for (let i = 1; i < col.length; i++) {
      const above = nodeY.get(col[i - 1].id) ?? 0;
      const cur   = nodeY.get(col[i].id)     ?? 0;
      const need  = (slotH(col[i - 1].id) + slotH(col[i].id)) / 2 + MIN_VGAP;
      if (cur - above < need) {
        nodeY.set(col[i].id, Math.round(above + need));
      }
    }
  }

  // 3d. Collinearity repulsion — push intermediate nodes off skip-edge straight lines
  edges.forEach(e => {
    const u = e.sourceId, w = e.targetId;
    if (!latentSet.has(u) || !latentSet.has(w)) return;
    const uD = depth.get(u) ?? 0, wD = depth.get(w) ?? 0;
    if (wD - uD < 2) return;
    const uY = nodeY.get(u) ?? 0, wY = nodeY.get(w) ?? 0;
    for (let d = uD + 1; d < wD; d++) {
      layers[d]?.forEach(v => {
        const vY = nodeY.get(v.id) ?? 0;
        const t = (d - uD) / (wD - uD);
        const lineY = uY + t * (wY - uY);
        if (Math.abs(vY - lineY) < 50) {
          const dir = vY >= lineY ? 1 : -1;
          nodeY.set(v.id, Math.round(lineY + dir * 65));
        }
      });
    }
  });

  // ── 4. Indicator direction ───────────────────────────────────────────────────
  // Rule: exogenous (layer 0) → LEFT; endogenous (last layer) → RIGHT;
  //       intermediate → TOP if above midline, BOTTOM if below (keeps arrows clear)
  const indDir = new Map<string, 'left' | 'right' | 'top' | 'bottom'>();
  layers.forEach((col, d) => {
    col.forEach(n => {
      if (!indicators.some(ind => ind.parentId === n.id)) return;
      if (d === 0)      indDir.set(n.id, 'left');
      else if (d === maxD) indDir.set(n.id, 'right');
      else               indDir.set(n.id, (nodeY.get(n.id) ?? 0) <= 0 ? 'top' : 'bottom');
    });
  });

  // ── 5. Bounding box per construct ────────────────────────────────────────────
  const bounds = new Map<string, { L: number; R: number; T: number; B: number }>();
  latents.forEach(n => {
    const dir = indDir.get(n.id);
    const cnt = indicators.filter(ind => ind.parentId === n.id).length;
    let L = R, Rb = R, T = R, B = R;
    if (cnt > 0 && dir) {
      const stackLen = cnt * (dir === 'left' || dir === 'right' ? IH : IW) +
                       (cnt - 1) * IGAP;
      if (dir === 'left')   { L  = OFF_SIDE + IW / 2 + 6; T = Math.max(R, stackLen / 2 + 6); B = T; }
      if (dir === 'right')  { Rb = OFF_SIDE + IW / 2 + 6; T = Math.max(R, stackLen / 2 + 6); B = T; }
      if (dir === 'top')    { T  = OFF_TB   + IH / 2 + 6; L = Math.max(R, stackLen / 2 + 6); Rb = L; }
      if (dir === 'bottom') { B  = OFF_TB   + IH / 2 + 6; L = Math.max(R, stackLen / 2 + 6); Rb = L; }
    }
    bounds.set(n.id, { L, R: Rb, T, B });
  });

  // ── 6. Column X positions (badge-aware spacing) ──────────────────────────────
  const colX: number[] = [0];
  for (let d = 0; d < maxD; d++) {
    const curRight  = Math.max(...layers[d].map(n => bounds.get(n.id)?.R ?? R));
    const nextLeft  = Math.max(...layers[d + 1].map(n => bounds.get(n.id)?.L ?? R));
    const step      = curRight + nextLeft + COL_GAP;
    colX.push(colX[d] + Math.max(step, 220));  // 220 px hard minimum between columns
  }

  // Centre horizontally
  const totalW  = colX[colX.length - 1];
  const shiftX0 = -totalW / 2;
  layers.forEach((col, d) => {
    col.forEach(n => {
      n.x = Math.round(colX[d] + shiftX0);
      n.y = Math.round(nodeY.get(n.id) ?? 0);
    });
  });

  // ── 7. Place indicators ──────────────────────────────────────────────────────
  latents.forEach(par => {
    const dir = indDir.get(par.id) ?? 'left';
    const kids = indicators.filter(ind => ind.parentId === par.id);
    if (!kids.length) return;
    const side = dir === 'left' || dir === 'right';
    const step = side ? (IH + IGAP) : (IW + IGAP);
    const start = -((kids.length - 1) * step) / 2;
    kids.forEach((kid, i) => {
      delete kid.waypoints;
      delete (kid as any).edgeWaypoints;
      const off = start + i * step;
      if (dir === 'left')   { kid.x = par.x - OFF_SIDE; kid.y = par.y + off; }
      if (dir === 'right')  { kid.x = par.x + OFF_SIDE; kid.y = par.y + off; }
      if (dir === 'top')    { kid.x = par.x + off;       kid.y = par.y - OFF_TB; }
      if (dir === 'bottom') { kid.x = par.x + off;       kid.y = par.y + OFF_TB; }
      kid.x = Math.round(kid.x);
      kid.y = Math.round(kid.y);
    });
  });

  // ── 8. Edge curvature ────────────────────────────────────────────────────────
  // - Straight  : adjacent-layer, non-reciprocal
  // - Curved 36 : reciprocal pair (bi-directional arrows)
  // - Curved 55+ : skip edges (bypasses ≥1 column)
  // - Curved 55  : same-layer or backward edge

  let skipIdx = 0;
  edges.forEach(e => {
    if (!latentSet.has(e.sourceId) || !latentSet.has(e.targetId)) {
      e.curved = false; delete e.curvature; return;
    }
    const sd = depth.get(e.sourceId) ?? 0;
    const td = depth.get(e.targetId) ?? 0;
    const span = td - sd;

    if (span === 1) {
      const isRecip = edges.some(o => o.sourceId === e.targetId && o.targetId === e.sourceId);
      if (isRecip) { e.curved = true; e.curvature = 36; }
      else         { e.curved = false; delete e.curvature; }

    } else if (span >= 2) {
      e.curved = true;
      // Count intermediate nodes above vs below to decide curve direction
      let above = 0, below = 0;
      for (let d = sd + 1; d < td; d++) {
        layers[d]?.forEach(v => { (nodeY.get(v.id) ?? 0) < 0 ? above++ : below++; });
      }
      const dir = above > below ? 1 : -1;
      // Stagger multiple skip arcs so they don't coincide
      skipIdx++;
      const jitter = ((skipIdx - 1) % 4) * 20;
      const base   = 50 + (span - 2) * 22;
      e.curvature  = dir * Math.min(base + jitter, 160);

    } else {
      // span <= 0: same-layer or back-edge
      e.curved = true;
      e.curvature = 60;
    }
  });

  // ── 9. Centre entire diagram in viewport ────────────────────────────────────
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  nodes.forEach(n => {
    const b = bounds.get(n.id);
    x0 = Math.min(x0, n.x - (b?.L ?? R));
    x1 = Math.max(x1, n.x + (b?.R ?? R));
    y0 = Math.min(y0, n.y - (b?.T ?? R));
    y1 = Math.max(y1, n.y + (b?.B ?? R));
  });

  const vp = { w: options.containerWidth ?? 1200, h: options.containerHeight ?? 800 };
  const dx = Math.round(vp.w / 2 - (x0 + x1) / 2);
  const dy = Math.round(vp.h / 2 - (y0 + y1) / 2);
  nodes.forEach(n => { n.x += dx; n.y += dy; });

  return { nodes, edges };
}
