/**
 * Taste Test — Apps Script backend
 * Phase 1: workbook setup, API router, login and taster management.
 * Phase 2: types, product library, photo uploads to Drive.
 *
 * Bind this script to the "Taste Test" spreadsheet (Extensions → Apps Script),
 * run setup() once, then deploy as a web app (Execute as: Me, Access: Anyone).
 */

// ─── Schema ──────────────────────────────────────────────────────────────────
// One tab per table. setup() creates missing tabs and adds missing columns,
// so it is safe to re-run whenever the schema grows in later phases.
const SCHEMA = {
  Users:            ['userId', 'displayName', 'emoji', 'pinHash', 'pinSalt', 'isAdmin', 'active', 'created', 'lastLogin'],
  Sessions:         ['token', 'userId', 'created', 'expires'],
  Types:            ['typeId', 'name', 'icon'],
  Products:         ['productId', 'productLine', 'name', 'manufacturer', 'typeId', 'vintage', 'description', 'photoUrl', 'created', 'createdBy'],
  Tests:            ['testId', 'name', 'testDate', 'organiserId', 'status', 'halfPoints', 'currentSample', 'phase', 'phaseOpenedAt', 'version', 'created'],
  TestProducts:     ['testId', 'sampleNo', 'productId', 'order'],
  TestParticipants: ['testId', 'userId', 'joinedAt', 'status'],
  Scores:           ['testId', 'sampleNo', 'userId', 'niceness', 'authenticity', 'flavourGuess', 'guessCorrect', 'comment', 'phaseOpenedAt', 'nicenessAt', 'authenticityAt'],
  Notes:            ['testId', 'sampleNo', 'userId', 'note', 'phase', 'created'],
  Settings:         ['key', 'value']
};

// Free-text columns forced to plain text, so Sheets never turns "1/2" into a date.
const TEXT_COLS = {
  Users: ['displayName', 'pinHash', 'pinSalt'],
  Types: ['name'],
  Products: ['productLine', 'name', 'manufacturer', 'vintage', 'description'],
  Tests: ['name'],
  Scores: ['flavourGuess', 'comment'],
  Notes: ['note']
};

const DEFAULT_TYPES = [['Crisps', '🥔'], ['Chocolate', '🍫'], ['Biscuits', '🍪'], ['Wine', '🍷'], ['Cheese', '🧀']];
const SESSION_DAYS = 90;
const MAX_PIN_FAILS = 5;

// ─── One-off setup ───────────────────────────────────────────────────────────
function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.rename('Taste Test');

  Object.keys(SCHEMA).forEach(name => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const headers = SCHEMA[name];
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);

    if (existing.join('') === '') {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      headers.filter(h => existing.indexOf(h) === -1).forEach(h => {
        sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
      });
    }
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
    sh.setFrozenRows(1);

    const finalHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    (TEXT_COLS[name] || []).forEach(col => {
      const idx = finalHeaders.indexOf(col);
      if (idx > -1) sh.getRange(2, idx + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  });

  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);

  if (readTable_('Types').length === 0) {
    DEFAULT_TYPES.forEach(([name, icon]) => appendRow_('Types', { typeId: newId_('T'), name, icon }));
  }
  Logger.log('Taste Test workbook is ready.');
}

// ─── Router ──────────────────────────────────────────────────────────────────
// auth: false = public, true = any logged-in taster, 'admin' = admins only
const ROUTES = {
  ping:            { auth: false,   fn: () => ({ pong: true, time: Date.now() }) },
  listUsers:       { auth: false,   fn: listUsers },
  listTypes:       { auth: false,   fn: () => readTable_('Types') },
  register:        { auth: false,   fn: register },
  login:           { auth: false,   fn: login },
  me:              { auth: true,    fn: (p, user) => publicUser_(user) },
  logout:          { auth: true,    fn: logout },
  updateProfile:   { auth: true,    fn: updateProfile },
  changePin:       { auth: true,    fn: changePin },
  adminResetPin:   { auth: 'admin', fn: adminResetPin },
  adminSetAdmin:   { auth: 'admin', fn: adminSetAdmin },
  adminRemoveUser: { auth: 'admin', fn: adminRemoveUser },

  // Phase 2: product library (admins only, so nobody browses what's in the cupboard)
  saveType:        { auth: 'admin', fn: saveType },
  deleteType:      { auth: 'admin', fn: deleteType },
  listProducts:    { auth: 'admin', fn: listProducts },
  saveProduct:     { auth: 'admin', fn: saveProduct },
  deleteProduct:   { auth: 'admin', fn: deleteProduct },
  uploadPhoto:     { auth: 'admin', fn: uploadPhoto }
};

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const route = ROUTES[req.action];
    if (!route) throw err_('Unknown action: ' + req.action);

    let user = null;
    if (route.auth) {
      user = userFromToken_(req.token);
      if (!user) throw err_('Your login has expired. Please log in again.', 'AUTH');
      if (route.auth === 'admin' && !isTrue_(user.isAdmin)) throw err_('Only an admin can do that.', 'FORBIDDEN');
    }
    out = { ok: true, data: route.fn(req.payload || {}, user, req) };
  } catch (ex) {
    out = { ok: false, error: ex.message, code: ex.code || 'ERROR' };
  }
  return json_(out);
}

