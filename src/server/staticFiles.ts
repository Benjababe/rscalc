/// <reference types="node" />
/**
 * Serving the built SPA.
 *
 * The bundle is static and every asset name is content-hashed by Vite, so the
 * caching policy is the interesting part:
 *
 *  - `assets/*` never change under a given name → `immutable`, one year.
 *  - `index.html` is the only thing that names those assets → `no-cache`, so a
 *    rebuild is picked up immediately.
 *  - a missing hashed asset is a 404, never `index.html`: answering a `<script>`
 *    request with HTML is the classic "Unexpected token '<'" bug.
 *
 * Everything is compressed on demand and kept in a small in-memory cache. The
 * files are content-hashed, so a cache entry can only be invalidated by a rebuild,
 * which changes the name.
 */

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";

import type { Request, Response } from "express";

const gzip = promisify(gzipCallback);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

interface CacheEntry {
  mtimeMs: number;
  size: number;
  body: Buffer;
}

export class StaticFiles {
  private readonly root: string;
  private readonly compressed = new Map<string, CacheEntry>();
  private readonly maxEntries = 64;

  constructor(root: string) {
    this.root = root;
  }

  /** True when a frontend build is present. */
  async available(): Promise<boolean> {
    try {
      const info = await stat(join(this.root, "index.html"));
      return info.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Serve `name` from the build directory. Returns false when the file does not
   * exist, so the caller decides between a 404 and the SPA fallback.
   */
  async serve(req: Request, res: Response, name: string, options: { immutable: boolean }): Promise<boolean> {
    const relative = normalize(name);
    if (relative === "." || relative.startsWith("..") || relative.includes(`..${sep}`) || relative.startsWith(sep)) {
      return false;
    }
    const path = join(this.root, relative);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(path);
    } catch {
      return false;
    }
    if (!info.isFile()) return false;

    const contentType = contentTypeFor(relative);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", options.immutable ? "public, max-age=31536000, immutable" : "no-cache");
    res.setHeader("Vary", "Accept-Encoding");

    if (isCompressible(contentType) && acceptsGzip(req)) {
      const body = await this.compressedBody(path, info.mtimeMs, info.size);
      if (body !== null) {
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Content-Length", String(body.length));
        res.statusCode = 200;
        res.end(body);
        return true;
      }
    }

    res.setHeader("Content-Length", String(info.size));
    res.statusCode = 200;
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    await pipeline(createReadStream(path), res);
    return true;
  }

  private async compressedBody(path: string, mtimeMs: number, size: number): Promise<Buffer | null> {
    const cached = this.compressed.get(path);
    if (cached !== undefined && cached.mtimeMs === mtimeMs && cached.size === size) return cached.body;

    let raw: Buffer;
    try {
      raw = await readFile(path);
    } catch {
      return null;
    }
    const body = await gzip(raw, { level: 6 });
    if (this.compressed.size >= this.maxEntries) {
      const oldest = this.compressed.keys().next();
      if (!oldest.done) this.compressed.delete(oldest.value);
    }
    this.compressed.set(path, { mtimeMs, size, body });
    return body;
  }
}

export function acceptsGzip(req: Request): boolean {
  const header = req.headers["accept-encoding"];
  const value = Array.isArray(header) ? header.join(",") : header;
  if (value === undefined) return false;
  return value
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase() ?? "")
    .includes("gzip");
}

export function contentTypeFor(name: string): string {
  return CONTENT_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";
}

function isCompressible(contentType: string): boolean {
  const base = contentType.split(";")[0] ?? "";
  return base.startsWith("text/") || base === "application/json" || base === "application/javascript" || base === "image/svg+xml";
}
