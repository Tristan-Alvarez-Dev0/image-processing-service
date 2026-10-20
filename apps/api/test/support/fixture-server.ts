import {
  createServer,
  type IncomingHttpHeaders,
  type RequestListener,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Route {
  status?: number;
  contentType?: string;
  body?: Buffer | string;
  /** Delay before responding, to simulate a slow upstream. */
  delayMs?: number;
}

export interface FixtureServer {
  url: (path: string) => string;
  /** Number of requests received per path. */
  hits: Map<string, number>;
  /** Headers of the most recent request per path. */
  lastHeaders: Map<string, IncomingHttpHeaders>;
  close: () => Promise<void>;
}

/** A tiny local HTTP server that plays the role of the remote image host. */
export async function startFixtureServer(routes: Record<string, Route>): Promise<FixtureServer> {
  const hits = new Map<string, number>();
  const lastHeaders = new Map<string, IncomingHttpHeaders>();
  const timers = new Set<NodeJS.Timeout>();

  const handler: RequestListener = (req, res) => {
    const path = req.url ?? '/';
    hits.set(path, (hits.get(path) ?? 0) + 1);
    lastHeaders.set(path, req.headers);
    const route = routes[path];
    const respond = () => {
      if (!route) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(route.status ?? 200, {
        'Content-Type': route.contentType ?? 'application/octet-stream',
      });
      res.end(route.body ?? '');
    };
    if (route?.delayMs) {
      const t = setTimeout(respond, route.delayMs);
      timers.add(t);
    } else {
      respond();
    }
  };

  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    hits,
    lastHeaders,
    close: () => {
      timers.forEach(clearTimeout);
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
