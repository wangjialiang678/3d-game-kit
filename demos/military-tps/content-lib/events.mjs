/**
 * Military TPS global event registry.
 *
 * data contracts:
 * - enemy-killed: { name: string, remaining: number }
 * - all-enemies-dead: {}
 * - player-hit: { amount: number, health: number }
 * - weapon-fired: { mag: number, reserve: number }
 * - ammo-changed: { mag: number, reserve: number }
 * - health-changed: { health: number }
 * - toast: { text: string }
 */
export const EVENTS = [
  'enemy-killed',
  'all-enemies-dead',
  'player-hit',
  'weapon-fired',
  'ammo-changed',
  'health-changed',
  'toast',
];
