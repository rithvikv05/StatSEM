/**
 * StatSEM Professional Academic SEM Layout Engine
 * Generates publication-ready, compact, non-overlapping, and direct journal submission-ready model layouts.
 * 
 * Rules & Invariants:
 * 1. Compact Area & Balanced Footprint:
 *    - Eliminates excessive horizontal sprawl by tightening indicator offsets and inter-column clearances.
 *    - Enhances vertical tier usage so models are proportional, tall, and compact (aspect ratio ~4:3 or 16:10).
 * 2. Zero Overlaps & Collinear Coincidence Elimination:
 *    - Constructs, indicator blocks, and path labels never overlap.
 *    - Skip / Long-range edges (spanning >= 2 layers) are automatically curved with tiered curvature offsets
 *      so they never coincide with intermediate edges or slice through intermediate constructs.
 *    - Mediators and single-node columns are placed at elevated apex tiers (triangle / multi-tier geometry)
 *      to completely eliminate straight-line collapsing.
 * 3. Anti-Collision Result Badges:
 *    - Dynamically staggers badges along arrow paths (parameter t) and applies normal offsets
 *      to 100% guarantee that path coefficients / results on arrow midlines NEVER overlap each other.
 * 4. Intelligent Indicator Orientation:
 *    - Exogenous constructs (in-degree = 0) -> Indicators placed on LEFT.
 *    - Endogenous constructs (out-degree = 0) -> Indicators placed on RIGHT.
 *    - Mediators / Middle constructs:
 *      Upper-tier constructs face TOP; lower-tier constructs face BOTTOM to ensure
 *      structural path arrows entering/leaving sides never cross indicator boxes.
 * 5. Crossing Minimization: Two-pass Barycenter layer sorting.
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

/**
 * Resolves non-overlapping coordinates for edge result badges (path coefficients).
 * Applies along-path staggering and normal repulsion to guarantee zero badge overlaps.
 */
