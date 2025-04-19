import { Logger } from "winston";
import WebSocket from "ws";
import {
  AllPlayersStats,
  ClientID,
  ClientMessage,
  ClientMessageSchema,
  ClientSendWinnerMessage,
  GameConfig,
  GameInfo,
  GameStartInfo,
  GameStartInfoSchema,
  Intent,
  PlayerRecord,
  ServerDesyncSchema,
  ServerPrestartMessageSchema,
  ServerStartGameMessageSchema,
  ServerTurnMessageSchema,
  Turn,
} from "../core/Schemas";
import { createGameRecord } from "../core/Util";
import { ServerConfig } from "../core/configuration/Config";
import { GameType } from "../core/game/Game";
import { archive } from "./Archive";
import { Client } from "./Client";
import { gatekeeper } from "./Gatekeeper";
export enum GamePhase {
  Lobby = "LOBBY",
  Active = "ACTIVE",
  Finished = "FINISHED",
}

export class GameServer {
  private sentDesyncMessageClients = new Set<ClientID>();

  private maxGameDuration = 3 * 60 * 60 * 1000; // 3 hours

  private turns: Turn[] = [];
  private intents: Intent[] = [];
  public activeClients: Client[] = [];
  // Used for record record keeping
  private allClients: Map<ClientID, Client> = new Map();
  private _hasStarted = false;
  private _startTime: number = null;

  private endTurnIntervalID;

  private lastPingUpdate = 0;

  private winner: ClientSendWinnerMessage = null;
  // This field is currently only filled at victory
  private allPlayersStats: AllPlayersStats = {};

  private gameStartInfo: GameStartInfo;

  private log: Logger;

  private _hasPrestarted = false;

  constructor(
    public readonly id: string,
    readonly log_: Logger,
    public readonly createdAt: number,
    private config: ServerConfig,
    public gameConfig: GameConfig,
  ) {
    this.log = log_.child({ gameID: id });
  }

  public updateGameConfig(gameConfig: GameConfig): void {
    if (gameConfig.gameMap != null) {
      this.gameConfig.gameMap = gameConfig.gameMap;
    }
    if (gameConfig.difficulty != null) {
      this.gameConfig.difficulty = gameConfig.difficulty;
    }
    if (gameConfig.disableNPCs != null) {
      this.gameConfig.disableNPCs = gameConfig.disableNPCs;
    }
    if (gameConfig.disableNukes != null) {
      this.gameConfig.disableNukes = gameConfig.disableNukes;
    }
    if (gameConfig.bots != null) {
      this.gameConfig.bots = gameConfig.bots;
    }
    if (gameConfig.infiniteGold != null) {
      this.gameConfig.infiniteGold = gameConfig.infiniteGold;
    }
    if (gameConfig.infiniteTroops != null) {
      this.gameConfig.infiniteTroops = gameConfig.infiniteTroops;
    }
    if (gameConfig.instantBuild != null) {
      this.gameConfig.instantBuild = gameConfig.instantBuild;
    }
    if (gameConfig.gameMode != null) {
      this.gameConfig.gameMode = gameConfig.gameMode;
    }
  }

