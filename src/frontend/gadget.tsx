// "Drive receipt" dashboard gadget: what you heard and approved on the way in, with undo,
// plus Risk Radar with a two-click fix (Propose -> Confirm). The desk experience must stand alone
// for judges, who test at a desk, not in a car.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  xcss,
} from '@forge/react';
import { call } from './call';

interface Line {
  text: string;
  ok: boolean;
  issueKey?: string;
}
interface ReceiptView {
  id: string;
  at: string;
  kind: 'talkback' | 'risk-fix';
  heard: string;
  lines: Line[];
  allOk: boolean;
  canUndo: boolean;
  undone: boolean;
}
interface RiskJson {
  key: string;
  summary: string;
  score: number;
  label: 'confirmed' | 'estimated';
  sources: string[];
  signals: Array<{ rule: string }>;
  proposed_fix: { say: string };
}

const card = xcss({
  padding: 'space.150',
  borderRadius: 'radius.medium',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
});
const time = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function Receipt({ r, onUndo, busy }: { r: ReceiptView; onUndo: () => void; busy: boolean }) {
  return (
    <Box xcss={card}>
      <Stack space="space.075">
        <Inline space="space.100" alignBlock="center" spread="space-between">
          <Inline space="space.100" alignBlock="center">
            <Lozenge appearance={r.undone ? 'default' : r.allOk ? 'success' : 'moved'}>
              {r.undone ? 'Undone' : r.kind === 'talkback' ? 'Status update' : 'Risk fix'}
            </Lozenge>
            <Text size="small">{time(r.at)}</Text>
          </Inline>
          {r.canUndo && (
            <Button appearance="subtle" spacing="compact" isDisabled={busy} onClick={onUndo}>
              Undo
            </Button>
          )}
        </Inline>
        <Text>
          <Text as="strong">You said:</Text> “{r.heard}”
        </Text>
        <Stack space="space.025">
          {r.lines.map((l, i) => (
            <Text key={i} color={l.ok ? 'color.text' : 'color.text.danger'}>
              {l.ok ? '✓' : '✗'} {l.text}
            </Text>
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}

function Risk({ r, rank, onPropose, busy }: { r: RiskJson; rank: number; onPropose: (rank: number) => void; busy: boolean }) {
  return (
    <Box xcss={card}>
      <Stack space="space.075">
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance={r.label === 'confirmed' ? 'removed' : 'inprogress'}>{r.label}</Lozenge>
          <Text as="strong">{r.key}</Text>
          <Text>{r.summary}</Text>
        </Inline>
        <Text size="small">Why: {r.signals.map((s) => s.rule).join('; ')}</Text>
        <Text size="small">Sources: {r.sources.join(', ')}</Text>
        <Inline space="space.100" alignBlock="center">
          <Text>Proposed: {r.proposed_fix.say}</Text>
          <Button spacing="compact" isDisabled={busy} onClick={() => onPropose(rank)}>
            Review fix
          </Button>
        </Inline>
      </Stack>
    </Box>
  );
}

function App() {
  const [receipts, setReceipts] = useState<ReceiptView[] | null>(null);
  const [risks, setRisks] = useState<RiskJson[] | null>(null);
  const [pending, setPending] = useState<{ readback: string; pendingId: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'information' | 'error' | 'success'; text: string }>();
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [r, k] = await Promise.all([call<ReceiptView[]>('getReceipts'), call<RiskJson[]>('getRisks')]);
    setReceipts(r);
    setRisks(k);
  };
  useEffect(() => {
    load().catch((e) => setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) }));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const undo = (id: string) =>
    run(async () => {
      const out = await call<{ ok: boolean; failed: number }>('undo', { receiptId: id });
      setMsg(
        out.ok
          ? { kind: 'success', text: 'Undone. Comments, notifications and created issues stay for the audit trail.' }
          : { kind: 'error', text: `Undo partly failed (${out.failed}). Check the issues in Jira.` },
      );
      await load();
    });

  const propose = (rank: number) =>
    run(async () => {
      const p = await call<{ readback: string; pendingId?: string }>('proposeRiskFix', { rank });
      if (p.pendingId) setPending({ readback: p.readback, pendingId: p.pendingId });
      else setMsg({ kind: 'information', text: p.readback });
    });

  const decide = (confirm: boolean) =>
    run(async () => {
      if (!pending) return;
      const out = await call<{ speech: string }>('resolvePending', { pendingId: pending.pendingId, confirm });
      setPending(null);
      setMsg({ kind: confirm ? 'success' : 'information', text: out.speech });
      await load();
    });

  if (!receipts || !risks) return <Spinner label="Loading your drive receipt" />;

  return (
    <Stack space="space.200">
      {msg && (
        <SectionMessage appearance={msg.kind}>
          <Text>{msg.text}</Text>
        </SectionMessage>
      )}

      {pending && (
        <SectionMessage appearance="warning" title="Confirm this change">
          <Stack space="space.100">
            <Text>{pending.readback}</Text>
            <Text size="small">Nothing changes until you confirm. This expires in 2 minutes.</Text>
            <ButtonGroup>
              <Button appearance="primary" isDisabled={busy} onClick={() => decide(true)}>
                Confirm
              </Button>
              <Button appearance="subtle" isDisabled={busy} onClick={() => decide(false)}>
                Cancel
              </Button>
            </ButtonGroup>
          </Stack>
        </SectionMessage>
      )}

      <Inline spread="space-between" alignBlock="center">
        <Heading as="h3">On the way in</Heading>
        <Button appearance="subtle" spacing="compact" isDisabled={busy} onClick={() => run(load)}>
          Refresh
        </Button>
      </Inline>
      {receipts.length === 0 ? (
        <Text>No voice updates yet. Try in Rovo: “I finished MP-12”, then say yes.</Text>
      ) : (
        receipts.slice(0, 5).map((r) => <Receipt key={r.id} r={r} busy={busy} onUndo={() => undo(r.id)} />)
      )}

      <Heading as="h3">Risk Radar</Heading>
      {risks.length === 0 ? (
        <Text>No risks this week.</Text>
      ) : (
        risks.map((r, i) => <Risk key={r.key} r={r} rank={i + 1} busy={busy || !!pending} onPropose={propose} />)
      )}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
