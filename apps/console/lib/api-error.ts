export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function validationError(message: string, details?: unknown): ApiError {
  return new ApiError('validation_error', message, 400, details);
}

export function unauthorized(message = 'Authentication required'): ApiError {
  return new ApiError('unauthorized', message, 401);
}

export function forbidden(message = 'Forbidden'): ApiError {
  return new ApiError('forbidden', message, 403);
}

export function notFound(message = 'Not found'): ApiError {
  return new ApiError('not_found', message, 404);
}

export function conflict(message: string): ApiError {
  return new ApiError('conflict', message, 409);
}

export function providerError(message: string): ApiError {
  return new ApiError('provider_error', message, 502);
}

export function internalError(message = 'Internal server error'): ApiError {
  return new ApiError('internal_error', message, 500);
}
