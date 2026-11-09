// HeyBrief settings: pair a phone for Siri (token shown once), unpair, and pick projects.
// Demo data loader button lands here on Nov 16.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Code, Heading, SectionMessage, Stack, Text, Textfield } from '@forge/react';
import { call } from './call';

function App() {
  const [pair, setPair] = useState<{ token: string; url: string }>();
  const [projects, setProjects] = useState('');
  const [note, setNote] = useState<string>();

  useEffect(() => {
    call<{ projectKeys: string[] }>('getSettings').then((s) => setProjects(s.projectKeys.join(', ')));
  }, []);

  return (
    <Stack space="space.200">
      <Heading as="h2">HeyBrief</Heading>
      {note && (
        <SectionMessage appearance="information">
          <Text>{note}</Text>
        </SectionMessage>
      )}

      <Heading as="h3">Siri</Heading>
      <Text>Pair your iPhone. The token is shown once; pairing again revokes the old one.</Text>
      <Button appearance="primary" onClick={async () => setPair(await call<{ token: string; url: string }>('pairPhone'))}>
        Pair a phone
      </Button>
      {pair && (
        <Stack space="space.100">
          <Text>Paste both into the HeyBrief Shortcut:</Text>
          <Code>{pair.url}</Code>
          <Code>{pair.token}</Code>
        </Stack>
      )}
      <Button
        appearance="subtle"
        onClick={async () => {
          await call('unpairPhone');
          setPair(undefined);
          setNote('Phone unpaired.');
        }}
      >
        Unpair
      </Button>

      <Heading as="h3">Projects</Heading>
      <Textfield name="projects" value={projects} onChange={(e) => setProjects(e.target.value)} />
      <Button
        onClick={async () => {
          const s = await call<{ projectKeys: string[] }>('saveSettings', { projectKeys: projects.split(',') });
          setNote(`Saved: ${s.projectKeys.join(', ')}`);
        }}
      >
        Save
      </Button>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
