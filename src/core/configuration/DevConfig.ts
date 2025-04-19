import { UnitInfo, UnitType } from "../game/Game";
import { UserSettings } from "../game/UserSettings";
import { GameConfig } from "../Schemas";
import { GameEnv, ServerConfig } from "./Config";
import { DefaultConfig, DefaultServerConfig } from "./DefaultConfig";

export class DevServerConfig extends DefaultServerConfig {
  r2Bucket(): string {
    return "openfront-staging";
  }
  adminToken(): string {
    return "WARNING_DEV_ADMIN_KEY_DO_NOT_USE_IN_PRODUCTION";
  }

  env(): GameEnv {
    return GameEnv.Dev;
  }

  gameCreationRate(): number {
    return 5 * 1000;
  }

  lobbyMaxPlayers(): number {
    return Math.random() < 0.5 ? 2 : 3;
  }

  samWarheadHittingChance(): number {
    return 1;
  }

  samHittingChance(): number {
    return 1;
  }

  discordRedirectURI(): string {
    return "http://localhost:3000/auth/callback";
  }
  numWorkers(): number {
    return 2;
  }
  gitCommit(): string {
    return "DEV";
  }
}

export class DevConfig extends DefaultConfig {
  constructor(sc: ServerConfig, gc: GameConfig, us: UserSettings) {
    super(sc, gc, us);
  }

  // numSpawnPhaseTurns(): number {
  //   return this.gameConfig().gameType == GameType.Singleplayer ? 70 : 100;
  //   // return 100
  // }

  unitInfo(type: UnitType): UnitInfo {
    const info = super.unitInfo(type);
    const oldCost = info.cost;
    // info.cost = (p: Player) => oldCost(p) / 1000000000;
    return info;
  }

  // tradeShipSpawnRate(): number {
  //   return 10;
  // }

  // percentageTilesOwnedToWin(): number {
  //     return 1
  // }

  // populationIncreaseRate(player: Player): number {
  //     return this.maxPopulation(player)
  // }

  // boatMaxDistance(): number {
  //     return 5000
  // }

  //   numBots(): number {
  //     return 0;
  //   }
  //   spawnNPCs(): boolean {
  //     return false;
  //   }
}
