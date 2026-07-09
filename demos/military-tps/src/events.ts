import { EventBus } from '@engine';
import { EVENTS } from '../content-lib/events.mjs';

EventBus.register(...EVENTS);

export const Bus = EventBus;
