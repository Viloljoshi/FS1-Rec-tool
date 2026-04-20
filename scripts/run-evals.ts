/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { runEval } from '../lib/eval/run';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function main() {
  console.log('running evals against gold set...');
  const report = await runEval({
    supabase: sb,
    initiatedBy: null,
    modelVersion: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    rulesVersion: 1
  });
  console.log(`\n✓ Eval complete`);
  console.log(`  pairs:      ${report.pair_count}`);
  console.log(`  precision:  ${report.precision_score.toFixed(3)}`);
  console.log(`  recall:     ${report.recall_score.toFixed(3)}`);
  console.log(`  f1:         ${report.f1_score.toFixed(3)}`);
  console.log(`  confusion:  TP=${report.confusion.tp} FP=${report.confusion.fp} TN=${report.confusion.tn} FN=${report.confusion.fn}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
