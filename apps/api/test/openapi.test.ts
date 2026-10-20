import SwaggerParser from '@apidevtools/swagger-parser';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/errors/app-error.js';
import {
  CROP_MODES,
  createProcessQuerySchema,
  createVideoQuerySchema,
  FLIP_MODES,
  OUTPUT_FORMATS,
} from '../src/schemas/process.js';
import { buildTestApp } from './support/app.js';

type Param = { name: string; in: string; schema: Record<string, unknown>; example?: unknown };
type Operation = { parameters: Param[]; responses: Record<string, { description: string }> };
type Doc = {
  info: { description: string };
  paths: Record<string, { get: Operation }>;
  components: {
    schemas: { Error: { properties: { error: { properties: { code: { enum: string[] } } } } } };
  };
};

let app: FastifyInstance;
afterEach(() => app?.close());

async function spec(env: Record<string, string> = {}) {
  app = await buildTestApp(env);
  const res = await app.inject({ method: 'GET', url: '/openapi.json' });
  return { res, doc: res.json() as Doc };
}

const queryParams = (op: Operation) => op.parameters.filter((p) => p.in === 'query');
const param = (op: Operation, name: string) => op.parameters.find((p) => p.name === name)!;

describe('GET /openapi.json', () => {
  it('serves a valid OpenAPI 3.1 document', async () => {
    const { res, doc } = await spec();

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    await expect(SwaggerParser.validate(structuredClone(doc) as never)).resolves.toBeTruthy();
  });

  it('documents every endpoint', async () => {
    const { doc } = await spec();

    expect(Object.keys(doc.paths).sort()).toEqual([
      '/health',
      '/metrics',
      '/process',
      '/video/thumbnail',
    ]);
  });
});

describe('the spec matches the code (drift checks)', () => {
  it.each([
    ['/process', createProcessQuerySchema],
    ['/video/thumbnail', createVideoQuerySchema],
  ] as const)('%s documents exactly the parameters the validator accepts', async (path, schema) => {
    const { doc } = await spec();
    const documented = queryParams(doc.paths[path]!.get).map((p) => p.name);

    expect(documented.sort()).toEqual(Object.keys(schema({ maxDimension: 1 }).shape).sort());
  });

  it('documents every format and crop mode', async () => {
    const { doc } = await spec();
    const op = doc.paths['/process']!.get;

    expect(param(op, 'format').schema.enum).toEqual([...OUTPUT_FORMATS, 'jpg', 'auto']);
    expect(param(op, 'crop').schema.enum).toEqual([...CROP_MODES]);
    expect(param(op, 'flip').schema.enum).toEqual([...FLIP_MODES]);
  });

  it('documents every error code, under the right HTTP status', async () => {
    const { doc } = await spec();

    expect(doc.components.schemas.Error.properties.error.properties.code.enum.sort()).toEqual(
      Object.keys(ERROR_CODES).sort(),
    );
    for (const { get } of Object.values(doc.paths)) {
      for (const [status, response] of Object.entries(get.responses)) {
        for (const [, code] of response.description.matchAll(/`([A-Z_]+)`/g)) {
          expect(ERROR_CODES[code as keyof typeof ERROR_CODES]).toBe(Number(status));
        }
      }
    }
  });

  it.each([
    ['/process', createProcessQuerySchema],
    ['/video/thumbnail', createVideoQuerySchema],
  ] as const)('the examples for %s are accepted by the validator', async (path, schema) => {
    const { doc } = await spec();
    const example = Object.fromEntries(
      queryParams(doc.paths[path]!.get)
        .filter((p) => p.example !== undefined)
        .map((p) => [p.name, String(p.example)]),
    );

    expect(schema({ maxDimension: 4000 }).safeParse(example).success).toBe(true);
  });

  it('quotes the configured limits, not hard-coded ones', async () => {
    const { doc } = await spec({ MAX_OUTPUT_DIMENSION: '1234', RATE_LIMIT_MAX: '7' });

    expect(param(doc.paths['/process']!.get, 'width').schema.maximum).toBe(1234);
    expect(doc.info.description).toMatch(/\| Output width\/height \| 1234 px \|/);
    expect(doc.info.description).toMatch(/7 requests/);
  });
});

describe('GET /docs', () => {
  it('serves the interactive docs', async () => {
    app = await buildTestApp();

    let res = await app.inject({ method: 'GET', url: '/docs' });
    if (res.statusCode === 302)
      res = await app.inject({ method: 'GET', url: String(res.headers.location) });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toMatch(/swagger/i);
  });

  it('is not rate limited', async () => {
    app = await buildTestApp({ RATE_LIMIT_MAX: '1' });

    const statuses = await Promise.all(
      [1, 2, 3].map(
        async () => (await app.inject({ method: 'GET', url: '/docs/json' })).statusCode,
      ),
    );

    expect(statuses).toEqual([200, 200, 200]);
  });
});
