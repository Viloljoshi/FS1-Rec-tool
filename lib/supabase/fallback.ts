const NOOP_ERROR = {
  message: 'Supabase env vars are missing in local demo mode.'
};

function createNoopQueryBuilder(): any {
  let builder: any;
  const resolved = Promise.resolve({ data: null, error: null });

  builder = new Proxy(function noop() {}, {
    get(_target, prop) {
      if (prop === 'then') return resolved.then.bind(resolved);
      if (prop === 'catch') return resolved.catch.bind(resolved);
      if (prop === 'finally') return resolved.finally.bind(resolved);
      if (prop === 'auth') {
        return {
          async getUser() {
            return { data: { user: null }, error: null };
          },
          async getSession() {
            return { data: { session: null }, error: null };
          },
          async signInWithPassword() {
            return { data: { user: null, session: null }, error: NOOP_ERROR };
          },
          async signOut() {
            return { error: null };
          }
        };
      }
      return builder;
    },
    apply() {
      return builder;
    }
  });

  return builder;
}

export function createNoopSupabaseClient() {
  return createNoopQueryBuilder();
}

export function createNoopSupabaseError() {
  return NOOP_ERROR;
}
