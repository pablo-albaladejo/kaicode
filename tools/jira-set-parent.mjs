#!/usr/bin/env node
// Sets the parent (epic) of Jira work items through REST, with the acli API token from the Keychain.
//   node jira-set-parent.mjs APR-7093 APR-7869 [APR-7870 ...]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const cfg = fs.readFileSync(path.join(process.env.HOME, '.config/acli/jira_config.yaml'), 'utf8');
const field = (name) => new RegExp(`${name}:\\s*(\\S+)`).exec(cfg)?.[1];
const raw = execFileSync('security', ['find-generic-password', '-s', 'acli', '-a', `jira:${field('cloud_id')}:${field('account_id')}`, '-w'], { encoding: 'utf8' }).trim();
const token = raw.startsWith('go-keyring-base64:') ? Buffer.from(raw.slice(18), 'base64').toString('utf8') : raw;
const auth = `Basic ${Buffer.from(`${field('email')}:${token}`).toString('base64')}`;
const site = field('site') ?? 'aircall-product.atlassian.net';
const [parent, ...keys] = process.argv.slice(2);
for (const key of keys) {
  const res = await fetch(`https://${site}/rest/api/3/issue/${key}`, {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ fields: { parent: { key: parent } } }),
  });
  const check = await (await fetch(`https://${site}/rest/api/3/issue/${key}?fields=parent`, { headers: { Authorization: auth, Accept: 'application/json' } })).json();
  console.log(`${key}: HTTP ${res.status}${res.ok ? '' : ' ' + (await res.text()).slice(0, 200)} parent=${check.fields?.parent?.key ?? 'none'}`);
}
