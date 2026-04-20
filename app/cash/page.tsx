import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Banknote, Clock, ArrowRight } from 'lucide-react';

export default function CashPage() {
  return (
    <AppShell>
      <div className="w-full px-6 xl:px-8 2xl:px-10 py-6 max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Cash Reconciliation</h1>
          <Badge variant="outline" className="text-[10px] uppercase font-mono bg-amber-50 text-amber-700 border-amber-200">
            <Clock className="h-3 w-3 mr-1" />
            Coming soon
          </Badge>
        </div>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              Why we built this module
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-700 space-y-2">
            <p>
              Securities reconciliation and cash reconciliation share the same canonical pattern: feed profiles,
              versioned mappings, a layered matching engine, and a human-in-the-loop exception workspace.
            </p>
            <p>
              Cash recon extends through the same seven-layer engine. The only differences are the canonical
              schema (cash transactions instead of trades) and the tolerance profile on timing and amount.
            </p>
            <p className="text-slate-500">
              Reference data — counterparties, accounts, correspondent banks — is the same Neo4j graph. No
              rewrite required.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-50 border-slate-200 opacity-75">
          <CardContent className="pt-6">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Preview</p>
            <div className="grid grid-cols-4 gap-3">
              {[
                ['Cash in', '$4.8M'],
                ['Cash out', '$4.6M'],
                ['Open breaks', '12'],
                ['Median age', '1.8 d']
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-slate-200 bg-white p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
                  <div className="text-lg font-mono tabular-nums text-slate-900 mt-1">{value}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-slate-700">
              Roadmap order: PDF ingestion (Docling) → Corporate actions → Cash reconciliation → FX
              <ArrowRight className="h-3 w-3 inline mx-1.5" />
              each shares the canonical pattern documented in
              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded ml-1">docs/CANONICAL_SCHEMA.md</span>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
