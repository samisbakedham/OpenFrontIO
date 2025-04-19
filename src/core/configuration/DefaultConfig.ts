import {
  Difficulty,
  Game,
  GameMapType,
  GameMode,
  GameType,
  Gold,
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { UserSettings } from "../game/UserSettings";
import { GameConfig, GameID } from "../Schemas";
import { assertNever, simpleHash, within } from "../Util";
import { Config, GameEnv, NukeMagnitude, ServerConfig, Theme } from "./Config";
import { pastelTheme } from "./PastelTheme";
import { pastelThemeDark } from "./PastelThemeDark";

export abstract class DefaultServerConfig implements ServerConfig {
  region(): string {
    if (this.env() == GameEnv.Dev) {
      return "dev";
    }
    return process.env.REGION;
  }
  gitCommit(): string {
    return process.env.GIT_COMMIT;
  }
  r2Endpoint(): string {
    return `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }
  r2AccessKey(): string {
    return process.env.R2_ACCESS_KEY;
  }
  r2SecretKey(): string {
    return process.env.R2_SECRET_KEY;
  }
  abstract r2Bucket(): string;
  adminHeader(): string {
    return "x-admin-key";
  }
  adminToken(): string {
    return process.env.ADMIN_TOKEN;
  }
  abstract numWorkers(): number;
  abstract env(): GameEnv;
  abstract discordRedirectURI(): string;
  turnIntervalMs(): number {
    return 100;
  }
  gameCreationRate(): number {
    return 60 * 1000;
  }
  lobbyMaxPlayers(map: GameMapType): number {
    // Maps with ~4 mil pixels
    if (
      [
        GameMapType.GatewayToTheAtlantic,
        GameMapType.SouthAmerica,
        GameMapType.NorthAmerica,
        GameMapType.Africa,
        GameMapType.Europe,
      ].includes(map)
    ) {
      return Math.random() < 0.2 ? 100 : 50;
    }
    // Maps with ~2.5 - ~3.5 mil pixels
    if (
      [
        GameMapType.Australia,
        GameMapType.Iceland,
        GameMapType.Britannia,
        GameMapType.Asia,
      ].includes(map)
    ) {
      return Math.random() < 0.3 ? 50 : 25;
    }
    // Maps with ~2 mil pixels
    if (
      [
        GameMapType.Mena,
        GameMapType.Mars,
        GameMapType.Oceania,
        GameMapType.Japan, // Japan at this level because its 2/3 water
        GameMapType.FaroeIslands,
      ].includes(map)
    ) {
      return Math.random() < 0.3 ? 50 : 25;
    }
    // Maps smaller than ~2 mil pixels
    if (
      [
        GameMapType.BetweenTwoSeas,
        GameMapType.BlackSea,
        GameMapType.Pangaea,
      ].includes(map)
    ) {
      return Math.random() < 0.5 ? 30 : 15;
    }
    // world belongs with the ~2 mils, but these amounts never made sense so I assume the insanity is intended.
    if (map == GameMapType.World) {
      return Math.random() < 0.2 ? 150 : 50;
    }
    // default return for non specified map
    return Math.random() < 0.2 ? 50 : 20;
  }
  workerIndex(gameID: GameID): number {
    return simpleHash(gameID) % this.numWorkers();
  }
  workerPath(gameID: GameID): string {
    return `w${this.workerIndex(gameID)}`;
  }
  workerPort(gameID: GameID): number {
    return this.workerPortByIndex(this.workerIndex(gameID));
  }
  workerPortByIndex(index: number): number {
    return 3001 + index;
  }
}

export class DefaultConfig implements Config {
  constructor(
    private _serverConfig: ServerConfig,
    private _gameConfig: GameConfig,
    private _userSettings: UserSettings,
  ) {}

  samHittingChance(): number {
    return 0.8;
  }

  samWarheadHittingChance(): number {
    return 0.5;
  }

  traitorDefenseDebuff(): number {
    return 0.5;
  }
  traitorDuration(): number {
    return 30 * 10; // 30 seconds
  }
  spawnImmunityDuration(): Tick {
    return 5 * 10;
  }

  gameConfig(): GameConfig {
    return this._gameConfig;
  }

  serverConfig(): ServerConfig {
    return this._serverConfig;
  }

  userSettings(): UserSettings | null {
    return this._userSettings;
  }

  difficultyModifier(difficulty: Difficulty): number {
    switch (difficulty) {
      case Difficulty.Easy:
        return 1;
      case Difficulty.Medium:
        return 3;
      case Difficulty.Hard:
        return 9;
      case Difficulty.Impossible:
        return 18;
    }
  }

  cityPopulationIncrease(): number {
    return 250_000;
  }

  falloutDefenseModifier(falloutRatio: number): number {
    // falloutRatio is between 0 and 1
    // So defense modifier is between [5, 2.5]
    return 5 - falloutRatio * 2;
  }
  SAMCooldown(): number {
    return 75;
  }
  SiloCooldown(): number {
    return 75;
  }

  defensePostRange(): number {
    return 30;
  }
  defensePostDefenseBonus(): number {
    return 5;
  }
  numPlayerTeams(): number {
    return this._gameConfig.numPlayerTeams ?? 0;
  }
  spawnNPCs(): boolean {
    return !this._gameConfig.disableNPCs;
  }
  disableNukes(): boolean {
    return this._gameConfig.disableNukes;
  }
  bots(): number {
    return this._gameConfig.bots;
  }
  instantBuild(): boolean {
    return this._gameConfig.instantBuild;
  }
  infiniteGold(): boolean {
    return this._gameConfig.infiniteGold;
  }
  infiniteTroops(): boolean {
    return this._gameConfig.infiniteTroops;
  }
  tradeShipGold(dist: number): Gold {
    return 10000 + 150 * Math.pow(dist, 1.1);
  }
  tradeShipSpawnRate(numberOfPorts: number): number {
    if (numberOfPorts <= 3) return 18;
    if (numberOfPorts <= 5) return 25;
    if (numberOfPorts <= 8) return 35;
    if (numberOfPorts <= 10) return 40;
    if (numberOfPorts <= 12) return 45;
    return 50;
  }

  unitInfo(type: UnitType): UnitInfo {
    switch (type) {
      case UnitType.TransportShip:
        return {
          cost: () => 0,
          territoryBound: false,
        };
      case UnitType.Warship:
        return {
          cost: (p: Player) =>
            p.type() == PlayerType.Human && this.infiniteGold()
              ? 0
              : Math.min(
                  1_000_000,
                  (p.unitsIncludingConstruction(UnitType.Warship).length + 1) *
                    250_000,
                ),
          territoryBound: false,
          maxHealth: 1000,
        };
      case UnitType.Shell:
        return {
          cost: () => 0,
          territoryBound: false,
          damage: 250,
        };
      case UnitType.SAMMissile:
        return {
          cost: () => 0,
          territoryBound: false,
        };
      case UnitType.Port:
        return {
          cost: (p: Player) =>
            p.type() == PlayerType.Human && this.infiniteGold()
              ? 0
              : Math.min(
                  1_000_000,
                  Math.pow(
                    2,
                    p.unitsIncludingConstruction(UnitType.Port).length,
                  ) * 125_000,
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
        };
      case UnitType.AtomBomb:
        return {
          cost: (p: Player) =>
            p.type() == PlayerType.Human && this.infiniteGold() ? 0 : 750_000,
          territoryBound: false,
        };
      case UnitType.HydrogenBomb:
        return {
          cost: (p: Player) =>
            p.type() == PlayerType.Human && this.infiniteGold() ? 0 : 5_000_000,
          territoryBound: false,
        };
      case UnitType.MIRV:
        return {
          cost: (p: Player) =>
            p.type() == PlayerType.Human && this.infiniteGold()
              ? 0
              : 25_000_000,
          territoryBound: false,
        };
      case UnitType.MIRVWarhead:
        return {
          cost: () => 0,
          territoryBound: false,
        };
      case UnitType.TradeShip:
        return {
          cost: () => 0,
          territoryBound: false,
        };
      case UnitType.MissileSilo:
        return {
          cost: (p: Player) =>
            p.type() == PlayerType.Human && this.infiniteGold() ? 0 : 1_000_000,
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 10 * 10,
        };
      case UnitType.DefensePost:
        return {
          cost: (p: Player) =>
            p.type() == PlayerType.Human && this.infiniteGold()
              ? 0
              : Math.min(
                  250_000,
                  (p.unitsIncludingConstruction(UnitType.DefensePost).length +
                    1) *
                    50_000,
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
        };
      case UnitType.SAMLauncher:
        return {
          cost: (p: Player) =>
            p.type() == PlayerType.Human && this.infiniteGold()
              ? 0
              : Math.min(
                  3_000_000,
                  (p.unitsIncludingConstruction(UnitType.SAMLauncher).length +
                    1) *
                    1_500_000,
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 30 * 10,
        };
      case UnitType.City:
        return {
          cost: (p: Player) =>
            p.type() == PlayerType.Human && this.infiniteGold()
              ? 0
              : Math.min(
                  1_000_000,
                  Math.pow(
                    2,
                    p.unitsIncludingConstruction(UnitType.City).length,
                  ) * 125_000,
                ),
          territoryBound: true,
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
        };
      case UnitType.Construction:
        return {
          cost: () => 0,
          territoryBound: true,
        };
      default:
        assertNever(type);
    }
  }
  defaultDonationAmount(sender: Player): number {
    return Math.floor(sender.troops() / 3);
  }
  donateCooldown(): Tick {
    return 10 * 10;
  }
  emojiMessageDuration(): Tick {
    return 5 * 10;
  }
  emojiMessageCooldown(): Tick {
    return 5 * 10;
  }
  targetDuration(): Tick {
    return 10 * 10;
  }
  targetCooldown(): Tick {
    return 15 * 10;
  }
  allianceRequestCooldown(): Tick {
    return 30 * 10;
  }
  allianceDuration(): Tick {
    return 600 * 10; // 10 minutes.
  }
  percentageTilesOwnedToWin(): number {
    if (this._gameConfig.gameMode == GameMode.Team) {
      return 95;
    }
    return 80;
  }
  boatMaxNumber(): number {
    return 9;
  }
  numSpawnPhaseTurns(): number {
    return this._gameConfig.gameType == GameType.Singleplayer ? 100 : 300;
  }
  numBots(): number {
    return this.bots();
  }
  theme(): Theme {
    return this.userSettings().darkMode() ? pastelThemeDark : pastelTheme;
  }

  attackLogic(
    gm: Game,
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    tileToConquer: TileRef,
  ): {
    attackerTroopLoss: number;
    defenderTroopLoss: number;
    tilesPerTickUsed: number;
  } {
    let mag = 0;
    let speed = 0;
    const type = gm.terrainType(tileToConquer);
    switch (type) {
      case TerrainType.Plains:
        mag = 85;
        speed = 16.5;
        break;
      case TerrainType.Highland:
        mag = 100;
        speed = 20;
        break;
      case TerrainType.Mountain:
        mag = 120;
        speed = 25;
        break;
      default:
        throw new Error(`terrain type ${type} not supported`);
    }
    if (defender.isPlayer()) {
      for (const dp of gm.nearbyUnits(
        tileToConquer,
        gm.config().defensePostRange(),
        UnitType.DefensePost,
      )) {
        if (dp.unit.owner() == defender) {
          mag *= this.defensePostDefenseBonus();
          speed *= this.defensePostDefenseBonus();
          break;
        }
      }
    }

    if (gm.hasFallout(tileToConquer)) {
      const falloutRatio = gm.numTilesWithFallout() / gm.numLandTiles();
      mag *= this.falloutDefenseModifier(falloutRatio);
      speed *= this.falloutDefenseModifier(falloutRatio);
    }

    if (attacker.isPlayer() && defender.isPlayer()) {
      if (
        attacker.type() == PlayerType.Human &&
        defender.type() == PlayerType.Bot
      ) {
        mag *= 0.8;
      }
      if (
        attacker.type() == PlayerType.FakeHuman &&
        defender.type() == PlayerType.Bot
      ) {
        mag *= 0.8;
      }
    }

    let largeLossModifier = 1;
    if (attacker.numTilesOwned() > 100_000) {
      largeLossModifier = Math.sqrt(100_000 / attacker.numTilesOwned());
    }
    let largeSpeedMalus = 1;
    if (attacker.numTilesOwned() > 75_000) {
      // sqrt is only exponent 1/2 which doesn't slow enough huge players
      largeSpeedMalus = (75_000 / attacker.numTilesOwned()) ** 0.6;
    }

    if (defender.isPlayer()) {
      const ratio = within(
        Math.pow(defender.troops() / attackTroops, 0.4),
        0.1,
        10,
      );
      const speedRatio = within(
        defender.troops() / (5 * attackTroops),
        0.1,
        10,
      );

      return {
        attackerTroopLoss:
          ratio *
          mag *
          largeLossModifier *
          (defender.isTraitor() ? this.traitorDefenseDebuff() : 1),
        defenderTroopLoss: defender.population() / defender.numTilesOwned(),
        tilesPerTickUsed: Math.floor(speedRatio * speed * largeSpeedMalus),
      };
    } else {
      return {
        attackerTroopLoss:
          attacker.type() == PlayerType.Bot ? mag / 10 : mag / 5,
        defenderTroopLoss: 0,
        tilesPerTickUsed: within(
          (2000 * Math.max(10, speed)) / attackTroops,
          5,
          100,
        ),
      };
    }
  }

  attackTilesPerTick(
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number {
    if (defender.isPlayer()) {
      return (
        within(((5 * attackTroops) / defender.troops()) * 2, 0.01, 0.5) *
        numAdjacentTilesWithEnemy *
        3
      );
    } else {
      return numAdjacentTilesWithEnemy * 2;
    }
  }

  boatAttackAmount(attacker: Player, defender: Player | TerraNullius): number {
    return Math.floor(attacker.troops() / 5);
  }

  warshipShellLifetime(): number {
    return 20; // in ticks (one tick is 100ms)
  }

  radiusPortSpawn() {
    return 20;
  }

  proximityBonusPortsNb(totalPorts: number) {
    return within(totalPorts / 3, 4, totalPorts);
  }

  attackAmount(attacker: Player, defender: Player | TerraNullius) {
    if (attacker.type() == PlayerType.Bot) {
      return attacker.troops() / 20;
    } else {
      return attacker.troops() / 5;
    }
  }

  startManpower(playerInfo: PlayerInfo): number {
    if (playerInfo.playerType == PlayerType.Bot) {
      return 10_000;
    }
    if (playerInfo.playerType == PlayerType.FakeHuman) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          return 2_500 * (playerInfo?.nation?.strength ?? 1);
        case Difficulty.Medium:
          return 5_000 * (playerInfo?.nation?.strength ?? 1);
        case Difficulty.Hard:
          return 20_000 * (playerInfo?.nation?.strength ?? 1);
        case Difficulty.Impossible:
          return 50_000 * (playerInfo?.nation?.strength ?? 1);
      }
    }
    return this.infiniteTroops() ? 1_000_000 : 25_000;
  }

  maxPopulation(player: Player | PlayerView): number {
    const maxPop =
      player.type() == PlayerType.Human && this.infiniteTroops()
        ? 1_000_000_000
        : 2 * (Math.pow(player.numTilesOwned(), 0.6) * 1000 + 50000) +
          player.units(UnitType.City).length * this.cityPopulationIncrease();

    if (player.type() == PlayerType.Bot) {
      return maxPop / 2;
    }

    if (player.type() == PlayerType.Human) {
      return maxPop;
    }

    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return maxPop * 0.5;
      case Difficulty.Medium:
        return maxPop * 1;
      case Difficulty.Hard:
        return maxPop * 1.5;
      case Difficulty.Impossible:
        return maxPop * 2;
    }
  }

  populationIncreaseRate(player: Player): number {
    const max = this.maxPopulation(player);

    let toAdd = 10 + Math.pow(player.population(), 0.73) / 4;

    const ratio = 1 - player.population() / max;
    toAdd *= ratio;

    if (player.type() == PlayerType.Bot) {
      toAdd *= 0.7;
    }

    if (player.type() == PlayerType.FakeHuman) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          toAdd *= 0.9;
          break;
        case Difficulty.Medium:
          toAdd *= 1;
          break;
        case Difficulty.Hard:
          toAdd *= 1.1;
          break;
        case Difficulty.Impossible:
          toAdd *= 1.2;
          break;
      }
    }

    return Math.min(player.population() + toAdd, max) - player.population();
  }

  goldAdditionRate(player: Player): number {
    const ratio = Math.pow(player.workers() / player.population(), 1.3);
    return Math.floor(Math.sqrt(player.workers()) * ratio * 5);
  }

  troopAdjustmentRate(player: Player): number {
    const maxDiff = this.maxPopulation(player) / 1000;
    const target = player.population() * player.targetTroopRatio();
    const diff = target - player.troops();
    if (Math.abs(diff) < maxDiff) {
      return diff;
    }
    const adjustment = maxDiff * Math.sign(diff);
    // Can ramp down troops much faster
    if (adjustment < 0) {
      return adjustment * 5;
    }
    return adjustment;
  }

  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    switch (unitType) {
      case UnitType.MIRVWarhead:
        return { inner: 25, outer: 30 };
      case UnitType.AtomBomb:
        return { inner: 12, outer: 30 };
      case UnitType.HydrogenBomb:
        return { inner: 80, outer: 100 };
    }
  }

  defaultNukeSpeed(): number {
    return 4;
  }

  // Humans can be population, soldiers attacking, soldiers in boat etc.
  nukeDeathFactor(humans: number, tilesOwned: number): number {
    return (5 * humans) / Math.max(1, tilesOwned);
  }

  structureMinDist(): number {
    return 18;
  }

  shellLifetime(): number {
    return 50;
  }

  warshipPatrolRange(): number {
    return 100;
  }

  warshipTargettingRange(): number {
    return 130;
  }

  warshipShellAttackRate(): number {
    return 20;
  }

  defensePostShellAttackRate(): number {
    return 100;
  }

  safeFromPiratesCooldownMax(): number {
    return 20;
  }

  defensePostTargettingRange(): number {
    return 75;
  }
}
