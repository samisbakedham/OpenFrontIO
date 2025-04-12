// src/server/Security.ts
import { NextFunction, Request, Response } from "express";
import http from "http";

export enum LimiterType {
  Get = "get",
  Post = "post",
  Put = "put",
  WebSocket = "websocket",
}

export interface Gatekeeper {
  // The wrapper for request handlers with optional rate limiting
  httpHandler: (
    limiterType: LimiterType,
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ) => (req: Request, res: Response, next: NextFunction) => Promise<void>;

  // The wrapper for WebSocket message handlers with rate limiting
  wsHandler: (
    req: http.IncomingMessage | string,
    fn: (message: string) => Promise<void>,
  ) => (message: string) => Promise<void>;
}

let gk: Gatekeeper = null;

async function getGatekeeperCached(): Promise<Gatekeeper> {
  if (gk != null) return gk;
  return getGatekeeper().then((g) => {
    gk = g;
    return gk;
  });
}

// Forces use of NoOpGatekeeper to allow unrestricted access
async function getGatekeeper(): Promise<Gatekeeper> {
  console.log("⚠️ Using NoOpGatekeeper — all traffic is allowed.");
  return new NoOpGatekeeper();
}

export class GatekeeperWrapper implements Gatekeeper {
  constructor(private getGK: () => Promise<Gatekeeper>) {}

  httpHandler(
    limiterType: LimiterType,
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const gk = await this.getGK();
        const handler = gk.httpHandler(limiterType, fn);
        return handler(req, res, next);
      } catch (error) {
        next(error);
      }
    };
  }

  wsHandler(
    req: http.IncomingMessage | string,
    fn: (message: string) => Promise<void>,
  ) {
    return async (message: string) => {
      try {
        const gk = await this.getGK();
        const handler = gk.wsHandler(req, fn);
        return handler(message);
      } catch (error) {
        console.error("WebSocket handler error:", error);
      }
    };
  }
}

export class NoOpGatekeeper implements Gatekeeper {
  httpHandler(
    limiterType: LimiterType,
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ) {
    return async (req, res, next) => {
      try {
        await fn(req, res, next);
      } catch (error) {
        next(error);
      }
    };
  }

  wsHandler(
    req: http.IncomingMessage | string,
    fn: (message: string) => Promise<void>,
  ) {
    return async (message: string) => {
      try {
        await fn(message);
      } catch (error) {
        console.error("WebSocket handler error:", error);
      }
    };
  }
}

export const gatekeeper: Gatekeeper = new GatekeeperWrapper(() =>
  getGatekeeperCached(),
);
