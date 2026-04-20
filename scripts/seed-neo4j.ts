/* eslint-disable no-console */
import neo4j from 'neo4j-driver';
import { BROKERS, SECURITIES } from './constants';
import { createClient } from '@supabase/supabase-js';

const uri = process.env.NEO4J_URI!;
const username = process.env.NEO4J_USERNAME ?? 'neo4j';
const password = process.env.NEO4J_PASSWORD!;
const database = process.env.NEO4J_DATABASE ?? 'neo4j';
if (!uri || !password) {
  console.error('Missing NEO4J_URI or NEO4J_PASSWORD');
  process.exit(1);
}

const driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
  disableLosslessIntegers: true
});

const SUBSIDIARIES: Array<[string, string]> = [
  ['J.P. Morgan Securities LLC', 'JPMorgan Chase & Co.'],
  ['Citigroup Global Markets Inc.', 'Citigroup Inc.'],
  ['Merrill Lynch, Pierce, Fenner & Smith Incorporated', 'Bank of America Corporation'],
  ['Morgan Stanley & Co. LLC', 'Morgan Stanley'],
  ['Goldman Sachs & Co. LLC', 'The Goldman Sachs Group, Inc.'],
  ['UBS Securities LLC', 'UBS Group AG'],
  ['Barclays Capital Inc.', 'Barclays PLC']
];

async function main() {
  const session = driver.session({ database });
  try {
    // Constraints + indexes
    console.log('creating constraints/indexes...');
    await session.run('CREATE CONSTRAINT cp_id IF NOT EXISTS FOR (c:Counterparty) REQUIRE c.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT alias_val IF NOT EXISTS FOR (a:Alias) REQUIRE a.value IS UNIQUE');
    await session.run('CREATE CONSTRAINT sec_id IF NOT EXISTS FOR (s:Security) REQUIRE s.id IS UNIQUE');
    await session.run('CREATE INDEX cp_name IF NOT EXISTS FOR (c:Counterparty) ON (c.canonical_name)');
    await session.run('CREATE INDEX sec_symbol IF NOT EXISTS FOR (s:Security) ON (s.symbol)');
    await session.run('CREATE INDEX sec_isin IF NOT EXISTS FOR (s:Security) ON (s.isin)');
    await session.run('CREATE INDEX sec_cusip IF NOT EXISTS FOR (s:Security) ON (s.cusip)');

    // Fetch Postgres IDs so graph IDs align
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: entities } = await sb.from('counterparty_entities').select('id, canonical_name, sec_crd, country');
    const byName = new Map((entities ?? []).map((e) => [e.canonical_name, e]));

    console.log('upserting counterparty nodes + aliases...');
    for (const broker of BROKERS) {
      const entity = byName.get(broker.canonical);
      if (!entity) {
        console.warn(`  no postgres entity for ${broker.canonical}, skipping`);
        continue;
      }
      await session.run(
        `
        MERGE (c:Counterparty {id: $id})
        SET c.canonical_name = $name,
            c.sec_crd        = $sec_crd,
            c.country        = $country
        WITH c
        UNWIND $aliases AS alias
        MERGE (a:Alias {value: alias})
        SET a.normalized = toLower(replace(replace(replace(alias,".",""),",",""),"&",""))
        MERGE (c)-[:HAS_ALIAS]->(a)
        `,
        {
          id: entity.id,
          name: entity.canonical_name,
          sec_crd: entity.sec_crd,
          country: entity.country,
          aliases: broker.aliases
        }
      );
      console.log(`  ${broker.canonical} + ${broker.aliases.length} aliases`);
    }

    console.log('upserting securities...');
    for (const sec of SECURITIES) {
      await session.run(
        `
        MERGE (s:Security {id: $id})
        SET s.symbol       = $symbol,
            s.isin         = $isin,
            s.cusip        = $cusip,
            s.name         = $name,
            s.asset_class  = 'EQUITY'
        `,
        {
          id: `SEC-${sec.symbol}`,
          symbol: sec.symbol,
          isin: sec.isin,
          cusip: sec.cusip,
          name: sec.name
        }
      );
    }
    console.log(`  ${SECURITIES.length} securities`);

    console.log('adding subsidiary relationships...');
    for (const [childName, parentName] of SUBSIDIARIES) {
      const parentId = `GROUP-${parentName.replace(/\s+/g, '-')}`;
      await session.run(
        `
        MATCH (child:Counterparty {canonical_name: $child})
        MERGE (parent:Counterparty {id: $parentId})
        ON CREATE SET parent.canonical_name = $parent,
                      parent.country = 'US'
        MERGE (child)-[:SUBSIDIARY_OF]->(parent)
        `,
        { child: childName, parent: parentName, parentId }
      );
    }
    console.log(`  ${SUBSIDIARIES.length} subsidiary links`);

    // Summary
    const summary = await session.run(`
      MATCH (c:Counterparty) WITH count(c) AS counterparties
      MATCH (a:Alias) WITH counterparties, count(a) AS aliases
      MATCH (s:Security) WITH counterparties, aliases, count(s) AS securities
      MATCH ()-[r:HAS_ALIAS]->() WITH counterparties, aliases, securities, count(r) AS alias_edges
      MATCH ()-[r2:SUBSIDIARY_OF]->() RETURN counterparties, aliases, securities, alias_edges, count(r2) AS sub_edges
    `);
    const row = summary.records[0];
    console.log('\n✓ Neo4j seed complete.');
    if (row) {
      console.log(`  counterparties=${row.get('counterparties')} aliases=${row.get('aliases')} securities=${row.get('securities')} alias_edges=${row.get('alias_edges')} sub_edges=${row.get('sub_edges')}`);
    }
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(async (err) => {
  console.error(err);
  await driver.close();
  process.exit(1);
});
