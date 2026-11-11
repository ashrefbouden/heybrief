// "HeyBrief receipt" dashboard gadget: what you said and approved by voice, with undo,
// plus Risk Radar with a two-click fix (Review fix -> Yes). The desk experience must stand alone
// for judges, who test at a desk, not in a car.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  useProductContext,
  xcss,
} from '@forge/react';
import { call } from './call';
import { KIT, langFromLocale, type KitLang } from './kit-i18n';

interface Line {
  text: string;
  ok: boolean;
  issueKey?: string;
}
interface ReceiptView {
  id: string;
  at: string;
  kind: 'talkback' | 'risk-fix' | 'alert';
  heard: string;
  readback?: string;
  writeMs?: number;
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
  proposed_fix: { say: string; say_by_lang?: Record<KitLang, string> };
}
interface Pending {
  readback: string;
  pendingId: string;
  changes: string[];
}

const card = xcss({
  padding: 'space.150',
  borderRadius: 'radius.large',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  backgroundColor: 'elevation.surface.raised',
});
const accentOk = xcss({ borderLeftWidth: 'border.width.selected', borderLeftColor: 'color.border.success' });
const accentWarn = xcss({ borderLeftWidth: 'border.width.selected', borderLeftColor: 'color.border.warning' });
const accentRisk = xcss({ borderLeftWidth: 'border.width.selected', borderLeftColor: 'color.border.danger' });

