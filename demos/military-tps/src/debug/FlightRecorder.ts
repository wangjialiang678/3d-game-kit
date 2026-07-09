import { EventBus, Input } from '@engine';
import KitFlightRecorder from '@kit/core/FlightRecorder';
import { contentFingerprint, insideAnyBlock } from '../../content-lib/core.mjs';

const STUCK_SECS = 2;

export default class FlightRecorder extends KitFlightRecorder {
  private lastPos = { x: 0, z: 0 };
  private stuckFor = 0;

  constructor(game: any) {
    super({
      game,
      eventBus: EventBus,
      input: Input,
      contentFingerprint: () => contentFingerprint(game.content),
      state: () => {
        const player = game.em?.Get('Player');
        const pc = player?.GetComponent('ThirdPersonPlayer');
        if (!player || !pc) return null;
        const enemiesAlive = game.em.GetAll((e: any) => {
          const npc = e.GetComponent('SoldierNPC');
          return !!npc && !npc.Dead;
        }).length;
        return {
          t: +performance.now().toFixed(0),
          pos: player.Position ? [+player.Position.x.toFixed(1), +player.Position.y.toFixed(2), +player.Position.z.toFixed(1)] : null,
          hp: pc.Health,
          ammo: pc.Ammo,
          enemiesAlive,
          keys: ['KeyW', 'KeyA', 'KeyS', 'KeyD'].filter((k) => Input.GetKeyDown(k)),
        };
      },
      finalState: () => {
        const player = game.em?.Get('Player');
        const pc = player?.GetComponent('ThirdPersonPlayer');
        const enemiesAlive = game.em?.GetAll?.((e: any) => {
          const npc = e.GetComponent('SoldierNPC');
          return !!npc && !npc.Dead;
        }).length ?? null;
        return {
          tick: game.tick ?? 0,
          playerPos: player?.Position ? [+player.Position.x.toFixed(3), +player.Position.z.toFixed(3)] : null,
          hp: pc?.Health ?? null,
          ammo: pc?.Ammo ?? null,
          enemiesAlive,
        };
      },
      watchdogs: [
        (s) => {
          if (!s?.pos || !game.content) return null;
          const [x, , z] = s.pos;
          if (insideAnyBlock(game.content.arena.covers, x, z, -0.05)) {
            return { key: 'inside-cover', message: '检测到玩家卡进掩体内部', data: { pos: s.pos } };
          }
          return null;
        },
        (s) => {
          if (!s?.pos) return null;
          const [x, , z] = s.pos;
          const moving = Math.hypot(x - this.lastPos.x, z - this.lastPos.z) > 0.25;
          const pressing = s.keys.length > 0;
          this.stuckFor = pressing && !moving ? this.stuckFor + 1 : 0;
          this.lastPos = { x, z };
          if (this.stuckFor >= STUCK_SECS) {
            return { key: 'stuck', message: '检测到按键卡死（按住方向键但无位移）', data: { pos: s.pos, keys: s.keys } };
          }
          return null;
        },
      ],
    });
  }
}
