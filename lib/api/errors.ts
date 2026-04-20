import type { ZodError } from 'zod';

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

/**
 * Turn a ZodError into a human-readable error payload for API responses.
 * The `message` field is a short summary the UI can toast directly;
 * `details` carries the full issue array for debugging.
 */
export function friendlyZodError(err: ZodError): ApiErrorBody {
  const first = err.issues[0];
  const others = err.issues.length - 1;
  const path = first?.path.join('.') || 'body';
  const summary = first
    ? `${path}: ${first.message}${others > 0 ? ` (+${others} more)` : ''}`
    : 'request failed validation';
  return {
    error: 'bad_request',
    message: summary,
    details: err.issues
  };
}

/**
 * Parse an arbitrary error response body (string or JSON) and extract
 * a readable message for UI display.
 */
export async function readableApiError(response: Response): Promise<string> {
  try {
    const body = await response.clone().json();
    if (typeof body === 'object' && body !== null) {
      if (typeof body.message === 'string') return body.message;
      if (typeof body.error === 'string') return body.error;
    }
  } catch {
    // not json — fall through
  }
  try {
    const text = await response.text();
    return text.slice(0, 400) || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}
