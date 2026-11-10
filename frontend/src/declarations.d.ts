declare module 'sav-reader';
declare module '*/utils/model-canvas' {
  const content: any;
  export default content;
  export const initModelCanvas: any;
  export const ModelCanvas: any;
  export const exportModelSpec: () => any;
  export const getModelCanvasState: () => any;
  export const loadModelCanvasState: (state: any) => void;
  export const setCanvasResults: (results: any) => void;
  export const renderModelCanvas: () => void;
  export const clearModelCanvas: () => void;
  export const resetModelStyles: () => void;
  export const toggleMeasurementMode: () => void;
  export const copySelected: () => void;
  export const pasteClipboard: () => void;
  export const setCanvasDatasetColumns: (columns: string[]) => void;
  export const getModeratingEffects: () => any[];
  export const updateModeratingEffect: (id: string, patch: any) => void;
  export const deleteModeratingEffect: (id: string) => void;
  export const getSelectedModeratingEffect: () => any;
  export const hasInvalidLatentVariables: () => boolean;
  export const createAndEditNewLatentNode: (x?: number, y?: number) => any;
  export const createAndEditNewTextNode: (x?: number, y?: number) => any;
  export const getCanvasGridColors: (bgColor?: string) => { dot: string; line: string };
}
declare module '*/utils/results.js' {
  const content: any;
  export default content;
  export const initResults: any;
}
