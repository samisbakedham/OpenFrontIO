import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  Player,
  PlayerID,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";

export class WarshipExecution implements Execution {
  private random: PseudoRandom;

  private _owner: Player;
  private active = true;
  private warship: Unit = null;
  private mg: Game = null;

  private target: Unit = null;
  private pathfinder: PathFinder;

  private patrolTile: TileRef;

  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();

  constructor(
    private playerID: PlayerID,
    private patrolCenterTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.playerID)) {
      console.log(`WarshipExecution: player ${this.playerID} not found`);
      this.active = false;
      return;
    }
    this.pathfinder = PathFinder.Mini(mg, 5000, false);
    this._owner = mg.player(this.playerID);
    this.mg = mg;
    this.patrolTile = this.patrolCenterTile;
    this.random = new PseudoRandom(mg.ticks());
  }

  // Only for warships with "moveTarget" set
  goToMoveTarget(target: TileRef): boolean {
    // Patrol unless we are hunting down a tradeship
    const result = this.pathfinder.nextTile(this.warship.tile(), target);
    switch (result.type) {
      case PathFindResultType.Completed:
        this.warship.setMoveTarget(null);
        return;
      case PathFindResultType.NextTile:
        this.warship.move(result.tile);
        break;
      case PathFindResultType.Pending:
        break;
      case PathFindResultType.PathNotFound:
        consolex.log(`path not found to target`);
        break;
    }
  }

  private shoot() {
    const shellAttackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      this.lastShellAttack = this.mg.ticks();
      this.mg.addExecution(
        new ShellExecution(
          this.warship.tile(),
          this.warship.owner(),
          this.warship,
          this.target,
        ),
      );
      if (!this.target.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.target);
        this.target = null;
        return;
      }
    }
  }

  private patrol() {
    this.warship.setWarshipTarget(this.target);
    if (this.target == null || this.target.type() != UnitType.TradeShip) {
      // Patrol unless we are hunting down a tradeship
      const result = this.pathfinder.nextTile(
        this.warship.tile(),
        this.patrolTile,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this.patrolTile = this.randomTile();
          break;
        case PathFindResultType.NextTile:
          this.warship.move(result.tile);
          break;
        case PathFindResultType.Pending:
          return;
        case PathFindResultType.PathNotFound:
          consolex.log(`path not found to patrol tile`);
          this.patrolTile = this.randomTile();
          break;
      }
    }
  }

  tick(ticks: number): void {
    if (this.warship == null) {
      const spawn = this._owner.canBuild(UnitType.Warship, this.patrolTile);
      if (spawn == false) {
        this.active = false;
        return;
      }
      this.warship = this._owner.buildUnit(UnitType.Warship, 0, spawn);
      return;
    }
    if (!this.warship.isActive()) {
      this.active = false;
      return;
    }
    if (this.target != null && !this.target.isActive()) {
      this.target = null;
    }
    const hasPort = this._owner.units(UnitType.Port).length > 0;
    const ships = this.mg
      .nearbyUnits(
        this.warship.tile(),
        this.mg.config().warshipTargettingRange(),
        [UnitType.TransportShip, UnitType.Warship, UnitType.TradeShip],
      )
      .filter(
        ({ unit }) =>
          unit.owner() !== this.warship.owner() &&
          unit !== this.warship &&
          !unit.owner().isFriendly(this.warship.owner()) &&
          !this.alreadySentShell.has(unit) &&
          (unit.type() !== UnitType.TradeShip ||
            (hasPort &&
              unit.dstPort()?.owner() !== this.warship.owner() &&
              !unit.dstPort()?.owner().isFriendly(this.warship.owner()) &&
              unit.isSafeFromPirates() !== true)),
      );

    this.target =
      ships.sort((a, b) => {
        const { unit: unitA, distSquared: distA } = a;
        const { unit: unitB, distSquared: distB } = b;

        // Prioritize Warships
        if (
          unitA.type() === UnitType.Warship &&
          unitB.type() !== UnitType.Warship
        )
          return -1;
        if (
          unitA.type() !== UnitType.Warship &&
          unitB.type() === UnitType.Warship
        )
          return 1;

        // Then favor Transport Ships over Trade Ships
        if (
          unitA.type() === UnitType.TransportShip &&
          unitB.type() !== UnitType.TransportShip
        )
          return -1;
        if (
          unitA.type() !== UnitType.TransportShip &&
          unitB.type() === UnitType.TransportShip
        )
          return 1;

        // If both are the same type, sort by distance (lower `distSquared` means closer)
        return distA - distB;
      })[0]?.unit ?? null;

    if (this.warship.moveTarget()) {
      this.goToMoveTarget(this.warship.moveTarget());
      // If we have a "move target" then we cannot target trade ships as it
      // requires moving.
      if (this.target && this.target.type() == UnitType.TradeShip) {
        this.target = null;
      }
    } else if (!this.target || this.target.type() != UnitType.TradeShip) {
      this.patrol();
    }

    if (
      this.target == null ||
      !this.target.isActive() ||
      this.target.owner() == this._owner ||
      this.target.isSafeFromPirates() == true
    ) {
      // In case another warship captured or destroyed target, or the target escaped into safe waters
      this.target = null;
      return;
    }

    this.warship.setWarshipTarget(this.target);

    // If we have a move target we do not want to go after trading ships
    if (!this.target) {
      return;
    }

    if (this.target.type() != UnitType.TradeShip) {
      this.shoot();
      return;
    }

    for (let i = 0; i < 2; i++) {
      // target is trade ship so capture it.
      const result = this.pathfinder.nextTile(
        this.warship.tile(),
        this.target.tile(),
        5,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this._owner.captureUnit(this.target);
          this.target = null;
          return;
        case PathFindResultType.NextTile:
          this.warship.move(result.tile);
          break;
        case PathFindResultType.Pending:
          break;
        case PathFindResultType.PathNotFound:
          consolex.log(`path not found to target`);
          break;
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(): TileRef {
    let warshipPatrolRange = this.mg.config().warshipPatrolRange();
    const maxAttemptBeforeExpand: number = warshipPatrolRange * 2;
    let attemptCount: number = 0;
    let expandCount: number = 0;
    while (expandCount < 3) {
      const x =
        this.mg.x(this.patrolCenterTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      const y =
        this.mg.y(this.patrolCenterTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (!this.mg.isOcean(tile) || this.mg.isShoreline(tile)) {
        attemptCount++;
        if (attemptCount === maxAttemptBeforeExpand) {
          expandCount++;
          attemptCount = 0;
          warshipPatrolRange =
            warshipPatrolRange + Math.floor(warshipPatrolRange / 2);
        }
        continue;
      }
      return tile;
    }
  }
}
