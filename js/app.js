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

  // ─── Product library ─────────────────────────────────────────────────────
  Object.assign(state, { types: [], products: [], filter: 'all', search: '' });
  let pendingPhoto = null;

  $('#open-products').addEventListener('click', goProducts);
  $('#products-back').addEventListener('click', goHome);
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
