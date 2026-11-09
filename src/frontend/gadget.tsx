// "Drive receipt" dashboard gadget: what you heard and approved on the way in, with undo,
// plus the Risk Radar panel. The desk experience must stand alone for judges.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Inline, Lozenge, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { call } from './call';

interface OpResult {
  op: { type: string; issueKey?: string };
  ok: boolean;
  error?: string;
  createdKey?: string;
  undo?: unknown;
}
interface Receipt {
  id: string;
  at: string;
  kind: string;
  heard: string;
  results: OpResult[];
}
interface RiskJson {
  key: string;
  summary: string;
  score: number;
  label: string;
  sources: string[];
  signals: Array<{ rule: string }>;
  proposed_fix: { say: string };
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function App() {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [risks, setRisks] = useState<RiskJson[] | null>(null);
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState<string>();

  const load = async () => {
    setReceipts(await call<Receipt[]>('getReceipts'));
    const r = await call<{ risks?: RiskJson[] }>('getRisks');
    setRisks(r?.risks ?? []);
  };
  useEffect(() => {
    load().catch((e) => setMsg(String(e)));
  }, []);

  const undo = async (id: string) => {
    setBusy(id);
    try {
      await call('undo', { receiptId: id });
      setMsg('Undone. Comments and created issues stay, for the audit trail.');
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  if (!receipts || !risks) return <Spinner label="Loading your drive receipt" />;

  return (
    <Stack space="space.200">
      {msg && (
        <SectionMessage appearance="information">
          <Text>{msg}</Text>
        </SectionMessage>
      )}
      <Heading as="h3">On the way in</Heading>
      {receipts.length === 0 && <Text>No voice updates yet. Try: "Hey Siri, HeyBrief, I finished MP-12".</Text>}
      {receipts.slice(0, 5).map((r) => (
        <Stack key={r.id} space="space.050">
          <Inline space="space.100" alignBlock="center">
            <Lozenge appearance={r.results.every((x) => x.ok) ? 'success' : 'moved'}>
              {r.kind === 'talkback' ? 'Status update' : 'Risk fix'}
            </Lozenge>
            <Text>{time(r.at)}</Text>
          </Inline>
          <Text>Heard: “{r.heard}”</Text>
          <Text>
            {r.results
              .filter((x) => x.ok && x.op.issueKey)
              .map((x) => `${x.op.type} ${x.op.issueKey}`)
              .join(' · ')}
            {r.results.find((x) => x.createdKey) ? ` · created ${r.results.find((x) => x.createdKey)!.createdKey}` : ''}
          </Text>
          {r.results.some((x) => x.undo) && (
            <Button appearance="subtle" isDisabled={busy === r.id} onClick={() => undo(r.id)}>
              Undo
            </Button>
          )}
        </Stack>
      ))}
      <Heading as="h3">Risk Radar</Heading>
      {risks.length === 0 && <Text>No risks this week.</Text>}
      {risks.map((r) => (
        <Stack key={r.key} space="space.050">
          <Inline space="space.100" alignBlock="center">
            <Lozenge appearance={r.label === 'confirmed' ? 'removed' : 'inprogress'}>{r.label}</Lozenge>
            <Text>
              {r.key}: {r.summary} (score {r.score})
            </Text>
          </Inline>
          <Text>Why: {r.signals.map((s) => s.rule).join('; ')}</Text>
          <Text>
            Sources: {r.sources.join(', ')} · Proposed: {r.proposed_fix.say}
          </Text>
        </Stack>
      ))}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
