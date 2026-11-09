import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { HealthResponse, PlannerResult, VisionAssessment } from '../../shared/contracts.ts';
import type { ServerConfig } from './config.ts';

export const VERSION = '0.1.0';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Minimal HTTP app. Request bodies (which will later contain images/audio) are
 * never logged; only method, path and status are.
 */
export function createApp(config: ServerConfig): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const started = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    });

    if (req.method === 'GET' && url.pathname === '/health') {
      const body: HealthResponse = {
        status: 'ok',
        service: 'cnh-backend',
        version: VERSION,
        time: new Date().toISOString(),
        integrations: { openai: config.openaiApiKey ? 'configured' : 'not_configured' },
      };
      return sendJson(res, 200, body);
    }

    // Integration seams. These deliberately do NOT call OpenAI or return fake
    // results: they report 'unavailable' until milestone 2 implements them
    // against current official docs.
    if (req.method === 'POST' && url.pathname === '/v1/vision/assess') {
      req.resume(); // drain and discard the body without reading/logging it
      const body: VisionAssessment = {
        state: 'unavailable',
        reason: config.openaiApiKey
          ? 'Vision assessment is not implemented yet (milestone 1 scaffold).'
          : 'Server has no OPENAI_API_KEY configured.',
      };
      return sendJson(res, 501, body);
    }
    if (req.method === 'POST' && url.pathname === '/v1/planner/recommend') {
      req.resume();
      const body: PlannerResult = {
        state: 'unavailable',
        reason: 'Planner is not implemented yet and no verified conference schedule is loaded.',
      };
      return sendJson(res, 501, body);
    }

    sendJson(res, 404, { error: 'not_found' });
  });
}
