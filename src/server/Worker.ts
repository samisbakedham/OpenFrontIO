import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { GameEnv } from "../core/configuration/Config";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameType } from "../core/game/Game";
import { GameConfig, GameRecord } from "../core/Schemas";
import { archive, readGameRecord } from "./Archive";
import { Client } from "./Client";
import { GameManager } from "./GameManager";
import { gatekeeper, LimiterType } from "./Gatekeeper";
import { logger } from "./Logger";
import { metrics } from "./WorkerMetrics";

const config = getServerConfigFromServer();

const workerId = parseInt(process.env.WORKER_ID || "0");
const log = logger.child({ comp: `w_${workerId}` });

// Worker setup
export function startWorker() {
  log.info(`Worker starting...`);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const gm = new GameManager(config, log);

  // Set up periodic metrics updates
  setInterval(() => {
    metrics.updateGameMetrics(gm);
  }, 15000); // Update every 15 seconds

  // Middleware to handle /wX path prefix
  app.use((req, res, next) => {
    // Extract the original path without the worker prefix
    const originalPath = req.url;
    const match = originalPath.match(/^\/w(\d+)(.*)$/);

    if (match) {
      const pathWorkerId = parseInt(match[1]);
      const actualPath = match[2] || "/";

      // Verify this request is for the correct worker
      if (pathWorkerId !== workerId) {
        return res.status(404).json({
          error: "Worker mismatch",
          message: `This is worker ${workerId}, but you requested worker ${pathWorkerId}`,
        });
      }

      // Update the URL to remove the worker prefix
      req.url = actualPath;
    }

    next();
  });

  app.set("trust proxy", 3);
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "../../out")));
  app.use(
    rateLimit({
      windowMs: 1000, // 1 second
      max: 20, // 20 requests per IP per second
    }),
  );

  app.post(
    "/api/create_game/:id",
    gatekeeper.httpHandler(LimiterType.Post, async (req, res) => {
      const id = req.params.id;
      if (!id) {
        log.warn(`cannot create game, id not found`);
        return;
      }
      // TODO: if game is public make sure request came from localhohst!!!
      const clientIP = req.ip || req.socket.remoteAddress || "unknown";
      const gc = req.body?.gameConfig as GameConfig;
      if (
        gc?.gameType == GameType.Public &&
        req.headers[config.adminHeader()] !== config.adminToken()
      ) {
        log.warn(
          `cannot create public game ${id}, ip ${clientIP} incorrect admin token`,
        );
        return res.status(400);
      }

      // Double-check this worker should host this game
      const expectedWorkerId = config.workerIndex(id);
      if (expectedWorkerId !== workerId) {
        log.warn(
          `This game ${id} should be on worker ${expectedWorkerId}, but this is worker ${workerId}`,
        );
        return res.status(400);
      }

      const game = gm.createGame(id, gc);

      log.info(
        `Worker ${workerId}: IP ${clientIP} creating game ${game.isPublic() ? "Public" : "Private"} with id ${id}`,
      );
      res.json(game.gameInfo());
    }),
  );

  // Add other endpoints from your original server
  app.post(
    "/api/start_game/:id",
    gatekeeper.httpHandler(LimiterType.Post, async (req, res) => {
      log.info(`starting private lobby with id ${req.params.id}`);
      const game = gm.game(req.params.id);
      if (!game) {
        return;
      }
      if (game.isPublic()) {
        const clientIP = req.ip || req.socket.remoteAddress || "unknown";
        log.info(
          `cannot start public game ${game.id}, game is public, ip: ${clientIP}`,
        );
        return;
      }
      game.start();
      res.status(200).json({ success: true });
    }),
  );

  app.put(
    "/api/game/:id",
    gatekeeper.httpHandler(LimiterType.Put, async (req, res) => {
      // TODO: only update public game if from local host
      const lobbyID = req.params.id;
      if (req.body.gameType == GameType.Public) {
        log.info(`cannot update game ${lobbyID} to public`);
        return res.status(400);
      }
      const game = gm.game(lobbyID);
      if (!game) {
        return res.status(400);
      }
      if (game.isPublic()) {
        const clientIP = req.ip || req.socket.remoteAddress || "unknown";
        log.warn(`cannot update public game ${game.id}, ip: ${clientIP}`);
        return res.status(400);
      }
      if (game.hasStarted()) {
        log.warn(`cannot update game ${game.id} after it has started`);
        return res.status(400);
      }
      game.updateGameConfig({
        gameMap: req.body.gameMap,
        difficulty: req.body.difficulty,
        infiniteGold: req.body.infiniteGold,
        infiniteTroops: req.body.infiniteTroops,
        instantBuild: req.body.instantBuild,
        bots: req.body.bots,
        disableNPCs: req.body.disableNPCs,
        disableNukes: req.body.disableNukes,
        gameMode: req.body.gameMode,
      });
      res.status(200).json({ success: true });
    }),
  );

  app.get(
    "/api/game/:id/exists",
    gatekeeper.httpHandler(LimiterType.Get, async (req, res) => {
      const lobbyId = req.params.id;
      res.json({
        exists: gm.game(lobbyId) != null,
      });
    }),
  );

  app.get(
    "/api/game/:id",
    gatekeeper.httpHandler(LimiterType.Get, async (req, res) => {
      const game = gm.game(req.params.id);
      if (game == null) {
        log.info(`lobby ${req.params.id} not found`);
        return res.status(404).json({ error: "Game not found" });
      }
      res.json(game.gameInfo());
    }),
  );

  app.get(
    "/api/archived_game/:id",
    gatekeeper.httpHandler(LimiterType.Get, async (req, res) => {
      const gameRecord = await readGameRecord(req.params.id);

      if (!gameRecord) {
        return res.status(404).json({
          success: false,
          error: "Game not found",
          exists: false,
        });
      }

      if (
        config.env() != GameEnv.Dev &&
        gameRecord.gitCommit != config.gitCommit()
      ) {
        log.warn(
          `git commit mismatch for game ${req.params.id}, expected ${config.gitCommit()}, got ${gameRecord.gitCommit}`,
        );
        return res.status(409).json({
          success: false,
          error: "Version mismatch",
          exists: true,
          details: {
            expectedCommit: config.gitCommit(),
            actualCommit: gameRecord.gitCommit,
          },
        });
      }

      return res.status(200).json({
        success: true,
        exists: true,
        gameRecord: gameRecord,
      });
    }),
  );

  app.post(
    "/api/archive_singleplayer_game",
    gatekeeper.httpHandler(LimiterType.Post, async (req, res) => {
      const gameRecord: GameRecord = req.body;
      const clientIP = req.ip || req.socket.remoteAddress || "unknown";

      if (!gameRecord) {
        log.info("game record not found in request");
        res.status(404).json({ error: "Game record not found" });
        return;
      }
      gameRecord.players.forEach((p) => (p.ip = clientIP));
      archive(gameRecord);
      res.json({
        success: true,
      });
    }),
  );

  app.get(
    "/metrics",
    gatekeeper.httpHandler(LimiterType.Get, async (req, res) => {
      if (req.headers[config.adminHeader()] !== config.adminToken()) {
        return res.status(403).end("Access denied");
      }
      log.info(`metrics requested on worker ${workerId}`);

      try {
        const metricsData = await metrics.register.metrics();
        res.set("Content-Type", metrics.register.contentType);
        res.end(metricsData);
      } catch (error) {
        res.status(500).end(error.message);
      }
    }),
  );

  // WebSocket handling
  wss.on("connection", (ws: WebSocket, req) => {
    ws.on(
      "message",
      gatekeeper.wsHandler(req, async (message: string) => {
        const forwarded = req.headers["x-forwarded-for"];
        const ip = Array.isArray(forwarded)
          ? forwarded[0]
          : forwarded || req.socket.remoteAddress || "unknown";

        try {
          // Process WebSocket messages as in your original code
          // Parse and handle client messages
          const clientMsg = JSON.parse(message.toString());

          if (clientMsg.type == "join") {
            // Verify this worker should handle this game
            const expectedWorkerId = config.workerIndex(clientMsg.gameID);
            if (expectedWorkerId !== workerId) {
              log.warn(
                `Worker mismatch: Game ${clientMsg.gameID} should be on worker ${expectedWorkerId}, but this is worker ${workerId}`,
              );
              return;
            }

            // Create client and add to game
            const client = new Client(
              clientMsg.clientID,
              clientMsg.persistentID,
              ip,
              clientMsg.username,
              ws,
              clientMsg.flag,
            );

            const wasFound = gm.addClient(
              client,
              clientMsg.gameID,
              clientMsg.lastTurn,
            );

            if (!wasFound) {
              log.info(
                `game ${clientMsg.gameID} not found on worker ${workerId}`,
              );
              // Handle game not found case
            }
          }

          // Handle other message types
        } catch (error) {
          log.warn(
            `error handling websocket message for ${ip}: ${error}`.substring(
              0,
              250,
            ),
          );
        }
      }),
    );

    ws.on("error", (error: Error) => {
      if ((error as any).code === "WS_ERR_UNEXPECTED_RSV_1") {
        ws.close(1002);
      }
    });
  });

  // The load balancer will handle routing to this server based on path
  const PORT = config.workerPortByIndex(workerId);
  server.listen(PORT, () => {
    log.info(`running on http://localhost:${PORT}`);
    log.info(`Handling requests with path prefix /w${workerId}/`);
    // Signal to the master process that this worker is ready
    if (process.send) {
      process.send({
        type: "WORKER_READY",
        workerId: workerId,
      });
      log.info(`signaled ready state to master`);
    }
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    log.error(`Error in ${req.method} ${req.path}:`, err);
    res.status(500).json({ error: "An unexpected error occurred" });
  });

  // Process-level error handlers
  process.on("uncaughtException", (err) => {
    log.error(`uncaught exception:`, err);
  });

  process.on("unhandledRejection", (reason, promise) => {
    log.error(`unhandled rejection at:`, promise, "reason:", reason);
  });
}
