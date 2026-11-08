(() => {
  const EMOJIS = ['🥔', '🍫', '🍷', '🧀', '🍪', '🌶️', '🍋', '🧅', '🥓', '🍄', '🦊', '🐸',
                  '🐙', '🦉', '🐝', '🦄', '🐢', '🐼', '🦖', '🚀', '🎩', '👑', '⭐', '🌈'];

  const state = { user: null, users: [], picked: null, pin: '', emoji: EMOJIS[0], busy: false };

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function show(id) {
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
        return goHome();
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
      goHome();
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
      goHome();
      if (r.user.isAdmin) toast("You're the first taster, so you're the admin");
    } catch (x) {
      err.textContent = x.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ─── Home ────────────────────────────────────────────────────────────────
  function goHome() {
    show('screen-home');
    $('#home-emoji').textContent = state.user.emoji;
    $('#home-name').textContent = `Hello, ${state.user.displayName}`;
    $('#admin-panel').hidden = !state.user.isAdmin;
    if (state.user.isAdmin) loadUsers();
  }

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

  // ─── Dialog ──────────────────────────────────────────────────────────────
  let dialogHandler = null;

  function openDialog({ title, body, ok, onOk }) {
    $('#dialog-title').textContent = title;
    $('#dialog-body').innerHTML = body;
    $('#dialog-ok').textContent = ok;
    $('#dialog-error').textContent = '';
    dialogHandler = onOk;
    $('#dialog').showModal();
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
