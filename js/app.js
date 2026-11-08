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
    if (state.user.isAdmin) loadUsers();
    loadOpenTests(resume);
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
  function productPicker(selectedIds) {
    if (!state.products.length) {
      return '<p class="muted">Your product library is empty. Add products from the home screen first. You can also add them to this test later.</p>';
    }
    const sel = new Set(selectedIds);
    return `
      <fieldset class="picker">
        <legend>Products <span class="hint" id="pick-count"></span></legend>
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
                  <input type="checkbox" name="productIds" value="${esc(p.productId)}"${sel.has(p.productId) ? ' checked' : ''}>
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
      body.querySelector('#pick-count').textContent = n ? `${n} chosen` : 'None chosen yet';
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

  async function refreshLobby(force = false) {
    clearTimeout(timers.lobby);
    if ($('#screen-lobby').hidden || !lobby.testId) return;
    if (force) lobby.version = null;
    try {
      const s = await Api.call('getTest', { testId: lobby.testId, since: lobby.version });
      if ($('#screen-lobby').hidden) return;
      if (!s.unchanged) {
        lobby.version = s.version;
        if (renderLobby(s) === false) return;
      }
    } catch (e) {
      if (e.code === 'AUTH') return;
      toast(e.message);
    }
    if (!$('#screen-lobby').hidden) {
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

  function openProduct(p) {
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
        goProducts();
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

  function openDialog({ title, body, ok, onOk, onOpen, wide }) {
    $('#dialog-title').textContent = title;
    $('#dialog-body').innerHTML = body;
    $('#dialog-ok').textContent = dialogOkLabel = ok;
    $('#dialog-error').textContent = '';
    $('#dialog').classList.toggle('dialog--wide', !!wide);
    dialogHandler = onOk;
    $('#dialog').showModal();
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
