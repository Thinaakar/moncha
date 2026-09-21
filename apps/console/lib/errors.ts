import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ApiError } from './api-error';

export function jsonError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'Invalid request',
          details: error.flatten(),
        },
      },
      { status: 400 },
    );
  }
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'api_error',
      ts: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'Internal server error' } },
    { status: 500 },
  );
}
