/** GTA demo 事件总线：合法事件名来自 content-lib/events.mjs。 */
import { EventBus } from '@engine';
import { EVENTS } from '../content-lib/events.mjs';

EventBus.register(...EVENTS);

export const Bus = EventBus;
