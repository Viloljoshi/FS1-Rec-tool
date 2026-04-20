import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'recon-ai' },
  timestamp: pino.stdTimeFunctions.isoTime
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
