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
        const of = game.em?.Get('Player')?.GetComponent('OnFootPlayer');
        const cars = game.em?.GetAll?.((e: any) => !!e.GetComponent('Car')).map((e: any) => e.GetComponent('Car')) ?? [];
        const car = cars.find((c: any) => c.Active) ?? cars[0];
        const activeCar = cars.find((c: any) => c.Active);
        const w = game.em?.Get('Wanted')?.GetComponent('WantedSystem');
        const ms = game.em?.Get('Missions')?.GetComponent('MissionSystem');
        if (!of) return null;
        const cap = of.character?.body?.translation?.();
        return {
          t: +performance.now().toFixed(0),
          mode: activeCar ? 'car' : 'foot',
          pos: cap ? [+cap.x.toFixed(1), +cap.y.toFixed(2), +cap.z.toFixed(1)] : null,
          carPos: car ? [+car.Position.x.toFixed(1), +car.Position.z.toFixed(1)] : null,
          wanted: w?.Level ?? 0,
          mission: ms?.idx ?? 0,
          keys: ['KeyW', 'KeyA', 'KeyS', 'KeyD'].filter((k) => Input.GetKeyDown(k)),
        };
      },
      finalState: () => {
        const cars = game.em?.GetAll?.((e: any) => !!e.GetComponent('Car')).map((e: any) => e.GetComponent('Car')) ?? [];
        const car = cars.find((c: any) => c.Active);
        const player = game.em?.Get('Player');
        const p = car?.Active ? car.Position : player?.Position;
        const w = game.em?.Get('Wanted')?.GetComponent('WantedSystem');
        const ms = game.em?.Get('Missions')?.GetComponent('MissionSystem');
        return {
          tick: game.tick ?? 0,
          playerPos: p ? [+p.x.toFixed(3), +p.z.toFixed(3)] : null,
          wanted: w?.Level ?? 0,
          mission: ms?.idx ?? 0,
        };
      },
      watchdogs: [
        (s) => {
          if (!s?.pos || !game.content) return null;
          const [x, , z] = s.pos;
          if (s.mode === 'foot' && insideAnyBlock(game.content.blocks, x, z, -0.1)) {
            return { key: 'inside-block', message: '检测到玩家卡进建筑内部', data: { pos: s.pos } };
          }
          return null;
        },
        (s) => {
          if (!s?.pos) return null;
          const [x, , z] = s.pos;
          const moving = Math.hypot(x - this.lastPos.x, z - this.lastPos.z) > 0.3;
          const pressing = s.keys.length > 0;
          this.stuckFor = pressing && !moving ? this.stuckFor + 1 : 0;
          this.lastPos = { x, z };
          if (this.stuckFor >= STUCK_SECS) {
            return { key: 'stuck', message: '检测到按键卡死（按住方向键但无位移）', data: { pos: s.pos, keys: s.keys, mode: s.mode } };
          }
          return null;
        },
      ],
    });
  }
}