function Receipt({ r, onUndo, busy, s, lang }: { r: ReceiptView; onUndo: () => void; busy: boolean; s: typeof KIT.en; lang: KitLang }) {
  const when = new Date(r.at).toLocaleString(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <Box xcss={[card, r.allOk ? accentOk : accentWarn]}>
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" spread="space-between">
          <Inline space="space.100" alignBlock="center">
            <Lozenge appearance={r.undone ? 'default' : r.kind === 'alert' ? 'removed' : r.kind === 'risk-fix' ? 'moved' : 'inprogress'}>
              {r.undone ? s.undone : (s.kind[r.kind] ?? r.kind)}
            </Lozenge>
            <Text size="small" color="color.text.subtlest">
              {when}
            </Text>
          </Inline>
          {r.canUndo && (
            <Button appearance="subtle" spacing="compact" iconBefore="undo" isDisabled={busy} onClick={onUndo}>
              {s.undo}
            </Button>
          )}
        </Inline>
        <Text size="small" color="color.text.subtle">
          <Text as="strong">{s.youSaid}:</Text> “{r.heard}”
        </Text>
        {r.writeMs !== undefined && (
          <Text size="small" color="color.text.success">
            {s.savedIn(r.lines.filter((l) => l.ok).length, (r.writeMs / 1000).toFixed(1))}
          </Text>
        )}
        <Stack space="space.050">
          {r.lines.map((l, i) => (
            <Inline key={i} space="space.075" alignBlock="center">
              <Lozenge appearance={r.undone ? 'default' : l.ok ? 'success' : 'removed'}>{l.ok ? '✓' : '✗'}</Lozenge>
              <Text color={l.ok ? 'color.text' : 'color.text.danger'}>{l.text}</Text>
            </Inline>
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}

function Risk({
  r,
  rank,
  onPropose,
  busy,
  s,
  lang,
}: {
  r: RiskJson;
  rank: number;
  onPropose: (rank: number) => void;
  busy: boolean;
  s: typeof KIT.en;
  lang: KitLang;
}) {
  const fix = r.proposed_fix.say_by_lang?.[lang] ?? r.proposed_fix.say;
  return (
    <Box xcss={[card, accentRisk]}>
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Lozenge appearance={r.label === 'confirmed' ? 'removed' : 'moved'} isBold>
            {r.label === 'confirmed' ? s.confirmed : s.estimate}
          </Lozenge>
          <Text as="strong">{r.key}</Text>
          <Text>{r.summary}</Text>
        </Inline>
        <Text size="small" color="color.text.subtle">
          <Text as="strong">{s.why}:</Text> {r.signals.map((x) => x.rule).join(' · ')}
        </Text>
        <Text size="small" color="color.text.subtlest">
          {s.sources}: {r.sources.join(', ')}
        </Text>
        <Inline space="space.100" alignBlock="center" spread="space-between" shouldWrap>
          <Text>
            <Text as="strong">{s.proposed}:</Text> {fix}
          </Text>
          <Button appearance="primary" spacing="compact" isDisabled={busy} onClick={() => onPropose(rank)}>
            {s.review}
          </Button>
        </Inline>
      </Stack>
    </Box>
  );
}

function App() {
  const ctx = useProductContext();
  const lang = langFromLocale(ctx?.locale);
  const s = KIT[lang];
  const [receipts, setReceipts] = useState<ReceiptView[] | null>(null);
  const [risks, setRisks] = useState<RiskJson[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [msg, setMsg] = useState<{ kind: 'information' | 'error' | 'success'; text: string }>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    const [r, k] = await Promise.all([call<ReceiptView[]>('getReceipts', { lang }), call<RiskJson[]>('getRisks')]);
    setReceipts(r);
    setRisks(k);
    setFailed(false);
  };
  useEffect(() => {
    if (!ctx) return;
    load().catch(() => setFailed(true));
  }, [ctx?.locale]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : s.loadFailed });
    } finally {
      setBusy(false);
    }
  };

  const undo = (id: string) =>
    run(async () => {
      const out = await call<{ ok: boolean; failed: number }>('undo', { receiptId: id });
      setMsg(out.ok ? { kind: 'success', text: s.undoOk } : { kind: 'error', text: s.undoPartial(out.failed) });
      await load();
    });

  const propose = (rank: number) =>
    run(async () => {
      const p = await call<{ readback: string; pendingId?: string; changes?: string[] }>('proposeRiskFix', { rank, lang });
      if (p.pendingId) setPending({ readback: p.readback, pendingId: p.pendingId, changes: p.changes ?? [] });
      else setMsg({ kind: 'information', text: p.readback });
    });

  const decide = (confirm: boolean) =>
    run(async () => {
      if (!pending) return;
      const out = await call<{ speech: string }>('resolvePending', { pendingId: pending.pendingId, confirm, lang });
      setPending(null);
      setMsg({ kind: confirm ? 'success' : 'information', text: out.speech });
      await load();
    });

  if (failed && !receipts)
    return (
      <SectionMessage appearance="error">
        <Stack space="space.100">
          <Text>{s.loadFailed}</Text>
          <Button onClick={() => run(load)}>{s.refresh}</Button>
        </Stack>
      </SectionMessage>
    );
  if (!receipts || !risks) return <Spinner label={s.loading} />;

  return (
    <Stack space="space.200">
      {msg && (
        <SectionMessage appearance={msg.kind}>
          <Text>{msg.text}</Text>
        </SectionMessage>
      )}

      {pending && (
        <SectionMessage appearance="warning" title={s.gateTitle}>
          <Stack space="space.100">
            <Text>{pending.readback}</Text>
            {pending.changes.map((c, i) => (
              <Text key={i}>→ {c}</Text>
            ))}
            <Text size="small">{s.gateNote}</Text>
            <Inline space="space.100">
              <Button appearance="primary" isDisabled={busy} onClick={() => decide(true)}>
                {s.confirm}
              </Button>
              <Button appearance="subtle" isDisabled={busy} onClick={() => decide(false)}>
                {s.cancel}
              </Button>
            </Inline>
          </Stack>
        </SectionMessage>
      )}

      <Inline spread="space-between" alignBlock="center">
        <Stack space="space.025">
          <Heading size="small">{s.receiptTitle}</Heading>
          <Text size="small" color="color.text.subtlest">
            {s.receiptSub}
          </Text>
        </Stack>
        <Button appearance="subtle" spacing="compact" iconBefore="refresh" isDisabled={busy} onClick={() => run(load)}>
          {s.refresh}
        </Button>
      </Inline>
      {receipts.length === 0 ? (
        <SectionMessage appearance="discovery">
          <Text>{s.receiptEmpty}</Text>
        </SectionMessage>
      ) : (
        receipts.slice(0, 5).map((r) => <Receipt key={r.id} r={r} s={s} lang={lang} busy={busy} onUndo={() => undo(r.id)} />)
      )}

      <Stack space="space.025">
        <Heading size="small">{s.radarTitle}</Heading>
        <Text size="small" color="color.text.subtlest">
          {s.radarSub}
        </Text>
      </Stack>
      {risks.length === 0 ? (
        <SectionMessage appearance="success">
          <Text>{s.radarEmpty}</Text>
        </SectionMessage>
      ) : (
        risks.map((r, i) => <Risk key={r.key} r={r} s={s} lang={lang} rank={i + 1} busy={busy || !!pending} onPropose={propose} />)
      )}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
