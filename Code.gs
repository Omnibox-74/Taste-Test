/**
 * Taste Test — Apps Script backend
 * Phase 1: workbook setup, API router, login and taster management.
 * Phase 2: types, product library, photo uploads to Drive.
 * Phase 3: creating tests, choosing products, the lobby, bowls and the bowl keeper.
 * Phase 4: live tasting rounds: bowl picking, scoring, notes, guesses, reveal.
 * Phase 5: results, awards and stats, past tests, product reviews.
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
  Tests:            ['testId', 'name', 'testDate', 'organiserId', 'status', 'halfPoints', 'currentSample', 'phase', 'phaseOpenedAt', 'version', 'created', 'source', 'startedAt', 'finishedAt', 'keeperId', 'bowlsReady'],
  TestProducts:     ['testId', 'sampleNo', 'productId', 'order', 'bowl', 'chosenAt', 'revealedAt', 'closedAt'],
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
  uploadPhoto:     { auth: 'admin', fn: uploadPhoto },

  // Phase 3: tests and the lobby
  listOpenTests:      { auth: true,    fn: listOpenTests },
  getTest:            { auth: true,    fn: getTest },
  joinTest:           { auth: true,    fn: joinTest },
  leaveTest:          { auth: true,    fn: leaveTest },
  createTest:         { auth: 'admin', fn: createTest },
  updateTestProducts: { auth: 'admin', fn: updateTestProducts },
  removeParticipant:  { auth: 'admin', fn: removeParticipant },
  setKeeper:          { auth: 'admin', fn: setKeeper },
  prepareBowls:       { auth: 'admin', fn: prepareBowls },
  startTest:          { auth: 'admin', fn: startTest },
  cancelTest:         { auth: 'admin', fn: cancelTest },

  // Phase 4: tasting rounds
  pickBowl:           { auth: true,    fn: pickBowl },
  submitScore:        { auth: true,    fn: submitScore },
  noteVocab:          { auth: true,    fn: noteVocab },
  revealSample:       { auth: 'admin', fn: revealSample },
  nextSample:         { auth: 'admin', fn: nextSample },
  markGuess:          { auth: 'admin', fn: markGuess },

  // Phase 5: results and history
  listPastTests:      { auth: true,    fn: listPastTests },
  getResults:         { auth: true,    fn: getResults },
  listReviews:        { auth: true,    fn: listReviews },
  getProductReview:   { auth: true,    fn: getProductReview }
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
  return json_({ ok: true, data: { app: 'Taste Test', phase: 5 } });
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
    // Products from cancelled tests can go (handy for practice runs); anything else has scores.
    const cancelled = readTable_('Tests').filter(t => t.status === 'cancelled').map(t => t.testId);
    const uses = readTable_('TestProducts').filter(x => x.productId === p.productId);
    if (uses.some(x => cancelled.indexOf(x.testId) === -1)) {
      throw err_("This product has been used in a test, so it can't be deleted. Its scores depend on it.");
    }
    deleteWhere_('TestProducts', x => x.productId === p.productId);
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

// ─── Tests: setup and lobby ──────────────────────────────────────────────────
// Status runs: lobby → live → finished (or cancelled at any point).
const ACTIVE = ['lobby', 'live'];

function createTest(p, user) {
  const name = cleanText_(p.name, 'test name', 60, true);
  const testDate = /^\d{4}-\d{2}-\d{2}$/.test(p.testDate) ? p.testDate : today_();

  return withLock_(() => {
    const productIds = checkProductIds_(p.productIds);
    if (readTable_('Tests').some(t => t.organiserId === user.userId && ACTIVE.indexOf(t.status) > -1)) {
      throw err_("You're already running a test. Finish or cancel it first.");
    }
    if (p.tasting && activeTestsFor_(user.userId).length) {
      throw err_("You're already tasting in another test. Leave it first, or untick \"I'm tasting too\".");
    }
    const now = Date.now();
    const test = {
      testId: newId_('X'), name, testDate, organiserId: user.userId, status: 'lobby',
      halfPoints: !!p.halfPoints, currentSample: '', phase: '', phaseOpenedAt: '',
      version: now, created: now, source: 'live', startedAt: '', finishedAt: '',
      keeperId: '', bowlsReady: false
    };
    appendRow_('Tests', test);
    appendRows_('TestProducts', productIds.map(id => ({ testId: test.testId, sampleNo: '', productId: id, order: '' })));
    if (p.tasting) appendRow_('TestParticipants', { testId: test.testId, userId: user.userId, joinedAt: now, status: 'in' });
    setVersionCache_(test.testId, now);
    return { testId: test.testId };
  });
}

function updateTestProducts(p, user) {
  return withLock_(() => {
    const t = organisersTest_(p.testId, user, 'lobby');
    const productIds = checkProductIds_(p.productIds);
    deleteWhere_('TestProducts', x => x.testId === t.testId);
    appendRows_('TestProducts', productIds.map(id => ({ testId: t.testId, sampleNo: '', productId: id, order: '', bowl: '' })));
    updateRow_('Tests', t._row, { bowlsReady: false });   // bowls need re-labelling
    bumpTest_(t);
    return true;
  });
}

function listOpenTests(p, user) {
  const tests = readTable_('Tests').filter(t => ACTIVE.indexOf(t.status) > -1);
  if (!tests.length) return { tests: [], myTestId: null };

  const users = userMap_();
  const parts = readTable_('TestParticipants').filter(x => x.status === 'in');
  const samples = readTable_('TestProducts');
  const ids = tests.map(t => t.testId);
  const mine = parts.find(x => x.userId === user.userId && ids.indexOf(x.testId) > -1);
  const organising = tests.find(t => t.organiserId === user.userId || t.keeperId === user.userId);

  return {
    myTestId: mine ? mine.testId : (organising ? organising.testId : null),
    tests: tests
      .sort((a, b) => Number(b.created) - Number(a.created))
      .map(t => ({
        testId: t.testId, name: String(t.name), testDate: t.testDate, status: t.status,
        organiser: users[t.organiserId],
        isOrganiser: t.organiserId === user.userId,
        isKeeper: t.keeperId === user.userId,
        tasterCount: parts.filter(x => x.testId === t.testId).length,
        sampleCount: samples.filter(x => x.testId === t.testId).length
      }))
  };
}

// The lobby polls this every few seconds. If nothing has changed since the
// version the browser already has, it answers from cache without reading the sheet.
function getTest(p, user) {
  const cache = CacheService.getScriptCache();
  const since = p.since ? String(p.since) : '';
  const cached = cache.get('tv_' + p.testId);
  if (since && cached === since) return { unchanged: true, version: Number(cached) };

  const t = findTest_(p.testId);
  if (!t) throw err_("That test doesn't exist any more.");
  const version = Number(t.version);
  setVersionCache_(t.testId, version);
  if (since && Number(since) === version) return { unchanged: true, version };

  const users = userMap_();
  const parts = readTable_('TestParticipants')
    .filter(x => x.testId === t.testId && x.status === 'in')
    .sort((a, b) => Number(a.joinedAt) - Number(b.joinedAt));
  const samples = readTable_('TestProducts').filter(x => x.testId === t.testId);
  const isOrganiser = t.organiserId === user.userId;

  const out = {
    version, testId: t.testId, name: String(t.name), testDate: t.testDate, status: t.status,
    halfPoints: isTrue_(t.halfPoints), organiser: users[t.organiserId], isOrganiser,
    amIn: parts.some(x => x.userId === user.userId),
    participants: parts.map(x => users[x.userId]).filter(Boolean),
    sampleCount: samples.length,
    currentSample: t.currentSample, phase: t.phase,
    keeper: t.keeperId ? users[t.keeperId] || null : null,
    isKeeper: t.keeperId === user.userId,
    bowlsReady: isTrue_(t.bowlsReady)
  };

  if (t.status === 'live' || t.status === 'finished') {
    Object.assign(out, liveState_(t, user, samples, parts, users));
  }

  // Only the organiser sees product names and bowl letters, and only before
  // the test starts. After that the app is the only thing that knows.
  if (isOrganiser && t.status === 'lobby') {
    const products = productMap_();
    out.products = samples
      .map(x => ({ x, pr: products[x.productId] }))
      .filter(o => o.pr)
      .map(({ x, pr }) => ({
        productId: pr.productId, name: String(pr.name), manufacturer: String(pr.manufacturer),
        vintage: String(pr.vintage), photoUrl: pr.photoUrl, typeId: pr.typeId,
        bowl: out.bowlsReady ? String(x.bowl) : ''
      }))
      .sort((a, b) => (a.bowl.length - b.bowl.length) || a.bowl.localeCompare(b.bowl));
  }
  return out;
}

function joinTest(p, user) {
  return withLock_(() => {
    const t = findTest_(p.testId);
    if (!t || t.status !== 'lobby') {
      throw err_(t && t.status === 'live' ? 'That test has already started.' : "That test isn't open any more.");
    }
    const current = activeTestsFor_(user.userId);
    if (current.some(x => x.testId === t.testId)) return true;
    if (current.length) throw err_("You're already in " + current[0].name + '. Leave it first.');

    const prev = readTable_('TestParticipants').find(x => x.testId === t.testId && x.userId === user.userId);
    if (prev) updateRow_('TestParticipants', prev._row, { status: 'in', joinedAt: Date.now() });
    else appendRow_('TestParticipants', { testId: t.testId, userId: user.userId, joinedAt: Date.now(), status: 'in' });
    bumpTest_(t);
    return true;
  });
}

function leaveTest(p, user) {
  return withLock_(() => {
    const t = findTest_(p.testId);
    if (!t) throw err_('Test not found.');
    if (t.status !== 'lobby') throw err_('The tasting has started. Ask the organiser if you need to drop out.');
    const row = readTable_('TestParticipants').find(x => x.testId === t.testId && x.userId === user.userId && x.status === 'in');
    if (row) updateRow_('TestParticipants', row._row, { status: 'left' });
    bumpTest_(t);
    return true;
  });
}

function removeParticipant(p, user) {
  return withLock_(() => {
    const t = organisersTest_(p.testId, user, 'lobby');
    const row = readTable_('TestParticipants').find(x => x.testId === t.testId && x.userId === p.userId && x.status === 'in');
    if (row) updateRow_('TestParticipants', row._row, { status: 'removed' });
    bumpTest_(t);
    return true;
  });
}

function startTest(p, user) {
  return withLock_(() => {
    const t = organisersTest_(p.testId, user, 'lobby');
    const samples = readTable_('TestProducts').filter(x => x.testId === t.testId);
    const tasters = readTable_('TestParticipants').filter(x => x.testId === t.testId && x.status === 'in');
    if (!samples.length) throw err_('Add at least one product first.');
    if (!tasters.length) throw err_('Nobody has joined yet.');
    if (!isTrue_(t.bowlsReady)) throw err_('Prepare the bowls first.');
    if (!t.keeperId) throw err_('Choose a bowl keeper first.');

    // Sample numbers are given out round by round, as the keeper picks each bowl.
    const now = Date.now();
    updateRow_('Tests', t._row, {
      status: 'live', currentSample: 1, phase: 'choose', phaseOpenedAt: now, startedAt: now, version: now
    });
    setVersionCache_(t.testId, now);
    return true;
  });
}

function setKeeper(p, user) {
  return withLock_(() => {
    const t = organisersTest_(p.testId, user, 'lobby');
    const keeper = findUser_(p.userId);
    if (!keeper || !isTrue_(keeper.active)) throw err_('Taster not found.');
    updateRow_('Tests', t._row, { keeperId: keeper.userId });
    bumpTest_(t);
    return true;
  });
}

// Gives each product a bowl letter in random order. Re-running reshuffles.
function prepareBowls(p, user) {
  return withLock_(() => {
    const t = organisersTest_(p.testId, user, 'lobby');
    const samples = readTable_('TestProducts').filter(x => x.testId === t.testId);
    if (!samples.length) throw err_('Add some products first.');

    const letters = samples.map((_, i) => bowlLetter_(i));
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = letters[i]; letters[i] = letters[j]; letters[j] = tmp;
    }
    samples.forEach((row, i) => updateRow_('TestProducts', row._row, { bowl: letters[i] }));
    updateRow_('Tests', t._row, { bowlsReady: true });
    bumpTest_(t);
    return true;
  });
}

// A, B … Z, then AA, AB …
function bowlLetter_(i) {
  let s = '';
  i += 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function cancelTest(p, user) {
  return withLock_(() => {
    const t = findTest_(p.testId);
    if (!t) throw err_('Test not found.');
    if (t.organiserId !== user.userId) throw err_('Only the organiser can cancel this test.');
    if (ACTIVE.indexOf(t.status) === -1) return true;
    const now = Date.now();
    updateRow_('Tests', t._row, { status: 'cancelled', finishedAt: now, version: now });
    setVersionCache_(t.testId, now);
    return true;
  });
}

// ─── Tasting rounds ──────────────────────────────────────────────────────────
// Each round: choose (keeper picks a bowl) → niceness (blind) →
// authenticity (after the reveal) → next round, or finished.

function pickBowl(p, user) {
  return withLock_(() => {
    const t = liveTest_(p.testId, 'choose');
    if (t.keeperId !== user.userId) throw err_('Only the bowl keeper can pick the bowl.');
    const row = readTable_('TestProducts').find(x => x.testId === t.testId && String(x.bowl) === String(p.bowl));
    if (!row) throw err_("There's no bowl " + p.bowl + '.');
    if (row.sampleNo !== '') throw err_('Bowl ' + p.bowl + ' has already been tasted.');

    const now = Date.now();
    updateRow_('TestProducts', row._row, { sampleNo: Number(t.currentSample), chosenAt: now });
    updateRow_('Tests', t._row, { phase: 'niceness', phaseOpenedAt: now });
    bumpTest_(t);
    return true;
  });
}

function submitScore(p, user) {
  return withLock_(() => {
    const t = findTest_(p.testId);
    if (!t || t.status !== 'live') throw err_('This test has finished.');
    if (Number(p.sampleNo) !== Number(t.currentSample)) throw err_('Too late, the organiser has moved on to the next sample.');
    const phase = t.phase;
    if (phase !== 'niceness' && phase !== 'authenticity') throw err_("Scoring isn't open right now.");
    const tasting = readTable_('TestParticipants').some(x => x.testId === t.testId && x.userId === user.userId && x.status === 'in');
    if (!tasting) throw err_("You're not tasting in this test.");

    const half = isTrue_(t.halfPoints);
    const score = cleanScore_(phase === 'niceness' ? p.niceness : p.authenticity, half);
    const now = Date.now();

    const existing = readTable_('Scores').find(x => x.testId === t.testId && Number(x.sampleNo) === Number(t.currentSample) && x.userId === user.userId);
    const patch = {};
    if (p.comment !== undefined) patch.comment = cleanText_(p.comment, 'comment', 500, false);   // leave it alone if not sent
    if (phase === 'niceness') {
      patch.niceness = score;
      if (p.guess !== undefined) patch.flavourGuess = cleanText_(p.guess, 'guess', 80, false);
      if (!existing || !existing.nicenessAt) patch.nicenessAt = now;   // speed counts the first answer
    } else {
      patch.authenticity = score;
      if (!existing || !existing.authenticityAt) patch.authenticityAt = now;
    }
    if (existing) {
      updateRow_('Scores', existing._row, patch);
    } else {
      appendRow_('Scores', Object.assign({
        testId: t.testId, sampleNo: Number(t.currentSample), userId: user.userId,
        niceness: '', authenticity: '', flavourGuess: '', guessCorrect: '', comment: '',
        phaseOpenedAt: t.phaseOpenedAt, nicenessAt: '', authenticityAt: ''
      }, patch));
    }

    // Notes are replaced as a set for this phase
    const notePhase = phase === 'niceness' ? 'blind' : 'revealed';
    const notes = cleanNotes_(p.notes);
    deleteWhere_('Notes', x => x.testId === t.testId && Number(x.sampleNo) === Number(t.currentSample) && x.userId === user.userId && x.phase === notePhase);
    appendRows_('Notes', notes.map(n => ({ testId: t.testId, sampleNo: Number(t.currentSample), userId: user.userId, note: n, phase: notePhase, created: now })));

    bumpTest_(t);
    return true;
  });
}

function revealSample(p, user) {
  return withLock_(() => {
    const t = liveTest_(p.testId, 'niceness');
    if (t.organiserId !== user.userId) throw err_('Only the organiser can reveal.');
    const now = Date.now();
    const row = currentRow_(t);
    if (row) updateRow_('TestProducts', row._row, { revealedAt: now });
    updateRow_('Tests', t._row, { phase: 'authenticity', phaseOpenedAt: now });
    bumpTest_(t);
    return true;
  });
}

function nextSample(p, user) {
  return withLock_(() => {
    const t = liveTest_(p.testId, 'authenticity');
    if (t.organiserId !== user.userId) throw err_('Only the organiser can move on.');
    const now = Date.now();
    const rows = readTable_('TestProducts').filter(x => x.testId === t.testId);
    const row = rows.find(x => Number(x.sampleNo) === Number(t.currentSample));
    if (row) updateRow_('TestProducts', row._row, { closedAt: now });

    const left = rows.filter(x => x.sampleNo === '').length;
    if (left) {
      updateRow_('Tests', t._row, { currentSample: Number(t.currentSample) + 1, phase: 'choose', phaseOpenedAt: now });
    } else {
      updateRow_('Tests', t._row, { status: 'finished', phase: 'done', phaseOpenedAt: now, finishedAt: now });
    }
    bumpTest_(t);
    return { finished: !left };
  });
}

function markGuess(p, user) {
  return withLock_(() => {
    const t = findTest_(p.testId);
    if (!t || t.organiserId !== user.userId) throw err_('Only the organiser can mark guesses.');
    const row = readTable_('Scores').find(x => x.testId === t.testId && Number(x.sampleNo) === Number(p.sampleNo) && x.userId === p.userId);
    if (!row) throw err_('No guess found.');
    updateRow_('Scores', row._row, { guessCorrect: p.correct === true ? true : p.correct === false ? false : '' });
    bumpTest_(t);
    return true;
  });
}

// Every note anyone has used, most popular first, for autocomplete
function noteVocab() {
  const counts = {};
  readTable_('Notes').forEach(n => {
    const k = String(n.note).toLowerCase();
    if (k) counts[k] = (counts[k] || 0) + 1;
  });
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 400);
}

// The live part of getTest: who's scored, my own answers, the reveal and results
function liveState_(t, user, samples, parts, users) {
  const cur = Number(t.currentSample);
  const scores = readTable_('Scores').filter(x => x.testId === t.testId);
  const products = productMap_();
  const types = {};
  readTable_('Types').forEach(x => { types[x.typeId] = x; });
  const productInfo = pr => pr ? {
    name: String(pr.name), manufacturer: String(pr.manufacturer), vintage: String(pr.vintage),
    description: String(pr.description || ''), photoUrl: pr.photoUrl,
    typeIcon: types[pr.typeId] ? types[pr.typeId].icon : ''
  } : null;
  const out = { sampleTotal: samples.length, current: cur };

  if (t.status === 'live') {
    const curScores = scores.filter(x => Number(x.sampleNo) === cur);
    out.progress = parts.map(x => {
      const sc = curScores.find(y => y.userId === x.userId);
      return { userId: x.userId, nice: !!(sc && sc.niceness !== ''), auth: !!(sc && sc.authenticity !== '') };
    });

    const mine = curScores.find(x => x.userId === user.userId);
    const myNotes = readTable_('Notes').filter(n => n.testId === t.testId && Number(n.sampleNo) === cur && n.userId === user.userId);
    out.mine = {
      niceness: mine && mine.niceness !== '' ? Number(mine.niceness) : null,
      authenticity: mine && mine.authenticity !== '' ? Number(mine.authenticity) : null,
      guess: mine ? String(mine.flavourGuess || '') : '',
      comment: mine ? String(mine.comment || '') : '',
      notesBlind: myNotes.filter(n => n.phase === 'blind').map(n => String(n.note)),
      notesRevealed: myNotes.filter(n => n.phase === 'revealed').map(n => String(n.note))
    };

    if (t.phase === 'choose' && t.keeperId === user.userId) {
      out.bowlsLeft = samples.filter(x => x.sampleNo === '').map(x => String(x.bowl))
        .sort((a, b) => (a.length - b.length) || a.localeCompare(b));
    }
    out.bowlsRemaining = samples.filter(x => x.sampleNo === '').length;

    if (t.phase === 'authenticity') {
      const row = samples.find(x => Number(x.sampleNo) === cur);
      out.reveal = row ? productInfo(products[row.productId]) : null;
      if (t.organiserId === user.userId) {
        out.guesses = curScores.filter(x => x.flavourGuess).map(x => ({
          userId: x.userId, guess: String(x.flavourGuess),
          correct: x.guessCorrect === '' ? null : isTrue_(x.guessCorrect)
        }));
      }
    }
  }

  // Samples already revealed, for the "so far" strip and the final results
  const done = samples
    .filter(x => x.sampleNo !== '' && (Number(x.sampleNo) < cur || t.status === 'finished' || (Number(x.sampleNo) === cur && t.phase === 'authenticity')))
    .sort((a, b) => Number(a.sampleNo) - Number(b.sampleNo));
  out.revealed = done.map(x => {
    const sc = scores.filter(y => Number(y.sampleNo) === Number(x.sampleNo));
    const avg = f => {
      const v = sc.map(y => y[f]).filter(v => v !== '').map(Number);
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100 : null;
    };
    return Object.assign({ sampleNo: Number(x.sampleNo), bowl: String(x.bowl), niceness: avg('niceness'), authenticity: avg('authenticity') },
      productInfo(products[x.productId]));
  });
  return out;
}

function liveTest_(testId, phase) {
  const t = findTest_(testId);
  if (!t || t.status !== 'live') throw err_("This test isn't running.");
  if (phase && t.phase !== phase) throw err_('Things have moved on. Refreshing…');
  return t;
}

function currentRow_(t) {
  return readTable_('TestProducts').find(x => x.testId === t.testId && Number(x.sampleNo) === Number(t.currentSample)) || null;
}

function cleanScore_(v, half) {
  const n = Number(v);
  const step = half ? 0.5 : 1;
  if (!isFinite(n) || n < step || n > 5 || Math.round(n / step) !== n / step) {
    throw err_('Pick a score from ' + (half ? '½' : '1') + ' to 5 stars.');
  }
  return n;
}

function cleanNotes_(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  arr.forEach(n => {
    const s = String(n || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
    if (s && out.indexOf(s) === -1) out.push(s);
  });
  return out.slice(0, 8);
}

// ─── Results and history ─────────────────────────────────────────────────────
function listPastTests() {
  const tests = readTable_('Tests').filter(t => t.status === 'finished');
  if (!tests.length) return [];
  const users = userMap_();
  const products = productMap_();
  const samples = readTable_('TestProducts');
  const scores = readTable_('Scores');

  return tests.map(t => {
    const mine = samples.filter(x => x.testId === t.testId && x.sampleNo !== '');
    const sc = scores.filter(x => x.testId === t.testId);
    // Winner = best average niceness + authenticity
    let best = null;
    mine.forEach(x => {
      const rows = sc.filter(y => Number(y.sampleNo) === Number(x.sampleNo));
      const avg = f => {
        const v = rows.map(y => y[f]).filter(v => v !== '').map(Number);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
      };
      const total = avg('niceness') + avg('authenticity');
      if (!best || total > best.total) best = { total, product: products[x.productId] };
    });
    const tasters = {};
    sc.forEach(x => { tasters[x.userId] = true; });
    return {
      testId: t.testId, name: String(t.name), testDate: t.testDate, source: t.source || 'live',
      organiser: users[t.organiserId] || null,
      sampleCount: mine.length, tasterCount: Object.keys(tasters).length,
      winner: best && best.product ? {
        name: String(best.product.name), manufacturer: String(best.product.manufacturer), photoUrl: best.product.photoUrl
      } : null
    };
  }).sort((a, b) => String(b.testDate).localeCompare(String(a.testDate)));
}

// Raw material for the results page. The browser works out the stats,
// so the same code can later combine several tests.
function getResults(p) {
  const t = findTest_(p.testId);
  if (!t) throw err_("That test doesn't exist.");
  if (t.status !== 'finished') throw err_("That test hasn't finished yet.");

  const users = userMap_();
  const products = productMap_();
  const types = {};
  readTable_('Types').forEach(x => { types[x.typeId] = x; });
  const num = v => (v === '' || v === null || v === undefined ? null : Number(v));

  const samples = readTable_('TestProducts')
    .filter(x => x.testId === t.testId && x.sampleNo !== '')
    .sort((a, b) => Number(a.sampleNo) - Number(b.sampleNo))
    .map(x => {
      const pr = products[x.productId] || {};
      return {
        sampleNo: Number(x.sampleNo), bowl: String(x.bowl || ''), productId: x.productId,
        productLine: String(pr.productLine || ''), name: String(pr.name || 'Deleted product'),
        manufacturer: String(pr.manufacturer || ''), vintage: String(pr.vintage || ''),
        description: String(pr.description || ''), photoUrl: pr.photoUrl || '',
        typeIcon: types[pr.typeId] ? types[pr.typeId].icon : '',
        chosenAt: num(x.chosenAt), revealedAt: num(x.revealedAt)
      };
    });

  const scores = readTable_('Scores').filter(x => x.testId === t.testId).map(x => ({
    sampleNo: Number(x.sampleNo), userId: x.userId,
    niceness: num(x.niceness), authenticity: num(x.authenticity),
    guess: String(x.flavourGuess || ''), guessCorrect: x.guessCorrect === '' ? null : isTrue_(x.guessCorrect),
    comment: String(x.comment || ''), nicenessAt: num(x.nicenessAt), authenticityAt: num(x.authenticityAt)
  }));

  const notes = readTable_('Notes').filter(x => x.testId === t.testId).map(x => ({
    sampleNo: Number(x.sampleNo), userId: x.userId, note: String(x.note), phase: x.phase
  }));

  const ids = {};
  readTable_('TestParticipants').filter(x => x.testId === t.testId && x.status === 'in').forEach(x => { ids[x.userId] = true; });
  scores.forEach(x => { ids[x.userId] = true; });

  return {
    test: {
      testId: t.testId, name: String(t.name), testDate: t.testDate, source: t.source || 'live',
      halfPoints: isTrue_(t.halfPoints), organiser: users[t.organiserId] || null,
      keeper: t.keeperId ? users[t.keeperId] || null : null
    },
    samples, scores, notes,
    tasters: Object.keys(ids).map(id => users[id]).filter(Boolean)
  };
}

// ─── Reviews: every product that's been through a finished test ─────────────
function reviewData_() {
  const finished = {};
  readTable_('Tests').filter(t => t.status === 'finished').forEach(t => { finished[t.testId] = t; });
  const samples = readTable_('TestProducts').filter(x => finished[x.testId] && x.sampleNo !== '');
  const scores = readTable_('Scores').filter(x => finished[x.testId]);
  return { finished, samples, scores };
}

function listReviews(p, user) {
  const { finished, samples, scores } = reviewData_();
  const products = productMap_();
  const avg = list => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length * 100) / 100 : null);
  const vals = (rows, f) => rows.map(r => r[f]).filter(v => v !== '').map(Number);
  const byProduct = {};

  samples.forEach(x => {
    const pr = products[x.productId];
    if (!pr) return;
    const t = finished[x.testId];
    const rows = scores.filter(y => y.testId === x.testId && Number(y.sampleNo) === Number(x.sampleNo));
    const entry = byProduct[x.productId] = byProduct[x.productId] || {
      productId: pr.productId, name: String(pr.name), manufacturer: String(pr.manufacturer),
      vintage: String(pr.vintage), typeId: pr.typeId, productLine: String(pr.productLine || ''),
      photoUrl: pr.photoUrl, description: String(pr.description || ''),
      appearances: [], _n: [], _a: [], _myN: [], _myA: []
    };
    entry.appearances.push({
      testId: t.testId, testName: String(t.name), testDate: t.testDate, source: t.source || 'live',
      nice: avg(vals(rows, 'niceness')), auth: avg(vals(rows, 'authenticity')), tasters: rows.length
    });
    entry._n = entry._n.concat(vals(rows, 'niceness'));
    entry._a = entry._a.concat(vals(rows, 'authenticity'));
    const mine = rows.filter(r => r.userId === user.userId);
    entry._myN = entry._myN.concat(vals(mine, 'niceness'));
    entry._myA = entry._myA.concat(vals(mine, 'authenticity'));
  });

  const list = Object.keys(byProduct).map(id => {
    const e = byProduct[id];
    e.appearances.sort((a, b) => String(b.testDate).localeCompare(String(a.testDate)));
    const out = Object.assign({}, e, {
      nice: avg(e._n), auth: avg(e._a), ratings: e._n.length,
      mine: e._myN.length || e._myA.length ? { nice: avg(e._myN), auth: avg(e._myA) } : null,
      lastTasted: e.appearances[0] ? e.appearances[0].testDate : ''
    });
    delete out._n; delete out._a; delete out._myN; delete out._myA;
    return out;
  });
  return { products: list, types: readTable_('Types') };
}

// Everyone's scores and comments for one product, across every test it was in
function getProductReview(p) {
  const { finished, samples, scores } = reviewData_();
  const users = userMap_();
  const mine = samples.filter(x => x.productId === p.productId);
  if (!mine.length) throw err_("That product hasn't been tasted in a finished test yet.");
  const notes = readTable_('Notes');
  const num = v => (v === '' ? null : Number(v));
  const out = { scores: [], notes: {} };

  mine.forEach(x => {
    const t = finished[x.testId];
    scores.filter(y => y.testId === x.testId && Number(y.sampleNo) === Number(x.sampleNo)).forEach(y => {
      out.scores.push({
        testId: t.testId, testName: String(t.name), testDate: t.testDate,
        user: users[y.userId] || { emoji: '👤', displayName: 'Someone' },
        niceness: num(y.niceness), authenticity: num(y.authenticity),
        guess: String(y.flavourGuess || ''), guessCorrect: y.guessCorrect === '' ? null : isTrue_(y.guessCorrect),
        comment: String(y.comment || '')
      });
    });
    notes.filter(n => n.testId === x.testId && Number(n.sampleNo) === Number(x.sampleNo)).forEach(n => {
      const k = String(n.note);
      out.notes[k] = (out.notes[k] || 0) + 1;
    });
  });
  out.scores.sort((a, b) => String(b.testDate).localeCompare(String(a.testDate)));
  return out;
}

// ─── Test helpers ────────────────────────────────────────────────────────────
function findTest_(testId) {
  return readTable_('Tests').find(t => t.testId === testId) || null;
}

function organisersTest_(testId, user, status) {
  const t = findTest_(testId);
  if (!t) throw err_('Test not found.');
  if (t.organiserId !== user.userId) throw err_('Only the organiser can do that.');
  if (status && t.status !== status) {
    throw err_(t.status === 'live' ? 'The test has already started.' : "That test isn't open any more.");
  }
  return t;
}

function activeTestsFor_(userId) {
  const active = readTable_('Tests').filter(t => ACTIVE.indexOf(t.status) > -1);
  const ids = readTable_('TestParticipants')
    .filter(x => x.userId === userId && x.status === 'in')
    .map(x => x.testId);
  return active.filter(t => ids.indexOf(t.testId) > -1);
}

function checkProductIds_(list) {
  const ids = Array.isArray(list) ? list.map(String) : [];
  const unique = ids.filter((id, i) => ids.indexOf(id) === i);
  if (unique.length > 40) throw err_('A test can have up to 40 products.');
  const known = productMap_();
  unique.forEach(id => { if (!known[id]) throw err_('One of those products has been deleted. Refresh and try again.'); });
  return unique;
}

function bumpTest_(t) {
  const v = Math.max(Date.now(), Number(t.version) + 1);
  updateRow_('Tests', t._row, { version: v });
  setVersionCache_(t.testId, v);
  return v;
}

function setVersionCache_(testId, v) {
  CacheService.getScriptCache().put('tv_' + testId, String(v), 21600);
}

function userMap_() {
  const map = {};
  readTable_('Users').forEach(u => { map[u.userId] = publicUser_(u); });
  return map;
}

function productMap_() {
  const map = {};
  readTable_('Products').forEach(x => { map[x.productId] = x; });
  return map;
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
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

function appendRows_(name, objs) {
  if (!objs.length) return;
  const sh = sheet_(name);
  const headers = headers_(name);
  const rows = objs.map(o => headers.map(h => (o[h] === undefined || o[h] === null ? '' : o[h])));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
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
