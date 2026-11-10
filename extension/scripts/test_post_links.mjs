import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { copyPostLinkInPage } from '../src/lib/postLink.js';
import { cardToPost, resolveCopiedPostLinks } from '../src/lib/posts.js';

const { document } = parseHTML(`<div class="feed-shared-update-v2" data-urn="urn:li:share:7524577087303880704" data-outreach-copy-token="test">
  <div class="update-components-text">Apply: bozhidar@techwork.bg</div>
  <button class="feed-shared-control-menu__trigger" aria-controls="post-menu">More</button>
</div><div id="post-menu" hidden><button role="menuitem">Copy link to post</button></div>`);
globalThis.document = document;
const writes = [];
const clipboard = { writeText: async (text) => writes.push(text) };
Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true });
const originalWrite = clipboard.writeText;
const card = document.querySelector('.feed-shared-update-v2');
const trigger = card.querySelector('button');
const menu = document.querySelector('#post-menu');
trigger.addEventListener('click', () => {
  menu.hidden = !menu.hidden;
  trigger.setAttribute('aria-expanded', String(!menu.hidden));
});
menu.querySelector('button').addEventListener('click', () => {
  void clipboard.writeText('https://lnkd.in/p/dZa85pXX');
});
assert.equal(await copyPostLinkInPage('test', 'bozhidar@techwork.bg'), 'https://lnkd.in/p/dZa85pXX');
assert.equal(clipboard.writeText, originalWrite, 'restore clipboard method after capture');
assert.deepEqual(writes, [], 'do not overwrite or read the user clipboard');
assert.equal(menu.hidden, true, 'close the menu opened by capture');
assert.equal(await copyPostLinkInPage('test', 'someone-else@example.com'), '', 'do not copy from the wrong card');

const realButton = menu.querySelector('button');
const failedButton = document.createElement('button');
failedButton.textContent = 'Copy link to post';
failedButton.setAttribute('role', 'menuitem');
realButton.replaceWith(failedButton);
failedButton.addEventListener('click', () => { void clipboard.writeText('https://example.com/unrelated'); });
assert.equal(await copyPostLinkInPage('test', 'bozhidar@techwork.bg'), '', 'reject non-post copy values');
assert.equal(clipboard.writeText, originalWrite, 'restore after failure too');
assert.equal(menu.hidden, true);
failedButton.replaceWith(realButton);

// Older copy implementations select a temporary textarea and call execCommand.
const legacyButton = document.createElement('button');
legacyButton.textContent = 'Copy link to post';
legacyButton.setAttribute('role', 'menuitem');
realButton.replaceWith(legacyButton);
const oldExec = () => { throw new Error('should capture this copy without changing clipboard'); };
document.execCommand = oldExec;
document.getSelection = () => ({ toString: () => 'https://lnkd.in/p/dZa85pXX' });
legacyButton.addEventListener('click', () => document.execCommand('copy'));
assert.equal(await copyPostLinkInPage('test', 'bozhidar@techwork.bg'), 'https://lnkd.in/p/dZa85pXX');
assert.equal(document.execCommand, oldExec, 'restore legacy copy method');
legacyButton.replaceWith(realButton);

const item = cardToPost(card);
assert.equal(item.job_url, '', 'do not construct a share permalink');
await resolveCopiedPostLinks([item], async (source, email) => {
  assert.equal(source, card);
  assert.equal(email, 'bozhidar@techwork.bg');
  return 'https://lnkd.in/p/dZa85pXX';
});
assert.equal(item.job_url, 'https://lnkd.in/p/dZa85pXX');
assert.equal(item.detail_payload.post_url_source, 'copied');
const reparse = cardToPost(card);
await resolveCopiedPostLinks([reparse], () => { throw new Error('cached card should not reopen its menu'); });
assert.equal(reparse.job_url, 'https://lnkd.in/p/dZa85pXX');
console.log('post link tests passed (exact card, copy capture, clipboard cleanup, short URL)');
