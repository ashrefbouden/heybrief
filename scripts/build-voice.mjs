// Builds the voice console twice from src/frontend/voice:
//   dist/heybrief-voice.html  self-contained browser prototype (engine + simulated Jira inline)
//   static/voice/build/       Forge Custom UI resource for the "HeyBrief" Jira page
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';

const css = await readFile('src/frontend/voice/console.css', 'utf8');
const common = { bundle: true, format: 'iife', target: 'es2020', minify: true, legalComments: 'none', write: false };

const proto = await build({ ...common, entryPoints: ['src/frontend/voice/proto.ts'] });
const js = proto.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
await mkdir('dist', { recursive: true });
await writeFile(
  'dist/heybrief-voice.html',
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="claude:viewport-fit-sides">
<title>HeyBrief Voice Prototype</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>${js}</script>
</body>
</html>
`,
);

await mkdir('static/voice/build', { recursive: true });
await build({ ...common, write: true, entryPoints: ['src/frontend/voice/forge.ts'], outfile: 'static/voice/build/main.js' });
await writeFile('static/voice/build/console.css', css);
await writeFile(
  'static/voice/build/index.html',
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HeyBrief</title>
<link rel="stylesheet" href="console.css">
</head>
<body>
<div id="app"></div>
<script src="main.js"></script>
</body>
</html>
`,
);
console.log('built dist/heybrief-voice.html and static/voice/build');
