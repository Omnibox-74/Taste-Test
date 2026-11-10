// Works out everything for the results page from the raw test data.
// Pure functions, no screen code, so it can be reused for combined tests later.
window.Stats = (() => {
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const median = a => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const sd = a => {
    if (a.length < 2) return null;
    const m = mean(a);
    return Math.sqrt(mean(a.map(x => (x - m) ** 2)));
  };
  const present = v => v !== null && v !== undefined;

  // Percentile rank among tasters: 0 = lowest in the group, 100 = highest.
  // higherIsBetter=false flips it (e.g. a quicker time scores higher).
  function percentiles(items, key, higherIsBetter = true) {
    const vals = items.filter(i => present(i[key]));
    const out = {};
    vals.forEach(i => {
      const below = vals.filter(j => (higherIsBetter ? j[key] < i[key] : j[key] > i[key])).length;
      const ties = vals.filter(j => j[key] === i[key]).length - 1;
      out[i.userId] = vals.length > 1 ? Math.round(((below + ties / 2) / (vals.length - 1)) * 100) : 50;
    });
    return out;
  }

  function compute(d) {
    // ── Products ──
    // When several share a name ("Mince Pies"), label them by maker too
    const nameCount = {};
    d.samples.forEach(s => { const k = s.name.toLowerCase(); nameCount[k] = (nameCount[k] || 0) + 1; });
    const samples = d.samples.map(s => {
      const sc = d.scores.filter(x => x.sampleNo === s.sampleNo);
      const N = sc.map(x => x.niceness).filter(present);
      const A = sc.map(x => x.authenticity).filter(present);
      const V = sc.map(x => x.value).filter(present);
      const nice = mean(N);
      const auth = mean(A);
      return Object.assign({}, s, {
        label: nameCount[s.name.toLowerCase()] > 1 ? `${s.manufacturer} ${s.name}`.trim() : s.name,
        scores: sc,
        notes: d.notes.filter(x => x.sampleNo === s.sampleNo),
        nice, auth, value: mean(V),
        unit: s.price ? (s.price.qty ? s.price.price / s.price.qty : s.price.price) : null,
        total: present(nice) && present(auth) ? nice + auth : null,
        gap: present(nice) && present(auth) ? nice - auth : null,
        spread: sd(N)
      });
    });

    // ── Tasters ──
    const noteUsers = {};
    d.notes.forEach(n => {
      (noteUsers[n.note] = noteUsers[n.note] || new Set()).add(n.userId);
    });

    const tasters = d.tasters.map(u => {
      const mine = d.scores.filter(x => x.userId === u.userId);
      const N = mine.map(x => x.niceness).filter(present);
      const A = mine.map(x => x.authenticity).filter(present);
      const all = N.concat(A);

      // How far each score sits from everyone else's average for that sample
      const devs = [];
      mine.forEach(m => ['niceness', 'authenticity'].forEach(f => {
        if (!present(m[f])) return;
        const others = d.scores
          .filter(x => x.sampleNo === m.sampleNo && x.userId !== u.userId && present(x[f]))
          .map(x => x[f]);
        if (others.length) devs.push(Math.abs(m[f] - mean(others)));
      }));

      // Seconds from the bowl arriving (or the reveal) to their first score
      const times = [];
      if (!d.test || d.test.source !== 'open') mine.forEach(m => {   // open tastings have no "bowl arrived" moment
        const s = d.samples.find(x => x.sampleNo === m.sampleNo);
        if (!s) return;
        if (m.nicenessAt && s.chosenAt) times.push((m.nicenessAt - s.chosenAt) / 1000);
        if (m.authenticityAt && s.revealedAt) times.push((m.authenticityAt - s.revealedAt) / 1000);
      });

      const marked = mine.filter(m => present(m.guessCorrect));
      const myNotes = d.notes.filter(x => x.userId === u.userId);
      const commentWords = mine.reduce((a, m) => a + (m.comment ? m.comment.trim().split(/\s+/).length : 0), 0);

      return Object.assign({}, u, {
        count: mine.length,
        nice: mean(N),
        auth: mean(A),
        generosity: mean(all),
        deviation: mean(devs),
        speed: median(times.filter(t => t > 0 && t < 3600)),
        decisiveness: sd(all),
        guessRight: marked.filter(m => m.guessCorrect).length,
        guessMarked: marked.length,
        palate: marked.length ? marked.filter(m => m.guessCorrect).length / marked.length : null,
        notes: myNotes.length,
        uniqueNotes: myNotes.filter(n => noteUsers[n.note].size === 1).length,
        words: myNotes.length + commentWords
      });
    }).filter(t => t.count > 0);

    // ── Taster profile (radar) axes, as percentiles ──
    const AXES = [
      { key: 'generosity', label: 'Generosity', higher: true },
      { key: 'speed', label: 'Speed', higher: false },
      { key: 'deviation', label: 'Agreement', higher: false },
      { key: 'decisiveness', label: 'Decisiveness', higher: true },
      { key: 'palate', label: 'Palate', higher: true },
      { key: 'words', label: 'Wordiness', higher: true }
    ];
    const axes = AXES.filter(a => tasters.filter(t => present(t[a.key])).length >= 2);
    const pct = {};
    axes.forEach(a => { pct[a.key] = percentiles(tasters, a.key, a.higher); });

    // ── Awards ──
    const awards = [];
    const best = (list, key, dir = 1) => {
      const v = list.filter(x => present(x[key]));
      if (!v.length) return null;
      return v.reduce((a, b) => (dir * b[key] > dir * a[key] ? b : a));
    };
    const scored = samples.filter(s => present(s.total));
    const p = (icon, title, s, detail) => s && awards.push({ icon, title, kind: 'product', sample: s, detail });
    const t = (icon, title, u, detail) => u && awards.push({ icon, title, kind: 'taster', taster: u, detail });
    const f1 = v => Number(v).toFixed(1);

    if (scored.length >= 2) {   // product awards need something to beat
      const champ = best(scored, 'total');
      p('🏆', 'Champion', champ, `Top overall with ${f1(champ.nice)} niceness and ${f1(champ.auth)} authenticity`);
      const tasty = best(scored, 'nice');
      p('😋', 'Tastiest', tasty, `${f1(tasty.nice)} for niceness`);
      const trueOne = best(scored, 'auth');
      p('🎯', 'Most authentic', trueOne, `${f1(trueOne.auth)} for tasting like the packet says`);
      const fibber = best(scored, 'auth', -1);
      if (scored.length > 1 && fibber.auth < 3) p('🤥', 'Packet fibber', fibber, `Only ${f1(fibber.auth)} for authenticity`);
      const happy = best(scored, 'gap');
      if (happy.gap >= 0.75) p('🎁', 'Happy accident', happy, 'Tastes great, just not of what it says');
      const truth = best(scored, 'gap', -1);
      if (truth.gap <= -0.75) p('😬', 'Truth hurts', truth, 'Exactly as described… sadly');
      const divisive = best(samples.filter(s => present(s.spread)), 'spread');
      if (divisive && divisive.spread >= 0.8) p('⚔️', 'Most divisive', divisive, 'Loved by some, hated by others');
      if (scored.length >= 3) {
        const spoon = best(scored, 'total', -1);
        p('🥄', 'Wooden spoon', spoon, 'Bottom of the pile');
      }
      const valued = samples.filter(s => present(s.value));
      if (valued.length >= 2) {
        const bargain = best(valued, 'value');
        p('💷', 'Bargain buy', bargain, `${f1(bargain.value)} for value for money`);
        const robbery = best(valued, 'value', -1);
        if (robbery.value < 3) p('💸', 'Daylight robbery', robbery, `Only ${f1(robbery.value)} for value`);
      }
      const priced = samples.filter(s => present(s.unit));
      if (priced.length >= 2) {
        const cheap = best(priced, 'unit', -1);
        const dear = best(priced, 'unit');
        if (cheap !== dear) {
          p('🪙', 'Cheapest', cheap, 'Lowest price each');
          p('👑', 'Priciest', dear, 'Highest price each');
        }
      }
    }

    if (tasters.length >= 2) {
      const gen = best(tasters, 'generosity');
      t('😇', 'Most generous', gen, `Average score ${f1(gen.generosity)}`);
      const harsh = best(tasters, 'generosity', -1);
      t('😈', 'Harshest critic', harsh, `Average score ${f1(harsh.generosity)}`);
      if (tasters.filter(x => present(x.speed)).length >= 2) {
        const fast = best(tasters, 'speed', -1);
        t('⚡', 'Speed demon', fast, `Usually scored within ${fmtSecs(fast.speed)}`);
        const slow = best(tasters, 'speed');
        t('🐢', 'Slow and steady', slow, `Took about ${fmtSecs(slow.speed)} to decide`);
      }
      const palate = best(tasters.filter(x => x.guessRight > 0), 'guessRight');
      if (palate) t('👅', 'Best palate', palate, `Guessed ${palate.guessRight} of ${palate.guessMarked} flavours right`);
      const tune = best(tasters, 'deviation', -1);
      if (tune) t('🤝', 'In tune', tune, 'Closest to what everyone else thought');
      const contra = best(tasters, 'deviation');
      if (contra && contra !== tune) t('🦄', 'Contrarian', contra, 'Marched to their own drum');
      const somm = best(tasters.filter(x => x.notes > 0), 'notes');
      if (somm) t('🍷', 'Sommelier', somm, `${somm.notes} tasting notes`);
    }

    // ── Notes ──
    const counts = {};
    d.notes.forEach(n => { counts[n.note] = (counts[n.note] || 0) + 1; });
    const cloud = Object.keys(counts)
      .map(word => ({ word, count: counts[word] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    // Two or more people independently picking the same note, blind
    const greatMinds = [];
    samples.forEach(s => {
      const byNote = {};
      s.notes.filter(n => n.phase === 'blind').forEach(n => {
        (byNote[n.note] = byNote[n.note] || new Set()).add(n.userId);
      });
      Object.keys(byNote).forEach(note => {
        if (byNote[note].size >= 2) greatMinds.push({ note, sample: s, userIds: [...byNote[note]] });
      });
    });

    // ── Every star given, for the score spread chart ──
    const distribution = {};
    d.scores.forEach(x => ['niceness', 'authenticity', 'value'].forEach(f => {
      if (present(x[f])) distribution[x[f]] = (distribution[x[f]] || 0) + 1;
    }));

    return {
      samples, tasters, axes, pct, awards, cloud, greatMinds, distribution,
      hasTiming: tasters.some(x => present(x.speed)),
      hasValue: samples.some(x => present(x.value))
    };
  }

  function fmtSecs(s) {
    if (!present(s)) return '–';
    if (s < 60) return `${Math.round(s)}s`;
    return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
  }

  return { compute, fmtSecs };
})();
