/**
 * WantedSystem — GTA 式通缉系统。
 * 按 G 惹麻烦 → 通缉 +1 星（最多 5）；警力、甩脱距离和抓捕距离来自 tuning.json。
 * 与所有警察拉开指定距离并保持指定秒数 → 降 1 星；星级归零警察消散。
 * 步行时被警察贴身 → BUSTED：清星、送回广场。
 */
import * as THREE from 'three';
import { Component, Input, Entity } from '@engine';
import PoliceNPC from './PoliceNPC';
import { cloneSoldier } from '../util/build';
import { Bus } from '../events';

const MAX_STARS = 5;

interface PoliceTuning {
  speed: number;
  perStar: number;
  escapeDist: number;
  escapeTime: number;
  bustDist: number;
  cullDist: number;
  spawnRadius: number;
}

export default class WantedSystem extends Component {
  private scene: THREE.Scene;
  private soldierGltf: any;
  private tuning: PoliceTuning;
  private level = 0;
  private escapeTimer = 0;
  private police: Entity[] = [];
  private spawnSeq = 0;

  constructor(scene: THREE.Scene, soldierGltf: any, tuning: PoliceTuning) {
    super();
    this.name = 'WantedSystem';
    this.scene = scene;
    this.soldierGltf = soldierGltf;
    this.tuning = tuning;
  }

  get Level() { return this.level; }

  Initialize(): void {
    Input.AddKeyDownListner((e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'KeyG') this.raise('制造了事端！');
    });
  }

  raise(reason: string) {
    const prev = this.level;
    if (this.level < MAX_STARS) this.level++;
    Bus.emit('wanted-raise', { level: this.level });
    if (this.level !== prev) Bus.emit('wanted-changed', { level: this.level });
    Bus.emit('toast', { text: `⭐ 通缉 ${this.level} 星 — ${reason}` });
    this.syncPolice();
  }

  private em() { return (this.parent as any).parent; }

  private playerGroundPos(): THREE.Vector3 {
    const car = this.FindEntity('Car')?.GetComponent('Car');
    if (car?.Active) return car.Position;
    return this.FindEntity('Player')!.Position as THREE.Vector3;
  }

  /** 让在场警察数量向 星级×perStar 对齐。
   *  allowSpawn=false（降星时）只裁减不补充——降星还在玩家身边刷新警察会让"甩脱"自相矛盾。 */
  private syncPolice(allowSpawn = true) {
    const want = this.level * this.tuning.perStar;
    const p = this.playerGroundPos();
    while (allowSpawn && this.police.length < want) {
      const ang = Math.random() * Math.PI * 2;
      const spawn = new THREE.Vector3(
        p.x + Math.cos(ang) * this.tuning.spawnRadius,
        0,
        p.z + Math.sin(ang) * this.tuning.spawnRadius,
      );
      spawn.x = Math.max(-70, Math.min(70, spawn.x));
      spawn.z = Math.max(-70, Math.min(70, spawn.z));
      const e = new Entity();
      e.SetName(`Police${this.spawnSeq++}`);
      e.SetPosition(spawn);
      e.AddComponent(new PoliceNPC(cloneSoldier(this.soldierGltf, 0x2a4bd7), this.scene, this.tuning.speed));
      this.em().Add(e);       // EndSetup 之后 Add 会自动 Initialize（引擎已支持）
      this.police.push(e);
    }
    while (this.police.length > want) {
      const e = this.police.pop()!;
      e.GetComponent('PoliceNPC').dispose();
      this.em().Remove(e);
    }
  }

  private bust() {
    // 系统职责只剩"通缉机制本身"：清星、撤警力。
    // 被捕的"后果"（传送到哪、提示什么）已迁入 ECA 规则层（content/rules.json）——
    // 曾有真实 bug：传送点硬编码 (0,0)，玩家在广场盖楼后被传送进楼里卡死；
    // 规则层的 teleport_player 只接受命名点位 + L0 校验 + 运行时安全落点，写不出那种 bug。
    this.level = 0;
    Bus.emit('wanted-changed', { level: this.level });
    this.syncPolice();
    Bus.emit('busted', {});
  }

  Update(t: number): void {
    if (this.level === 0) return;

    const p = this.playerGroundPos();
    // 跟丢消散：被甩开 >cullDist 的警察退出追捕（从场景与实体表移除）
    for (let i = this.police.length - 1; i >= 0; i--) {
      const cop = this.police[i].GetComponent('PoliceNPC');
      if (cop.Position.distanceTo(p) > this.tuning.cullDist) {
        cop.dispose();
        this.em().Remove(this.police[i]);
        this.police.splice(i, 1);
      }
    }
    let nearest = Infinity;
    for (const e of this.police) {
      const d = e.GetComponent('PoliceNPC').Position.distanceTo(p);
      nearest = Math.min(nearest, d);
    }

    // 被捕：仅步行状态可被贴身抓住（在车里警察追不上）
    const car = this.FindEntity('Car')?.GetComponent('Car');
    if (!car?.Active && nearest < this.tuning.bustDist) { this.bust(); return; }

    // 甩脱降星
    if (nearest > this.tuning.escapeDist) {
      this.escapeTimer += t;
      if (this.escapeTimer >= this.tuning.escapeTime) {
        this.escapeTimer = 0;
        this.level--;
        Bus.emit('wanted-changed', { level: this.level });
        this.syncPolice(false);   // 降星只裁减，绝不在玩家身边补刷警察
        Bus.emit('wanted-drop', { level: this.level });
        Bus.emit('toast', { text: this.level === 0 ? '✅ 甩掉警察了！通缉解除' : `通缉降为 ${this.level} 星` });
      }
    } else {
      this.escapeTimer = 0;
    }
  }
}
