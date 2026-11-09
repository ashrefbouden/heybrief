// HeyBrief settings: pair a phone for Siri (token shown once), unpair, projects, and the
// one-click demo data loader (admins only).
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Code, Heading, SectionMessage, Stack, Text, Textfield } from '@forge/react';
import { call } from './call';

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

function App() {
  const [settings, setSettings] = useState<Settings>();
  const [pair, setPair] = useState<{ token: string; url: string }>();
  const [projects, setProjects] = useState('');
  const [demoProject, setDemoProject] = useState('');
  const [seed, setSeed] = useState<SeedResult>();
  const [note, setNote] = useState<{ kind: 'information' | 'error' | 'success'; text: string }>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call<Settings>('getSettings').then((s) => {
      setSettings(s);
      setProjects(s.projectKeys.join(', '));
      setDemoProject(s.projectKeys[0] ?? '');
    });
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

  return (
    <Stack space="space.200">
      <Heading as="h2">HeyBrief</Heading>
      {note && (
        <SectionMessage appearance={note.kind}>
          <Text>{note.text}</Text>
        </SectionMessage>
      )}

      <Heading as="h3">Siri</Heading>
      <Text>Pair your iPhone. The token is shown once; pairing again revokes the old one.</Text>
      <Button appearance="primary" isDisabled={busy} onClick={() => run(async () => setPair(await call('pairPhone')))}>
        Pair a phone
      </Button>
      {pair && (
        <SectionMessage appearance="warning" title="Copy these now. They won't be shown again.">
          <Stack space="space.100">
            <Text>Web address for the Shortcut:</Text>
            <Code>{pair.url}</Code>
            <Text>Your token (treat it like a password):</Text>
            <Code>{pair.token}</Code>
          </Stack>
        </SectionMessage>
      )}
      <Button
        appearance="subtle"
        isDisabled={busy}
        onClick={() =>
          run(async () => {
            await call('unpairPhone');
            setPair(undefined);
            setNote({ kind: 'success', text: 'Phone unpaired. The old token no longer works.' });
          })
        }
      >
        Unpair
      </Button>

      {settings?.isAdmin && (
        <>
          <Heading as="h3">Projects</Heading>
          <Text>Comma-separated project keys HeyBrief reads.</Text>
          <Textfield name="projects" value={projects} onChange={(e) => setProjects(e.target.value)} />
          <Button
            isDisabled={busy}
            onClick={() =>
              run(async () => {
                const s = await call<Settings>('saveSettings', { projectKeys: projects.split(',') });
                setNote({ kind: 'success', text: `Saved: ${s.projectKeys.join(', ')}` });
              })
            }
          >
            Save
          </Button>

          <Heading as="h3">Demo data</Heading>
          <Text>Creates 14 labelled issues with three built-in risks. Use an empty test project.</Text>
          <Textfield name="demoProject" value={demoProject} onChange={(e) => setDemoProject(e.target.value)} />
          <Button
            appearance="primary"
            isDisabled={busy}
            onClick={() =>
              run(async () => {
                setNote({ kind: 'information', text: 'Creating demo issues, about 20 seconds…' });
                const r = await call<SeedResult>('loadDemoData', { projectKey: demoProject.trim() });
                setSeed(r);
                setNote(
                  r.alreadyLoaded
                    ? { kind: 'information', text: r.notes[0] }
                    : { kind: 'success', text: `Demo loaded. Risk Radar should find ${r.expectedRisks} risks.` },
                );
              })
            }
          >
            Load demo data
          </Button>
          {seed && !seed.alreadyLoaded && (
            <SectionMessage appearance="information" title="Try it">
              <Stack space="space.100">
                <Text>In Rovo, open HeyBrief and say:</Text>
                <Code>{seed.script.risk}</Code>
                <Code>{seed.script.talkback}</Code>
                {seed.notes.map((n, i) => (
                  <Text key={i}>{n}</Text>
                ))}
              </Stack>
            </SectionMessage>
          )}
        </>
      )}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
