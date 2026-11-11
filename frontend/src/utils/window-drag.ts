import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { MouseEvent } from 'react';

/** Only explicitly marked background elements can move the window. */
export function isWindowDragBackground(target: EventTarget | null): boolean {
  return target instanceof Element && target.hasAttribute('data-window-drag-surface');
}

export function startWindowDrag(event: MouseEvent<HTMLElement>): void {
  if (event.defaultPrevented || event.button !== 0 || event.detail !== 1 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !isWindowDragBackground(event.target) || !isTauri()) return;
  const target = event.target as HTMLElement;
  const bounds = target.getBoundingClientRect();
  if (target.offsetWidth > target.clientWidth && event.clientX >= bounds.left + target.clientLeft + target.clientWidth) return;
  void getCurrentWindow().startDragging().catch(error => console.warn('Could not start window drag:', error));
}
