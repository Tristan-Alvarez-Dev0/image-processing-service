import { describe, expectTypeOf, it } from 'vitest';
import {
  ImageClient,
  type ErrorCode,
  type ImageApiError,
  type ImageResult,
  type ProcessOptions,
} from '../src/index.js';

const client = new ImageClient({ baseUrl: '' });

describe('public types', () => {
  it('process() resolves to ImageResult', () => {
    expectTypeOf(client.process).returns.resolves.toEqualTypeOf<ImageResult>();
    expectTypeOf(client.buildUrl).returns.toBeString();
  });

  it('error codes are a closed union', () => {
    expectTypeOf<ImageApiError['code']>().toEqualTypeOf<ErrorCode>();
    expectTypeOf<'INVALID_PARAMETER'>().toExtend<ErrorCode>();
    expectTypeOf<'NETWORK_ERROR'>().toExtend<ErrorCode>();
    expectTypeOf<'SOMETHING_ELSE'>().not.toExtend<ErrorCode>();
  });

  it('rejects invalid options at compile time', () => {
    // @ts-expect-error format must be a known format
    const badFormat: ProcessOptions = { url: 'x', format: 'bmp' };
    // @ts-expect-error crop must be a known mode
    const badCrop: ProcessOptions = { url: 'x', crop: 'zoom' };
    // @ts-expect-error url is required
    const noUrl: ProcessOptions = { width: 100 };
    // @ts-expect-error unknown options are rejected
    const typo: ProcessOptions = { url: 'x', widht: 100 };
    expectTypeOf([badFormat, badCrop, noUrl, typo]).toBeArray();
  });
});
