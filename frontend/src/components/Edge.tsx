import React from 'react';
import type { EdgeData, NodeData } from '../store';

interface EdgeProps {
  edge: EdgeData;
  sourceNode: NodeData;
  targetNode: NodeData;
}

const Edge = ({ edge, sourceNode, targetNode }: EdgeProps) => {
  if (!sourceNode || !targetNode) return null;

  const getEdgeCoordinates = (source: NodeData, target: NodeData) => {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance === 0) return { x1: source.x, y1: source.y, x2: target.x, y2: target.y };
    
    let sourceOffsetX = 0, sourceOffsetY = 0;
    let targetOffsetX = 0, targetOffsetY = 0;

    const NODE_R = 36; // From frontend
    const isIndicatorPath = target.parentId === source.id && !target.isLatent;

    if (source.isLatent !== false) {
      sourceOffsetX = (dx / distance) * NODE_R;
      sourceOffsetY = (dy / distance) * NODE_R;
    } else {
      // Source is a rectangle
      const rx = 32;
      const ry = 12;
      if (Math.abs(dx) * ry > Math.abs(dy) * rx) {
        sourceOffsetX = Math.sign(dx) * rx;
        sourceOffsetY = dy * (rx / Math.abs(dx));
      } else {
        sourceOffsetX = dx * (ry / Math.abs(dy));
        sourceOffsetY = Math.sign(dy) * ry;
      }
    }
    
    if (isIndicatorPath) {
      // connecting latent to indicator (left side center)
      targetOffsetX = 32; // half of 64px width
      targetOffsetY = 0;
    } else if (target.isLatent !== false) {
      targetOffsetX = (dx / distance) * NODE_R;
      targetOffsetY = (dy / distance) * NODE_R;
    } else {
      // 64x24 rectangle intersection
      const rx = 32;
      const ry = 12;
      if (Math.abs(dx) * ry > Math.abs(dy) * rx) {
        targetOffsetX = Math.sign(dx) * rx;
        targetOffsetY = dy * (rx / Math.abs(dx));
      } else {
        targetOffsetX = dx * (ry / Math.abs(dy));
        targetOffsetY = Math.sign(dy) * ry;
      }
    }
    
    return {
      x1: source.x + sourceOffsetX,
      y1: source.y + sourceOffsetY,
      x2: target.x - targetOffsetX,
      y2: target.y - targetOffsetY
    };
  };

  const { x1, y1, x2, y2 } = getEdgeCoordinates(sourceNode, targetNode);
  const isIndicatorEdge = targetNode.parentId === sourceNode.id && !targetNode.isLatent;

  return (
    <path 
      d={`M ${x1} ${y1} L ${x2} ${y2}`}
      stroke={isIndicatorEdge ? '#64748b' : 'var(--color-text-secondary)'}
      strokeWidth={isIndicatorEdge ? '1.5' : '2'}
      fill="none"
      markerEnd="url(#arrowhead)"
    />
  );
};

export default Edge;
