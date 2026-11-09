(() => {
  const EMOJIS = ['🥔', '🍫', '🍷', '🧀', '🍪', '🌶️', '🍋', '🧅', '🥓', '🍄', '🦊', '🐸',
                  '🐙', '🦉', '🐝', '🦄', '🐢', '🐼', '🦖', '🚀', '🎩', '👑', '⭐', '🌈'];

  const state = { user: null, users: [], picked: null, pin: '', emoji: EMOJIS[0], busy: false };

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const timers = { lobby: null, home: null };

  function show(id) {
    clearTimeout(timers.lobby);
    clearTimeout(timers.home);
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
    window.scrollTo(0, 0);
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('toast--on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('toast--on'), 2600);
  }

  // ─── Boot ────────────────────────────────────────────────────────────────
  async function boot() {
    const url = window.TT_CONFIG && window.TT_CONFIG.API_URL;
    if (!url || url.startsWith('PASTE')) return show('screen-config');

    if (Api.getToken()) {
      try {
        state.user = await Api.call('me');
        return goHome(true);
      } catch (e) {
        Api.setToken(null);
      }
    }
    goLogin();
  }

  window.addEventListener('tt:logout', () => { state.user = null; goLogin(); });

  // ─── Login ───────────────────────────────────────────────────────────────
  async function goLogin() {
    show('screen-login');
    $('#who').hidden = false;
    $('#pin-step').hidden = true;

    const grid = $('#taster-grid');
    grid.innerHTML = '<p class="loading">Fetching tasters…</p>';
    try {
      state.users = await Api.call('listUsers');
    } catch (e) {
      grid.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      return;
    }
    if (!state.users.length) {
      grid.innerHTML = '<p class="empty">No tasters yet. The first person to join becomes the admin.</p>';
      return;
    }
    grid.innerHTML = state.users.map(u => `
      <button type="button" class="taster" data-id="${esc(u.userId)}">
        <span class="taster__emoji" aria-hidden="true">${esc(u.emoji)}</span>
        <span>${esc(u.displayName)}</span>
      </button>`).join('');
  }

  $('#taster-grid').addEventListener('click', e => {
    const b = e.target.closest('.taster');
    if (b) pickUser(b.dataset.id);
  });

  function pickUser(id) {
    state.picked = state.users.find(u => u.userId === id);
    state.pin = '';
    $('#who').hidden = true;
    $('#pin-step').hidden = false;
    $('#pin-title').textContent = `${state.picked.emoji} ${state.picked.displayName}, enter your PIN`;
    $('#login-error').textContent = '';
    renderDots();
  }

  $('#pin-back').addEventListener('click', () => { $('#who').hidden = false; $('#pin-step').hidden = true; });
  $('#go-register').addEventListener('click', goRegister);

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'go'];
  $('#keypad').innerHTML = KEYS.map(k => {
    const label = k === 'back' ? 'Delete' : k === 'go' ? 'Log in' : k;
    const face = k === 'back' ? '⌫' : k === 'go' ? '✓' : k;
    return `<button type="button" class="key key--${k}" data-k="${k}" aria-label="${label}">${face}</button>`;
  }).join('');

  $('#keypad').addEventListener('click', e => {
    const b = e.target.closest('.key');
    if (b) pressKey(b.dataset.k);
  });

  document.addEventListener('keydown', e => {
    if ($('#screen-login').hidden || $('#pin-step').hidden) return;
    if (/^\d$/.test(e.key)) pressKey(e.key);
    else if (e.key === 'Backspace') pressKey('back');
    else if (e.key === 'Enter') pressKey('go');
  });

  function pressKey(k) {
    if (state.busy) return;
    if (k === 'back') state.pin = state.pin.slice(0, -1);
    else if (k === 'go') return tryLogin();
    else if (state.pin.length < 4) state.pin += k;
    renderDots();
    if (state.pin.length === 4) tryLogin();
  }

  function renderDots() {
    $('#pin-dots').innerHTML = [0, 1, 2, 3]
      .map(i => `<span class="dot${i < state.pin.length ? ' dot--on' : ''}"></span>`).join('');
  }

  async function tryLogin() {
    if (state.pin.length !== 4) return;
    state.busy = true;
    $('#login-error').textContent = '';
    try {
      const r = await Api.call('login', { userId: state.picked.userId, pin: state.pin });
      Api.setToken(r.token);
      state.user = r.user;
      goHome(true);
    } catch (e) {
      $('#login-error').textContent = e.message;
      state.pin = '';
      renderDots();
      const dots = $('#pin-dots');
      dots.classList.remove('shake');
      void dots.offsetWidth;
      dots.classList.add('shake');
    } finally {
      state.busy = false;
    }
  }

  // ─── Register ────────────────────────────────────────────────────────────
  function goRegister() {
    show('screen-register');
    $('#register-form').reset();
    $('#register-error').textContent = '';
    state.emoji = EMOJIS[0];
    renderEmojiGrid();
  }

  function renderEmojiGrid() {
    $('#emoji-grid').innerHTML = EMOJIS.map(em => `
      <button type="button" class="emoji${em === state.emoji ? ' emoji--on' : ''}"
        data-e="${em}" aria-pressed="${em === state.emoji}">${em}</button>`).join('');
  }

  $('#emoji-grid').addEventListener('click', e => {
    const b = e.target.closest('.emoji');
    if (b) { state.emoji = b.dataset.e; renderEmojiGrid(); }
  });

  $('#register-back').addEventListener('click', goLogin);

  $('#register-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get('name') || '').trim();
    const err = $('#register-error');

    if (!name) { err.textContent = 'Add your name.'; return; }
    if (!/^\d{4}$/.test(f.get('pin'))) { err.textContent = 'Your PIN needs to be 4 digits.'; return; }
    if (f.get('pin') !== f.get('pin2')) { err.textContent = "Those PINs don't match."; return; }

    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    err.textContent = '';
    try {
      const r = await Api.call('register', { name, pin: f.get('pin'), emoji: state.emoji });
      Api.setToken(r.token);
      state.user = r.user;
      goHome(true);
      if (r.user.isAdmin) toast("You're the first taster, so you're the admin");
    } catch (x) {
      err.textContent = x.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ─── Home ────────────────────────────────────────────────────────────────
  // resume = true jumps straight back into a test you're part of (after login or a refresh)
  function goHome(resume = false) {
    show('screen-home');
    $('#home-emoji').textContent = state.user.emoji;
    $('#home-name').textContent = `Hello, ${state.user.displayName}`;
    $('#admin-panel').hidden = !state.user.isAdmin;
    $('#create-test').hidden = !state.user.isAdmin;
    $('#create-open').hidden = !state.user.isAdmin;
    if (state.user.isAdmin) loadUsers();
    loadOpenTests(resume);
    loadOpenTastings();
  }

  const fmtDate = d => {
    const dt = new Date(String(d) + 'T12:00:00');
    return isNaN(dt) ? String(d || '') : dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };

  async function loadOpenTests(resume) {
    const box = $('#open-tests');
    let r;
    try {
      r = await Api.call('listOpenTests');
    } catch (e) {
      box.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      return;
    }
    if ($('#screen-home').hidden) return;
    if (resume && r.myTestId) return openLobby(r.myTestId);

    box.innerHTML = r.tests.length ? r.tests.map(t => {
      const mine = t.testId === r.myTestId || t.isOrganiser;
      const label = mine ? 'Open' : t.status === 'live' ? 'Started' : 'Join';
      const disabled = !mine && t.status === 'live';
      return `
        <div class="test-card">
          <div class="test-card__info">
            <p class="test-card__name">${esc(t.name)}</p>
            <p class="test-card__meta">${esc(t.organiser ? t.organiser.emoji + ' ' + t.organiser.displayName : '')}, ${esc(fmtDate(t.testDate))}</p>
            <p class="test-card__meta">${t.status === 'live' ? 'Tasting now' : plural(t.tasterCount, 'taster') + ' waiting'}, ${plural(t.sampleCount, 'sample')}</p>
          </div>
          <button class="btn${mine ? '' : ' btn--light'}" type="button" data-id="${esc(t.testId)}" data-act="${mine ? 'open' : 'join'}"${disabled ? ' disabled' : ''}>${label}</button>
        </div>`;
    }).join('') : '<p class="empty">Nothing\'s on the table yet. When an organiser opens a test, it\'ll show up here.</p>';

    timers.home = setTimeout(() => { if (!$('#screen-home').hidden) loadOpenTests(false); }, document.hidden ? 15000 : 6000);
  }

  $('#open-tests').addEventListener('click', async e => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    if (b.dataset.act === 'open') return openLobby(b.dataset.id);
    b.disabled = true;
    try {
      await Api.call('joinTest', { testId: b.dataset.id });
      openLobby(b.dataset.id);
    } catch (x) {
      toast(x.message);
      b.disabled = false;
    }
  });

  $('#logout').addEventListener('click', () => {
    Api.call('logout').catch(() => {});
    Api.setToken(null);
    state.user = null;
    goLogin();
  });

  $('#change-pin').addEventListener('click', () => openDialog({
    title: 'Change my PIN',
    body: pinFields(true),
    ok: 'Save PIN',
    onOk: async f => {
      checkPins(f);
      await Api.call('changePin', { currentPin: f.get('current'), newPin: f.get('pin') });
      toast('PIN changed');
    }
  }));

  // ─── Admin: taster list ──────────────────────────────────────────────────
  async function loadUsers() {
    const list = $('#user-list');
    list.innerHTML = '<li class="loading">Loading tasters…</li>';
    try {
      state.users = await Api.call('listUsers');
    } catch (e) {
      list.innerHTML = `<li class="error">${esc(e.message)}</li>`;
      return;
    }
    list.innerHTML = state.users.map(u => {
      const me = u.userId === state.user.userId;
      return `
        <li>
          <span class="taster__emoji" aria-hidden="true">${esc(u.emoji)}</span>
          <span class="user-name">${esc(u.displayName)}${u.isAdmin ? ' <span class="badge">Admin</span>' : ''}</span>
          <span class="user-actions">
            <button class="link" data-act="pin" data-id="${esc(u.userId)}">Reset PIN</button>
            ${me ? '' : `
              <button class="link" data-act="admin" data-id="${esc(u.userId)}">${u.isAdmin ? 'Remove admin' : 'Make admin'}</button>
              <button class="link link--danger" data-act="remove" data-id="${esc(u.userId)}">Remove</button>`}
          </span>
        </li>`;
    }).join('');
  }

  $('#user-list').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const u = state.users.find(x => x.userId === b.dataset.id);

    if (b.dataset.act === 'pin') {
      openDialog({
        title: `New PIN for ${u.displayName}`,
        body: pinFields(false),
        ok: 'Reset PIN',
        onOk: async f => {
          checkPins(f);
          await Api.call('adminResetPin', { userId: u.userId, newPin: f.get('pin') });
          toast(`${u.displayName}'s PIN reset`);
        }
      });
    }

    if (b.dataset.act === 'admin') {
      try {
        await Api.call('adminSetAdmin', { userId: u.userId, isAdmin: !u.isAdmin });
        toast(u.isAdmin ? `${u.displayName} is no longer an admin` : `${u.displayName} is now an admin`);
        loadUsers();
      } catch (x) {
        toast(x.message);
      }
    }

    if (b.dataset.act === 'remove') {
      openDialog({
        title: `Remove ${u.displayName}?`,
        body: '<p>They won\'t be able to log in. Scores from past tests stay in the results.</p>',
        ok: 'Remove',
        onOk: async () => {
          await Api.call('adminRemoveUser', { userId: u.userId });
          toast(`${u.displayName} removed`);
          loadUsers();
        }
      });
    }
  });

  // ─── Creating a test ─────────────────────────────────────────────────────
  $('#create-test').addEventListener('click', async () => {
    try {
      [state.types, state.products] = await Promise.all([Api.call('listTypes'), Api.call('listProducts')]);
    } catch (e) {
      return toast(e.message);
    }
    const today = new Date();
    const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

    openDialog({
      title: 'Create a test',
      ok: 'Create test',
      wide: true,
      body: `
        <label>Name<input name="name" maxlength="60" placeholder="Christmas crisps"></label>
        <label>Date<input name="testDate" type="date" value="${iso}"></label>
        <label class="check"><input type="checkbox" name="halfPoints"> Allow half points</label>
        <label class="check"><input type="checkbox" name="tasting" checked> I'm tasting too</label>
        ${productPicker([])}`,
      onOpen: wirePicker,
      onOk: async f => {
        if (!String(f.get('name') || '').trim()) throw new Error('Give the test a name.');
        const r = await Api.call('createTest', {
          name: f.get('name'),
          testDate: f.get('testDate'),
          halfPoints: f.get('halfPoints') === 'on',
          tasting: f.get('tasting') === 'on',
          productIds: f.getAll('productIds')
        });
        toast('Test created. Tasters can join now');
        openLobby(r.testId);
      }
    });
  });

  // Checkbox list of library products, with a search box. Used when creating
  // a test and when changing its products in the lobby.
  function productPicker(selectedIds, single = false) {
    if (!state.products.length) {
      return '<p class="muted">Your product library is empty. Add products from the home screen first. You can also add them to this test later.</p>';
    }
    const sel = new Set(selectedIds);
    return `
      <fieldset class="picker">
        <legend>${single ? 'Product' : 'Products'} <span class="hint" id="pick-count"></span></legend>
        <input class="search" type="search" id="pick-search" placeholder="Search products" aria-label="Search products">
        <ul class="pick-list" id="pick-list">
          ${state.products.map(p => {
            const t = typeOf(p.typeId);
            const pic = p.photoUrl
              ? `<img src="${esc(p.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
              : `<span aria-hidden="true">${esc(t.icon)}</span>`;
            const hay = [p.name, p.manufacturer, p.vintage, t.name].join(' ').toLowerCase();
            return `
              <li data-hay="${esc(hay)}">
                <label>
                  <input type="${single ? 'radio' : 'checkbox'}" name="${single ? 'productId' : 'productIds'}" value="${esc(p.productId)}"${sel.has(p.productId) ? ' checked' : ''}>
                  <span class="pick__pic">${pic}</span>
                  <span class="pick__text"><strong>${esc(p.name)}</strong><span>${esc(p.manufacturer)}${p.vintage ? ', ' + esc(p.vintage) : ''}</span></span>
                </label>
              </li>`;
          }).join('')}
        </ul>
      </fieldset>`;
  }

  function wirePicker(body) {
    const list = body.querySelector('#pick-list');
    if (!list) return;
    const count = () => {
      const n = list.querySelectorAll('input:checked').length;
      const single = !!list.querySelector('input[type=radio]');
      body.querySelector('#pick-count').textContent = single ? (n ? '' : 'Pick one') : n ? `${n} chosen` : 'None chosen yet';
    };
    list.addEventListener('change', count);
    body.querySelector('#pick-search').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      list.querySelectorAll('li').forEach(li => { li.hidden = q && !li.dataset.hay.includes(q); });
    });
    count();
  }

  // ─── Lobby ───────────────────────────────────────────────────────────────
  const lobby = { testId: null, version: null, wasIn: false, test: null, showBowls: false };

  async function openLobby(testId) {
    show('screen-lobby');
    lobby.testId = testId;
    lobby.version = null;
    lobby.wasIn = false;
    lobby.showBowls = false;
    $('#lobby-name').textContent = 'Loading…';
    $('#lobby-status').textContent = '';
    $('#lobby-meta').textContent = '';
    $('#lobby-actions').innerHTML = '';
    $('#lobby-tasters').innerHTML = '';
    $('#lobby-setup').hidden = true;
    refreshLobby();
  }

  const onTestScreen = () => !$('#screen-lobby').hidden || !$('#screen-live').hidden;

  async function refreshLobby(force = false) {
    clearTimeout(timers.lobby);
    if (!onTestScreen() || !lobby.testId) return;
    if (force) lobby.version = null;
    try {
      const s = await Api.call('getTest', { testId: lobby.testId, since: lobby.version });
      if (!onTestScreen()) return;
      if (!s.unchanged) {
        lobby.version = s.version;
        if (renderLobby(s) === false) return;
      }
    } catch (e) {
      if (e.code === 'AUTH') return;
      toast(e.message);
    }
    const finished = lobby.test && lobby.test.status === 'finished';
    if (onTestScreen() && !finished) {
      timers.lobby = setTimeout(refreshLobby, document.hidden ? 10000 : 2500);
    }
  }

  // Returns false when we've navigated away
  function renderLobby(s) {
    lobby.test = s;

    if (s.status === 'cancelled') {
      toast(s.isOrganiser ? 'Test cancelled' : 'The organiser cancelled this test');
      goHome();
      return false;
    }
    if (s.status === 'live' || s.status === 'finished') {
      renderLive(s);
      return true;
    }
    if (lobby.wasIn && !s.amIn && !s.isOrganiser) {
      toast("You've been taken out of this test");
      goHome();
      return false;
    }
    lobby.wasIn = s.amIn;

    const live = s.status === 'live';
    $('#lobby-status').textContent = live ? 'Tasting in progress' : 'In the lobby';
    $('#lobby-name').textContent = s.name;
    const who = u => (u ? u.emoji + ' ' + u.displayName : 'nobody yet');
    $('#lobby-meta').textContent =
      `${fmtDate(s.testDate)}. Run by ${who(s.organiser)}, bowl keeper ${who(s.keeper)}. ` +
      `${plural(s.sampleCount, 'sample')} to taste${s.halfPoints ? ', half points allowed' : ''}.`;

    // Actions depend on who you are and where the test is up to
    let html = '';
    if (s.isOrganiser && !live) {
      const why = !s.sampleCount ? 'Add some products first'
        : !s.bowlsReady ? 'Prepare the bowls first'
        : !s.keeper ? 'Choose a bowl keeper first'
        : !s.participants.length ? 'Waiting for tasters to join' : '';
      html += `<button class="btn" type="button" data-act="start"${why ? ' disabled' : ''}>Start the test</button>`;
      html += s.amIn
        ? '<button class="link" type="button" data-act="leave">Stop tasting myself</button>'
        : '<button class="link" type="button" data-act="join">Taste as well</button>';
      html += '<button class="link" type="button" data-act="cancel">Cancel test</button>';
      if (why) html += `<p class="lobby-hint">${why}.</p>`;
    } else if (s.isOrganiser && live) {
      html += '<p class="lobby-hint">The tasting has started. The scoring screens arrive in the next update, so this is as far as it goes for now.</p>';
      html += '<button class="link" type="button" data-act="cancel">Cancel test</button>';
    } else if (live) {
      html += `<p class="lobby-hint">${s.amIn ? "The tasting has started! The scoring screens arrive in the next update, so this is as far as it goes for now." : 'This test has already started.'}</p>`;
    } else if (s.amIn) {
      html += `<p class="lobby-hint">You're in. Waiting for ${s.organiser ? esc(s.organiser.displayName) : 'the organiser'} to start…</p>`;
      html += '<button class="btn btn--ghost" type="button" data-act="leave">Leave test</button>';
    } else {
      html += `<button class="btn" type="button" data-act="join">${s.isKeeper ? 'Taste as well' : 'Join this test'}</button>`;
    }
    if (s.isKeeper && !s.isOrganiser && !live) {
      html = `<p class="lobby-hint">🥣 You're the bowl keeper. When the tasting starts, you'll pick which bowl goes out each round. You won't know what's in them!</p>` + html;
    }
    $('#lobby-actions').innerHTML = html;

    $('#lobby-count').textContent = plural(s.participants.length, 'taster');
    $('#lobby-tasters').innerHTML = s.participants.length ? s.participants.map(u => `
      <div class="lobby-taster">
        <span class="taster__emoji" aria-hidden="true">${esc(u.emoji)}</span>
        <span>${esc(u.displayName)}</span>
        ${s.isOrganiser && !live && u.userId !== state.user.userId
          ? `<button class="lobby-taster__x" type="button" data-remove="${esc(u.userId)}" aria-label="Remove ${esc(u.displayName)}">×</button>`
          : ''}
      </div>`).join('') : '<p class="empty">Nobody yet.</p>';

    renderSetup(s, live);
    return true;
  }

  $('#lobby-home').addEventListener('click', () => goHome());
  $('#live-home').addEventListener('click', () => goHome());

  $('#lobby-actions').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const s = lobby.test;
    const act = b.dataset.act;

    if (act === 'start' && !confirm('Start the test? Samples get shuffled and nobody else can join.')) return;
    if (act === 'cancel' && !confirm('Cancel this test? Everyone in the lobby will be sent home.')) return;

    b.disabled = true;
    try {
      if (act === 'join') await Api.call('joinTest', { testId: s.testId });
      if (act === 'leave') {
        await Api.call('leaveTest', { testId: s.testId });
        if (!s.isOrganiser) { toast('You left the test'); return goHome(); }
      }
      if (act === 'start') await Api.call('startTest', { testId: s.testId });
      if (act === 'cancel') {
        await Api.call('cancelTest', { testId: s.testId });
        toast('Test cancelled');
        return goHome();
      }
      refreshLobby(true);
    } catch (x) {
      toast(x.message);
      b.disabled = false;
    }
  });

  $('#lobby-tasters').addEventListener('click', async e => {
    const b = e.target.closest('button[data-remove]');
    if (!b) return;
    const u = lobby.test.participants.find(x => x.userId === b.dataset.remove);
    if (!confirm(`Take ${u.displayName} out of this test?`)) return;
    try {
      await Api.call('removeParticipant', { testId: lobby.testId, userId: u.userId });
      refreshLobby(true);
    } catch (x) {
      toast(x.message);
    }
  });

  // The organiser's "Getting ready" checklist
  function renderSetup(s, live) {
    const panel = $('#lobby-setup');
    panel.hidden = !(s.isOrganiser && !live);
    if (panel.hidden) return;

    const step = (done, num, title, detail, buttons) => `
      <span class="setup__tick${done ? ' setup__tick--done' : ''}" aria-hidden="true">${done ? '✓' : num}</span>
      <div class="setup__body"><strong>${title}</strong><span>${detail}</span></div>
      <div class="setup__btns">${buttons}</div>`;

    $('#setup-products').innerHTML = step(s.sampleCount > 0, 1, 'Products',
      s.sampleCount ? plural(s.sampleCount, 'product') + ' chosen' : 'None chosen yet',
      '<button class="link" type="button" data-setup="products">Change</button>');

    $('#setup-bowls').innerHTML = step(s.bowlsReady, 2, 'Bowls',
      s.bowlsReady ? 'Fill each bowl and stick its letter underneath'
        : 'Give each product a secret bowl letter',
      s.bowlsReady
        ? `<button class="link" type="button" data-setup="toggle">${lobby.showBowls ? 'Hide list' : 'Show list'}</button>
           <button class="link" type="button" data-setup="bowls">Shuffle again</button>`
        : `<button class="btn btn--small" type="button" data-setup="bowls"${s.sampleCount ? '' : ' disabled'}>Prepare bowls</button>`);

    $('#setup-keeper').innerHTML = step(!!s.keeper, 3, 'Bowl keeper',
      s.keeper ? `${esc(s.keeper.emoji)} ${esc(s.keeper.displayName)} picks which bowl goes out each round`
        : "Picks the bowls during tasting, without knowing what's in them",
      `<button class="link" type="button" data-setup="keeper">${s.keeper ? 'Change' : 'Choose'}</button>`);

    const list = $('#bowl-list');
    list.hidden = !(s.bowlsReady && lobby.showBowls);
    if (!list.hidden) {
      list.innerHTML = `<ul class="lobby-products">${s.products.map(p => `
        <li>
          <span class="bowl-badge">${esc(p.bowl)}</span>
          <span class="pick__text"><strong>${esc(p.name)}</strong><span>${esc(p.manufacturer)}${p.vintage ? ', ' + esc(p.vintage) : ''}</span></span>
        </li>`).join('')}</ul>
        <p class="muted">Keep this to yourself. Once the test starts, this list is gone for good.</p>`;
    }
  }

  $('#lobby-setup').addEventListener('click', async e => {
    const b = e.target.closest('button[data-setup]');
    if (!b) return;
    const s = lobby.test;
    const act = b.dataset.setup;

    if (act === 'toggle') {
      lobby.showBowls = !lobby.showBowls;
      return renderSetup(s, false);
    }
    if (act === 'products') return editLobbyProducts();
    if (act === 'keeper') return chooseKeeper();
    if (act === 'bowls') {
      if (s.bowlsReady && !confirm('Shuffle the bowl letters again? If you have already labelled the bowls, you will need to redo them.')) return;
      b.disabled = true;
      try {
        await Api.call('prepareBowls', { testId: s.testId });
        lobby.showBowls = true;
        toast('Bowls ready. Time to fill and label them');
        refreshLobby(true);
      } catch (x) {
        toast(x.message);
        b.disabled = false;
      }
    }
  });

  async function editLobbyProducts() {
    if (lobby.test.bowlsReady && !confirm('Changing the products clears the bowl letters, so you will need to prepare and label the bowls again. Carry on?')) return;
    try {
      [state.types, state.products] = await Promise.all([Api.call('listTypes'), Api.call('listProducts')]);
    } catch (e) {
      return toast(e.message);
    }
    openDialog({
      title: 'Products in this test',
      ok: 'Save',
      wide: true,
      body: productPicker(lobby.test.products.map(p => p.productId)),
      onOpen: wirePicker,
      onOk: async f => {
        await Api.call('updateTestProducts', { testId: lobby.testId, productIds: f.getAll('productIds') });
        lobby.showBowls = false;
        toast('Products updated');
        refreshLobby(true);
      }
    });
  }

  async function chooseKeeper() {
    let users;
    try {
      users = await Api.call('listUsers');
    } catch (e) {
      return toast(e.message);
    }
    const s = lobby.test;
    const tasting = new Set(s.participants.map(u => u.userId));
    users.sort((a, b) => (tasting.has(b.userId) - tasting.has(a.userId)) || a.displayName.localeCompare(b.displayName));
    const current = s.keeper ? s.keeper.userId : '';

    openDialog({
      title: 'Who is the bowl keeper?',
      ok: 'Choose',
      body: `
        <p class="muted">They pick which bowl goes out each round, without knowing what's in them. They can taste too, but it shouldn't be you if you're tasting, because you know the bowls.</p>
        <ul class="pick-list">${users.map(u => `
          <li><label>
            <input type="radio" name="keeper" value="${esc(u.userId)}"${u.userId === current ? ' checked' : ''}>
            <span class="pick__pic">${esc(u.emoji)}</span>
            <span class="pick__text"><strong>${esc(u.displayName)}</strong><span>${u.userId === state.user.userId ? 'You, the organiser' : tasting.has(u.userId) ? 'Tasting in this test' : 'Not tasting'}</span></span>
          </label></li>`).join('')}
        </ul>`,
      onOk: async f => {
        const id = f.get('keeper');
        if (!id) throw new Error('Pick someone.');
        await Api.call('setKeeper', { testId: s.testId, userId: id });
        toast('Bowl keeper chosen');
        refreshLobby(true);
      }
    });
  }

  // ─── Live tasting ────────────────────────────────────────────────────────
  const NICE_LABELS = ['Never again', 'Not for me', "It's fine", 'Really good', 'I want the whole bag'];
  const AUTH_LABELS = ['Nothing like it', 'A faint hint', 'Getting there', 'Very close', 'Exactly as promised'];
  const INSPIRATION = [
    'summer rain', 'a damp tent', "grandma's handbag", 'a hint of regret', 'wet dog', 'bonfire night',
    'the seaside', 'cardboard', 'old pennies', 'christmas morning', 'school dinners', 'burnt toast',
    'freshly cut grass', 'a cinema floor', 'the fairground', 'a new car', 'pencil shavings', 'a campfire',
    'a sock drawer', 'chip shop vinegar', 'sunday roast', 'birthday cake', 'a library', 'a garden centre café',
    'a petrol station', 'the 1980s', 'disappointment', 'pure joy', 'a wet tuesday', 'pocket fluff',
    'a ploughman’s lunch', 'smugness', 'a farmyard', 'a bouncy castle', 'nan’s sideboard'
  ];
  const live = { key: null, form: null, vocab: null };

  const fmtScore = v => (v == null ? '–' : (Math.floor(v) || '') + (v % 1 ? '½' : ''));
  const fmtAvg = v => (v == null ? '–' : Number(v).toFixed(1));
  const labelFor = (v, L) => v % 1
    ? (v < 1 ? L[0] : `${L[Math.floor(v) - 1]} / ${L[Math.ceil(v) - 1]}`)
    : L[v - 1];
  const nameOf = u => (u ? `${u.emoji} ${u.displayName}` : 'someone');

  function renderLive(s) {
    if ($('#screen-live').hidden) {
      show('screen-live');
      live.key = null;
    }
    lobby.test = s;
    const finished = s.status === 'finished';
    const phase = finished ? 'done' : s.phase;
    const key = `${s.current}:${phase}`;
    const changed = key !== live.key;
    live.key = key;

    // Header
    $('#live-head').className = 'packet live-head packet--' +
      ({ choose: 'blue', niceness: 'red', authenticity: 'green', done: 'blue' }[phase] || 'blue');
    $('#live-testname').textContent = s.name;
    $('#live-stage').textContent = { choose: 'Next sample on its way', niceness: 'Tasting blind', authenticity: 'Revealed!', done: 'All done' }[phase] || '';
    $('#live-sample').textContent = finished ? "That's a wrap!" : `Sample ${s.current}`;
    $('#live-sub').textContent = finished
      ? `${plural(s.sampleTotal, 'sample')} tasted. Here's how they did.`
      : `${s.current} of ${s.sampleTotal}. ` + {
          choose: `Waiting for ${nameOf(s.keeper)} to bring it out.`,
          niceness: 'Score it before you know what it is.',
          authenticity: 'Now, does it taste like the packet says?'
        }[phase];

    // Keeper picks a bowl
    const kp = $('#keeper-panel');
    kp.hidden = !(phase === 'choose' && s.isKeeper && s.bowlsLeft);
    if (!kp.hidden && changed) {
      kp.innerHTML = `
        <h2>🥣 Pick a bowl</h2>
        <p class="muted">Any bowl you like. Carry it out with the letter still hidden underneath.</p>
        <div class="bowl-grid">${s.bowlsLeft.map(b => `<button type="button" class="bowl-btn" data-bowl="${esc(b)}">${esc(b)}</button>`).join('')}</div>`;
    }

    // The reveal
    const rp = $('#reveal-panel');
    rp.hidden = !(phase === 'authenticity' && s.reveal);
    if (!rp.hidden && changed) {
      const r = s.reveal;
      rp.innerHTML = `
        <div class="reveal__pic">${r.photoUrl ? `<img src="${esc(r.photoUrl)}" alt="" referrerpolicy="no-referrer">` : `<span>${esc(r.typeIcon || '🍽️')}</span>`}</div>
        <div class="reveal__text">
          <p class="kicker">Sample ${s.current} was…</p>
          <h2>${esc(r.name)}</h2>
          <p class="muted">${esc(r.manufacturer)}${r.vintage ? ', ' + esc(r.vintage) : ''}</p>
          ${r.description ? `<p class="reveal__desc"><strong>The packet says:</strong> ${esc(r.description)}</p>` : ''}
        </div>`;
    }

    // My scoring form
    const sp = $('#score-panel');
    const scoring = !finished && s.amIn && (phase === 'niceness' || phase === 'authenticity');
    const waiting = !finished && s.amIn && phase === 'choose' && !s.isKeeper;
    sp.hidden = !(scoring || waiting);
    if (changed) {
      if (scoring) buildScoreForm(s);
      else if (waiting) sp.innerHTML = `<p class="waiting">🥣 Waiting for ${esc(nameOf(s.keeper))} to bring out the next sample…</p>`;
    }

    renderStatus(s, phase);
    renderSoFar(s, finished);
  }

  // ── Scoring form ──
  function buildScoreForm(s) {
    const nice = s.phase === 'niceness';
    const m = s.mine;
    const field = nice ? 'niceness' : 'authenticity';
    live.form = {
      field, half: s.halfPoints, value: m[field],
      labels: nice ? NICE_LABELS : AUTH_LABELS,
      notes: [...(nice ? m.notesBlind : m.notesRevealed)]
    };
    $('#score-panel').innerHTML = `
      <h2>${nice ? '😋 How nice is it?' : '🎯 How true is it?'}</h2>
      <p class="muted">${nice ? "Just how much you like it. Forget what it's meant to be." : "Does it taste like the packet says? Whether you like it doesn't matter now."}</p>
      ${!nice && m.niceness != null ? `<p class="your-nice">You gave it ${fmtScore(m.niceness)} for niceness.</p>` : ''}
      <div class="stars" id="stars" role="group" aria-label="${nice ? 'Niceness' : 'Authenticity'} score"></div>
      <p class="star-label" id="star-label"></p>

      <div class="notes-field">
        <label for="note-input">Notes of… <span class="hint">${nice ? 'What can you taste? Silly is good.' : 'Anything else, now you know?'}</span></label>
        <div class="note-chips-edit" id="note-chips"></div>
        <div class="note-add">
          <input id="note-input" list="note-vocab" maxlength="40" autocomplete="off" placeholder="e.g. summer rain">
          <button type="button" class="btn btn--ghost btn--small" id="note-add">Add</button>
        </div>
        <button type="button" class="link" id="note-inspire">✨ Inspire me</button>
        <datalist id="note-vocab"></datalist>
      </div>

      ${nice ? `<label>What flavour do you think it is?<input id="guess" maxlength="80" value="${esc(m.guess)}" placeholder="Your best guess"></label>` : ''}
      <label>Comment<textarea id="comment" rows="2" maxlength="500" placeholder="Optional">${esc(m.comment)}</textarea></label>

      <button class="btn btn--wide" type="button" id="score-send">${m[field] != null ? 'Update my score' : 'Send my score'}</button>
      <p class="sent" id="score-sent" role="status">${m[field] != null ? '✓ Sent. You can change it until the organiser moves on.' : ''}</p>`;
    renderStars();
    renderNoteChips();
    fillVocab();
  }

  function renderStars() {
    const f = live.form;
    const box = $('#stars');
    if (!box) return;
    let html = '';
    for (let i = 1; i <= 5; i++) {
      const fill = f.value >= i ? 100 : f.value >= i - 0.5 ? 50 : 0;
      const hits = f.half
        ? `<button type="button" class="star__hit star__hit--l" data-v="${i - 0.5}" aria-label="${fmtScore(i - 0.5)} stars"></button>
           <button type="button" class="star__hit star__hit--r" data-v="${i}" aria-label="${i} stars"></button>`
        : `<button type="button" class="star__hit" data-v="${i}" aria-label="${plural(i, 'star')}"></button>`;
      html += `<span class="star" style="--fill:${fill}%"><span class="star__glyph" aria-hidden="true">★</span>${hits}</span>`;
    }
    box.innerHTML = html;
    $('#star-label').textContent = f.value
      ? `${fmtScore(f.value)} ${f.value > 1 ? 'stars' : 'star'}: ${labelFor(f.value, f.labels)}`
      : 'Tap the stars';
  }

  function renderNoteChips() {
    $('#note-chips').innerHTML = live.form.notes.map(n =>
      `<span class="note-chip">${esc(n)}<button type="button" data-note-remove="${esc(n)}" aria-label="Remove ${esc(n)}">×</button></span>`).join('');
  }

  function addNote(raw) {
    const n = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
    if (!n) return;
    if (live.form.notes.length >= 8) return toast("That's plenty of notes!");
    if (!live.form.notes.includes(n)) live.form.notes.push(n);
    renderNoteChips();
  }

  async function fillVocab() {
    if (!live.vocab) {
      try { live.vocab = await Api.call('noteVocab'); } catch (e) { live.vocab = []; }
    }
    const dl = $('#note-vocab');
    if (dl) dl.innerHTML = live.vocab.map(n => `<option value="${esc(n)}">`).join('');
  }

  $('#score-panel').addEventListener('click', e => {
    const star = e.target.closest('[data-v]');
    if (star) {
      live.form.value = Number(star.dataset.v);
      return renderStars();
    }
    const rm = e.target.closest('[data-note-remove]');
    if (rm) {
      live.form.notes = live.form.notes.filter(n => n !== rm.dataset.noteRemove);
      return renderNoteChips();
    }
    if (e.target.closest('#note-add')) {
      addNote($('#note-input').value);
      $('#note-input').value = '';
      return $('#note-input').focus();
    }
    if (e.target.closest('#note-inspire')) {
      const pool = INSPIRATION.filter(n => !live.form.notes.includes(n));
      $('#note-input').value = pool[Math.floor(Math.random() * pool.length)] || '';
      return $('#note-input').focus();
    }
    if (e.target.closest('#score-send')) sendScore();
  });

  $('#score-panel').addEventListener('keydown', e => {
    if (e.target.id === 'note-input' && (e.key === 'Enter' || e.key === ',')) {
      e.preventDefault();
      addNote(e.target.value);
      e.target.value = '';
    }
  });

  async function sendScore() {
    const f = live.form;
    if (!f.value) return toast('Tap the stars first');
    const pending = $('#note-input').value;
    if (pending.trim()) { addNote(pending); $('#note-input').value = ''; }

    const s = lobby.test;
    const payload = { testId: s.testId, sampleNo: s.current, notes: f.notes, comment: $('#comment').value };
    payload[f.field] = f.value;
    if ($('#guess')) payload.guess = $('#guess').value;

    const btn = $('#score-send');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await Api.call('submitScore', payload);
      btn.textContent = 'Update my score';
      $('#score-sent').textContent = '✓ Sent. You can change it until the organiser moves on.';
      live.vocab = null;   // pick up any new notes next time
      refreshLobby(true);
    } catch (x) {
      btn.textContent = 'Send my score';
      toast(x.message);
      refreshLobby(true);
    } finally {
      btn.disabled = false;
    }
  }

  // ── Who's scored, and the organiser's controls ──
  function renderStatus(s, phase) {
    const panel = $('#status-panel');
    panel.hidden = phase === 'done';
    if (panel.hidden) return;

    const field = phase === 'authenticity' ? 'auth' : 'nice';
    const prog = {};
    (s.progress || []).forEach(p => { prog[p.userId] = p; });
    const doneCount = s.participants.filter(u => prog[u.userId] && prog[u.userId][field]).length;
    const scoringPhase = phase === 'niceness' || phase === 'authenticity';
    const missing = s.participants.length - doneCount;

    let html = `
      <div class="panel__head">
        <h2>${scoringPhase ? (phase === 'niceness' ? 'Blind scores' : 'Authenticity scores') : 'Tasters'}</h2>
        ${scoringPhase ? `<span class="muted">${doneCount} of ${s.participants.length} in</span>` : ''}
      </div>
      <div class="progress-chips">${s.participants.map(u => {
        const done = scoringPhase && prog[u.userId] && prog[u.userId][field];
        return `<span class="pchip${done ? ' pchip--done' : ''}">${esc(u.emoji)} ${esc(u.displayName)}${scoringPhase ? (done ? ' ✓' : ' …') : ''}</span>`;
      }).join('')}</div>`;

    if (s.isOrganiser) {
      if (phase === 'choose') {
        html += `<p class="muted org-note">Waiting for ${esc(nameOf(s.keeper))} to pick a bowl.</p>`;
      }
      if (phase === 'niceness') {
        html += `<button class="btn btn--wide" type="button" data-org="reveal" data-missing="${missing}">Reveal sample ${s.current}</button>`;
      }
      if (phase === 'authenticity') {
        if (s.guesses && s.guesses.length) {
          html += `<h3 class="org-sub">Flavour guesses</h3><p class="muted">Tick the ones that got it right.</p>
            <ul class="guess-list">${s.guesses.map(g => {
              const u = s.participants.find(x => x.userId === g.userId);
              return `<li>
                <span class="guess-list__who">${esc(nameOf(u))}</span>
                <span class="guess-list__guess">“${esc(g.guess)}”</span>
                <span class="guess-list__btns">
                  <button type="button" class="guess-btn${g.correct === true ? ' guess-btn--yes' : ''}" data-guess="${esc(g.userId)}" data-correct="true" aria-label="Right">✓</button>
                  <button type="button" class="guess-btn${g.correct === false ? ' guess-btn--no' : ''}" data-guess="${esc(g.userId)}" data-correct="false" aria-label="Wrong">✗</button>
                </span>
              </li>`;
            }).join('')}</ul>`;
        }
        const last = !s.bowlsRemaining;
        html += `<button class="btn btn--wide" type="button" data-org="next" data-missing="${missing}">${last ? 'Finish the test' : 'Next sample'}</button>`;
      }
    }
    panel.innerHTML = html;
  }

  $('#status-panel').addEventListener('click', async e => {
    const s = lobby.test;
    const g = e.target.closest('[data-guess]');
    if (g) {
      const want = g.dataset.correct === 'true';
      const cur = (s.guesses.find(x => x.userId === g.dataset.guess) || {}).correct;
      try {
        await Api.call('markGuess', { testId: s.testId, sampleNo: s.current, userId: g.dataset.guess, correct: cur === want ? null : want });
        refreshLobby(true);
      } catch (x) { toast(x.message); }
      return;
    }

    const b = e.target.closest('[data-org]');
    if (!b) return;
    const missing = Number(b.dataset.missing);
    const act = b.dataset.org;
    if (missing && !confirm(`${plural(missing, 'taster')} still to score. ${act === 'reveal' ? 'Reveal' : 'Move on'} anyway?`)) return;
    if (act === 'next' && !s.bowlsRemaining && !missing && !confirm('That was the last sample. Finish the test?')) return;

    b.disabled = true;
    try {
      await Api.call(act === 'reveal' ? 'revealSample' : 'nextSample', { testId: s.testId });
      refreshLobby(true);
    } catch (x) {
      toast(x.message);
      b.disabled = false;
      refreshLobby(true);
    }
  });

  $('#keeper-panel').addEventListener('click', async e => {
    const b = e.target.closest('[data-bowl]');
    if (!b) return;
    if (!confirm(`Bring out bowl ${b.dataset.bowl}? Keep the letter hidden underneath.`)) return;
    $('#keeper-panel').querySelectorAll('button').forEach(x => { x.disabled = true; });
    try {
      await Api.call('pickBowl', { testId: lobby.test.testId, bowl: b.dataset.bowl });
      refreshLobby(true);
    } catch (x) {
      toast(x.message);
      refreshLobby(true);
    }
  });

  // ── Revealed so far, and the final ranking ──
  function renderSoFar(s, finished) {
    const panel = $('#sofar-panel');
    const list = s.revealed || [];
    panel.hidden = !list.length;
    if (panel.hidden) return;

    const total = r => (r.niceness == null || r.authenticity == null) ? -1 : r.niceness + r.authenticity;
    const rows = finished ? [...list].sort((a, b) => total(b) - total(a)) : list;
    const medal = i => (finished ? ['🥇', '🥈', '🥉'][i] || `${i + 1}.` : '');

    panel.innerHTML = `
      <h2>${finished ? 'The results' : 'Revealed so far'}</h2>
      ${finished ? '<p class="muted">Ranked by niceness plus authenticity.</p>' : ''}
      <ul class="sofar">${rows.map((r, i) => `
        <li>
          ${finished ? `<span class="sofar__rank">${medal(i)}</span>` : `<span class="sofar__num">${r.sampleNo}</span>`}
          <span class="pick__pic">${r.photoUrl ? `<img src="${esc(r.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(r.typeIcon || '🍽️')}</span>
          <span class="pick__text"><strong>${esc(r.name)}</strong><span>${esc(r.manufacturer)}${r.vintage ? ', ' + esc(r.vintage) : ''}</span></span>
          <span class="sofar__scores"><span title="Niceness">😋 ${fmtAvg(r.niceness)}</span><span title="Authenticity">🎯 ${fmtAvg(r.authenticity)}</span></span>
        </li>`).join('')}
      </ul>
      ${finished ? `<button class="btn btn--wide" type="button" id="full-results" data-id="${esc(s.testId)}">See the full results</button>` : ''}`;
  }

  $('#sofar-panel').addEventListener('click', e => {
    const b = e.target.closest('#full-results');
    if (b) openResults(b.dataset.id, 'live');
  });

  // ─── Past tests ──────────────────────────────────────────────────────────
  $('#open-history').addEventListener('click', goHistory);
  $('#history-back').addEventListener('click', () => goHome());

  async function goHistory() {
    show('screen-history');
    const box = $('#history-list');
    box.innerHTML = '<p class="loading">Fetching past tests…</p>';
    let list;
    try {
      list = await Api.call('listPastTests');
    } catch (e) {
      box.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      return;
    }
    box.innerHTML = list.length ? list.map(t => `
      <button type="button" class="history-card" data-id="${esc(t.testId)}">
        <span class="history-card__pic">${t.winner && t.winner.photoUrl
          ? `<img src="${esc(t.winner.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '🏆'}</span>
        <span class="history-card__text">
          <strong>${esc(t.name)}</strong>
          <span>${esc(fmtDate(t.testDate))}${t.source === 'paper' ? ' <span class="badge badge--paper">From paper</span>' : ''}${t.source === 'open' ? ` <span class="badge badge--open">${t.isOpen ? 'Open now' : 'Open tasting'}</span>` : ''}</span>
          <span>${plural(t.sampleCount, 'sample')}, ${plural(t.tasterCount, 'taster')}</span>
          ${t.winner ? `<span class="history-card__win">🏆 ${esc(t.winner.name)}</span>` : ''}
        </span>
      </button>`).join('')
      : '<p class="empty">No finished tests yet. Once you\'ve run one, it\'ll be here.</p>';
  }

  $('#history-list').addEventListener('click', e => {
    const b = e.target.closest('.history-card');
    if (b) openResults(b.dataset.id, 'history');
  });

  // ─── Results ─────────────────────────────────────────────────────────────
  const results = { from: 'history', data: null, stats: null, sort: 'total', picked: [], charts: [] };

  $('#results-back').addEventListener('click', () => {
    if (results.from === 'live' && lobby.testId) return openLobby(lobby.testId);
    if (results.from === 'history') return goHistory();
    if (results.from === 'reviews') return goReviews();
    if (results.from === 'open' && openT.testId) return openOpenTasting(openT.testId);
    goHome();
  });

  async function openResults(testId, from) {
    results.from = from;
    show('screen-results');
    $('#res-title').textContent = 'Loading…';
    $('#res-eyebrow').textContent = '';
    $('#res-meta').textContent = '';
    ['ranking', 'awards', 'charts', 'tasters', 'notes'].forEach(k => { $('#res-' + k).innerHTML = ''; });
    let data;
    try {
      data = await Api.call('getResults', { testId });
    } catch (e) {
      $('#res-title').textContent = 'Oops';
      $('#res-meta').textContent = e.message;
      return;
    }
    results.data = data;
    results.stats = Stats.compute(data);
    results.sort = 'total';
    results.picked = results.stats.tasters.slice(0, 1).map(t => t.userId);
    renderResults();
  }

  const userById = id => (results.data.tasters.find(u => u.userId === id) || { emoji: '👤', displayName: 'Someone' });
  const picHTML = (s, cls = 'pick__pic') =>
    `<span class="${cls}">${s.photoUrl ? `<img src="${esc(s.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(s.typeIcon || '🍽️')}</span>`;
  const bar = (v, cls) => `<span class="bar"><span class="bar__fill ${cls}" style="width:${v == null ? 0 : (v / 5) * 100}%"></span></span>`;

  function renderResults() {
    const { data, stats } = results;
    const t = data.test;
    $('#res-eyebrow').textContent = t.source === 'paper' ? 'From paper' : t.source === 'open' ? (t.isOpen ? 'Open tasting, still open' : 'Open tasting') : 'Results';
    $('#res-title').textContent = t.name;
    $('#res-meta').textContent = `${fmtDate(t.testDate)}. ${plural(stats.samples.length, 'sample')}, ${plural(stats.tasters.length, 'taster')}` +
      (t.organiser ? `. Run by ${t.organiser.emoji} ${t.organiser.displayName}` : '') + '.';
    renderRanking();
    renderAwards();
    renderCharts();
    renderTasterProfiles();
    renderNotes();
    renderResultsAdmin();
  }

  function renderResultsAdmin() {
    const panel = $('#res-admin');
    const t = results.data.test;
    panel.hidden = !state.user.isAdmin;
    if (panel.hidden) return;
    const canConvert = t.source !== 'open' && results.stats.samples.length === 1;
    panel.innerHTML = `
      <h2>Admin</h2>
      ${canConvert ? `
        <p class="muted">Only one product in this test? Turn it into an open tasting. Everyone's scores are kept, and others can add theirs.</p>
        <button class="btn btn--ghost" type="button" data-res-admin="convert">Turn into an open tasting</button>` : ''}
      <p class="muted">Deleting removes this test and all its scores, notes and guesses for good. The products stay in your library.</p>
      <button class="btn btn--ghost btn--danger" type="button" data-res-admin="delete">Delete this test</button>`;
  }

  $('#res-admin').addEventListener('click', async e => {
    const b = e.target.closest('[data-res-admin]');
    if (!b) return;
    const t = results.data.test;
    if (b.dataset.resAdmin === 'convert') {
      if (!confirm(`Turn "${t.name}" into an open tasting? It will appear on everyone's home screen for more scores.`)) return;
      try {
        await Api.call('convertToOpen', { testId: t.testId });
        toast('Now an open tasting');
        openOpenTasting(t.testId);
      } catch (x) { toast(x.message); }
    }
    if (b.dataset.resAdmin === 'delete') {
      if (!confirm(`Delete "${t.name}" and all its scores? This can't be undone.`)) return;
      try {
        await Api.call('deleteTest', { testId: t.testId });
        toast('Test deleted');
        goHistory();
      } catch (x) { toast(x.message); }
    }
  });

  // ── Ranking ──
  function renderRanking() {
    const key = results.sort;
    const list = [...results.stats.samples].sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));
    const medal = i => ['🥇', '🥈', '🥉'][i] || String(i + 1);
    const tabs = [['total', 'Overall'], ['nice', 'Niceness'], ['auth', 'Authenticity']];
    $('#res-ranking').innerHTML = `
      <h2>Ranking</h2>
      <div class="chips" role="group" aria-label="Rank by">${tabs.map(([k, l]) =>
        `<button type="button" class="chip${k === key ? ' chip--on' : ''}" data-sort="${k}" aria-pressed="${k === key}">${l}</button>`).join('')}</div>
      <ol class="ranking">${list.map((s, i) => `
        <li><button type="button" class="rank-row" data-sample="${s.sampleNo}">
          <span class="rank-row__pos">${medal(i)}</span>
          ${picHTML(s)}
          <span class="rank-row__main">
            <strong>${esc(s.name)}</strong>
            <span class="rank-row__sub">${esc(s.manufacturer)}${s.vintage ? ', ' + esc(s.vintage) : ''}</span>
            <span class="rank-row__bars">
              <span class="rank-row__bar">😋 ${bar(s.nice, 'bar__fill--n')}<b>${fmtAvg(s.nice)}</b></span>
              <span class="rank-row__bar">🎯 ${bar(s.auth, 'bar__fill--a')}<b>${fmtAvg(s.auth)}</b></span>
            </span>
          </span>
        </button></li>`).join('')}
      </ol>
      <p class="muted">Tap a product to see everyone's scores, guesses and comments.</p>`;
  }

  $('#res-ranking').addEventListener('click', e => {
    const chip = e.target.closest('[data-sort]');
    if (chip) { results.sort = chip.dataset.sort; return renderRanking(); }
    const row = e.target.closest('[data-sample]');
    if (row) openSampleDetail(Number(row.dataset.sample));
  });

  function openSampleDetail(sampleNo) {
    const s = results.stats.samples.find(x => x.sampleNo === sampleNo);
    const rows = [...s.scores].sort((a, b) => ((b.niceness ?? 0) + (b.authenticity ?? 0)) - ((a.niceness ?? 0) + (a.authenticity ?? 0)));
    const noteCounts = {};
    s.notes.forEach(n => { noteCounts[n.note] = (noteCounts[n.note] || 0) + 1; });
    const cloud = Object.keys(noteCounts).map(word => ({ word, count: noteCounts[word] }));
    openDialog({
      title: s.name,
      ok: 'Done',
      wide: true,
      noCancel: true,
      body: `
        <div class="detail-head">
          ${picHTML(s, 'detail-head__pic')}
          <div>
            <p class="muted">${esc(s.manufacturer)}${s.vintage ? ', ' + esc(s.vintage) : ''}. Sample ${s.sampleNo}${s.bowl ? `, bowl ${esc(s.bowl)}` : ''}.</p>
            <p class="detail-head__scores">😋 ${fmtAvg(s.nice)} &nbsp; 🎯 ${fmtAvg(s.auth)}</p>
          </div>
        </div>
        ${s.description ? `<p class="reveal__desc"><strong>The packet says:</strong> ${esc(s.description)}</p>` : ''}
        <ul class="detail-scores">${rows.map(r => {
          const u = userById(r.userId);
          return `<li>
            <span class="detail-scores__who">${esc(u.emoji)} ${esc(u.displayName)}</span>
            <span class="detail-scores__nums">😋 ${fmtScore(r.niceness)} &nbsp; 🎯 ${fmtScore(r.authenticity)}</span>
            ${r.guess ? `<span class="detail-scores__extra">Guessed “${esc(r.guess)}”${r.guessCorrect === true ? ' ✅' : r.guessCorrect === false ? ' ❌' : ''}</span>` : ''}
            ${r.comment ? `<span class="detail-scores__extra">“${esc(r.comment)}”</span>` : ''}
          </li>`;
        }).join('')}</ul>
        ${cloud.length ? `<h3 class="org-sub">Notes of…</h3>${cloudHTML(cloud)}` : ''}`,
      onOk: async () => {}
    });
  }

  // ── Awards ──
  function renderAwards() {
    const awards = results.stats.awards;
    $('#res-awards').innerHTML = `
      <h2>Awards</h2>
      ${awards.length ? `<div class="awards">${awards.map(a => {
        const who = a.kind === 'product'
          ? `${esc(a.sample.name)}`
          : `${esc(a.taster.emoji)} ${esc(a.taster.displayName)}`;
        return `<div class="award">
          <span class="award__icon" aria-hidden="true">${a.icon}</span>
          <span class="award__title">${esc(a.title)}</span>
          <strong class="award__who">${who}</strong>
          <span class="award__detail">${esc(a.detail)}</span>
        </div>`;
      }).join('')}</div>` : '<p class="empty">Not enough scores for awards.</p>'}`;
  }

  // ── Charts ──
  function chartColours() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    return { red: v('--red'), blue: v('--blue'), green: v('--green'), star: v('--star'), ink: v('--ink'), muted: v('--muted'), line: v('--line'), body: v('--body') };
  }
  const PALETTE = ['#C8243A', '#2346C2', '#137F4E', '#F5B700', '#8E44AD', '#E67E22', '#16A2B8', '#D63384', '#6C757D', '#5C3D2E'];

  function resetCharts() {
    results.charts.forEach(c => c.destroy());
    results.charts = [];
  }

  function renderCharts() {
    resetCharts();
    const panel = $('#res-charts');
    if (typeof window.Chart === 'undefined') {
      panel.innerHTML = '<h2>Charts</h2><p class="muted">The charts couldn\'t load. Check your connection and reopen the results.</p>';
      return;
    }
    const st = results.stats;
    panel.innerHTML = `
      <h2>Charts</h2>
      <h3 class="org-sub">Nice or true?</h3>
      <p class="muted">Top right is tasty and true to the packet. Top left is true but not nice. Bottom right is a happy accident.</p>
      <div class="chart-box chart-box--square"><canvas id="chart-scatter" aria-label="Niceness against authenticity for each product" role="img"></canvas></div>
      <h3 class="org-sub">Product by product</h3>
      <div class="chart-box" style="height:${Math.max(220, st.samples.length * 46 + 70)}px"><canvas id="chart-bars" aria-label="Average niceness and authenticity per product" role="img"></canvas></div>
      <h3 class="org-sub">Every star given</h3>
      <div class="chart-box chart-box--pie"><canvas id="chart-pie" aria-label="How often each score was given" role="img"></canvas></div>`;

    const c = chartColours();
    Chart.defaults.color = c.muted;
    Chart.defaults.borderColor = c.line;
    Chart.defaults.font.family = c.body;
    Chart.defaults.font.size = 13;
    const short = n => (n.length > 18 ? n.slice(0, 17) + '…' : n);
    const scored = st.samples.filter(s => s.nice != null && s.auth != null);

    results.charts.push(new Chart($('#chart-scatter'), {
      type: 'scatter',
      data: {
        datasets: scored.map((s, i) => ({
          label: short(s.name),
          data: [{ x: s.nice, y: s.auth }],
          backgroundColor: PALETTE[i % PALETTE.length],
          pointRadius: 9,
          pointHoverRadius: 11
        }))
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { min: 0, max: 5, title: { display: true, text: 'Niceness' }, ticks: { stepSize: 1 } },
          y: { min: 0, max: 5, title: { display: true, text: 'Authenticity' }, ticks: { stepSize: 1 } }
        },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(1)} nice, ${ctx.parsed.y.toFixed(1)} true` } }
        }
      },
      plugins: [{
        id: 'quadrants',
        beforeDatasetsDraw(chart) {
          const { ctx, scales: { x, y } } = chart;
          ctx.save();
          ctx.strokeStyle = c.line;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x.getPixelForValue(2.5), y.top); ctx.lineTo(x.getPixelForValue(2.5), y.bottom);
          ctx.moveTo(x.left, y.getPixelForValue(2.5)); ctx.lineTo(x.right, y.getPixelForValue(2.5));
          ctx.stroke();
          ctx.restore();
        }
      }]
    }));

    results.charts.push(new Chart($('#chart-bars'), {
      type: 'bar',
      data: {
        labels: st.samples.map(s => short(s.name)),
        datasets: [
          { label: 'Niceness', data: st.samples.map(s => s.nice), backgroundColor: c.red, borderRadius: 4 },
          { label: 'Authenticity', data: st.samples.map(s => s.auth), backgroundColor: c.green, borderRadius: 4 }
        ]
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        scales: { x: { min: 0, max: 5, ticks: { stepSize: 1 } } },
        plugins: { legend: { position: 'bottom' } }
      }
    }));

    const keys = Object.keys(st.distribution).map(Number).sort((a, b) => a - b);
    const shade = v => {
      const t = (v - 0.5) / 4.5;   // 0 → red, 1 → green, via gold
      return t < 0.5 ? mix('#C8243A', '#F5B700', t * 2) : mix('#F5B700', '#137F4E', (t - 0.5) * 2);
    };
    results.charts.push(new Chart($('#chart-pie'), {
      type: 'doughnut',
      data: {
        labels: keys.map(k => `${fmtScore(k)} ★`),
        datasets: [{ data: keys.map(k => st.distribution[k]), backgroundColor: keys.map(shade), borderColor: c.line, borderWidth: 1 }]
      },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    }));
  }

  function mix(a, b, t) {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  // ── Taster profiles ──
  function renderTasterProfiles() {
    const st = results.stats;
    const panel = $('#res-tasters');
    if (!st.tasters.length) { panel.innerHTML = ''; return; }
    const radarOK = typeof window.Chart !== 'undefined' && st.axes.length >= 3;

    panel.innerHTML = `
      <h2>Tasters</h2>
      ${radarOK ? `
        <p class="muted">Each spike shows where someone sits against everyone else in this test, from 0 (least) to 100 (most). Pick up to two to compare.</p>
        <div class="chips" id="taster-picks" role="group" aria-label="Choose tasters">${st.tasters.map(u =>
          `<button type="button" class="chip${results.picked.includes(u.userId) ? ' chip--on' : ''}" data-pick="${esc(u.userId)}" aria-pressed="${results.picked.includes(u.userId)}">${esc(u.emoji)} ${esc(u.displayName)}</button>`).join('')}</div>
        <div class="chart-box chart-box--square"><canvas id="chart-radar" aria-label="Taster profile" role="img"></canvas></div>
        <dl class="axis-key">${st.axes.map(a => `<div><dt>${a.label}</dt><dd>${AXIS_HELP[a.key]}</dd></div>`).join('')}</dl>` : ''}
      <div class="table-wrap">
        <table class="taster-table">
          <thead><tr><th scope="col">Taster</th><th scope="col">😋 avg</th><th scope="col">🎯 avg</th>${st.hasTiming ? '<th scope="col">Speed</th>' : ''}<th scope="col">Guesses</th></tr></thead>
          <tbody>${[...st.tasters].sort((a, b) => (b.generosity ?? 0) - (a.generosity ?? 0)).map(u => `
            <tr>
              <th scope="row">${esc(u.emoji)} ${esc(u.displayName)}</th>
              <td>${fmtAvg(u.nice)}</td>
              <td>${fmtAvg(u.auth)}</td>
              ${st.hasTiming ? `<td>${Stats.fmtSecs(u.speed)}</td>` : ''}
              <td>${u.guessMarked ? `${u.guessRight}/${u.guessMarked}` : '–'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    if (radarOK) drawRadar();
  }

  const AXIS_HELP = {
    generosity: 'How high their scores were',
    speed: 'How quickly they scored',
    deviation: 'How close they were to everyone else',
    decisiveness: 'How much of the 1–5 range they used',
    palate: 'Flavour guesses they got right',
    words: 'Notes and comments they wrote'
  };

  function drawRadar() {
    const st = results.stats;
    const old = results.charts.find(ch => ch.canvas && ch.canvas.id === 'chart-radar');
    if (old) { old.destroy(); results.charts = results.charts.filter(ch => ch !== old); }
    const c = chartColours();
    const colours = [c.blue, c.red];
    results.charts.push(new Chart($('#chart-radar'), {
      type: 'radar',
      data: {
        labels: st.axes.map(a => a.label),
        datasets: results.picked.map((id, i) => {
          const u = st.tasters.find(x => x.userId === id);
          return {
            label: `${u.emoji} ${u.displayName}`,
            data: st.axes.map(a => st.pct[a.key][id] ?? 0),
            backgroundColor: colours[i] + '33',
            borderColor: colours[i],
            pointBackgroundColor: colours[i],
            borderWidth: 2
          };
        })
      },
      options: {
        maintainAspectRatio: false,
        scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, backdropColor: 'transparent' }, pointLabels: { font: { size: 13, weight: 'bold' } } } },
        plugins: { legend: { position: 'bottom' } }
      }
    }));
  }

  $('#res-tasters').addEventListener('click', e => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const id = b.dataset.pick;
    if (results.picked.includes(id)) {
      if (results.picked.length === 1) return;
      results.picked = results.picked.filter(x => x !== id);
    } else {
      results.picked = [...results.picked, id].slice(-2);
    }
    $('#taster-picks').querySelectorAll('[data-pick]').forEach(x => {
      const on = results.picked.includes(x.dataset.pick);
      x.classList.toggle('chip--on', on);
      x.setAttribute('aria-pressed', on);
    });
    drawRadar();
  });

  // ── Notes ──
  function cloudHTML(list) {
    if (!list.length) return '';
    const max = Math.max(...list.map(x => x.count));
    const min = Math.min(...list.map(x => x.count));
    const size = n => (max === min ? 1.15 : 0.95 + ((n - min) / (max - min)) * 1.25);
    const shuffled = [...list].sort((a, b) => (a.word < b.word ? -1 : 1));
    return `<p class="cloud">${shuffled.map((x, i) =>
      `<span style="font-size:${size(x.count).toFixed(2)}rem;color:${PALETTE[i % 4]}" title="${plural(x.count, 'mention')}">${esc(x.word)}</span>`).join(' ')}</p>`;
  }

  function renderNotes() {
    const st = results.stats;
    $('#res-notes').innerHTML = `
      <h2>Notes of…</h2>
      ${st.cloud.length ? cloudHTML(st.cloud) : `<p class="empty">${results.data.test.source === 'paper' ? 'Paper tests have no tasting notes.' : 'Nobody wrote any notes this time.'}</p>`}
      ${st.greatMinds.length ? `
        <h3 class="org-sub">🧠 Great minds</h3>
        <p class="muted">Tasted blind, and came up with the same note.</p>
        <ul class="great-minds">${[...st.greatMinds].sort((a, b) => b.userIds.length - a.userIds.length).slice(0, 8).map(g => `
          <li><strong>“${esc(g.note)}”</strong> ${esc(listNames(g.userIds.map(userById)))} on ${esc(g.sample.name)}</li>`).join('')}
        </ul>` : ''}`;
  }

  function listNames(users) {
    const names = users.map(u => `${u.emoji} ${u.displayName}`);
    return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0] || '';
  }

  // ─── Reviews ─────────────────────────────────────────────────────────────
  const reviews = { list: [], types: [], filter: 'all', search: '', sort: 'total', onlyMine: false, compare: [], chart: null };

  $('#open-reviews').addEventListener('click', goReviews);
  $('#reviews-back').addEventListener('click', () => goHome());

  async function goReviews() {
    show('screen-reviews');
    $('#review-grid').innerHTML = '<p class="loading">Fetching reviews…</p>';
    $('#review-count').textContent = '';
    try {
      const r = await Api.call('listReviews');
      reviews.list = r.products;
      reviews.types = r.types;
    } catch (e) {
      $('#review-grid').innerHTML = `<p class="error">${esc(e.message)}</p>`;
      return;
    }
    const ids = new Set(reviews.list.map(p => p.productId));
    reviews.compare = reviews.compare.filter(id => ids.has(id));
    renderReviews();
  }

  const rTypeOf = id => reviews.types.find(t => t.typeId === id) || { name: '', icon: '🍽️' };
  const rTotal = p => (p.nice == null || p.auth == null ? -1 : p.nice + p.auth);
  const myTotal = p => (p.mine ? (p.mine.nice ?? 0) + (p.mine.auth ?? 0) : -1);
  const verdict = m => {
    if (!m || m.nice == null) return '';
    if (m.nice >= 4) return '👍 You liked it';
    if (m.nice <= 2) return '👎 Not for you';
    return '🤷 You were so-so';
  };

  function renderReviews() {
    const used = new Set(reviews.list.map(p => p.typeId));
    const types = reviews.types.filter(t => used.has(t.typeId));
    if (reviews.filter !== 'all' && !used.has(reviews.filter)) reviews.filter = 'all';
    $('#review-types').innerHTML = [{ typeId: 'all', name: 'All', icon: '' }, ...types].map(t => {
      const on = reviews.filter === t.typeId;
      return `<button type="button" class="chip${on ? ' chip--on' : ''}" data-type="${esc(t.typeId)}" aria-pressed="${on}">${t.icon ? esc(t.icon) + ' ' : ''}${esc(t.name)}</button>`;
    }).join('');

    const q = reviews.search.toLowerCase();
    let list = reviews.list.filter(p =>
      (reviews.filter === 'all' || p.typeId === reviews.filter) &&
      (!reviews.onlyMine || p.mine) &&
      (!q || [p.name, p.manufacturer, p.vintage, p.productLine, p.description, rTypeOf(p.typeId).name].join(' ').toLowerCase().includes(q)));

    const sorters = {
      total: (a, b) => rTotal(b) - rTotal(a),
      nice: (a, b) => (b.nice ?? -1) - (a.nice ?? -1),
      auth: (a, b) => (b.auth ?? -1) - (a.auth ?? -1),
      mine: (a, b) => myTotal(b) - myTotal(a),
      recent: (a, b) => String(b.lastTasted).localeCompare(String(a.lastTasted)),
      name: (a, b) => a.name.localeCompare(b.name)
    };
    list = [...list].sort(sorters[reviews.sort]);

    $('#review-count').textContent = reviews.list.length
      ? `${plural(list.length, 'product')}${list.length !== reviews.list.length ? ` of ${reviews.list.length}` : ''}` : '';

    $('#review-grid').innerHTML = list.length ? list.map(p => {
      const t = rTypeOf(p.typeId);
      const picked = reviews.compare.includes(p.productId);
      return `
        <div class="review-card${picked ? ' review-card--picked' : ''}">
          <button type="button" class="review-card__main" data-review="${esc(p.productId)}">
            <span class="review-card__pic">${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(t.icon)}</span>
            <span class="review-card__body">
              <strong>${esc(p.name)}</strong>
              <span class="muted">${esc(p.manufacturer)}${p.vintage ? ', ' + esc(p.vintage) : ''}</span>
              <span class="review-card__scores"><span>😋 <b>${fmtAvg(p.nice)}</b></span><span>🎯 <b>${fmtAvg(p.auth)}</b></span></span>
              <span class="review-card__mine">${p.mine ? `${verdict(p.mine)}: 😋 ${fmtAvg(p.mine.nice)} 🎯 ${fmtAvg(p.mine.auth)}` : "You haven't tasted it"}</span>
              <span class="review-card__meta">${plural(p.appearances.length, 'test')}, last on ${esc(fmtDate(p.lastTasted))}</span>
            </span>
          </button>
          <label class="review-card__compare"><input type="checkbox" data-compare="${esc(p.productId)}"${picked ? ' checked' : ''}> Compare</label>
        </div>`;
    }).join('') : `<p class="empty">${reviews.list.length ? 'Nothing matches that.' : 'Nothing has been tasted yet. Products appear here once a test finishes.'}</p>`;

    renderCompareBar();
  }

  function renderCompareBar() {
    const n = reviews.compare.length;
    $('#compare-bar').hidden = n === 0;
    $('#compare-count').textContent = n === 1 ? '1 chosen. Pick another to compare' : `${n} chosen`;
    $('#compare-go').disabled = n < 2;
  }

  $('#review-types').addEventListener('click', e => {
    const b = e.target.closest('[data-type]');
    if (b) { reviews.filter = b.dataset.type; renderReviews(); }
  });
  $('#review-search').addEventListener('input', e => { reviews.search = e.target.value.trim(); renderReviews(); });
  $('#review-sort').addEventListener('change', e => { reviews.sort = e.target.value; renderReviews(); });
  $('#review-mine').addEventListener('change', e => { reviews.onlyMine = e.target.checked; renderReviews(); });

  $('#review-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-review]');
    if (b) openReviewDetail(b.dataset.review);
  });

  $('#review-grid').addEventListener('change', e => {
    const box = e.target.closest('[data-compare]');
    if (!box) return;
    const id = box.dataset.compare;
    if (box.checked) {
      if (reviews.compare.length >= 4) {
        box.checked = false;
        return toast('You can compare up to four at a time');
      }
      reviews.compare.push(id);
    } else {
      reviews.compare = reviews.compare.filter(x => x !== id);
    }
    box.closest('.review-card').classList.toggle('review-card--picked', box.checked);
    renderCompareBar();
  });

  $('#compare-clear').addEventListener('click', () => { reviews.compare = []; renderReviews(); });
  $('#compare-go').addEventListener('click', openCompare);

  async function openReviewDetail(productId) {
    const p = reviews.list.find(x => x.productId === productId);
    if (!p) return;
    let detail;
    try {
      detail = await Api.call('getProductReview', { productId });
    } catch (e) {
      return toast(e.message);
    }
    const t = rTypeOf(p.typeId);
    const others = p.productLine
      ? reviews.list.filter(x => x.productLine === p.productLine && x.productId !== p.productId)
          .sort((a, b) => String(b.vintage).localeCompare(String(a.vintage)))
      : [];
    const cloud = Object.keys(detail.notes).map(word => ({ word, count: detail.notes[word] }))
      .sort((a, b) => b.count - a.count).slice(0, 30);

    openDialog({
      title: p.name,
      ok: 'Done',
      wide: true,
      noCancel: true,
      body: `
        <div class="detail-head">
          <span class="detail-head__pic">${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="" referrerpolicy="no-referrer">` : esc(t.icon)}</span>
          <div>
            <p class="muted">${esc(p.manufacturer)}${p.vintage ? ', ' + esc(p.vintage) : ''}${t.name ? '. ' + esc(t.icon + ' ' + t.name) : ''}</p>
            <p class="detail-head__scores">😋 ${fmtAvg(p.nice)} &nbsp; 🎯 ${fmtAvg(p.auth)}</p>
            <p class="muted">${plural(p.ratings, 'rating')}${p.mine ? `. ${verdict(p.mine)}` : ''}</p>
          </div>
        </div>
        ${p.description ? `<p class="reveal__desc"><strong>The packet says:</strong> ${esc(p.description)}</p>` : ''}

        <h3 class="org-sub">Tasted in</h3>
        <ul class="appearances">${p.appearances.map(a => `
          <li>
            <span><strong>${esc(a.testName)}</strong><span class="muted">${esc(fmtDate(a.testDate))}${a.source === 'paper' ? ', from paper' : a.source === 'open' ? ', open tasting' : ''}</span></span>
            <span class="appearances__scores">😋 ${fmtAvg(a.nice)} 🎯 ${fmtAvg(a.auth)}</span>
            <button type="button" class="link" data-open-test="${esc(a.testId)}">Results</button>
          </li>`).join('')}
        </ul>

        ${others.length ? `
          <h3 class="org-sub">Other vintages</h3>
          <div class="vintages">${others.map(o => `
            <button type="button" class="chip" data-other="${esc(o.productId)}">${esc(o.vintage || o.name)}: 😋 ${fmtAvg(o.nice)} 🎯 ${fmtAvg(o.auth)}</button>`).join('')}
          </div>` : ''}

        <h3 class="org-sub">What everyone said</h3>
        <ul class="detail-scores">${detail.scores.map(r => `
          <li>
            <span class="detail-scores__who">${esc(r.user.emoji)} ${esc(r.user.displayName)}</span>
            <span class="detail-scores__nums">😋 ${fmtScore(r.niceness)} &nbsp; 🎯 ${fmtScore(r.authenticity)}</span>
            ${p.appearances.length > 1 ? `<span class="detail-scores__extra">${esc(r.testName)}</span>` : ''}
            ${r.guess ? `<span class="detail-scores__extra">Guessed “${esc(r.guess)}”${r.guessCorrect === true ? ' ✅' : r.guessCorrect === false ? ' ❌' : ''}</span>` : ''}
            ${r.comment ? `<span class="detail-scores__extra">“${esc(r.comment)}”</span>` : ''}
          </li>`).join('')}
        </ul>
        ${cloud.length ? `<h3 class="org-sub">Notes of…</h3>${cloudHTML(cloud)}` : ''}`,
      onOk: async () => {}
    });
  }

  // Links inside the review detail (one listener, since the dialog body is reused)
  $('#dialog-body').addEventListener('click', e => {
    const testBtn = e.target.closest('[data-open-test]');
    if (testBtn) {
      $('#dialog').close();
      return openResults(testBtn.dataset.openTest, 'reviews');
    }
    const other = e.target.closest('[data-other]');
    if (other) {
      $('#dialog').close();
      openReviewDetail(other.dataset.other);
    }
  });

  function openCompare() {
    const picks = reviews.compare.map(id => reviews.list.find(p => p.productId === id)).filter(Boolean);
    if (picks.length < 2) return;
    const rows = [
      ['Overall', p => (rTotal(p) < 0 ? null : rTotal(p) / 2), true],
      ['😋 Nice', p => p.nice, true],
      ['🎯 True', p => p.auth, true],
      ['You 😋', p => (p.mine ? p.mine.nice : null), true],
      ['You 🎯', p => (p.mine ? p.mine.auth : null), true],
      ['Ratings', p => p.ratings, false],
      ['Tests', p => p.appearances.length, false]
    ];
    const cell = (v, best, isScore) => `<td${best ? ' class="best"' : ''}>${v == null ? '–' : isScore ? fmtAvg(v) : v}</td>`;

    openDialog({
      title: 'Compare',
      ok: 'Done',
      wide: true,
      noCancel: true,
      body: `
        <div class="table-wrap">
          <table class="compare-table">
            <thead><tr><th></th>${picks.map(p => `
              <th scope="col">
                <span class="compare-table__pic">${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="" referrerpolicy="no-referrer">` : esc(rTypeOf(p.typeId).icon)}</span>
                <span>${esc(p.name)}</span>
                <span class="muted">${esc(p.manufacturer)}${p.vintage ? ', ' + esc(p.vintage) : ''}</span>
              </th>`).join('')}</tr></thead>
            <tbody>${rows.map(([label, fn, isScore]) => {
              const vals = picks.map(fn);
              const top = Math.max(...vals.filter(v => v != null));
              return `<tr><th scope="row">${label}</th>${vals.map(v => cell(v, isScore && v != null && v === top && vals.filter(x => x != null).length > 1, isScore)).join('')}</tr>`;
            }).join('')}
            </tbody>
          </table>
        </div>
        <p class="muted">Overall is the average of niceness (😋) and authenticity (🎯). “You” is your own score. The best in each row is highlighted.</p>
        ${typeof window.Chart !== 'undefined' ? '<div class="chart-box"><canvas id="chart-compare" role="img" aria-label="Niceness and authenticity compared"></canvas></div>' : ''}`,
      onOpen: () => {
        if (typeof window.Chart === 'undefined') return;
        if (reviews.chart) reviews.chart.destroy();
        const c = chartColours();
        Chart.defaults.color = c.muted;
        Chart.defaults.borderColor = c.line;
        Chart.defaults.font.family = c.body;
        reviews.chart = new Chart($('#chart-compare'), {
          type: 'bar',
          data: {
            labels: picks.map(p => (p.vintage ? `${p.name} (${p.vintage})` : p.name)),
            datasets: [
              { label: 'Niceness', data: picks.map(p => p.nice), backgroundColor: c.red, borderRadius: 4 },
              { label: 'Authenticity', data: picks.map(p => p.auth), backgroundColor: c.green, borderRadius: 4 }
            ]
          },
          options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 5, ticks: { stepSize: 1 } } }, plugins: { legend: { position: 'bottom' } } }
        });
      },
      onOk: async () => {}
    });
  }

  // ─── Open tastings ───────────────────────────────────────────────────────
  const openT = { testId: null, data: null, nice: null, auth: null, notes: [] };

  async function loadOpenTastings() {
    let list;
    try {
      list = await Api.call('listOpenTastings');
    } catch (e) {
      return;
    }
    if ($('#screen-home').hidden) return;
    $('#open-tastings-wrap').hidden = !list.length;
    $('#open-tastings').innerHTML = list.map(t => `
      <div class="test-card test-card--open">
        <span class="test-card__pic">${t.product && t.product.photoUrl ? `<img src="${esc(t.product.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '🍽️'}</span>
        <div class="test-card__info">
          <p class="test-card__name">${esc(t.name)}</p>
          <p class="test-card__meta">${t.ratings ? `${plural(t.ratings, 'rating')}: 😋 ${fmtAvg(t.nice)} 🎯 ${fmtAvg(t.auth)}` : 'No ratings yet'}</p>
          ${t.mine ? `<p class="test-card__meta">You: 😋 ${fmtScore(t.mine.nice)} 🎯 ${fmtScore(t.mine.auth)}</p>` : ''}
        </div>
        <button class="btn${t.mine ? ' btn--light' : ''}" type="button" data-open-tasting="${esc(t.testId)}">${t.mine ? 'View' : 'Rate it'}</button>
      </div>`).join('');
  }

  $('#open-tastings').addEventListener('click', e => {
    const b = e.target.closest('[data-open-tasting]');
    if (b) openOpenTasting(b.dataset.openTasting);
  });
  $('#open-back').addEventListener('click', () => goHome());

  // Creating one (admins)
  $('#create-open').addEventListener('click', async () => {
    try {
      [state.types, state.products] = await Promise.all([Api.call('listTypes'), Api.call('listProducts')]);
    } catch (e) {
      return toast(e.message);
    }
    openCreateOpen(null);
  });

  function openCreateOpen(preselectId) {
    const today = new Date();
    const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const pre = preselectId ? state.products.find(p => p.productId === preselectId) : null;
    const suggest = p => `${p.manufacturer} ${p.name}`.trim();

    openDialog({
      title: 'Start an open tasting',
      ok: 'Start it',
      wide: true,
      body: `
        <p class="muted">One known product that anyone can score, whenever they get round to it. It stays open until you close it.</p>
        <label>Name<input name="name" maxlength="60" value="${esc(pre ? suggest(pre) : '')}" placeholder="Mr Kipling Mince Pies"></label>
        <label>Started on<input name="testDate" type="date" value="${iso}"></label>
        <label class="check"><input type="checkbox" name="halfPoints" checked> Allow half points</label>
        ${productPicker(preselectId ? [preselectId] : [], true)}
        <button type="button" class="link" id="open-new-product">Not in the library? Add a new product</button>`,
      onOpen: body => {
        wirePicker(body);
        const nameI = body.querySelector('[name=name]');
        let typed = !!pre;
        nameI.addEventListener('input', () => { typed = true; });
        const list = body.querySelector('#pick-list');
        if (list) list.addEventListener('change', e => {
          const p = state.products.find(x => x.productId === e.target.value);
          if (p && (!typed || !nameI.value.trim())) { nameI.value = suggest(p); typed = false; }
        });
        body.querySelector('#open-new-product').addEventListener('click', () => {
          openProduct(null, async saved => {
            try { state.products = await Api.call('listProducts'); } catch (e) { /* keep what we have */ }
            openCreateOpen(saved.productId);
          });
        });
      },
      onOk: async f => {
        if (!f.get('productId')) throw new Error('Pick a product.');
        if (!String(f.get('name') || '').trim()) throw new Error('Give it a name.');
        const r = await Api.call('createOpenTasting', {
          name: f.get('name'), testDate: f.get('testDate'),
          halfPoints: f.get('halfPoints') === 'on', productId: f.get('productId')
        });
        toast('Open tasting started. Everyone can rate it now');
        openOpenTasting(r.testId);
      }
    });
  }

  // The tasting page
  async function openOpenTasting(testId) {
    show('screen-open');
    openT.testId = testId;
    $('#open-name').textContent = 'Loading…';
    ['open-product', 'open-form', 'open-scores', 'open-admin'].forEach(id => { $('#' + id).hidden = true; });
    let d;
    try {
      d = await Api.call('getOpenTasting', { testId });
    } catch (e) {
      $('#open-name').textContent = 'Oops';
      $('#open-meta').textContent = e.message;
      return;
    }
    openT.data = d;
    openT.nice = d.mine ? d.mine.niceness : null;
    openT.auth = d.mine ? d.mine.authenticity : null;
    openT.notes = d.mine ? [...d.mine.notes] : [];
    renderOpenTasting();
  }

  function renderOpenTasting() {
    const d = openT.data;
    const pr = d.product || { name: 'Deleted product', manufacturer: '', vintage: '', description: '', photoUrl: '', typeIcon: '' };
    const avg = f => {
      const v = d.scores.map(x => x[f]).filter(x => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };

    $('#open-status').textContent = d.isOpen ? 'Open tasting' : 'Closed';
    $('#open-name').textContent = d.name;
    $('#open-meta').textContent = `Started ${fmtDate(d.testDate)}${d.organiser ? ' by ' + nameOf(d.organiser) : ''}. ${d.scores.length ? plural(d.scores.length, 'rating') + ' so far' : 'Nobody has rated it yet'}.`;

    const pp = $('#open-product');
    pp.hidden = false;
    pp.innerHTML = `
      <div class="reveal__pic">${pr.photoUrl ? `<img src="${esc(pr.photoUrl)}" alt="" referrerpolicy="no-referrer">` : `<span>${esc(pr.typeIcon || '🍽️')}</span>`}</div>
      <div class="reveal__text">
        <h2>${esc(pr.name)}</h2>
        <p class="muted">${esc(pr.manufacturer)}${pr.vintage ? ', ' + esc(pr.vintage) : ''}</p>
        ${pr.description ? `<p class="reveal__desc"><strong>The packet says:</strong> ${esc(pr.description)}</p>` : ''}
      </div>`;

    // My scores
    const fp = $('#open-form');
    fp.hidden = !d.isOpen && !d.mine;
    if (d.isOpen) {
      fp.innerHTML = `
        <h2>${d.mine ? 'Your scores' : 'Rate it'}</h2>
        <h3 class="org-sub">😋 How nice is it?</h3>
        <div class="stars" data-group="nice"></div>
        <p class="star-label" data-label="nice"></p>
        <h3 class="org-sub">🎯 Does it taste like the packet says?</h3>
        <div class="stars" data-group="auth"></div>
        <p class="star-label" data-label="auth"></p>

        <div class="notes-field">
          <label for="open-note-input">Notes of… <span class="hint">What can you taste? Silly is good.</span></label>
          <div class="note-chips-edit" id="open-note-chips"></div>
          <div class="note-add">
            <input id="open-note-input" list="open-note-vocab" maxlength="40" autocomplete="off" placeholder="e.g. Christmas morning">
            <button type="button" class="btn btn--ghost btn--small" id="open-note-add">Add</button>
          </div>
          <button type="button" class="link" id="open-note-inspire">✨ Inspire me</button>
          <datalist id="open-note-vocab"></datalist>
        </div>
        <label>Comment<textarea id="open-comment" rows="2" maxlength="500" placeholder="Optional">${esc(d.mine ? d.mine.comment : '')}</textarea></label>
        <button class="btn btn--wide" type="button" id="open-send">${d.mine ? 'Update my scores' : 'Send my scores'}</button>
        <p class="sent" id="open-sent" role="status">${d.mine ? '✓ Saved. You can change it while the tasting is open.' : ''}</p>`;
      renderOpenStars('nice');
      renderOpenStars('auth');
      renderOpenChips();
      if (live.vocab) fillOpenVocab();
      else Api.call('noteVocab').then(v => { live.vocab = v; fillOpenVocab(); }).catch(() => {});
    } else if (d.mine) {
      fp.innerHTML = `<h2>Your scores</h2><p class="detail-head__scores">😋 ${fmtScore(d.mine.niceness)} &nbsp; 🎯 ${fmtScore(d.mine.authenticity)}</p>
        ${d.mine.comment ? `<p class="muted">“${esc(d.mine.comment)}”</p>` : ''}`;
    }

    // Everyone's scores
    const sp = $('#open-scores');
    sp.hidden = !d.scores.length;
    const cloud = Object.keys(d.notes).map(word => ({ word, count: d.notes[word] })).sort((a, b) => b.count - a.count).slice(0, 30);
    sp.innerHTML = d.scores.length ? `
      <div class="panel__head"><h2>Everyone's scores</h2><span class="muted">${plural(d.scores.length, 'rating')}</span></div>
      <p class="detail-head__scores">😋 ${fmtAvg(avg('niceness'))} &nbsp; 🎯 ${fmtAvg(avg('authenticity'))}</p>
      <ul class="detail-scores">${d.scores.map(r => `
        <li>
          <span class="detail-scores__who">${esc(r.user.emoji)} ${esc(r.user.displayName)}${r.isMe ? ' (you)' : ''}</span>
          <span class="detail-scores__nums">😋 ${fmtScore(r.niceness)} &nbsp; 🎯 ${fmtScore(r.authenticity)}</span>
          ${r.at ? `<span class="detail-scores__extra">${esc(fmtDate(new Date(r.at).toISOString().slice(0, 10)))}</span>` : ''}
          ${r.comment ? `<span class="detail-scores__extra">“${esc(r.comment)}”</span>` : ''}
        </li>`).join('')}
      </ul>
      ${cloud.length ? `<h3 class="org-sub">Notes of…</h3>${cloudHTML(cloud)}` : ''}
      <button class="btn btn--ghost btn--wide" type="button" id="open-results">Full results and stats</button>` : '';

    // Admin controls
    const ap = $('#open-admin');
    ap.hidden = !state.user.isAdmin;
    ap.innerHTML = d.isOpen
      ? '<h2>Admin</h2><p class="muted">Close the tasting once everyone has had a go. You can reopen it later.</p><button class="btn btn--ghost" type="button" data-open-set="close">Close tasting</button>'
      : '<h2>Admin</h2><p class="muted">This tasting is closed, so nobody can add scores.</p><button class="btn btn--ghost" type="button" data-open-set="open">Reopen tasting</button>';
  }

  function renderOpenStars(group) {
    const half = openT.data.halfPoints;
    const value = openT[group];
    const labels = group === 'nice' ? NICE_LABELS : AUTH_LABELS;
    let html = '';
    for (let i = 1; i <= 5; i++) {
      const fill = value >= i ? 100 : value >= i - 0.5 ? 50 : 0;
      const hits = half
        ? `<button type="button" class="star__hit star__hit--l" data-g="${group}" data-v="${i - 0.5}" aria-label="${fmtScore(i - 0.5)} stars"></button>
           <button type="button" class="star__hit star__hit--r" data-g="${group}" data-v="${i}" aria-label="${i} stars"></button>`
        : `<button type="button" class="star__hit" data-g="${group}" data-v="${i}" aria-label="${plural(i, 'star')}"></button>`;
      html += `<span class="star" style="--fill:${fill}%"><span class="star__glyph" aria-hidden="true">★</span>${hits}</span>`;
    }
    $(`#open-form [data-group="${group}"]`).innerHTML = html;
    $(`#open-form [data-label="${group}"]`).textContent = value
      ? `${fmtScore(value)} ${value > 1 ? 'stars' : 'star'}: ${labelFor(value, labels)}` : 'Tap the stars';
  }

  function renderOpenChips() {
    $('#open-note-chips').innerHTML = openT.notes.map(n =>
      `<span class="note-chip">${esc(n)}<button type="button" data-open-note-remove="${esc(n)}" aria-label="Remove ${esc(n)}">×</button></span>`).join('');
  }

  function fillOpenVocab() {
    const dl = $('#open-note-vocab');
    if (dl) dl.innerHTML = (live.vocab || []).map(n => `<option value="${esc(n)}">`).join('');
  }

  function addOpenNote(raw) {
    const n = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
    if (!n) return;
    if (openT.notes.length >= 8) return toast("That's plenty of notes!");
    if (!openT.notes.includes(n)) openT.notes.push(n);
    renderOpenChips();
  }

  $('#screen-open').addEventListener('click', async e => {
    const star = e.target.closest('[data-g]');
    if (star) {
      openT[star.dataset.g] = Number(star.dataset.v);
      return renderOpenStars(star.dataset.g);
    }
    const rm = e.target.closest('[data-open-note-remove]');
    if (rm) {
      openT.notes = openT.notes.filter(n => n !== rm.dataset.openNoteRemove);
      return renderOpenChips();
    }
    if (e.target.closest('#open-note-add')) {
      addOpenNote($('#open-note-input').value);
      $('#open-note-input').value = '';
      return;
    }
    if (e.target.closest('#open-note-inspire')) {
      const pool = INSPIRATION.filter(n => !openT.notes.includes(n));
      $('#open-note-input').value = pool[Math.floor(Math.random() * pool.length)] || '';
      return $('#open-note-input').focus();
    }
    if (e.target.closest('#open-results')) return openResults(openT.testId, 'open');

    const set = e.target.closest('[data-open-set]');
    if (set) {
      const opening = set.dataset.openSet === 'open';
      if (!opening && !confirm('Close this tasting? Nobody will be able to add or change scores.')) return;
      try {
        await Api.call('setOpenTasting', { testId: openT.testId, open: opening });
        toast(opening ? 'Tasting reopened' : 'Tasting closed');
        openOpenTasting(openT.testId);
      } catch (x) { toast(x.message); }
      return;
    }

    if (e.target.closest('#open-send')) {
      if (!openT.nice || !openT.auth) return toast('Give it both scores first');
      const pending = $('#open-note-input').value;
      if (pending.trim()) { addOpenNote(pending); $('#open-note-input').value = ''; }
      const btn = $('#open-send');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        await Api.call('submitOpenScore', {
          testId: openT.testId, niceness: openT.nice, authenticity: openT.auth,
          comment: $('#open-comment').value, notes: openT.notes
        });
        toast('Scores saved');
        live.vocab = null;
        openOpenTasting(openT.testId);
      } catch (x) {
        toast(x.message);
        btn.disabled = false;
        btn.textContent = 'Send my scores';
      }
    }
  });

  $('#screen-open').addEventListener('keydown', e => {
    if (e.target.id === 'open-note-input' && (e.key === 'Enter' || e.key === ',')) {
      e.preventDefault();
      addOpenNote(e.target.value);
      e.target.value = '';
    }
  });

  // ─── Product library ─────────────────────────────────────────────────────
  Object.assign(state, { types: [], products: [], filter: 'all', search: '' });
  let pendingPhoto = null;

  $('#open-products').addEventListener('click', goProducts);
  $('#products-back').addEventListener('click', () => goHome());
  $('#add-product').addEventListener('click', () => openProduct(null));
  $('#add-type').addEventListener('click', () => openType(null));

  async function goProducts() {
    show('screen-products');
    $('#product-grid').innerHTML = '<p class="loading">Fetching the library…</p>';
    try {
      [state.types, state.products] = await Promise.all([Api.call('listTypes'), Api.call('listProducts')]);
    } catch (e) {
      $('#product-grid').innerHTML = `<p class="error">${esc(e.message)}</p>`;
      return;
    }
    if (state.filter !== 'all' && !state.types.some(t => t.typeId === state.filter)) state.filter = 'all';
    renderLibrary();
  }

  const typeOf = id => state.types.find(t => t.typeId === id) || { name: 'No type', icon: '❔' };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function renderLibrary() {
    const counts = {};
    state.products.forEach(p => { counts[p.typeId] = (counts[p.typeId] || 0) + 1; });

    $('#type-filter').innerHTML = [{ typeId: 'all', name: 'All', icon: '' }, ...state.types].map(t => {
      const on = state.filter === t.typeId;
      return `<button type="button" class="chip${on ? ' chip--on' : ''}" data-id="${esc(t.typeId)}" aria-pressed="${on}">${t.icon ? esc(t.icon) + ' ' : ''}${esc(t.name)}</button>`;
    }).join('');

    const q = state.search.toLowerCase();
    const list = state.products.filter(p =>
      (state.filter === 'all' || p.typeId === state.filter) &&
      (!q || [p.name, p.manufacturer, p.vintage, p.productLine].join(' ').toLowerCase().includes(q)));

    $('#product-grid').innerHTML = list.length
      ? list.map(productCard).join('')
      : `<p class="empty">${state.products.length ? 'Nothing matches that.' : 'The library is empty. Add the first thing you plan to taste.'}</p>`;

    $('#type-list').innerHTML = state.types.map(t => `
      <li>
        <span class="taster__emoji" aria-hidden="true">${esc(t.icon)}</span>
        <span class="user-name">${esc(t.name)} <span class="muted">${plural(counts[t.typeId] || 0, 'product')}</span></span>
        <span class="user-actions">
          <button class="link" data-act="edit" data-id="${esc(t.typeId)}">Edit</button>
          <button class="link link--danger" data-act="delete" data-id="${esc(t.typeId)}">Delete</button>
        </span>
      </li>`).join('') || '<li class="empty">No types yet.</li>';
  }

  function productCard(p) {
    const t = typeOf(p.typeId);
    const pic = p.photoUrl
      ? `<img src="${esc(p.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="product__icon" aria-hidden="true">${esc(t.icon)}</span>`;
    return `
      <button type="button" class="product" data-id="${esc(p.productId)}">
        <span class="product__pic">${pic}</span>
        <span class="product__name">${esc(p.name)}</span>
        <span class="product__meta">${esc(p.manufacturer)}${p.vintage ? ', ' + esc(p.vintage) : ''}</span>
      </button>`;
  }

  $('#type-filter').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (b) { state.filter = b.dataset.id; renderLibrary(); }
  });

  $('#product-search').addEventListener('input', e => { state.search = e.target.value.trim(); renderLibrary(); });

  $('#product-grid').addEventListener('click', e => {
    const b = e.target.closest('.product');
    if (b) openProduct(state.products.find(p => p.productId === b.dataset.id));
  });

  function openProduct(p, afterSave) {
    if (!state.types.length) return toast('Add a type first, like Crisps');
    pendingPhoto = null;
    const v = p || {
      name: '', manufacturer: '', description: '', productLine: '', photoUrl: '',
      typeId: state.filter !== 'all' ? state.filter : state.types[0].typeId,
      vintage: String(new Date().getFullYear())
    };
    const lines = [...new Set(state.products.map(x => x.productLine).filter(Boolean))].sort();

    openDialog({
      title: p ? 'Edit product' : 'Add a product',
      ok: p ? 'Save changes' : 'Add product',
      wide: true,
      body: `
        <div class="photo">
          <div class="photo__preview" id="photo-preview"></div>
          <div class="photo__actions">
            <label class="btn btn--ghost photo__pick">📷 Take a photo
              <input type="file" class="photo-file" accept="image/*" capture="environment" hidden>
            </label>
            <label class="btn btn--ghost photo__pick">🖼️ Choose from gallery
              <input type="file" class="photo-file" accept="image/*" hidden>
            </label>
            <button type="button" class="link" id="photo-remove">Remove photo</button>
          </div>
        </div>
        <input type="hidden" name="photoUrl" value="${esc(v.photoUrl)}">
        <label>Name<input name="name" maxlength="60" value="${esc(v.name)}" placeholder="Prawn Cocktail"></label>
        <label>Manufacturer<input name="manufacturer" maxlength="60" value="${esc(v.manufacturer)}" placeholder="Walkers"></label>
        <div class="two">
          <label>Type
            <select name="typeId">${state.types.map(t =>
              `<option value="${esc(t.typeId)}"${t.typeId === v.typeId ? ' selected' : ''}>${esc(t.icon)} ${esc(t.name)}</option>`).join('')}
            </select>
          </label>
          <label>Vintage<input name="vintage" maxlength="20" value="${esc(v.vintage)}"></label>
        </div>
        <label>Product line <span class="hint">Links the same product across vintages</span>
          <input name="productLine" maxlength="80" list="line-list" value="${esc(v.productLine)}">
          <datalist id="line-list">${lines.map(l => `<option value="${esc(l)}">`).join('')}</datalist>
        </label>
        <label>Manufacturer's description
          <textarea name="description" rows="4" maxlength="1500" placeholder="What the packet promises">${esc(v.description)}</textarea>
        </label>
        ${p ? '<button type="button" class="link link--danger" id="product-delete">Delete this product</button>' : ''}`,

      onOpen: body => {
        const hidden = body.querySelector('[name=photoUrl]');
        const fileInputs = body.querySelectorAll('.photo-file');
        const paint = src => {
          body.querySelector('#photo-preview').innerHTML = src
            ? `<img src="${esc(src)}" alt="Product photo" referrerpolicy="no-referrer">`
            : '<span>No photo yet</span>';
          body.querySelector('#photo-remove').hidden = !src;
        };
        paint(v.photoUrl);

        fileInputs.forEach(input => input.addEventListener('change', async () => {
          const file = input.files[0];
          if (!file) return;
          try {
            const photo = await cropImage(file);
            if (photo) { pendingPhoto = photo; paint(photo); }
          } catch (x) {
            $('#dialog-error').textContent = "Couldn't read that photo. Try a different one.";
          } finally {
            input.value = '';   // lets you pick the same file again
          }
        }));

        body.querySelector('#photo-remove').addEventListener('click', () => {
          pendingPhoto = null;
          hidden.value = '';
          paint('');
        });

        // Suggest a product line from maker + name while it's left blank
        const nameI = body.querySelector('[name=name]');
        const makerI = body.querySelector('[name=manufacturer]');
        const lineI = body.querySelector('[name=productLine]');
        const suggest = () => { lineI.placeholder = `${makerI.value} ${nameI.value}`.trim() || 'Walkers Prawn Cocktail'; };
        nameI.addEventListener('input', suggest);
        makerI.addEventListener('input', suggest);
        suggest();

        const del = body.querySelector('#product-delete');
        if (del) del.addEventListener('click', async () => {
          if (!confirm(`Delete ${p.name}? This can't be undone.`)) return;
          try {
            await Api.call('deleteProduct', { productId: p.productId });
            $('#dialog').close();
            toast(`${p.name} deleted`);
            goProducts();
          } catch (x) {
            $('#dialog-error').textContent = x.message;
          }
        });
      },

      onOk: async f => {
        const data = Object.fromEntries(f.entries());
        if (!data.name.trim() || !data.manufacturer.trim()) throw new Error('Add a name and a manufacturer.');

        if (pendingPhoto) {
          $('#dialog-ok').textContent = 'Uploading photo…';
          const up = await Api.call('uploadPhoto', {
            dataUrl: pendingPhoto,
            name: `${data.manufacturer} ${data.name} ${data.vintage}`
          });
          pendingPhoto = null;
          data.photoUrl = up.url;
          $('#dialog-form [name=photoUrl]').value = up.url;   // reused if the save below fails
          $('#dialog-ok').textContent = 'Saving…';
        }
        if (p) data.productId = p.productId;

        const saved = await Api.call('saveProduct', data);
        toast(p ? 'Changes saved' : `${saved.name} added`);
        if (afterSave) afterSave(saved);
        else goProducts();
      }
    });
  }

  // ─── Cropping ────────────────────────────────────────────────────────────
  // Opens the crop window over the product form. Resolves with a JPEG data URL,
  // or null if cancelled. Falls back to a plain resize if Cropper didn't load.
  let cropper = null;
  let cropResolve = null;
  let cropRatio = 1;

  function cropImage(file) {
    if (typeof window.Cropper === 'undefined') return shrinkImage(file);
    return new Promise(resolve => {
      cropResolve = resolve;
      const img = $('#crop-img');
      const url = URL.createObjectURL(file);
      img.dataset.url = url;
      $('#crop-dialog').showModal();          // show first so Cropper can measure the space
      img.onload = () => {
        if (cropper) cropper.destroy();
        cropper = new Cropper(img, {
          aspectRatio: cropRatio,
          viewMode: 1,
          dragMode: 'move',
          autoCropArea: 0.9,
          background: false,
          restore: false,
          toggleDragModeOnDblclick: false
        });
      };
      img.onerror = () => finishCrop(null, "Couldn't read that photo. Try a different one.");
      img.src = url;
    });
  }

  function finishCrop(result, error) {
    const d = $('#crop-dialog');
    if (d.open) d.close();
    if (cropper) { cropper.destroy(); cropper = null; }
    const img = $('#crop-img');
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.removeAttribute('src');
    if (error) $('#dialog-error').textContent = error;
    const done = cropResolve;
    cropResolve = null;
    if (done) done(result);
  }

  $('#crop-ok').addEventListener('click', () => {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({
      maxWidth: 1200,
      maxHeight: 1200,
      fillColor: '#FFFFFF',
      imageSmoothingQuality: 'high'
    });
    finishCrop(canvas ? canvas.toDataURL('image/jpeg', 0.82) : null);
  });

  $('#crop-cancel').addEventListener('click', () => finishCrop(null));
  $('#crop-dialog').addEventListener('cancel', e => { e.preventDefault(); finishCrop(null); });

  $('#crop-ratios').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    cropRatio = Number(b.dataset.r);
    $('#crop-ratios').querySelectorAll('.chip').forEach(c => {
      const on = c === b;
      c.classList.toggle('chip--on', on);
      c.setAttribute('aria-pressed', on);
    });
    if (cropper) cropper.setAspectRatio(cropRatio);
  });

  // Resize photos in the browser so uploads stay small and quick
  async function shrinkImage(file, max = 1200, quality = 0.82) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', quality);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ─── Types ───────────────────────────────────────────────────────────────
  $('#type-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const t = state.types.find(x => x.typeId === b.dataset.id);

    if (b.dataset.act === 'edit') openType(t);
    if (b.dataset.act === 'delete') {
      openDialog({
        title: `Delete ${t.name}?`,
        body: '<p>Types can only be deleted once no products use them.</p>',
        ok: 'Delete',
        onOk: async () => {
          await Api.call('deleteType', { typeId: t.typeId });
          toast(`${t.name} deleted`);
          goProducts();
        }
      });
    }
  });

  function openType(t) {
    openDialog({
      title: t ? `Edit ${t.name}` : 'Add a type',
      ok: t ? 'Save' : 'Add type',
      body: `
        <label>Name<input name="name" maxlength="30" value="${esc(t ? t.name : '')}" placeholder="Biscuits"></label>
        <label>Icon <span class="hint">One emoji</span><input name="icon" maxlength="8" value="${esc(t ? t.icon : '')}" placeholder="🍪"></label>`,
      onOk: async f => {
        await Api.call('saveType', { typeId: t ? t.typeId : '', name: f.get('name'), icon: f.get('icon') });
        toast(t ? 'Type saved' : 'Type added');
        goProducts();
      }
    });
  }

  // ─── Dialog ──────────────────────────────────────────────────────────────
  let dialogHandler = null;
  let dialogOkLabel = 'Save';

  function openDialog({ title, body, ok, onOk, onOpen, wide, noCancel }) {
    $('#dialog-cancel').hidden = !!noCancel;
    $('#dialog-title').textContent = title;
    $('#dialog-body').innerHTML = body;
    $('#dialog-ok').textContent = dialogOkLabel = ok;
    $('#dialog-error').textContent = '';
    $('#dialog').classList.toggle('dialog--wide', !!wide);
    dialogHandler = onOk;
    $('#dialog').showModal();
    $('#dialog').scrollTop = 0;
    if (onOpen) onOpen($('#dialog-body'));
  }

  $('#dialog-form').addEventListener('submit', async e => {
    if (e.submitter && e.submitter.value === 'cancel') return;   // let the dialog close
    e.preventDefault();
    const btn = $('#dialog-ok');
    btn.disabled = true;
    try {
      await dialogHandler(new FormData(e.target));
      $('#dialog').close();
    } catch (x) {
      $('#dialog-error').textContent = x.message;
    } finally {
      btn.disabled = false;
      btn.textContent = dialogOkLabel;
    }
  });

  const pinInput = (name, label) =>
    `<label>${label}<input name="${name}" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>`;

  const pinFields = withCurrent =>
    (withCurrent ? pinInput('current', 'Current PIN') : '') +
    pinInput('pin', 'New PIN') + pinInput('pin2', 'Type it again');

  function checkPins(f) {
    if (!/^\d{4}$/.test(f.get('pin'))) throw new Error('The PIN needs to be 4 digits.');
    if (f.get('pin') !== f.get('pin2')) throw new Error("Those PINs don't match.");
  }

  boot();
})();
