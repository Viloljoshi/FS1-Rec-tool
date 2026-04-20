import neo4j, { Driver, Session } from 'neo4j-driver';

let _driver: Driver | null = null;

export function getDriver(): Driver {
  if (_driver) return _driver;
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME ?? 'neo4j';
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !password) {
    throw new Error('NEO4J_URI and NEO4J_PASSWORD must be set');
  }
  _driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
    maxConnectionPoolSize: 10,
    connectionAcquisitionTimeout: 10_000,
    disableLosslessIntegers: true
  });
  return _driver;
}

export async function withSession<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  const driver = getDriver();
  const database = process.env.NEO4J_DATABASE ?? 'neo4j';
  const session = driver.session({ database });
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

export async function closeDriver(): Promise<void> {
  if (_driver) {
    await _driver.close();
    _driver = null;
  }
}
