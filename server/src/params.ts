import type { Request } from "express";

/**
 * Express 5 types allow route parameters to be string|string[] because of
 * wildcard/regex route parameters. These application routes use named scalar
 * parameters, so normalize them at the boundary before passing them to
 * database/API helpers that require a string.
 */
export function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  throw new Error(`Missing route parameter: ${name}`);
}
