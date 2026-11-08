/**
 * Playtest Lens collector for Google Drive.
 *
 * Testers' games upload their playtest sessions here; the Playtest Lens panel
 * in the Godot editor downloads them. Files are stored in your Drive under
 * "Playtest Lens Uploads/<game>/sessions" and ".../maps".
 *
 * Setup (see docs/CLOUD_SYNC.md):
 *   1. Paste this file into a new project at https://script.google.com
 *   2. Replace both keys below with your own random strings.
 *   3. Deploy > New deployment > Web app.
 *      Execute as: Me. Who has access: Anyone.
 *   4. Put the Web app URL and UPLOAD_KEY in Godot's Project Settings, and the
 *      URL and READ_KEY in the Playtest Lens panel.
 */

// Ships inside your game builds. It can only add playtest files.
const UPLOAD_KEY = 'replace-with-a-random-upload-key';
// Stays in your Godot editor. It can read everything uploaded here.
const READ_KEY = 'replace-with-a-different-random-read-key';

const ROOT_NAME = 'Playtest Lens Uploads';
const MAX_BYTES = 20 * 1024 * 1024;

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, error: 'The request was not valid JSON.' });
  }
  if (!sameKey_(body.key, UPLOAD_KEY)) return reply_({ ok: false, error: 'Wrong upload key.' });
  const name = safeName_(body.name);
  if (!/\.(jsonl|json|png)$/i.test(name)) return reply_({ ok: false, error: 'Only .jsonl, .json and .png files are accepted.' });
  if (String(body.content || '').length > MAX_BYTES) return reply_({ ok: false, error: 'File too large.' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const folder = child_(child_(root_(), safeName_(body.game || 'game')), body.kind === 'map' ? 'maps' : 'sessions');
    const blob = body.encoding === 'base64'
      ? Utilities.newBlob(Utilities.base64Decode(body.content), 'image/png', name)
      : Utilities.newBlob(String(body.content || ''), 'text/plain', name);
    // Sessions are re-sent as they grow, so replace any earlier copy.
    const existing = folder.getFilesByName(name);
    while (existing.hasNext()) existing.next().setTrashed(true);
    folder.createFile(blob);
  } finally {
    lock.releaseLock();
  }
  return reply_({ ok: true });
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!sameKey_(p.key, READ_KEY)) return reply_({ ok: false, error: 'Wrong read key.' });
  const root = root_();
  if (p.action === 'get') {
    const file = DriveApp.getFileById(p.id);
    if (!isInside_(file, root)) return reply_({ ok: false, error: 'Not a Playtest Lens file.' });
    const png = file.getMimeType() === 'image/png';
    return reply_({
      ok: true,
      name: file.getName(),
      encoding: png ? 'base64' : 'text',
      content: png ? Utilities.base64Encode(file.getBlob().getBytes()) : file.getBlob().getDataAsString(),
    });
  }
  const files = [];
  const games = root.getFolders();
  while (games.hasNext()) {
    const game = games.next();
    for (const kind of ['sessions', 'maps']) {
      const sub = game.getFoldersByName(kind);
      if (!sub.hasNext()) continue;
      const it = sub.next().getFiles();
      while (it.hasNext()) {
        const f = it.next();
        files.push({ id: f.getId(), name: f.getName(), game: game.getName(), kind: kind === 'maps' ? 'map' : 'session', size: f.getSize(), updated: f.getLastUpdated().getTime() });
      }
    }
  }
  return reply_({ ok: true, files: files });
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sameKey_(given, expected) {
  return typeof given === 'string' && given.length > 0 && given === expected && expected.indexOf('replace-with') !== 0;
}

function safeName_(text) {
  return String(text || '').replace(/[^A-Za-z0-9_.\-]+/g, '_').slice(0, 120) || 'unnamed';
}

function root_() {
  const it = DriveApp.getFoldersByName(ROOT_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_NAME);
}

function child_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// True when the file sits in ROOT_NAME/<game>/<sessions|maps>.
function isInside_(file, root) {
  const rootId = root.getId();
  const parents = file.getParents();
  while (parents.hasNext()) {
    const kindFolder = parents.next();
    const games = kindFolder.getParents();
    while (games.hasNext()) {
      const roots = games.next().getParents();
      while (roots.hasNext()) if (roots.next().getId() === rootId) return true;
    }
  }
  return false;
}