  public addClient(client: Client, lastTurn: number) {
    this.log.info("client (re)joining game", {
      clientID: client.clientID,
      persistentID: client.persistentID,
      clientIP: client.ip,
      isRejoin: lastTurn > 0,
    });

    if (
      this.gameConfig.gameType == GameType.Public &&
      this.activeClients.filter(
        (c) => c.ip == client.ip && c.clientID != client.clientID,
      ).length >= 3
    ) {
      this.log.warn("cannot add client, already have 3 ips", {
        clientID: client.clientID,
        clientIP: client.ip,
      });
      return;
    }

    // Remove stale client if this is a reconnect
    const existing = this.activeClients.find(
      (c) => c.clientID == client.clientID,
    );
    if (existing != null) {
      existing.ws.removeAllListeners("message");
    }
    this.activeClients = this.activeClients.filter(
      (c) => c.clientID != client.clientID,
    );
    this.activeClients.push(client);
    client.lastPing = Date.now();

    this.allClients.set(client.clientID, client);

    client.ws.on(
      "message",
      gatekeeper.wsHandler(client.ip, async (message: string) => {
        try {
          let clientMsg: ClientMessage = null;
          try {
            clientMsg = ClientMessageSchema.parse(JSON.parse(message));
          } catch (error) {
            throw Error(`error parsing schema for ${client.ip}`);
          }
          if (this.allClients.has(clientMsg.clientID)) {
            const client = this.allClients.get(clientMsg.clientID);
            if (client.persistentID != clientMsg.persistentID) {
              this.log.warn(
                `Client ID ${clientMsg.clientID} sent incorrect id ${clientMsg.persistentID}, does not match persistent id ${client.persistentID}`,
                {
                  clientID: clientMsg.clientID,
                  persistentID: clientMsg.persistentID,
                },
              );
              return;
            }
          }

          // Clear out persistent id to make sure it doesn't get sent to other clients.
          clientMsg.persistentID = null;

          if (clientMsg.type == "intent") {
            if (clientMsg.gameID == this.id) {
              this.addIntent(clientMsg.intent);
            } else {
              this.log.warn("client sent to wrong game", {
                clientID: clientMsg.clientID,
                persistentID: clientMsg.persistentID,
              });
            }
          }
          if (clientMsg.type == "ping") {
            this.lastPingUpdate = Date.now();
            client.lastPing = Date.now();
          }
          if (clientMsg.type == "hash") {
            client.hashes.set(clientMsg.turnNumber, clientMsg.hash);
          }
          if (clientMsg.type == "winner") {
            this.winner = clientMsg;
            this.allPlayersStats = clientMsg.allPlayersStats;
          }
        } catch (error) {
          this.log.info(
            `error handline websocket request in game server: ${error}`,
            {
              clientID: client.clientID,
            },
          );
        }
      }),
    );
    client.ws.on("close", () => {
      this.log.info("client disconnected", {
        clientID: client.clientID,
        persistentID: client.persistentID,
      });
      this.activeClients = this.activeClients.filter(
        (c) => c.clientID != client.clientID,
      );
    });
    client.ws.on("error", (error: Error) => {
      if ((error as any).code === "WS_ERR_UNEXPECTED_RSV_1") {
        client.ws.close(1002);
      }
    });

    // In case a client joined the game late and missed the start message.
    if (this._hasStarted) {
      this.sendStartGameMsg(client.ws, lastTurn);
    }
  }

  public numClients(): number {
    return this.activeClients.length;
  }

  public startTime(): number {
    if (this._startTime > 0) {
      return this._startTime;
    } else {
      //game hasn't started yet, only works for public games
      return this.createdAt + this.config.gameCreationRate();
    }
  }

