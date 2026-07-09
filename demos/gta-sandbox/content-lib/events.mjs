/**
 * GTA sandbox 全局事件名单一来源。
 *
 * data 约定：
 * - busted: {}
 * - wanted-raise: { level: number }
 * - wanted-drop: { level: number }
 * - wanted-changed: { level: number }
 * - mission-complete: { idx: number }
 * - mission-changed: { text: string }
 * - enter-car: undefined
 * - exit-car: { at: [number, number] }
 * - toast: { text: string }
 */
export const EVENTS = [
  'busted',
  'wanted-raise',
  'wanted-drop',
  'wanted-changed',
  'mission-complete',
  'mission-changed',
  'enter-car',
  'exit-car',
  'toast',
];
