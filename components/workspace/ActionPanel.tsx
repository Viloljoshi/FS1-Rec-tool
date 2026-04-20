'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Check, X, AlertTriangle, StickyNote, UserPlus } from 'lucide-react';
import type { Exception } from '@/app/workspace/WorkspaceClient';

interface Props {
  exception: Exception;
  onAction: (action: 'ACCEPT' | 'REJECT' | 'ESCALATE' | 'NOTE' | 'ASSIGN', reason?: string) => void;
}

export function ActionPanel({ exception, onAction }: Props) {
  const [note, setNote] = useState('');
  const isTerminal = exception.status === 'RESOLVED' || exception.status === 'ESCALATED';

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-slate-200">
        <h3 className="text-sm font-medium text-slate-900">Actions</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          {isTerminal ? (
            <>
              This exception is <span className="font-mono font-semibold">{exception.status}</span>.
              Terminal actions are disabled. You can still add a note or reassign.
            </>
          ) : (
            <>Every action is audited immutably.</>
          )}
        </p>
      </div>
      <div className="p-4 space-y-2">
        <Button
          onClick={() => onAction('ACCEPT')}
          disabled={isTerminal}
          className="w-full justify-start bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300"
        >
          <Check className="h-4 w-4 mr-2" />
          Accept match
          <span className="ml-auto kbd bg-white/20 border-white/30 text-white">A</span>
        </Button>
        <Button
          onClick={() => onAction('REJECT', 'rejected by analyst')}
          disabled={isTerminal}
          variant="outline"
          className="w-full justify-start border-rose-200 text-rose-700 hover:bg-rose-50 disabled:text-slate-400 disabled:border-slate-200"
        >
          <X className="h-4 w-4 mr-2" />
          Reject
          <span className="ml-auto kbd">R</span>
        </Button>
        <Button
          onClick={() => onAction('ESCALATE', 'escalated for manager review')}
          disabled={isTerminal}
          variant="outline"
          className="w-full justify-start disabled:text-slate-400 disabled:border-slate-200"
        >
          <AlertTriangle className="h-4 w-4 mr-2" />
          Escalate
          <span className="ml-auto kbd">E</span>
        </Button>
        <Separator className="my-2" />
        <div className="space-y-1.5">
          <Label htmlFor="note" className="text-xs text-slate-500">
            Add note
          </Label>
          <Input
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Short analyst note..."
            className="h-8 text-xs"
          />
          <Button
            onClick={() => {
              if (note.trim()) {
                onAction('NOTE', note);
                setNote('');
              }
            }}
            variant="outline"
            size="sm"
            className="w-full"
            disabled={!note.trim()}
          >
            <StickyNote className="h-3.5 w-3.5 mr-1.5" />
            Save note
          </Button>
        </div>
        <Button
          onClick={() => onAction('ASSIGN', 'assigned for follow-up')}
          variant="outline"
          className="w-full justify-start"
          size="sm"
        >
          <UserPlus className="h-3.5 w-3.5 mr-1.5" />
          Assign to teammate
        </Button>
      </div>
      <div className="px-4 py-3 border-t border-slate-200 mt-auto">
        <div className="text-[10px] text-slate-400 uppercase tracking-wider">Exception</div>
        <div className="font-mono text-xs text-slate-600 mt-0.5">{exception.id.slice(0, 16)}…</div>
        <div className="text-xs text-slate-500 mt-1">
          status: <span className="font-mono">{exception.status}</span>
        </div>
      </div>
    </div>
  );
}
