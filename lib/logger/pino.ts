type Bindings = Record<string, unknown>;

function fmt(bindings: Bindings, msg: string): string {
  const pairs = Object.entries(bindings)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  return pairs ? `${msg} ${pairs}` : msg;
}

function makeLogger(base: Bindings = {}) {
  return {
    info: (bindingsOrMsg: Bindings | string, msg?: string) => {
      if (typeof bindingsOrMsg === 'string') {
        console.log(fmt(base, bindingsOrMsg));
      } else {
        console.log(fmt({ ...base, ...bindingsOrMsg }, msg ?? ''));
      }
    },
    warn: (bindingsOrMsg: Bindings | string, msg?: string) => {
      if (typeof bindingsOrMsg === 'string') {
        console.warn(fmt(base, bindingsOrMsg));
      } else {
        console.warn(fmt({ ...base, ...bindingsOrMsg }, msg ?? ''));
      }
    },
    error: (bindingsOrMsg: Bindings | string, msg?: string) => {
      if (typeof bindingsOrMsg === 'string') {
        console.error(fmt(base, bindingsOrMsg));
      } else {
        console.error(fmt({ ...base, ...bindingsOrMsg }, msg ?? ''));
      }
    },
    child: (bindings: Bindings) => makeLogger({ ...base, ...bindings })
  };
}

export const logger = makeLogger({ app: 'recon-ai' });

export function childLogger(bindings: Bindings) {
  return logger.child(bindings);
}