function doGet() {
  return json_({ ok: true, data: { app: 'Taste Test', phase: 2 } });
}

// ─── Tasters & login ─────────────────────────────────────────────────────────
function listUsers() {
  return readTable_('Users')
    .filter(u => isTrue_(u.active))
    .map(publicUser_)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function register(p) {
  const name = cleanName_(p.name);
  const pin = cleanPin_(p.pin);
  const emoji = cleanEmoji_(p.emoji);

  return withLock_(() => {
    const active = readTable_('Users').filter(u => isTrue_(u.active));
    assertNameFree_(active, name);

    const salt = Utilities.getUuid();
    const now = Date.now();
    const user = {
      userId: newId_('U'), displayName: name, emoji,
      pinHash: hashPin_(pin, salt), pinSalt: salt,
      isAdmin: active.length === 0,           // first taster becomes the admin
      active: true, created: now, lastLogin: now
    };
    appendRow_('Users', user);
    return { token: createSession_(user.userId), user: publicUser_(user) };
  });
}

function login(p) {
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + p.userId;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_PIN_FAILS) throw err_('Too many wrong PINs. Wait 10 minutes, or ask an admin to reset yours.');

  const user = findUser_(p.userId);
  if (!user || !isTrue_(user.active)) throw err_("That taster doesn't exist any more.");

  if (hashPin_(String(p.pin || ''), user.pinSalt) !== user.pinHash) {
    cache.put(failKey, String(fails + 1), 600);
    throw err_("That PIN isn't right. Try again.");
  }
  cache.remove(failKey);

  return withLock_(() => {
    updateRow_('Users', user._row, { lastLogin: Date.now() });
    return { token: createSession_(user.userId), user: publicUser_(user) };
  });
}

function logout(p, user, req) {
  CacheService.getScriptCache().remove('sess_' + req.token);
  withLock_(() => deleteWhere_('Sessions', s => s.token === req.token));
  return true;
}

function updateProfile(p, user) {
  return withLock_(() => {
    const patch = {};
    if (p.name != null) {
      const name = cleanName_(p.name);
      assertNameFree_(readTable_('Users').filter(u => isTrue_(u.active) && u.userId !== user.userId), name);
      patch.displayName = name;
    }
    if (p.emoji != null) patch.emoji = cleanEmoji_(p.emoji);
    updateRow_('Users', user._row, patch);
    return publicUser_(Object.assign({}, user, patch));
  });
}

function changePin(p, user) {
  if (hashPin_(String(p.currentPin || ''), user.pinSalt) !== user.pinHash) throw err_("Your current PIN isn't right.");
  setPin_(user, cleanPin_(p.newPin));
  return true;
}

function adminResetPin(p) {
  const target = findUser_(p.userId);
  if (!target) throw err_('Taster not found.');
  setPin_(target, cleanPin_(p.newPin));
  CacheService.getScriptCache().remove('fail_' + target.userId);
  return true;
}

function adminSetAdmin(p) {
  return withLock_(() => {
    const users = readTable_('Users').filter(u => isTrue_(u.active));
    const target = users.find(u => u.userId === p.userId);
    if (!target) throw err_('Taster not found.');
    if (!p.isAdmin && users.filter(u => isTrue_(u.isAdmin)).length <= 1 && isTrue_(target.isAdmin)) {
      throw err_('There has to be at least one admin.');
    }
    updateRow_('Users', target._row, { isAdmin: !!p.isAdmin });
    return true;
  });
}

