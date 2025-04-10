import { NextFunction, Request, Response } from "express";
import { Gatekeeper, LimiterType } from "../Gatekeeper";

export const RealGatekeeper: Gatekeeper = {
  httpHandler: (
    _limiterType: LimiterType,
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ) => {
    return async (req, res, next) => {
      try {
        await fn(req, res, next);
      } catch (err) {
        next(err);
      }
    };
  },

  wsHandler: (req, fn) => {
    return async (message: string) => {
      await fn(message);
    };
  },
};
