(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400000;
  const fmtT = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const fmtD = (t) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const wd = (t) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
  const ago = (t, now) => { const m = Math.max(0, Math.round((now - t) / 60000)); if (m < 1) return "à l'instant"; if (m < 60) return 'il y a ' + m + ' min'; const h = Math.round(m / 60); if (h < 24) return 'il y a ' + h + ' h'; return 'il y a ' + Math.round(h / 24) + ' j'; };
  const STAT = { confirmed: 'Confirmé', pending: 'En attente', reminded: 'Rappelé', cancelled: 'Annulé', past: 'Passé' };
  let state = { demo: false, items: [], sel: 0, fallback: false };

  function demoData() {
    const now = Date.now(); const d0 = new Date(now); d0.setHours(0, 0, 0, 0); const t0 = d0.getTime();
    const names = ['Samira B.', 'Karim E.', 'Nadia L.', 'Youssef A.', 'Imane R.', 'Omar T.', 'Salma H.', 'Hamza K.', 'Laila M.', 'Rachid S.'];
    const sts = ['confirmed', 'confirmed', 'pending', 'confirmed', 'reminded', 'cancelled', 'confirmed', 'pending'];
    const appts = []; let k = 0;
    for (let d = 0; d < 7; d++) for (let j = 0; j < (d === 0 ? 6 : 3 + (d % 3)); j++) appts.push({ id: 'd' + (k++), name: names[k % 10], at: t0 + d * DAY + (9 + j * 1.25) * 3600000, note: ['Consultation', 'Contrôle', 'Suivi', 'Bilan'][k % 4], status: d === 0 && j < 2 ? 'past' : sts[k % sts.length] });
    const today = appts.filter((a) => a.at < t0 + DAY), upcoming = appts.filter((a) => a.at >= t0 + DAY).slice(0, 10);
    const weekAppts = []; for (let i = 0; i < 7; i++) { const l = appts.filter((a) => a.at >= t0 + i * DAY && a.at < t0 + (i + 1) * DAY); weekAppts.push({ t: t0 + i * DAY, confirmed: l.filter((a) => a.status === 'confirmed').length, pending: l.filter((a) => a.status === 'pending' || a.status === 'reminded').length, cancelled: l.filter((a) => a.status === 'cancelled').length, past: l.filter((a) => a.status === 'past').length }); }
    const inn = [34, 41, 28, 52, 47, 22, 38], out = [30, 39, 25, 48, 44, 18, 31];
    const days = inn.map((v, i) => ({ t: t0 - (6 - i) * DAY, in: v, out: out[i] }));
    const hours = [0, 0, 0, 0, 0, 1, 3, 9, 22, 34, 41, 30, 18, 14, 26, 35, 29, 21, 12, 6, 3, 1, 0, 0];
    const mk = (n, h, tx) => ({ jid: n, name: n, ts: (now - h * 3600000) / 1000, text: tx });
    const unanswered = [mk('Samira B.', 30, 'Bonjour, est-ce que je peux décaler mon rendez-vous ?'), mk('Omar T.', 7, "Quels documents dois-je apporter ?"), mk('Laila M.', 3, 'Merci docteur !'), mk('Hamza K.', 1.2, 'Vous êtes ouvert samedi ?')];
    const a = (m, kind, text) => ({ t: now - m * 60000, kind, text });
    return { label: 'Démo', acc: 'demo', status: 'open', me: '+212 6 00 00 00 00', now, today, upcoming, unread: unanswered, unreadChats: 4, unreadTotal: 7, unanswered, unansweredCount: 4,
      sched: { pending: 3, missed: 0, failed: 0, next: [] }, auto: { on: true, open: true, reminderHours: 24, pc: 'PC-CABINET' },
      weekAppts, hours, respMedianMin: 14, survey: { n: 9, avg: 4.6, sent: 14 },
      activity: [a(6, 'confirmed', 'Karim E. a confirmé son rendez-vous'), a(22, 'reminder', 'Rappel envoyé à Nadia L.'), a(48, 'cancelled', 'Imane R. a annulé son rendez-vous'), a(95, 'rating', 'Youssef A. : note 5/5'), a(130, 'survey', 'Sondage envoyé à Salma H.'), a(300, 'confirmed', 'Rachid S. a confirmé son rendez-vous')],
      brand: { name: 'Cabinet exemple', logo: '', color: '' }, labels: [{ id: 1, name: 'Suivi', color: '#5b49f0', n: 18 }, { id: 2, name: 'Nouveau', color: '#ffb547', n: 9 }, { id: 3, name: 'Urgent', color: '#f2553f', n: 3 }], days, week: { reminded: 21, confirmed: 15, cancelled: 3, noReply: 3 } };
  }

  async function load() {
    $('stamp').textContent = 'Chargement…';
    let items = null, fallback = false;
    if (!state.demo) {
      try {
        const r = await fetch('/api/dashboard-all', { cache: 'no-store' });
        if (!r.ok) throw 0;
        const j = await r.json();
        items = j.items || [];
      } catch (e) { fallback = true; }
    }
    if (state.demo || fallback) items = [demoData()];
    state.items = items; state.fallback = fallback;
    if (state.sel >= items.length && state.sel !== -1) state.sel = 0;
    render();
  }

  function merge(list) {
    if (list.length === 1) return list[0];
    const o = JSON.parse(JSON.stringify(list[0]));
    const nonDemo = list.slice(1);
    const cat = (k) => list.flatMap((x) => (x[k] || []).map((y) => ({ ...y, _acc: x.label || x.me })));
    o.today = cat('today').sort((a, b) => a.at - b.at); o.upcoming = cat('upcoming').sort((a, b) => a.at - b.at).slice(0, 12);
    o.unanswered = cat('unanswered').sort((a, b) => a.ts - b.ts); o.activity = cat('activity').sort((a, b) => b.t - a.t).slice(0, 15);
    o.unreadTotal = list.reduce((t, x) => t + x.unreadTotal, 0); o.unansweredCount = list.reduce((t, x) => t + x.unansweredCount, 0);
    o.days = o.days.map((d, i) => ({ t: d.t, in: list.reduce((t, x) => t + x.days[i].in, 0), out: list.reduce((t, x) => t + x.days[i].out, 0) }));
    o.weekAppts = o.weekAppts.map((d, i) => { const r = { t: d.t }; for (const k of ['confirmed', 'pending', 'cancelled', 'past']) r[k] = list.reduce((t, x) => t + (x.weekAppts[i][k] || 0), 0); return r; });
    o.hours = o.hours.map((_, i) => list.reduce((t, x) => t + x.hours[i], 0));
    const meds = list.map((x) => x.respMedianMin).filter((x) => x != null); o.respMedianMin = meds.length ? Math.round(meds.reduce((a, b) => a + b, 0) / meds.length) : null;
    const sn = list.reduce((t, x) => t + x.survey.n, 0); o.survey = { n: sn, avg: sn ? Math.round(list.reduce((t, x) => t + x.survey.avg * x.survey.n, 0) / sn * 10) / 10 : 0, sent: list.reduce((t, x) => t + x.survey.sent, 0) };
    o.week = { reminded: 0, confirmed: 0, cancelled: 0, noReply: 0 }; for (const x of list) for (const k in o.week) o.week[k] += x.week[k] || 0;
    const lab = {}; for (const x of list) for (const l of x.labels || []) { lab[l.name] = lab[l.name] || { ...l, n: 0 }; lab[l.name].n += l.n; } o.labels = Object.values(lab);
    o.status = list.every((x) => x.status === 'open') ? 'open' : list.some((x) => x.status === 'open') ? 'partial' : list[0].status;
    o.me = list.length + ' comptes'; void nonDemo; return o;
  }

  function render() {
    const items = state.items;
    const pill = items.map((x, i) => '<button class="pill' + (state.sel === i ? ' on' : '') + '" data-i="' + i + '">' + esc(x.label || x.me || 'Compte ' + (i + 1)) + '</button>');
    if (items.length > 1) pill.unshift('<button class="pill' + (state.sel === -1 ? ' on' : '') + '" data-i="-1">Tous les comptes</button>');
    $('accs').innerHTML = items.length > 1 ? pill.join('') : '';
    $('accs').querySelectorAll('.pill').forEach((b) => b.onclick = () => { state.sel = +b.dataset.i; render(); });
    $('demo').checked = state.demo;
    const b = $('banner');
    if (state.demo || state.fallback) { b.className = 'banner demo'; b.textContent = state.fallback ? "Données de démonstration : PingChat n'est pas lancé sur cet appareil, voici un exemple de ce que vous verrez." : 'Données de démonstration : rien de ce qui est affiché ici ne vient de vos patients.'; }
    else b.className = 'banner hidden';
    $('foot-mode').textContent = state.demo || state.fallback ? 'Mode démo.' : '';
    if (!items.length) { $('main').querySelector('.kpis').innerHTML = ''; return emptyAll(); }
    const d = state.sel === -1 ? merge(items) : items[state.sel] || items[0];
    const now = d.now || Date.now();
    $('clinic').textContent = (d.brand && d.brand.name) || 'Tableau de bord';
    const lg = $('clinic-logo'); if (d.brand && d.brand.logo && /^(data:image|\/)/.test(d.brand.logo)) { lg.src = d.brand.logo; lg.classList.remove('hidden'); } else lg.classList.add('hidden');
    document.title = 'Tableau de bord · ' + ((d.brand && d.brand.name) || 'PingChat');
    $('today-title').textContent = new Date(now).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const nT = d.today.length; $('today-sub').textContent = nT ? nT + ' rendez-vous aujourd’hui' : 'Aucun rendez-vous aujourd’hui';
    const cs = d.status === 'open' ? ['ok', 'WhatsApp connecté'] : d.status === 'partial' ? ['warn', 'Connexion partielle'] : d.status === 'qr' || d.status === 'connecting' ? ['warn', 'WhatsApp en attente'] : ['off', 'WhatsApp non lié'];
    $('conn').className = 'chip ' + cs[0]; $('conn').textContent = state.demo || state.fallback ? 'Démo' : cs[1];
    $('stamp').textContent = 'Mis à jour à ' + fmtT(now) + (d.me && !state.demo ? ' · ' + d.me : '');

    const wk = d.weekAppts, sum = (k) => wk.reduce((t, x) => t + (x[k] || 0), 0);
    const conf = sum('confirmed'), pend = sum('pending'), canc = sum('cancelled'), past = sum('past'), tot = conf + pend + canc + past;
    const rate = tot - canc > 0 ? Math.round(100 * (conf + past) / (tot - canc)) : null;
    const empty = !tot && !d.unreadTotal && !d.unansweredCount && !d.days.some((x) => x.in || x.out) && !(d.activity || []).length;
    const kp = [
      ['Rendez-vous aujourd’hui', nT, nT ? d.today.filter((a) => a.status === 'confirmed').length + ' confirmés' : 'journée libre', 'var(--indigo)'],
      ['Rendez-vous (7 jours)', tot, conf + ' confirmés · ' + pend + ' en attente', 'var(--coral)'],
      ['Taux de confirmation', rate == null ? '—' : rate + ' %', canc + ' annulation' + (canc > 1 ? 's' : ''), 'var(--green)'],
      ['Messages non lus', d.unreadTotal, d.unreadChats != null ? (d.unreadChats || 0) + ' conversation(s)' : '', 'var(--amber)'],
      ['Sans réponse', d.unansweredCount, 'derniers 7 jours', d.unansweredCount ? 'var(--coral)' : 'var(--green)'],
      ['Temps de réponse', d.respMedianMin == null ? '—' : d.respMedianMin < 60 ? d.respMedianMin + ' min' : Math.round(d.respMedianMin / 6) / 10 + ' h', 'médiane, 14 jours', 'var(--indigo)'],
      ['Satisfaction', d.survey.n ? d.survey.avg + ' / 5' : '—', d.survey.n ? d.survey.n + ' avis (30 j)' : 'aucun avis', 'var(--amber)'],
    ];
    const wel = empty && !state.demo && !state.fallback ? '<div class="welcome" style="grid-column:1/-1"><h2>Pas encore de données</h2><p>Le tableau de bord se remplira dès que des messages et des rendez-vous seront enregistrés. En attendant, voyez à quoi il ressemblera avec des données d’exemple.</p><button class="btn" id="see-demo">Voir la démo</button></div>' : '';
    $('kpis').innerHTML = wel + kp.map((k) => '<div class="kpi" style="--c:' + k[3] + '"><div class="v">' + esc(k[1]) + '</div><div class="l">' + esc(k[0]) + '</div><div class="s">' + esc(k[2]) + '</div></div>').join('');
    const sd = $('see-demo'); if (sd) sd.onclick = () => { state.demo = true; load(); };

    // messages chart
    const mx = Math.max(1, ...d.days.map((x) => Math.max(x.in, x.out)));
    $('ch-msgs').innerHTML = d.days.some((x) => x.in || x.out) ? '<div class="bars">' + d.days.map((x) => '<div class="col"><div class="n">' + (x.in + x.out) + '</div><div class="stack"><div class="bar" title="Reçus ' + x.in + '" style="height:' + 100 * x.in / mx + '%;background:var(--indigo)"></div><div class="bar" title="Envoyés ' + x.out + '" style="height:' + 100 * x.out / mx + '%;background:var(--coral)"></div></div><div class="x">' + wd(x.t) + '</div></div>').join('') + '</div>' : empt('Aucun message', 'Les messages des 7 derniers jours apparaîtront ici.');
    // appts chart
    const am = Math.max(1, ...wk.map((x) => x.confirmed + x.pending + x.cancelled + x.past));
    $('ch-appts').innerHTML = tot ? '<div class="bars">' + wk.map((x) => { const t = x.confirmed + x.pending + x.cancelled + x.past; const seg = (v, c) => v ? '<div style="height:' + 100 * v / t + '%;background:' + c + '"></div>' : ''; return '<div class="col"><div class="n">' + (t || '') + '</div><div class="stack"><div class="stk" style="height:' + 100 * t / am + '%">' + seg(x.confirmed + x.past, 'var(--green)') + seg(x.pending, 'var(--amber)') + seg(x.cancelled, 'var(--red)') + '</div></div><div class="x">' + wd(x.t) + '</div></div>'; }).join('') + '</div>' : empt('Aucun rendez-vous', 'Ajoutez des rendez-vous dans PingChat : ils s’afficheront ici par jour et par statut.');
    // donut
    const parts = [['Confirmés', conf + past, '#34c98a'], ['En attente', pend, '#ffb547'], ['Annulés', canc, '#e5484d']]; const pt = parts.reduce((t, p) => t + p[1], 0);
    if (pt) { let acc = 0; const R = 54, C = 2 * Math.PI * R; const arcs = parts.map((p) => { const len = C * p[1] / pt; const s = '<circle r="' + R + '" cx="70" cy="70" fill="none" stroke="' + p[2] + '" stroke-width="20" stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + (-acc) + '" transform="rotate(-90 70 70)"/>'; acc += len; return s; }).join('');
      $('donut').innerHTML = '<div class="donut"><svg width="140" height="140" viewBox="0 0 140 140"><circle r="54" cx="70" cy="70" fill="none" stroke="#2a2755" stroke-width="20"/>' + arcs + '<text x="70" y="68" text-anchor="middle" fill="#fff" font-size="26" font-weight="700">' + pt + '</text><text x="70" y="86" text-anchor="middle" fill="#a39fd3" font-size="11">rdv</text></svg><div class="leg">' + parts.map((p) => '<div><i class="d" style="background:' + p[2] + '"></i>' + p[0] + '<b>' + p[1] + '</b></div>').join('') + '</div></div>'; }
    else $('donut').innerHTML = empt('Rien à afficher', 'Aucun rendez-vous cette semaine.');
    // hours
    const hm = Math.max(0, ...d.hours);
    $('ch-hours').innerHTML = hm ? '<div class="hours"><div class="bars">' + d.hours.map((v, h) => '<div class="col" title="' + h + ' h : ' + v + '"><div class="stack"><div class="bar' + (v === hm ? ' peak' : '') + '" style="height:' + 100 * v / hm + '%"></div></div></div>').join('') + '</div><div style="display:flex;justify-content:space-between" class="x muted"><small>0 h</small><small>6 h</small><small>12 h</small><small>18 h</small><small>23 h</small></div></div>' : empt('Pas assez de données', 'Les heures de pointe se calculent à partir des messages reçus.');
    // lists
    $('ag-count').textContent = nT ? nT + ' au total' : '';
    $('agenda').innerHTML = nT ? d.today.map(apRow).join('') : empt('Journée libre', 'Aucun rendez-vous prévu aujourd’hui.');
    $('un-count').textContent = d.unansweredCount ? d.unansweredCount + ' patient(s)' : '';
    $('unans').innerHTML = d.unanswered.length ? d.unanswered.slice(0, 8).map((u) => '<div class="row"><span class="dot" style="background:var(--coral)"></span><div class="m"><b>' + esc(u.name || u.jid) + (u._acc ? ' · ' + esc(u._acc) : '') + '</b><small>' + esc(u.text) + '</small></div><span class="badge b-pending">' + ago(u.ts * 1000, now) + '</span></div>').join('') : empt('Tout est à jour', 'Aucun message en attente de réponse.');
    $('activity').innerHTML = (d.activity || []).length ? d.activity.slice(0, 8).map((e) => '<div class="row k-' + esc(e.kind) + '"><span class="dot"></span><div class="m"><b>' + esc(e.text) + '</b><small>' + ago(e.t, now) + '</small></div></div>').join('') : empt('Aucune activité', 'Rappels, confirmations et avis récents s’afficheront ici.');
    $('upcoming').innerHTML = d.upcoming.length ? d.upcoming.slice(0, 8).map((a) => '<div class="row"><span class="t">' + fmtD(a.at).replace(/\.$/, '') + '</span><div class="m"><b>' + esc(a.name) + '</b><small>' + fmtT(a.at) + (a.note ? ' · ' + esc(a.note) : '') + '</small></div><span class="badge b-' + esc(a.status) + '">' + (STAT[a.status] || a.status) + '</span></div>').join('') : empt('Rien de prévu', 'Pas de rendez-vous dans les 7 prochains jours.');
    // autos
    const au = d.auto || {};
    const ar = (t, s, on) => '<div class="auto"><span class="dot" style="background:' + (on ? 'var(--green)' : 'var(--muted)') + '"></span><div class="m"><b>' + t + '</b><small>' + s + '</small></div><span class="badge ' + (on ? 'b-confirmed' : 'b-past') + '">' + (on ? 'Actif' : 'Inactif') + '</span></div>';
    $('autos').innerHTML = ar('Réponse automatique', au.open ? 'Cabinet ouvert maintenant' : 'Cabinet fermé maintenant', !!au.on) + ar('Rappels de rendez-vous', 'Envoi ' + (au.reminderHours || 24) + ' h avant', true) + ar('Messages programmés', (d.sched.pending || 0) + ' en attente' + (d.sched.missed ? ' · ' + d.sched.missed + ' manqué(s)' : '') + (d.sched.failed ? ' · ' + d.sched.failed + ' échoué(s)' : ''), d.sched.pending > 0);
    $('labels').innerHTML = (d.labels || []).length ? d.labels.map((l) => '<span class="lab"><i style="background:' + esc(/^#[0-9a-f]{3,8}$/i.test(l.color) ? l.color : '#5b49f0') + '"></i>' + esc(l.name) + ' <b>' + l.n + '</b></span>').join('') : empt('Aucune étiquette', 'Créez des étiquettes dans PingChat pour classer vos patients.');
  }
  const empt = (a, b) => '<div class="empty"><b>' + a + '</b>' + b + '</div>';
  const apRow = (a) => '<div class="row"><span class="t">' + fmtT(a.at) + '</span><div class="m"><b>' + esc(a.name) + '</b><small>' + esc(a.note || '') + '</small></div><span class="badge b-' + esc(a.status) + '">' + (STAT[a.status] || esc(a.status)) + '</span></div>';
  function emptyAll() { $('conn').className = 'chip off'; $('conn').textContent = 'Aucun compte'; $('kpis').innerHTML = '<div class="welcome" style="grid-column:1/-1"><h2>Aucun compte WhatsApp lié</h2><p>Liez un compte dans PingChat, ou regardez la démo.</p><button class="btn" id="see-demo">Voir la démo</button></div>'; $('see-demo').onclick = () => { state.demo = true; load(); }; }

  $('demo').onchange = (e) => { state.demo = e.target.checked; state.sel = 0; load(); };
  $('refresh').onclick = load;
  if (/[?&]demo\b/.test(location.search)) state.demo = true;
  load(); setInterval(() => { if (!state.demo && !state.fallback && !document.hidden) load(); }, 60000);
})();