  public prestart() {
    if (this.hasStarted()) {
      return;
    }
    this._hasPrestarted = true;

    const prestartMsg = ServerPrestartMessageSchema.safeParse({
      type: "prestart",
      gameMap: this.gameConfig.gameMap,
    });

    if (!prestartMsg.success) {
      console.error(
        `error creating prestart message for game ${this.id}, ${prestartMsg.error}`.substring(
          0,
          250,
        ),
      );
      return;
    }

    const msg = JSON.stringify(prestartMsg.data);
    this.activeClients.forEach((c) => {
      this.log.info("sending prestart message", {
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      c.ws.send(msg);
    });
  }

  public start() {
    if (this._hasStarted) {
      return;
    }
    this._hasStarted = true;
    this._startTime = Date.now();
    // Set last ping to start so we don't immediately stop the game
    // if no client connects/pings.
    this.lastPingUpdate = Date.now();

    this.gameStartInfo = GameStartInfoSchema.parse({
      gameID: this.id,
      config: this.gameConfig,
      players: this.activeClients.map((c) => ({
        playerID: c.playerID,
        username: c.username,
        clientID: c.clientID,
        flag: c.flag,
      })),
    });

    this.endTurnIntervalID = setInterval(
      () => this.endTurn(),
      this.config.turnIntervalMs(),
    );
    this.activeClients.forEach((c) => {
      this.log.info("sending start message", {
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      this.sendStartGameMsg(c.ws, 0);
    });
  }

  private addIntent(intent: Intent) {
    this.intents.push(intent);
  }

  private sendStartGameMsg(ws: WebSocket, lastTurn: number) {
    try {
      ws.send(
        JSON.stringify(
          ServerStartGameMessageSchema.parse({
            type: "start",
            turns: this.turns.slice(lastTurn),
            gameStartInfo: this.gameStartInfo,
          }),
        ),
      );
    } catch (error) {
      throw new Error(
        `error sending start message for game ${this.id}, ${error}`.substring(
          0,
          250,
        ),
      );
    }
  }

  private endTurn() {
    const pastTurn: Turn = {
      turnNumber: this.turns.length,
      gameID: this.id,
      intents: this.intents,
    };
    this.turns.push(pastTurn);
    this.intents = [];

    this.handleSynchronization();

    let msg = "";
    try {
      msg = JSON.stringify(
        ServerTurnMessageSchema.parse({
          type: "turn",
          turn: pastTurn,
        }),
      );
    } catch (error) {
      this.log.info(
        `error sending message for game: ${error.substring(0, 250)}`,
        {},
      );
      return;
    }

    this.activeClients.forEach((c) => {
      c.ws.send(msg);
    });
  }

  async end() {
    // Close all WebSocket connections
    clearInterval(this.endTurnIntervalID);
    this.allClients.forEach((client) => {
      client.ws.removeAllListeners("message");
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1000, "game has ended");
      }
    });
    if (!this._hasPrestarted || !this._hasStarted) {
      this.log.info(`game not started, not archiving game`);
      return;
    }
    this.log.info(`ending game with ${this.turns.length} turns`);
    try {
      if (this.allClients.size > 0) {
        const playerRecords: PlayerRecord[] = Array.from(
          this.allClients.values(),
        ).map((client) => ({
          ip: client.ip,
          clientID: client.clientID,
          username: client.username,
          persistentID: client.persistentID,
        }));
        archive(
          createGameRecord(
            this.id,
            this.gameStartInfo,
            playerRecords,
            this.turns,
            this._startTime,
            Date.now(),
            this.winner?.winner,
            this.winner?.winnerType,
            this.allPlayersStats,
          ),
        );
      } else {
        this.log.info("no clients joined, not archiving game", {
          gameID: this.id,
        });
      }
    } catch (error) {
      let errorDetails;
      if (error instanceof Error) {
        errorDetails = {
          message: error.message,
          stack: error.stack,
        };
      } else if (Array.isArray(error)) {
        errorDetails = error; // Now we'll actually see the array contents
      } else {
        try {
          errorDetails = JSON.stringify(error, null, 2);
        } catch (e) {
          errorDetails = String(error);
        }
      }

      this.log.error("Error archiving game record details:", {
        gameId: this.id,
        errorType: typeof error,
        error: errorDetails,
      });
    }
  }

  phase(): GamePhase {
    const now = Date.now();
    const alive = [];
    for (const client of this.activeClients) {
      if (now - client.lastPing > 60_000) {
        this.log.info("no pings received, terminating connection", {
          clientID: client.clientID,
          persistentID: client.persistentID,
        });
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close(1000, "no heartbeats received, closing connection");
        }
      } else {
        alive.push(client);
      }
    }
    this.activeClients = alive;
    if (now > this.createdAt + this.maxGameDuration) {
      this.log.warn("game past max duration", {
        gameID: this.id,
      });
      return GamePhase.Finished;
    }

    const noRecentPings = now > this.lastPingUpdate + 20 * 1000;
    const noActive = this.activeClients.length == 0;

    if (this.gameConfig.gameType != GameType.Public) {
      if (this._hasStarted) {
        if (noActive && noRecentPings) {
          this.log.info("private game complete", {
            gameID: this.id,
          });
          return GamePhase.Finished;
        } else {
          return GamePhase.Active;
        }
      } else {
        return GamePhase.Lobby;
      }
    }

    const msSinceCreation = now - this.createdAt;
    const lessThanLifetime = msSinceCreation < this.config.gameCreationRate();
    const notEnoughPlayers =
      this.gameConfig.gameType == GameType.Public &&
      this.gameConfig.maxPlayers &&
      this.activeClients.length < this.gameConfig.maxPlayers;
    if (lessThanLifetime && notEnoughPlayers) {
      return GamePhase.Lobby;
    }
    const warmupOver =
      now > this.createdAt + this.config.gameCreationRate() + 30 * 1000;
    if (noActive && warmupOver && noRecentPings) {
      return GamePhase.Finished;
    }

    return GamePhase.Active;
  }

  hasStarted(): boolean {
    return this._hasStarted || this._hasPrestarted;
  }

  public gameInfo(): GameInfo {
    return {
      gameID: this.id,
      clients: this.activeClients.map((c) => ({
        username: c.username,
        clientID: c.clientID,
      })),
      gameConfig: this.gameConfig,
      msUntilStart: this.isPublic()
        ? this.createdAt + this.config.gameCreationRate()
        : undefined,
    };
  }

  public isPublic(): boolean {
    return this.gameConfig.gameType == GameType.Public;
  }

  private handleSynchronization() {
    if (this.activeClients.length <= 1) {
      return;
    }
    if (this.turns.length % 10 != 0 || this.turns.length < 10) {
      // Check hashes every 10 turns
      return;
    }

    const lastHashTurn = this.turns.length - 10;

    const { mostCommonHash, outOfSyncClients } =
      this.findOutOfSyncClients(lastHashTurn);

    if (outOfSyncClients.length == 0) {
      this.turns[lastHashTurn].hash = mostCommonHash;
      return;
    }

    const serverDesync = ServerDesyncSchema.safeParse({
      type: "desync",
      turn: lastHashTurn,
      correctHash: mostCommonHash,
      clientsWithCorrectHash:
        this.activeClients.length - outOfSyncClients.length,
      totalActiveClients: this.activeClients.length,
    });
    if (!serverDesync.success) {
      this.log.warn("failed to create desync message", {
        gameID: this.id,
        error: serverDesync.error,
      });
      return;
    }

    const desyncMsg = JSON.stringify(serverDesync.data);
    for (const c of outOfSyncClients) {
      if (this.sentDesyncMessageClients.has(c.clientID)) {
        continue;
      }
      this.sentDesyncMessageClients.add(c.clientID);
      this.log.info("sending desync to client", {
        gameID: this.id,
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      c.ws.send(desyncMsg);
    }
  }

  findOutOfSyncClients(turnNumber: number): {
    mostCommonHash: number | null;
    outOfSyncClients: Client[];
  } {
    const counts = new Map<number, number>();

    // Count occurrences of each hash
    for (const client of this.activeClients) {
      if (client.hashes.has(turnNumber)) {
        const clientHash = client.hashes.get(turnNumber)!;
        counts.set(clientHash, (counts.get(clientHash) || 0) + 1);
      }
    }

    // Find the most common hash
    let mostCommonHash: number | null = null;
    let maxCount = 0;

    for (const [hash, count] of counts.entries()) {
      if (count > maxCount) {
        mostCommonHash = hash;
        maxCount = count;
      }
    }

    // Create a list of clients whose hash doesn't match the most common one
    let outOfSyncClients: Client[] = [];

    for (const client of this.activeClients) {
      if (client.hashes.has(turnNumber)) {
        const clientHash = client.hashes.get(turnNumber)!;
        if (clientHash !== mostCommonHash) {
          outOfSyncClients.push(client);
        }
      }
    }

    // If half clients out of sync assume all are out of sync.
    if (outOfSyncClients.length >= Math.floor(this.activeClients.length / 2)) {
      outOfSyncClients = this.activeClients;
    }

    return {
      mostCommonHash,
      outOfSyncClients,
    };
  }
}