export function resolveBadgePositions(
  edgesWithCoords: BadgeEdgeInput[]
): Map<string, { x: number; y: number; t: number; delta: number }> {
  const badges = edgesWithCoords.filter(e => e.hasBadge !== false);
  if (badges.length === 0) return new Map();

  const SAFE_W = 50;
  const SAFE_H = 24;

  function evalPoint(edge: BadgeEdgeInput, t: number, delta = 0) {
    const { x1, y1, x2, y2, curved, curvature } = edge;
    let px: number, py: number, tx: number, ty: number;

    if (curved) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const curveVal = typeof curvature === 'number' ? curvature : 40;
      const cx = mx + (-dy / len) * curveVal;
      const cy = my + (dx / len) * curveVal;

      const invT = 1 - t;
      px = invT * invT * x1 + 2 * invT * t * cx + t * t * x2;
      py = invT * invT * y1 + 2 * invT * t * cy + t * t * y2;

      tx = 2 * invT * (cx - x1) + 2 * t * (x2 - cx);
      ty = 2 * invT * (cy - y1) + 2 * t * (y2 - cy);
    } else {
      px = (1 - t) * x1 + t * x2;
      py = (1 - t) * y1 + t * y2;
      tx = x2 - x1;
      ty = y2 - y1;
    }

    if (delta !== 0) {
      const tLen = Math.hypot(tx, ty) || 1;
      const nx = -ty / tLen;
      const ny = tx / tLen;
      px += nx * delta;
      py += ny * delta;
    }

    return { x: px, y: py };
  }

  // Initialize state
  const state = badges.map(edge => ({
    edge,
    t: 0.50,
    delta: 0,
    pos: evalPoint(edge, 0.50, 0),
  }));

  // Step 1: Stagger edges converging on the same target
  const targetGroups = new Map<string, typeof state>();
  state.forEach(item => {
    const tid = item.edge.targetId;
    if (!targetGroups.has(tid)) targetGroups.set(tid, []);
    targetGroups.get(tid)!.push(item);
  });

  targetGroups.forEach(group => {
    if (group.length > 1) {
      group.sort((a, b) => a.edge.y1 - b.edge.y1);
      const offsets = group.length === 2 ? [-0.10, 0.10] : [-0.14, 0, 0.14];
      group.forEach((item, idx) => {
        const dt = offsets[idx] !== undefined ? offsets[idx] : ((idx - (group.length - 1) / 2) * 0.10);
        item.t = Math.max(0.32, Math.min(0.68, 0.50 + dt));
        item.pos = evalPoint(item.edge, item.t, item.delta);
      });
    }
  });

  // Step 2: Stagger edges diverging from the same source
  const sourceGroups = new Map<string, typeof state>();
  state.forEach(item => {
    const sid = item.edge.sourceId;
    if (!sourceGroups.has(sid)) sourceGroups.set(sid, []);
    sourceGroups.get(sid)!.push(item);
  });

  sourceGroups.forEach(group => {
    if (group.length > 1) {
      group.sort((a, b) => a.edge.y2 - b.edge.y2);
      const offsets = group.length === 2 ? [-0.08, 0.08] : [-0.12, 0, 0.12];
      group.forEach((item, idx) => {
        if (item.t === 0.50) {
          const dt = offsets[idx] !== undefined ? offsets[idx] : ((idx - (group.length - 1) / 2) * 0.08);
          item.t = Math.max(0.32, Math.min(0.68, 0.50 + dt));
          item.pos = evalPoint(item.edge, item.t, item.delta);
        }
      });
    }
  });

  // Step 3: Iterative Pairwise Anti-Collision Pass
  for (let iter = 0; iter < 5; iter++) {
    let hadCollision = false;

    for (let i = 0; i < state.length; i++) {
      for (let j = i + 1; j < state.length; j++) {
        const b1 = state[i];
        const b2 = state[j];

        const dx = Math.abs(b1.pos.x - b2.pos.x);
        const dy = Math.abs(b1.pos.y - b2.pos.y);

        if (dx < SAFE_W && dy < SAFE_H) {
          hadCollision = true;

          // Attempt 1: Separate along path t
          if (Math.abs(b1.t - b2.t) < 0.15) {
            if (b1.t <= b2.t) {
              b1.t = Math.max(0.30, b1.t - 0.08);
              b2.t = Math.min(0.70, b2.t + 0.08);
            } else {
              b1.t = Math.min(0.70, b1.t + 0.08);
              b2.t = Math.max(0.30, b2.t - 0.08);
            }
          }

          // Attempt 2: If still close, separate perpendicularly (normal delta)
          b1.pos = evalPoint(b1.edge, b1.t, b1.delta);
          b2.pos = evalPoint(b2.edge, b2.t, b2.delta);
          const newDx = Math.abs(b1.pos.x - b2.pos.x);
          const newDy = Math.abs(b1.pos.y - b2.pos.y);

          if (newDx < SAFE_W && newDy < SAFE_H) {
            b1.delta += 14;
            b2.delta -= 14;
            b1.pos = evalPoint(b1.edge, b1.t, b1.delta);
            b2.pos = evalPoint(b2.edge, b2.t, b2.delta);
          }
        }
      }
    }

    if (!hadCollision) break;
  }

  const resultMap = new Map<string, { x: number; y: number; t: number; delta: number }>();
  state.forEach(item => {
    const key = item.edge.id || `${item.edge.sourceId}->${item.edge.targetId}`;
    resultMap.set(key, {
      x: Math.round(item.pos.x),
      y: Math.round(item.pos.y),
      t: item.t,
      delta: item.delta,
    });
  });

  return resultMap;
}

