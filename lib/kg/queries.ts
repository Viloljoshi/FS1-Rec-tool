import neo4j from 'neo4j-driver';
import { withSession } from './neo4j';

export interface CounterpartyNode {
  id: string;
  canonical_name: string;
  lei: string | null;
  sec_crd: string | null;
  country: string | null;
}

export interface CounterpartyCluster {
  entity: CounterpartyNode;
  aliases: string[];
  subsidiaries: CounterpartyNode[];
}

export async function resolveCounterparty(alias: string): Promise<CounterpartyNode | null> {
  return withSession(async (session) => {
    // ORDER BY c.id before LIMIT 1 so that when an alias ambiguously matches
    // multiple entities (e.g. "JPM" maps to both JPMorgan Chase and JPMorgan
    // Securities in the seed graph), we always pick the same one. Without
    // this, Neo4j's internal iteration order could flip resolved IDs across
    // ingests of the same file — breaking cycle determinism downstream.
    const result = await session.run(
      `
      MATCH (c:Counterparty)
      WHERE toLower(c.canonical_name) = toLower($alias)
         OR EXISTS {
           MATCH (c)-[:HAS_ALIAS]->(:Alias {value: $alias})
         }
         OR EXISTS {
           MATCH (c)-[:HAS_ALIAS]->(a:Alias)
           WHERE toLower(a.normalized) = toLower($alias)
         }
      RETURN c
      ORDER BY c.id
      LIMIT 1
      `,
      { alias }
    );
    const record = result.records[0];
    if (!record) return null;
    const node = record.get('c').properties;
    return {
      id: node.id,
      canonical_name: node.canonical_name,
      lei: node.lei ?? null,
      sec_crd: node.sec_crd ?? null,
      country: node.country ?? null
    };
  });
}

export async function searchCounterparties(query: string, limit = 10): Promise<CounterpartyNode[]> {
  return withSession(async (session) => {
    // Neo4j LIMIT needs a real Integer; a JS number is received as float (e.g. 20.0)
    // and the driver rejects it with "not a valid value. Must be a non-negative integer".
    const result = await session.run(
      `
      MATCH (c:Counterparty)
      WHERE toLower(c.canonical_name) CONTAINS toLower($query)
      RETURN c
      ORDER BY c.canonical_name
      LIMIT $limit
      `,
      { query, limit: neo4j.int(limit) }
    );
    return result.records.map((r) => {
      const p = r.get('c').properties;
      return {
        id: p.id,
        canonical_name: p.canonical_name,
        lei: p.lei ?? null,
        sec_crd: p.sec_crd ?? null,
        country: p.country ?? null
      };
    });
  });
}

export async function getCounterpartyCluster(id: string): Promise<CounterpartyCluster | null> {
  return withSession(async (session) => {
    const result = await session.run(
      `
      MATCH (c:Counterparty {id: $id})
      OPTIONAL MATCH (c)-[:HAS_ALIAS]->(a:Alias)
      OPTIONAL MATCH (c)<-[:SUBSIDIARY_OF]-(sub:Counterparty)
      RETURN c,
             collect(DISTINCT a.value) AS aliases,
             collect(DISTINCT sub)     AS subs
      `,
      { id }
    );
    const record = result.records[0];
    if (!record) return null;
    const c = record.get('c').properties;
    const aliases = (record.get('aliases') as (string | null)[]).filter((x): x is string => !!x);
    const subs = record.get('subs') as Array<{ properties: Record<string, unknown> }>;
    return {
      entity: {
        id: c.id,
        canonical_name: c.canonical_name,
        lei: c.lei ?? null,
        sec_crd: c.sec_crd ?? null,
        country: c.country ?? null
      },
      aliases,
      subsidiaries: subs
        .filter((s) => s)
        .map((s) => ({
          id: s.properties.id as string,
          canonical_name: s.properties.canonical_name as string,
          lei: (s.properties.lei as string) ?? null,
          sec_crd: (s.properties.sec_crd as string) ?? null,
          country: (s.properties.country as string) ?? null
        }))
    };
  });
}

export interface GraphSlice {
  nodes: Array<{ id: string; label: string; type: 'Counterparty' | 'Alias' | 'Security' }>;
  edges: Array<{ source: string; target: string; type: string }>;
}

export async function getGraphSlice(centerId: string, depth = 2): Promise<GraphSlice> {
  return withSession(async (session) => {
    const result = await session.run(
      `
      MATCH (c:Counterparty {id: $centerId})
      CALL {
        WITH c
        MATCH path = (c)-[*1..${depth}]-(neighbor)
        RETURN path
        LIMIT 100
      }
      RETURN path
      `,
      { centerId }
    );

    const nodes = new Map<string, { id: string; label: string; type: 'Counterparty' | 'Alias' | 'Security' }>();
    const edges: Array<{ source: string; target: string; type: string }> = [];

    for (const record of result.records) {
      const path = record.get('path');
      for (const segment of path.segments ?? []) {
        for (const node of [segment.start, segment.end]) {
          const id = String(node.properties.id ?? node.identity);
          const label = node.labels[0] ?? 'Node';
          const display =
            (node.properties.canonical_name as string) ??
            (node.properties.value as string) ??
            (node.properties.symbol as string) ??
            id;
          nodes.set(id, {
            id,
            label: display,
            type: label as 'Counterparty' | 'Alias' | 'Security'
          });
        }
        edges.push({
          source: String(segment.start.properties.id ?? segment.start.identity),
          target: String(segment.end.properties.id ?? segment.end.identity),
          type: segment.relationship.type
        });
      }
    }

    return { nodes: Array.from(nodes.values()), edges };
  });
}