// Soft delete: their past scores keep a name attached in the stats.
function adminRemoveUser(p, user) {
  if (p.userId === user.userId) throw err_("You can't remove yourself.");
  return withLock_(() => {
    const target = findUser_(p.userId);
    if (!target) throw err_('Taster not found.');
    updateRow_('Users', target._row, { active: false, isAdmin: false });
    deleteWhere_('Sessions', s => s.userId === target.userId);
    return true;
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────
function saveType(p) {
  const name = cleanText_(p.name, 'type name', 30, true);
  const icon = cleanEmoji_(p.icon);
  return withLock_(() => {
    const types = readTable_('Types');
    const clash = types.find(t => t.typeId !== p.typeId && String(t.name).toLowerCase() === name.toLowerCase());
    if (clash) throw err_('There is already a type called ' + name + '.');

    if (p.typeId) {
      const t = types.find(x => x.typeId === p.typeId);
      if (!t) throw err_('Type not found.');
      updateRow_('Types', t._row, { name, icon });
      return { typeId: t.typeId, name, icon };
    }
    const type = { typeId: newId_('T'), name, icon };
    appendRow_('Types', type);
    return type;
  });
}

function deleteType(p) {
  return withLock_(() => {
    const used = readTable_('Products').filter(x => x.typeId === p.typeId).length;
    if (used) throw err_('That type is used by ' + used + ' product' + (used === 1 ? '' : 's') + '. Move them to another type first.');
    deleteWhere_('Types', t => t.typeId === p.typeId);
    return true;
  });
}

// ─── Products ────────────────────────────────────────────────────────────────
function listProducts() {
  return readTable_('Products')
    .map(x => Object.assign({}, x, { vintage: String(x.vintage) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(b.vintage).localeCompare(String(a.vintage)));
}

function saveProduct(p, user) {
  const name = cleanText_(p.name, 'product name', 60, true);
  const manufacturer = cleanText_(p.manufacturer, 'manufacturer', 60, true);
  const vintage = cleanText_(p.vintage, 'vintage', 20, false);
  const description = cleanText_(p.description, 'description', 1500, false);
  const productLine = cleanText_(p.productLine, 'product line', 80, false) || (manufacturer + ' ' + name);
  const photoUrl = cleanUrl_(p.photoUrl);
  const typeId = String(p.typeId || '');

  return withLock_(() => {
    if (!readTable_('Types').some(t => t.typeId === typeId)) throw err_('Pick a type.');
    const products = readTable_('Products');
    const fields = { name, manufacturer, typeId, vintage, description, productLine, photoUrl };

    const dupe = products.find(x => x.productId !== p.productId &&
      String(x.name).toLowerCase() === name.toLowerCase() &&
      String(x.manufacturer).toLowerCase() === manufacturer.toLowerCase() &&
      String(x.vintage) === vintage);
    if (dupe) throw err_('You already have ' + manufacturer + ' ' + name + (vintage ? ' (' + vintage + ')' : '') + '.');

    if (p.productId) {
      const existing = products.find(x => x.productId === p.productId);
      if (!existing) throw err_('Product not found.');
      if (existing.photoUrl && existing.photoUrl !== photoUrl) trashDrivePhoto_(existing.photoUrl);
      updateRow_('Products', existing._row, fields);
      return Object.assign({}, existing, fields);
    }
    const product = Object.assign({ productId: newId_('P') }, fields, { created: Date.now(), createdBy: user.userId });
    appendRow_('Products', product);
    return product;
  });
}

function deleteProduct(p) {
  return withLock_(() => {
    if (readTable_('TestProducts').some(x => x.productId === p.productId)) {
      throw err_("This product has been used in a test, so it can't be deleted. Its scores depend on it.");
    }
    const product = readTable_('Products').find(x => x.productId === p.productId);
    if (!product) throw err_('Product not found.');
    if (product.photoUrl) trashDrivePhoto_(product.photoUrl);
    deleteWhere_('Products', x => x.productId === p.productId);
    return true;
  });
}

// ─── Photos (Google Drive) ───────────────────────────────────────────────────
// Run this once from the editor after adding Phase 2, to grant Drive access.
function setupPhotos() {
  Logger.log('Photo folder ready: ' + photoFolder_().getUrl());
}

function uploadPhoto(p) {
  const m = String(p.dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) throw err_("That file isn't a photo the app can use. Try a JPEG or PNG.");
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 6e6) throw err_('That photo is too large. Try a smaller one.');

  const safeName = String(p.name || 'product').replace(/[^\w\- ]+/g, '').slice(0, 60) || 'product';
  const file = photoFolder_().createFile(Utilities.newBlob(bytes, m[1], safeName + '.jpg'));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: driveThumb_(file.getId()) };
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* folder gone; make a new one */ }
  }
  const folder = DriveApp.createFolder('Taste Test Photos');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function driveThumb_(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1200';
}

// Only trashes files the app uploaded (links in our own thumbnail format).
function trashDrivePhoto_(url) {
  const m = String(url).match(/^https:\/\/drive\.google\.com\/thumbnail\?id=([\w-]+)/);
  if (!m) return;
  try { DriveApp.getFileById(m[1]).setTrashed(true); } catch (e) { /* already gone */ }
}

// ─── Auth helpers ────────────────────────────────────────────────────────────
function createSession_(userId) {
  const now = Date.now();
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  deleteWhere_('Sessions', s => Number(s.expires) < now);   // tidy expired ones
  appendRow_('Sessions', { token, userId, created: now, expires: now + SESSION_DAYS * 864e5 });
  CacheService.getScriptCache().put('sess_' + token, userId, 21600);
  return token;
}

function userFromToken_(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  let userId = cache.get('sess_' + token);
  if (!userId) {
    const s = readTable_('Sessions').find(r => r.token === token);
    if (!s || Number(s.expires) < Date.now()) return null;
    userId = s.userId;
    cache.put('sess_' + token, userId, 21600);
  }
  const user = findUser_(userId);
  return user && isTrue_(user.active) ? user : null;
}

function setPin_(user, pin) {
  const salt = Utilities.getUuid();
  withLock_(() => updateRow_('Users', user._row, { pinHash: hashPin_(pin, salt), pinSalt: salt }));
}

function hashPin_(pin, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function findUser_(userId) {
  return readTable_('Users').find(u => u.userId === userId) || null;
}

function publicUser_(u) {
  return { userId: u.userId, displayName: String(u.displayName), emoji: u.emoji, isAdmin: isTrue_(u.isAdmin) };
}

function assertNameFree_(users, name) {
  if (users.some(u => String(u.displayName).toLowerCase() === name.toLowerCase())) {
    throw err_('Someone is already called ' + name + '. Try adding an initial.');
  }
}

function cleanName_(v) {
  const name = String(v || '').replace(/\s+/g, ' ').trim();
  if (!name) throw err_('Add a name.');
  if (name.length > 20) throw err_('Keep the name to 20 characters or fewer.');
  return name;
}

function cleanPin_(v) {
  const pin = String(v || '');
  if (!/^\d{4}$/.test(pin)) throw err_('The PIN needs to be 4 digits.');
  return pin;
}

function cleanEmoji_(v) {
  const e = String(v || '').trim();
  return e && e.length <= 8 ? e : '🥔';
}

function cleanText_(v, label, max, required) {
  const s = String(v == null ? '' : v).trim();
  if (required && !s) throw err_('Add the ' + label + '.');
  if (s.length > max) throw err_('Keep the ' + label + ' to ' + max + ' characters or fewer.');
  return s;
}

function cleanUrl_(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!/^https:\/\/\S+$/.test(s) || s.length > 600) throw err_('The photo link needs to start with https://');
  return s;
}

// ─── Sheet helpers ───────────────────────────────────────────────────────────
function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw err_('The "' + name + '" tab is missing. Run setup() in the script editor.');
  return sh;
}

// Returns rows as objects. Each object carries a hidden _row (sheet row number).
function readTable_(name) {
  const values = sheet_(name).getDataRange().getValues();
  const headers = values.shift().map(String);
  const tz = Session.getScriptTimeZone();
  return values
    .map((r, i) => ({ r, row: i + 2 }))
    .filter(x => x.r.some(v => v !== ''))
    .map(({ r, row }) => {
      const o = {};
      headers.forEach((h, j) => {
        let v = r[j];
        if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        o[h] = v;
      });
      Object.defineProperty(o, '_row', { value: row, enumerable: false });
      return o;
    });
}

function headers_(name) {
  const sh = sheet_(name);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function appendRow_(name, obj) {
  sheet_(name).appendRow(headers_(name).map(h => (obj[h] === undefined || obj[h] === null ? '' : obj[h])));
}

function updateRow_(name, row, patch) {
  const sh = sheet_(name);
  const headers = headers_(name);
  const range = sh.getRange(row, 1, 1, headers.length);
  const values = range.getValues()[0];
  Object.keys(patch).forEach(k => {
    const idx = headers.indexOf(k);
    if (idx > -1) values[idx] = patch[k];
  });
  range.setValues([values]);
}

function deleteWhere_(name, predicate) {
  const sh = sheet_(name);
  readTable_(name).filter(predicate).map(r => r._row)
    .sort((a, b) => b - a)
    .forEach(row => sh.deleteRow(row));
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw err_('The spreadsheet is busy. Try again in a moment.');
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

// ─── Misc ────────────────────────────────────────────────────────────────────
function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function isTrue_(v) {
  return v === true || v === 'TRUE' || v === 'true';
}

function err_(message, code) {
  const e = new Error(message);
  e.code = code || 'ERROR';
  return e;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