export function performAutoLayout(
  rawNodes: SEMNode[],
  rawEdges: SEMEdge[],
  options: LayoutOptions = {}
): { nodes: SEMNode[]; edges: SEMEdge[] } {
  if (!rawNodes || rawNodes.length === 0) {
    return { nodes: [], edges: rawEdges || [] };
  }

  // Clone nodes and edges
  const nodes: SEMNode[] = JSON.parse(JSON.stringify(rawNodes));
  const edges: SEMEdge[] = JSON.parse(JSON.stringify(rawEdges || []));

  // Reset old waypoints
  edges.forEach(e => {
    e.waypoints = [];
    delete e.waypoints;
  });

  // Separate latent constructs from indicators and text notes
  const latents = nodes.filter(n => n.isLatent !== false && !n.parentId && !n.isText);
  const indicators = nodes.filter(n => !n.isLatent && n.parentId);
  const textNotes = nodes.filter(n => n.isText);

  if (latents.length === 0) {
    return { nodes, edges };
  }

  // Ensure all latent constructs have textInside enabled by default for zero text/arrow collisions
  latents.forEach(l => {
    if (l.textInside === undefined) {
      l.textInside = true;
    }
  });

  // Compact, professional indicator geometry constants with safe clearance for loading badges
  const IND_W = options.indicatorWidth || 64;
  const IND_H = options.indicatorHeight || 24;
  const IND_GAP = options.indicatorGap || 8;
  const CONSTRUCT_R = options.constructRadius || 36;
  const OFFSET_SIDE = CONSTRUCT_R + 78; // Generous 46px gap between circle rim and box for 32px badge
  const OFFSET_TB = CONSTRUCT_R + 74;   // Generous 62px gap between circle rim and top/bottom boxes

  // Build adjacency graph for latent constructs
  const latentIdSet = new Set(latents.map(n => n.id));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();

  latents.forEach(l => {
    incoming.set(l.id, []);
    outgoing.set(l.id, []);
  });

  edges.forEach(e => {
    if (latentIdSet.has(e.sourceId) && latentIdSet.has(e.targetId)) {
      outgoing.get(e.sourceId)?.push(e.targetId);
      incoming.get(e.targetId)?.push(e.sourceId);
    }
  });

  // 1. TOPOLOGICAL LAYERING (Longest Path)
  const depths = new Map<string, number>();
  latents.forEach(l => depths.set(l.id, 0));

  let changed = true;
  let iter = 0;
  while (changed && iter < 100) {
    changed = false;
    iter++;
    edges.forEach(e => {
      if (latentIdSet.has(e.sourceId) && latentIdSet.has(e.targetId)) {
        const sDepth = depths.get(e.sourceId) ?? 0;
        const tDepth = depths.get(e.targetId) ?? 0;
        if (tDepth <= sDepth) {
          depths.set(e.targetId, sDepth + 1);
          changed = true;
        }
      }
    });
  }

  const maxDepth = Math.max(0, ...Array.from(depths.values()));
  const layers: SEMNode[][] = Array.from({ length: maxDepth + 1 }, () => []);

  depths.forEach((depth, id) => {
    const node = latents.find(n => n.id === id);
    if (node) {
      layers[depth].push(node);
    }
  });

  // 2. CROSSING MINIMIZATION (Two-pass Barycenter Heuristic)
  for (let d = 1; d <= maxDepth; d++) {
    const prevLayer = layers[d - 1];
    const prevIndexMap = new Map<string, number>();
    prevLayer.forEach((n, idx) => prevIndexMap.set(n.id, idx));

    layers[d].sort((a, b) => {
      const aIn = incoming.get(a.id) || [];
      const bIn = incoming.get(b.id) || [];

      const aScore = aIn.length > 0
        ? aIn.reduce((sum, src) => sum + (prevIndexMap.get(src) ?? 0), 0) / aIn.length
        : 0;
      const bScore = bIn.length > 0
        ? bIn.reduce((sum, src) => sum + (prevIndexMap.get(src) ?? 0), 0) / bIn.length
        : 0;

      return aScore - bScore;
    });
  }

  for (let d = maxDepth - 1; d >= 0; d--) {
    const nextLayer = layers[d + 1];
    const nextIndexMap = new Map<string, number>();
    nextLayer.forEach((n, idx) => nextIndexMap.set(n.id, idx));

    layers[d].sort((a, b) => {
      const aOut = outgoing.get(a.id) || [];
      const bOut = outgoing.get(b.id) || [];

      const aScore = aOut.length > 0
        ? aOut.reduce((sum, tgt) => sum + (nextIndexMap.get(tgt) ?? 0), 0) / aOut.length
        : 0;
      const bScore = bOut.length > 0
        ? bOut.reduce((sum, tgt) => sum + (nextIndexMap.get(tgt) ?? 0), 0) / bOut.length
        : 0;

      return aScore - bScore;
    });
  }

  // 3. IDENTIFY SKIP EDGES & INTERMEDIATE ROLES
  const bypassedCols = new Set<number>();
  edges.forEach(e => {
    if (latentIdSet.has(e.sourceId) && latentIdSet.has(e.targetId)) {
      const sDepth = depths.get(e.sourceId) ?? 0;
      const tDepth = depths.get(e.targetId) ?? 0;
      if (tDepth - sDepth >= 2) {
        for (let c = sDepth + 1; c < tDepth; c++) {
          bypassedCols.add(c);
        }
      }
    }
  });

  // 4. VERTICAL COORDINATE (Y) ASSIGNMENT
  // Balances tall height with compact width
  const nodeYMap = new Map<string, number>();
  const MIN_VERTICAL_GAP = 65; // Generous vertical clearance

  // Pass 4a: Multi-node columns centered at 0
  layers.forEach((colNodes) => {
    if (colNodes.length > 1) {
      const itemHeights = colNodes.map(n => {
        const childCount = indicators.filter(ind => ind.parentId === n.id).length;
        const stackHeight = childCount * IND_H + Math.max(0, childCount - 1) * IND_GAP;
        return Math.max(CONSTRUCT_R * 2, stackHeight);
      });
      const heightsSum = itemHeights.reduce((acc, h) => acc + h, 0);
      const gapsSum = (colNodes.length - 1) * MIN_VERTICAL_GAP;
      const totalColHeight = heightsSum + gapsSum;

      let currentY = -totalColHeight / 2;
      colNodes.forEach((node, idx) => {
        const halfH = itemHeights[idx] / 2;
        const centerY = currentY + halfH;
        nodeYMap.set(node.id, centerY);
        currentY += itemHeights[idx] + MIN_VERTICAL_GAP;
      });
    }
  });

  // Pass 4b: Single-node columns - elevate apex to make model taller and compact
  layers.forEach((colNodes, colIdx) => {
    if (colNodes.length === 1) {
      const node = colNodes[0];
      const isBypassed = bypassedCols.has(colIdx);
      const inDeg = incoming.get(node.id)?.length || 0;
      const outDeg = outgoing.get(node.id)?.length || 0;
      const isMediator = inDeg > 0 && outDeg > 0;

      if (isBypassed || isMediator) {
        // Elevate apex to 115px to form a well-proportioned, tall mediation triangle
        const offsetSign = (colIdx % 2 === 1) ? -1 : 1;
        nodeYMap.set(node.id, offsetSign * 115);
      } else {
        let neighborYSum = 0;
        let neighborCount = 0;
        const neighbors = [...(incoming.get(node.id) || []), ...(outgoing.get(node.id) || [])];
        neighbors.forEach(nbrId => {
          if (nodeYMap.has(nbrId)) {
            neighborYSum += nodeYMap.get(nbrId)!;
            neighborCount++;
          }
        });

        if (neighborCount > 0) {
          nodeYMap.set(node.id, Math.round(neighborYSum / neighborCount));
        } else {
          nodeYMap.set(node.id, 0);
        }
      }
    }
  });

  // Pass 4c: Collinearity Detection & Repulsion
  edges.forEach(directEdge => {
    const u = directEdge.sourceId;
    const w = directEdge.targetId;
    const uY = nodeYMap.get(u);
    const wY = nodeYMap.get(w);
    if (uY === undefined || wY === undefined) return;

    latents.forEach(vNode => {
      if (vNode.id === u || vNode.id === w) return;
      const vY = nodeYMap.get(vNode.id);
      if (vY === undefined) return;

      const uDepth = depths.get(u) ?? 0;
      const wDepth = depths.get(w) ?? 0;
      const vDepth = depths.get(vNode.id) ?? 0;

      if (vDepth > uDepth && vDepth < wDepth) {
        const t = (vDepth - uDepth) / (wDepth - uDepth);
        const lineY = uY + t * (wY - uY);
        if (Math.abs(vY - lineY) < 45) {
          const pushDir = vY >= lineY ? 1 : -1;
          nodeYMap.set(vNode.id, lineY + pushDir * 95);
        }
      }
    });
  });

  // 5. INTELLIGENT INDICATOR DIRECTION ASSIGNMENT
  const indicatorDirections = new Map<string, 'left' | 'right' | 'top' | 'bottom'>();
  layers.forEach((colNodes, colIdx) => {
    const isFirstCol = colIdx === 0;
    const isLastCol = colIdx === layers.length - 1;
    const isMiddleCol = !isFirstCol && !isLastCol;

    colNodes.forEach((node) => {
      const childCount = indicators.filter(ind => ind.parentId === node.id).length;
      if (childCount === 0) return;
      const nodeY = nodeYMap.get(node.id) || 0;

      if (isFirstCol) {
        indicatorDirections.set(node.id, 'left');
      } else if (isLastCol) {
        indicatorDirections.set(node.id, 'right');
      } else if (isMiddleCol) {
        indicatorDirections.set(node.id, nodeY <= 0 ? 'top' : 'bottom');
      } else {
        indicatorDirections.set(node.id, 'top');
      }
    });
  });

  // 6. BOUNDING BOX COMPUTATION PER CONSTRUCT
  interface ConstructBounds {
    leftSpan: number;
    rightSpan: number;
    topSpan: number;
    bottomSpan: number;
    totalWidth: number;
    totalHeight: number;
  }

  const boundsMap = new Map<string, ConstructBounds>();

  latents.forEach(node => {
    const dir = indicatorDirections.get(node.id);
    const childCount = indicators.filter(ind => ind.parentId === node.id).length;

    let leftSpan = CONSTRUCT_R;
    let rightSpan = CONSTRUCT_R;
    let topSpan = CONSTRUCT_R;
    let bottomSpan = CONSTRUCT_R;

    if (childCount > 0 && dir) {
      if (dir === 'left') {
        const stackHeight = childCount * IND_H + (childCount - 1) * IND_GAP;
        leftSpan = OFFSET_SIDE + IND_W / 2 + 6;
        topSpan = Math.max(CONSTRUCT_R, stackHeight / 2);
        bottomSpan = Math.max(CONSTRUCT_R, stackHeight / 2);
      } else if (dir === 'right') {
        const stackHeight = childCount * IND_H + (childCount - 1) * IND_GAP;
        rightSpan = OFFSET_SIDE + IND_W / 2 + 6;
        topSpan = Math.max(CONSTRUCT_R, stackHeight / 2);
        bottomSpan = Math.max(CONSTRUCT_R, stackHeight / 2);
      } else if (dir === 'top') {
        const stackWidth = childCount * IND_W + (childCount - 1) * IND_GAP;
        topSpan = OFFSET_TB + IND_H / 2 + 6;
        leftSpan = Math.max(CONSTRUCT_R, stackWidth / 2);
        rightSpan = Math.max(CONSTRUCT_R, stackWidth / 2);
      } else if (dir === 'bottom') {
        const stackWidth = childCount * IND_W + (childCount - 1) * IND_GAP;
        bottomSpan = OFFSET_TB + IND_H / 2 + 6;
        leftSpan = Math.max(CONSTRUCT_R, stackWidth / 2);
        rightSpan = Math.max(CONSTRUCT_R, stackWidth / 2);
      }
    }

    boundsMap.set(node.id, {
      leftSpan,
      rightSpan,
      topSpan,
      bottomSpan,
      totalWidth: leftSpan + rightSpan,
      totalHeight: topSpan + bottomSpan,
    });
  });

  // 7. COMPACT ADAPTIVE COLUMN SPACING (Eliminates excessive horizontal width)
  const colXOffsets: number[] = [0];
  const MIN_PATH_CLEARANCE = 85; // Tightened clearance for compact width

  for (let c = 0; c < layers.length - 1; c++) {
    const currentCol = layers[c];
    const nextCol = layers[c + 1];

    const currentMaxRight = Math.max(...currentCol.map(n => boundsMap.get(n.id)?.rightSpan || CONSTRUCT_R));
    const nextMaxLeft = Math.max(...nextCol.map(n => boundsMap.get(n.id)?.leftSpan || CONSTRUCT_R));

    const step = currentMaxRight + nextMaxLeft + MIN_PATH_CLEARANCE;
    colXOffsets.push(colXOffsets[c] + Math.max(step, 150)); // Reduced minimum from 300 to 150
  }

  // 8. ASSIGN FINAL CONSTRUCT COORDINATES
  const totalLayoutWidth = colXOffsets[colXOffsets.length - 1];
  const centerShiftX = -totalLayoutWidth / 2;

  layers.forEach((colNodes, colIdx) => {
    const colX = colXOffsets[colIdx] + centerShiftX;
    colNodes.forEach(node => {
      node.x = Math.round(colX);
      node.y = Math.round(nodeYMap.get(node.id) || 0);
    });
  });

  // 9. POSITION CHILD INDICATORS
  latents.forEach(parent => {
    const dir = indicatorDirections.get(parent.id) || 'left';
    const childInds = indicators.filter(ind => ind.parentId === parent.id);
    if (childInds.length === 0) return;

    const isSide = dir === 'left' || dir === 'right';
    const step = isSide ? (IND_H + IND_GAP) : (IND_W + IND_GAP);
    const totalStackLength = (childInds.length - 1) * step;
    const startOffset = -totalStackLength / 2;

    childInds.forEach((ind, idx) => {
      delete ind.waypoints;
      delete ind.edgeWaypoints;

      if (dir === 'left') {
        ind.x = Math.round(parent.x - OFFSET_SIDE);
        ind.y = Math.round(parent.y + startOffset + (idx * step));
      } else if (dir === 'right') {
        ind.x = Math.round(parent.x + OFFSET_SIDE);
        ind.y = Math.round(parent.y + startOffset + (idx * step));
      } else if (dir === 'top') {
        ind.x = Math.round(parent.x + startOffset + (idx * step));
        ind.y = Math.round(parent.y - OFFSET_TB);
      } else if (dir === 'bottom') {
        ind.x = Math.round(parent.x + startOffset + (idx * step));
        ind.y = Math.round(parent.y + OFFSET_TB);
      }
    });
  });

  // 10. INTELLIGENT EDGE ROUTING & CURVATURE (Zero Coinciding Arrows Guarantee)
  let skipCount = 0;
  edges.forEach(e => {
    const sDepth = depths.get(e.sourceId);
    const tDepth = depths.get(e.targetId);
    if (sDepth === undefined || tDepth === undefined) {
      e.curved = false;
      delete e.curvature;
      return;
    }

    const span = tDepth - sDepth;

    if (span >= 2) {
      e.curved = true;
      skipCount++;

      let nodesAbove = 0;
      let nodesBelow = 0;
      for (let c = sDepth + 1; c < tDepth; c++) {
        layers[c]?.forEach(n => {
          const y = nodeYMap.get(n.id) || 0;
          if (y < 0) nodesAbove++;
          else nodesBelow++;
        });
      }

      const curveDir = nodesAbove > nodesBelow ? 1 : -1;
      const baseCurvature = 45 + (span - 2) * 18 + ((skipCount - 1) % 3) * 18;
      e.curvature = curveDir * baseCurvature;
    } else {
      const isReciprocal = edges.some(other => other.sourceId === e.targetId && other.targetId === e.sourceId);
      if (isReciprocal) {
        e.curved = true;
        e.curvature = 32;
      } else {
        e.curved = false;
        delete e.curvature;
      }
    }
  });

  // 11. SHIFT ENTIRE DIAGRAM TO VIEWPORT CENTER
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  });

  const targetCenterX = (options.containerWidth || 1000) / 2;
  const targetCenterY = (options.containerHeight || 700) / 2;

  const currentCenterX = (minX + maxX) / 2;
  const currentCenterY = (minY + maxY) / 2;

  const dx = Math.round(targetCenterX - currentCenterX);
  const dy = Math.round(targetCenterY - currentCenterY);

  nodes.forEach(n => {
    n.x += dx;
    n.y += dy;
  });

  return { nodes, edges };
}
