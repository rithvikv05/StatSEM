/**
 * StatSEM Professional Academic SEM Layout Engine v4
 *
 * Produces clean, publication-ready SEM diagrams that match top-tier journal standards:
 *   - Intelligent Indicator Orientation: detects empty horizontal corridors and places
 *     intermediate indicators on LEFT (avoiding vertical ballooning)
 *   - Path-Construct & Path-Label Collision Elimination: ensures skip/bypass lines never
 *     cut through intermediate constructs or their labels
 *   - Moderator Placement: positions moderators above/below their target path midpoints
 *     instead of forcing them into Column 0 (eliminates ugly, giant vertical stacks)
 *   - Badge-Aware Spacing: derives arrow length and column clearances from active decimal precision
 *   - Smooth Skip Routing: properly curved or cleared skip paths with zero overlaps
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
  textPosition?: 'top' | 'bottom' | 'left' | 'right';
  indicatorDirection?: 'left' | 'right' | 'top' | 'bottom';
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

export interface ModerationEffect {
  id: string;
  moderator: string;
  source: string;
  target: string;
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
  decimalDigits?: number;
  moderatingEffects?: ModerationEffect[];
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
        if (Math.abs(a.t - b.t) < 0.18) {
          if (a.t <= b.t) { a.t = Math.max(0.26, a.t - 0.09); b.t = Math.min(0.74, b.t + 0.09); }
          else             { a.t = Math.min(0.74, a.t + 0.09); b.t = Math.max(0.26, b.t - 0.09); }
        }
        a.pos = evalPt(a.e, a.t, a.delta);
        b.pos = evalPt(b.e, b.t, b.delta);
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

// ─── Main Auto Layout Engine ─────────────────────────────────────────────────

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
  const BW         = badgeWidth(dp);
  const R          = options.constructRadius ?? 36;
  const IW         = options.indicatorWidth  ?? 72;
  const IH         = options.indicatorHeight ?? 26;
  const IGAP       = options.indicatorGap    ?? 10;

  // Arrow length must comfortably fit result badges
  const BADGE_MARGIN  = 24;
  const OFF_SIDE = Math.ceil(BW + BADGE_MARGIN * 2 + IW / 2 + R);
  const OFF_TB   = Math.ceil(BW + BADGE_MARGIN * 2 + IH / 2 + R);

  // ── Identify Pure Moderators ────────────────────────────────────────────────
  // Pure moderators point to path midpoints; they must NOT balloon Column 0!
  const moderatorMap = new Map<string, { sourceId: string; targetId: string }>();
  const isPureModerator = new Set<string>();

  if (options.moderatingEffects && Array.isArray(options.moderatingEffects)) {
    options.moderatingEffects.forEach(m => {
      if (m.moderator && m.source && m.target) {
        moderatorMap.set(m.moderator, { sourceId: m.source, targetId: m.target });
        const hasStructuralEdge = edges.some(e => e.sourceId === m.moderator || e.targetId === m.moderator);
        if (!hasStructuralEdge) {
          isPureModerator.add(m.moderator);
        }
      }
    });
  }

  // Latents participating in standard structural flow
  const flowLatents = latents.filter(n => !isPureModerator.has(n.id));
  const flowLatentSet = new Set(flowLatents.map(n => n.id));

  // ── Latent adjacency ─────────────────────────────────────────────────────────
  const inc = new Map<string, string[]>();
  const out = new Map<string, string[]>();
  flowLatents.forEach(l => { inc.set(l.id, []); out.set(l.id, []); });
  edges.forEach(e => {
    if (flowLatentSet.has(e.sourceId) && flowLatentSet.has(e.targetId)) {
      out.get(e.sourceId)?.push(e.targetId);
      inc.get(e.targetId)?.push(e.sourceId);
    }
  });

  // ── 1. Topological layering ──────────────────────────────────────────────────
  const depth = new Map<string, number>();
  flowLatents.forEach(l => depth.set(l.id, 0));
  let changed = true;
  for (let it = 0; changed && it < 200; it++) {
    changed = false;
    edges.forEach(e => {
      if (!flowLatentSet.has(e.sourceId) || !flowLatentSet.has(e.targetId)) return;
      const sd = depth.get(e.sourceId) ?? 0;
      const td = depth.get(e.targetId) ?? 0;
      if (td <= sd) { depth.set(e.targetId, sd + 1); changed = true; }
    });
  }

  const maxD = Math.max(0, ...depth.values());
  const layers: SEMNode[][] = Array.from({ length: maxD + 1 }, () => []);
  depth.forEach((d, id) => {
    const n = flowLatents.find(l => l.id === id);
    if (n) layers[d].push(n);
  });

  // ── 2. Within-layer ordering (barycenter) ───────────────────────────────────
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
  const nodeY = new Map<string, number>();

  function slotH(id: string): number {
    const n = indicators.filter(ind => ind.parentId === id).length;
    if (n === 0) return R * 2 + 20;
    return Math.max(R * 2, n * IH + (n - 1) * IGAP) + 20;
  }

  const MIN_VGAP = Math.max(85, IH * 2 + IGAP + 30);

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

  // 3b. Single-node columns: gravity average
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

  // 3c. Guarantee line clearance from intermediate constructs & labels
  // Ensures skip edges like LIKE -> CUSL never cut through intermediate constructs like CUSA
  edges.forEach(e => {
    const u = e.sourceId, w = e.targetId;
    if (!flowLatentSet.has(u) || !flowLatentSet.has(w)) return;
    const uD = depth.get(u) ?? 0, wD = depth.get(w) ?? 0;
    if (wD - uD < 2) return;
    const uY = nodeY.get(u) ?? 0, wY = nodeY.get(w) ?? 0;
    for (let d = uD + 1; d < wD; d++) {
      layers[d]?.forEach(v => {
        const vY = nodeY.get(v.id) ?? 0;
        const t = (d - uD) / (wD - uD);
        const lineY = uY + t * (wY - uY);
        const CLEAR_ZONE = R + 44; // Circle radius + label height + breathing room

        if (Math.abs(vY - lineY) < CLEAR_ZONE) {
          if (uY >= vY) {
            // Line is passing below v: ensure lineY >= vY + CLEAR_ZONE
            const neededU = (vY + CLEAR_ZONE - t * wY) / (1 - t);
            if (neededU > (nodeY.get(u) ?? 0)) {
              nodeY.set(u, Math.round(neededU));
            }
          } else {
            // Line is passing above v: ensure lineY <= vY - CLEAR_ZONE
            const neededU = (vY - CLEAR_ZONE - t * wY) / (1 - t);
            if (neededU < (nodeY.get(u) ?? 0)) {
              nodeY.set(u, Math.round(neededU));
            }
          }
        }
      });
    }
  });

  // ── 4. Intelligent Indicator Direction Assignment ───────────────────────────
  // Thoughtful journal logic:
  // - Layer 0 (exogenous): LEFT
  // - Last layer (endogenous): RIGHT
  // - Intermediate: Check if LEFT is open (empty horizontal corridor).
  //   If no horizontal edge enters left rim and no previous construct blocks left,
  //   place indicators on LEFT! (Eliminates vertical ballooning, creates Image 2 structure)
  const indDir = new Map<string, 'left' | 'right' | 'top' | 'bottom'>();
  layers.forEach((col, d) => {
    col.forEach(n => {
      if (!indicators.some(ind => ind.parentId === n.id)) return;
      if (d === 0) {
        indDir.set(n.id, 'left');
      } else if (d === maxD) {
        indDir.set(n.id, 'right');
      } else {
        const nY = nodeY.get(n.id) ?? 0;
        // Check if previous column has any node at similar Y
        const prevColNodes = layers[d - 1] ?? [];
        const hasDirectLeftNode = prevColNodes.some(prev => Math.abs((nodeY.get(prev.id) ?? 0) - nY) < 55);

        // Check if any incoming edge is strictly horizontal (within 20 degrees)
        const incomingEdges = edges.filter(e => e.targetId === n.id && flowLatentSet.has(e.sourceId));
        const hasHorizontalIncoming = incomingEdges.some(e => {
          const srcY = nodeY.get(e.sourceId) ?? 0;
          return Math.abs(srcY - nY) < 40;
        });

        if (!hasDirectLeftNode && !hasHorizontalIncoming) {
          // Corridor directly to the left is open! Put indicators on LEFT!
          indDir.set(n.id, 'left');
        } else {
          indDir.set(n.id, nY <= 0 ? 'top' : 'bottom');
        }
      }
    });
  });

  // ── 5. Bounding box per construct ────────────────────────────────────────────
  const bounds = new Map<string, { L: number; R: number; T: number; B: number }>();
  flowLatents.forEach(n => {
    const dir = indDir.get(n.id);
    const cnt = indicators.filter(ind => ind.parentId === n.id).length;
    let L = R, Rb = R, T = R, B = R;
    if (cnt > 0 && dir) {
      const stackLen = cnt * (dir === 'left' || dir === 'right' ? IH : IW) + (cnt - 1) * IGAP;
      if (dir === 'left')   { L  = OFF_SIDE + IW / 2 + 6; T = Math.max(R, stackLen / 2 + 6); B = T; }
      if (dir === 'right')  { Rb = OFF_SIDE + IW / 2 + 6; T = Math.max(R, stackLen / 2 + 6); B = T; }
      if (dir === 'top')    { T  = OFF_TB   + IH / 2 + 6; L = Math.max(R, stackLen / 2 + 6); Rb = L; }
      if (dir === 'bottom') { B  = OFF_TB   + IH / 2 + 6; L = Math.max(R, stackLen / 2 + 6); Rb = L; }
    }
    bounds.set(n.id, { L, R: Rb, T, B });
  });

  // ── 6. Column X positions (compact, clean inter-layer gaps) ───────────────────
  const colX: number[] = [0];
  for (let d = 0; d < maxD; d++) {
    const curRight  = Math.max(...layers[d].map(n => bounds.get(n.id)?.R ?? R));
    const nextLeft  = Math.max(...layers[d + 1].map(n => bounds.get(n.id)?.L ?? R));
    // When next column has left indicators, ensure comfortable separation
    const minStep = (d === 0 && layers[d].length > 1) ? 170 : 210;
    const step    = curRight + nextLeft + Math.max(BW + 45, 90);
    colX.push(colX[d] + Math.max(step, minStep));
  }

  // Centre flow latents horizontally
  const totalW  = colX[colX.length - 1];
  const shiftX0 = -totalW / 2;
  layers.forEach((col, d) => {
    col.forEach(n => {
      n.x = Math.round(colX[d] + shiftX0);
      n.y = Math.round(nodeY.get(n.id) ?? 0);
      n.indicatorDirection = indDir.get(n.id);
    });
  });

  // ── 7. Position Pure Moderator Constructs ───────────────────────────────────
  // Place moderators directly above/below the path midpoint they moderate!
  isPureModerator.forEach(modId => {
    const modNode = nodes.find(n => n.id === modId);
    const modInfo = moderatorMap.get(modId);
    if (!modNode || !modInfo) return;

    const sNode = nodes.find(n => n.id === modInfo.sourceId);
    const tNode = nodes.find(n => n.id === modInfo.targetId);
    if (!sNode || !tNode) return;

    const midX = (sNode.x + tNode.x) / 2;
    const midY = (sNode.y + tNode.y) / 2;

    // Place moderator above if path is on upper half, else below
    const isAbove = midY <= 0;
    modNode.x = Math.round(midX);
    modNode.y = Math.round(isAbove ? midY - 125 : midY + 125);
    const dir = isAbove ? 'top' : 'bottom';
    indDir.set(modNode.id, dir);
    modNode.indicatorDirection = dir;
  });

  // ── 8. Place Indicators ──────────────────────────────────────────────────────
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

  // ── 9. Edge Routing & Skip Curvature ─────────────────────────────────────────
  edges.forEach(e => {
    if (!flowLatentSet.has(e.sourceId) || !flowLatentSet.has(e.targetId)) {
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
      // Check if straight line clears all intermediate nodes
      const uNode = nodes.find(n => n.id === e.sourceId);
      const wNode = nodes.find(n => n.id === e.targetId);
      let needsCurve = false;
      let curveDir = 1;

      if (uNode && wNode) {
        for (let d = sd + 1; d < td; d++) {
          layers[d]?.forEach(v => {
            const t = (v.x - uNode.x) / (wNode.x - uNode.x);
            const lineY = uNode.y + t * (wNode.y - uNode.y);
            if (Math.abs(v.y - lineY) < R + 30) {
              needsCurve = true;
              curveDir = lineY >= v.y ? 1 : -1;
            }
          });
        }
      }

      if (needsCurve) {
        e.curved = true;
        e.curvature = curveDir * Math.min(50 + (span - 2) * 20, 110);
      } else {
        // Straight line has full clearance! Keep it straight for journal elegance!
        e.curved = false;
        delete e.curvature;
      }
    } else {
      e.curved = true;
      e.curvature = 55;
    }
  });

  // ── 10. Centre Diagram in Viewport ──────────────────────────────────────────
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
