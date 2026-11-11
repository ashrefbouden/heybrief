// HeyBrief settings: where to talk to HeyBrief, projects, and the one-click demo data loader (admins only).
// Siri pairing is on the roadmap (docs/ROADMAP_SIRI.md); its code is kept but not wired.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Code,
  Heading,
  Inline,
  Label,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  Textfield,
  useProductContext,
  xcss,
} from '@forge/react';
import { call } from './call';
import { KIT, langFromLocale } from './kit-i18n';

interface Settings {
  projectKeys: string[];
  standupSpaceKey: string;
  isAdmin: boolean;
}
interface SeedResult {
  alreadyLoaded: boolean;
  keys: Record<string, string>;
  people: Record<string, string | undefined>;
  script: { talkback: string; risk: string };
  expectedRisks: number;
  notes: string[];
}

const panel = xcss({
  padding: 'space.200',
  borderRadius: 'radius.large',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  backgroundColor: 'elevation.surface.raised',
});

function App() {
  const ctx = useProductContext();
  const s = KIT[langFromLocale(ctx?.locale)];
  const [settings, setSettings] = useState<Settings>();
  const [failed, setFailed] = useState(false);
  const [projects, setProjects] = useState('');
  const [demoProject, setDemoProject] = useState('');
  const [seed, setSeed] = useState<SeedResult>();
  const [note, setNote] = useState<{ kind: 'information' | 'error' | 'success'; text: string }>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call<Settings>('getSettings')
      .then((x) => {
        setSettings(x);
        setProjects(x.projectKeys.join(', '));
        setDemoProject(x.projectKeys[0] ?? '');
      })
      .catch(() => setFailed(true));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (failed)
    return (
      <SectionMessage appearance="error">
        <Text>{s.loadFailed}</Text>
      </SectionMessage>
    );
  if (!settings) return <Spinner label={s.loading} />;

  return (
    <Stack space="space.300">
      <Heading size="large">{s.settingsTitle}</Heading>
      {note && (
        <SectionMessage appearance={note.kind}>
          <Text>{note.text}</Text>
        </SectionMessage>
      )}

      <Box xcss={panel}>
        <Stack space="space.100">
          <Heading size="small">{s.talkTitle}</Heading>
          <Text>{s.talkBody}</Text>
        </Stack>
      </Box>

      {!settings.isAdmin && (
        <SectionMessage appearance="information">
          <Text>{s.notAdmin}</Text>
        </SectionMessage>
      )}

      {settings.isAdmin && (
        <Box xcss={panel}>
          <Stack space="space.150">
            <Heading size="small">{s.projectsTitle}</Heading>
            <Label labelFor="projects">{s.projectsBody}</Label>
            <Inline space="space.100" alignBlock="end">
              <Textfield id="projects" name="projects" value={projects} onChange={(e) => setProjects(e.target.value)} />
              <Button
                isDisabled={busy}
                onClick={() =>
                  run(async () => {
                    const x = await call<Settings>('saveSettings', { projectKeys: projects.split(',') });
                    setProjects(x.projectKeys.join(', '));
                    setNote({ kind: 'success', text: s.saved(x.projectKeys.join(', ')) });
                  })
                }
              >
                {s.save}
              </Button>
            </Inline>
          </Stack>
        </Box>
      )}

      {settings.isAdmin && (
        <Box xcss={panel}>
          <Stack space="space.150">
            <Heading size="small">{s.demoTitle}</Heading>
            <Label labelFor="demoProject">{s.demoBody}</Label>
            <Inline space="space.100" alignBlock="end">
              <Textfield id="demoProject" name="demoProject" value={demoProject} onChange={(e) => setDemoProject(e.target.value)} />
              <Button
                appearance="primary"
                isDisabled={busy}
                onClick={() =>
                  run(async () => {
                    setNote({ kind: 'information', text: s.demoWorking });
                    const r = await call<SeedResult>('loadDemoData', { projectKey: demoProject.trim() });
                    setSeed(r);
                    setNote(
                      r.alreadyLoaded ? { kind: 'information', text: r.notes[0] } : { kind: 'success', text: s.demoDone(r.expectedRisks) },
                    );
                  })
                }
              >
                {s.demoLoad}
              </Button>
            </Inline>
            {seed && !seed.alreadyLoaded && (
              <SectionMessage appearance="discovery" title={s.tryIt}>
                <Stack space="space.100">
                  <Text>{s.trySay}</Text>
                  <Code>{seed.script.risk}</Code>
                  <Code>{seed.script.talkback}</Code>
                  {seed.notes.map((n, i) => (
                    <Text key={i}>{n}</Text>
                  ))}
                </Stack>
              </SectionMessage>
            )}
          </Stack>
        </Box>
      )}

      <Box xcss={panel}>
        <Stack space="space.100">
          <Heading size="small">{s.privacyTitle}</Heading>
          <Text>{s.privacyBody}</Text>
        </Stack>
      </Box>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
