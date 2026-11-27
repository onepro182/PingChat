/* ==========================================================
   PingChat - logique de l'interface
   Discussions, messages texte / images / vocaux, recherche,
   mode sombre, reponses, emojis, sauvegarde locale.
   Aucune dependance externe : pur JavaScript.
   ========================================================== */

(function () {
  "use strict";

  const $ = function (id) { return document.getElementById(id); };
  const chatListEl = $("chat-list");
  const chatAreaEl = $("chat-area");
  const messagesEl = $("messages");
  const welcomeEl = $("welcome-screen");
  const chatAvatarEl = $("chat-avatar");
  const chatTitleEl = $("chat-title");
  const chatStatusEl = $("chat-status");
  const typingEl = $("typing-indicator");
  const typingAvatarEl = $("typing-avatar");
  const messageInput = $("message-input");
  const sendBtn = $("send-btn");
  const backBtn = $("back-btn");
  const searchInput = $("search-input");
  const composerEl = $("composer");

  const STORE_KEY = "pingchat.v2";
  const THEME_KEY = "pingchat.theme";
  const SET_KEY = "pingchat.settings";
  const STORY_KEY = "pingchat.stories";
  const INSTINCT_KEY = "pingchat.instinct";
  const EMOJIS = ["😀","😂","😍","🥰","😎","🤔","😢","😡","👍","👎","🙏","👏","💪","🎉","🔥","❤️","💯","✅","🎂","⚽","☕","🍕","🚀","👀"];

  let activeId = null;
  let listFilter = "all";
  let replyTo = null;
  let pendingImage = null;
  let uid = 0;

  // ---------- Etat : copie des donnees + sauvegarde locale ----------
  const ORIGINAL = JSON.parse(JSON.stringify(CONVERSATIONS));

  function normalize() {
    CONVERSATIONS.forEach(function (c) {
      c.days.forEach(function (d) {
        d.messages.forEach(function (m) {
          if (!m.id) m.id = "m" + Date.now().toString(36) + (uid++);
          if (!m.type) m.type = "text";
        });
      });
    });
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      CONVERSATIONS.length = 0;
      saved.forEach(function (c) { CONVERSATIONS.push(c); });
      // Ajoute le contact par defaut Instinct une seule fois (anciennes sauvegardes)
      if (!localStorage.getItem(INSTINCT_KEY) && !CONVERSATIONS.some(function (c) { return c.id === "a0"; })) {
        CONVERSATIONS.unshift(JSON.parse(JSON.stringify(ORIGINAL[0])));
      }
    } catch (e) { /* donnees invalides : on garde la demo */ }
  }

  function save() {
    if (typeof wb !== "undefined" && wb.on) return; // mode WhatsApp Web : rien a sauvegarder localement
    try {
      // Les images et vocaux (blobs) restent en memoire : on ne les sauvegarde pas
      const out = CONVERSATIONS.filter(function (c) { return !c.live; }).map(function (c) {
        return Object.assign({}, c, {
          days: c.days.map(function (d) {
            return { date: d.date, messages: d.messages.filter(function (m) { return m.type === "text"; }) };
          }),
        });
      });
      localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch (e) { /* stockage plein ou indisponible */ }
  }

  load();
  try { localStorage.setItem(INSTINCT_KEY, "1"); } catch (e) {}
  normalize();

  // ---------- Utilitaires ----------
  function avatarColor(id) {
    return (typeof AVATAR_COLORS !== "undefined" && AVATAR_COLORS[id]) || "#8696a0";
  }
  function initials(name) {
    return name.split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join("");
  }
  function getConv(id) { return CONVERSATIONS.find(function (c) { return c.id === id; }); }
  function allMessages(conv) {
    return conv.days.reduce(function (a, d) { return a.concat(d.messages); }, []);
  }
  function lastMessage(conv) {
    const all = allMessages(conv).filter(function (m) { return !m.deleted; });
    return all.length ? all[all.length - 1] : null;
  }
  function findMsg(conv, id) { return allMessages(conv).find(function (m) { return m.id === id; }); }
  function previewOf(m) {
    if (!m) return "";
    if (m.type === "image") return "📷 " + (m.text || "Photo");
    if (m.type === "voice") return "🎤 Message vocal " + fmtDur(m.duration);
    if (m.type === "audio") return "🎵 Audio";
    if (m.type === "video") return "🎥 " + (m.text || "Video");
    if (m.type === "document") return "📄 " + (m.name || "Document");
    if (m.type === "sticker") return "Sticker";
    return m.text;
  }
  function fmtDur(s) {
    s = Math.max(0, Math.round(s || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function ticksSvg(state) {
    const cls = state === "read" ? "ticks read" : "ticks";
    return '<span class="' + cls + '"><svg viewBox="0 0 18 12"><path d="M12.5 0 5 8.5 2.4 5.7 1 7l4.2 4.2L13.9 1.4z"/><path d="M17.5 0 10 8.5l-.9-1-1.4 1.5 2.5 2.5L18.9 1.4z"/></svg></span>';
  }
  function nowTime() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add("hidden"); }, 2800);
  }

  // ---------- Reglages : sons et notifications ----------
  let settings = { sound: true, notif: false };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY) || "{}")); } catch (e) {}
  function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) {} paintSettings(); }
  function paintSettings() {
    $("sound-state").textContent = settings.sound ? "on" : "off";
    $("notif-state").textContent = settings.notif ? "on" : "off";
  }
  let actx = null;
  function tone(freq, start, dur, vol) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, actx.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol, actx.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + start + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(actx.currentTime + start); o.stop(actx.currentTime + start + dur + 0.05);
  }
  function playSound(kind) {
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      if (kind === "in") { tone(880, 0, 0.14, 0.18); tone(1175, 0.12, 0.2, 0.18); }
      else if (kind === "send") { tone(660, 0, 0.1, 0.12); }
      else if (kind === "react") { tone(990, 0, 0.08, 0.1); }
    } catch (e) {}
  }
  function updateTitle() {
    let n = CONVERSATIONS.reduce(function (s, c) { return s + (c.unread || 0); }, 0);
    if (typeof wb !== "undefined" && wb.on) wb.accounts.forEach(function (a) { if (a.id !== wb.acc) n += a.unread || 0; });
    document.title = (n ? "(" + n + ") " : "") + "PingChat";
  }
  function notifyIncoming(conv, text, accName, accId) {
    if (conv && conv.muted) return;
    if (typeof wb !== "undefined" && wb.locked) { conv = { name: "PingChat" }; text = "Nouveau message"; }
    playSound("in");
    const title = accName ? conv.name + " · " + accName : conv.name;
    if (settings.notif && document.hidden && "Notification" in window && Notification.permission === "granted") {
      try {
        const n = new Notification(title, { body: text, icon: "assets/logo.svg" });
        n.onclick = function () { try { window.focus(); } catch (e) {} if (accId && typeof wbSwitch === "function" && accId !== wb.acc) wbSwitch(accId); };
      } catch (e) {}
    } else if (accId ? true : activeId !== conv.id) {
      toast("💬 " + (accName ? "[" + accName + "] " : "") + conv.name + " : " + text);
    }
  }

  // ---------- Theme sombre ----------
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    $("theme-state").textContent = theme === "dark" ? "on" : "off";
    document.querySelector(".icon-moon").classList.toggle("hidden", theme === "dark");
    document.querySelector(".icon-sun").classList.toggle("hidden", theme !== "dark");
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }
  function toggleTheme() {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  }
  (function initTheme() {
    let t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (!t) t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    applyTheme(t);
  })();
  $("theme-btn").addEventListener("click", toggleTheme);

  // ---------- Menus deroulants ----------
  function closeMenus() {
    $("side-menu").classList.add("hidden");
    $("chat-menu").classList.add("hidden");
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".menu-wrap")) closeMenus();
    if (!e.target.closest("#emoji-btn") && !e.target.closest("#emoji-panel")) $("emoji-panel").classList.add("hidden");
  });
  $("side-menu-btn").addEventListener("click", function () {
    const open = $("side-menu").classList.contains("hidden");
    closeMenus();
    $("side-menu").classList.toggle("hidden", !open);
  });
  $("chat-menu-btn").addEventListener("click", function () {
    const open = $("chat-menu").classList.contains("hidden");
    closeMenus();
    if (activeId) {
      const c = getConv(activeId);
      $("chat-menu").querySelector('[data-act="pin"]').textContent = c.pinned ? "Desepingler la discussion" : "Epingler la discussion";
      $("chat-menu").querySelector('[data-act="mute"]').textContent = c.muted ? "Reactiver les notifications" : "Mettre en sourdine";
      $("chat-menu").querySelector('[data-act="archive"]').textContent = c.archived ? "Desarchiver la discussion" : "Archiver la discussion";
      ["media", "location", "mute", "archive", "tags", "plan"].forEach(function (k) { $("chat-menu").querySelector('[data-act="' + k + '"]').classList.toggle("hidden", !c.wb); });
      $("chat-menu").classList.toggle("hidden", !open);
    }
  });
  $("side-menu").addEventListener("click", function (e) {
    const act = e.target.closest("button") && e.target.closest("button").dataset.act;
    closeMenus();
    if (act === "theme") toggleTheme();
    if (act === "sound") { settings.sound = !settings.sound; saveSettings(); if (settings.sound) playSound("react"); toast(settings.sound ? "Sons actives" : "Sons coupes"); }
    if (act === "notif") {
      if (settings.notif) { settings.notif = false; saveSettings(); return toast("Notifications desactivees"); }
      if (!("Notification" in window)) return toast("Notifications non supportees");
      Notification.requestPermission().then(function (p) {
        settings.notif = p === "granted"; saveSettings();
        toast(settings.notif ? "Notifications activees" : "Notifications refusees par le navigateur");
      });
    }
    if (act === "wb-logout") {
      if (!confirm("Deconnecter ce compte WhatsApp ? Un nouveau QR sera demande.")) return;
      wbApi("logout", {}); return;
    }
    if (act === "rr" || act === "typing") {
      if (!wb.on) return toast("Disponible avec WhatsApp Web");
      const body = {}; if (act === "rr") body.readReceipts = !wb.settings.readReceipts; else body.typing = !wb.settings.typing;
      wbApi("settings", body).then(function (r) { if (r && r.ok) { wb.settings = { readReceipts: r.readReceipts, typing: r.typing }; wbPaintSettings(); toast(act === "rr" ? (r.readReceipts ? "Accuses de lecture actives" : "Accuses de lecture desactives (tu ne verras plus ceux des autres non plus)") : (r.typing ? "Indicateur d'ecriture active" : "Indicateur d'ecriture desactive")); } });
      return;
    }
    if (act === "starred") { if (!wb.on) return toast("Disponible avec WhatsApp Web"); wbStarred(); return; }
    if (act === "accounts") { if (wb.on) wbManage(); else toast("Disponible avec l'application Windows"); return; }
    if (act === "delete-all") {
      if (!CONVERSATIONS.length) return toast("Aucune discussion");
      if (!confirm("Supprimer TOUTES les discussions ?")) return;
      CONVERSATIONS.forEach(function (c) { if (c.live) liveApi("delete.php", { phone: c.phone }); });
      CONVERSATIONS.length = 0; activeId = null; save(); closeChat(); renderChatList();
      toast("Toutes les discussions ont ete supprimees");
    }
    if (act === "read-all") {
      CONVERSATIONS.forEach(function (c) { c.unread = 0; });
      save(); renderChatList(); toast("Toutes les discussions sont lues");
    }
    if (act === "dash") return dashOpen();
    if (act === "pro") return proOpen("quick");
    if (act === "newgroup") { if (typeof wbNewGroup === "function" && wb.on) wbNewGroup(); else toast("Disponible avec WhatsApp Web"); return; }
    if (act === "reset") {
      if (!confirm("Reinitialiser toutes les discussions ?")) return;
      localStorage.removeItem(STORE_KEY);
      location.reload();
    }
  });
  $("chat-menu").addEventListener("click", function (e) {
    const act = e.target.closest("button") && e.target.closest("button").dataset.act;
    closeMenus();
    const conv = getConv(activeId);
    if (!conv) return;
    if (act === "info") { if (conv.wb) wbInfo(conv); else toast("Infos disponibles avec WhatsApp Web"); return; }
    if (act === "media") return wbGallery(conv);
    if (act === "tags") return wbTagPick(conv);
    if (act === "plan") return proOpen("appts", conv.jid);
    if (act === "lib") { if (conv.wb) return proOpen("lib", conv.jid); toast("Disponible avec WhatsApp Web"); return; }
    if (act === "export") return wbExportChat(conv);
    if (act === "note") { if (conv.wb) return proOpen("note", conv.jid); toast("Notes disponibles avec WhatsApp Web"); return; }
    if (act === "location") return wbLocation(conv);
    if (act === "archive") return wbFlag(conv, { archive: !conv.archived }, conv.archived ? "Discussion desarchivee" : "Discussion archivee");
    if (act === "mute") return conv.muted ? wbFlag(conv, { mute: 0 }, "Notifications reactivees") : openList("Mettre en sourdine pendant...", [{ title: "8 heures", onClick: function () { wbFlag(conv, { mute: 8 }, "Sourdine 8 h"); } }, { title: "1 semaine", onClick: function () { wbFlag(conv, { mute: 168 }, "Sourdine 1 semaine"); } }, { title: "Toujours", onClick: function () { wbFlag(conv, { mute: -1 }, "Sourdine activee"); } }], false);
    if (act === "pin" && conv.wb) return wbFlag(conv, { pin: !conv.pinned }, conv.pinned ? "Discussion desepinglee" : "Discussion epinglee");
    if (act === "pin") { conv.pinned = !conv.pinned; save(); renderChatList(); toast(conv.pinned ? "Discussion epinglee" : "Discussion desepinglee"); }
    if (act === "clear") {
      if (!confirm("Vider cette discussion ?")) return;
      conv.days = [{ date: "Aujourd'hui", messages: [] }];
      save(); renderMessages(conv); renderChatList();
    }
    if (act === "delete") {
      if (!confirm("Supprimer cette discussion ?")) return;
      if (conv.live) liveApi("delete.php", { phone: conv.phone });
      CONVERSATIONS.splice(CONVERSATIONS.indexOf(conv), 1);
      activeId = null; save(); closeChat(); renderChatList();
    }
  });

  // ---------- Liste des discussions ----------
  function renderChatList() {
    updateTitle();
    chatListEl.innerHTML = "";
    const q = searchInput.value.trim().toLowerCase();

    const list = CONVERSATIONS.filter(function (c) {
      if (listFilter === "unread" && !c.unread) return false;
      if (listFilter === "pinned" && !c.pinned) return false;
      if (listFilter.indexOf("tag:") === 0 && (c.tags || []).indexOf(listFilter.slice(4)) < 0) return false;
      if (listFilter === "archived" ? !c.archived : (c.archived && !q)) return false;
      if (!q) return true;
      if (typeof wb !== "undefined" && wb.on && c.jid && wb.hits[c.jid]) return true;
      return c.name.toLowerCase().includes(q) ||
        allMessages(c).some(function (m) { return m.type === "text" && !m.deleted && m.text.toLowerCase().includes(q); });
    }).sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.ts || 0) - (a.ts || 0); });

    if (!list.length) {
      const e = document.createElement("li");
      e.className = "empty-state";
      e.textContent = q ? "Aucun resultat pour \"" + searchInput.value + "\"" : (CONVERSATIONS.length ? "Aucune discussion ici." : "Aucune discussion. Cliquez sur + pour en creer une.");
      chatListEl.appendChild(e);
      return;
    }

    list.forEach(function (conv) {
      const last = lastMessage(conv);
      const li = document.createElement("li");
      li.className = "chat-item" + (conv.id === activeId ? " active" : "");
      li.setAttribute("role", "option");
      li.dataset.id = conv.id;

      const previewTicks = last && last.from === "out" ? ticksSvg(last.state) : "";
      const pin = conv.pinned ? '<svg class="pin-icon" viewBox="0 0 24 24"><path d="M16 9V4h1V2H7v2h1v5l-2 3v2h5.2v7h1.6v-7H18v-2z"/></svg>' : "";
      const badge = conv.unread > 0 ? '<span class="unread-badge">' + conv.unread + "</span>" : "";

      li.innerHTML =
        '<div class="avatar" style="background:' + avatarColor(conv.id) + '">' + initials(conv.name) + "</div>" +
        '<div class="chat-item-body">' +
          '<div class="chat-item-top"><span class="chat-item-name"></span>' +
          '<span class="chat-item-time' + (conv.unread ? " unread" : "") + '">' + (last ? last.time : (conv.timeLabel || "")) + "</span></div>" +
          '<div class="chat-item-bottom"><span class="chat-item-preview">' + previewTicks +
          '<span class="preview-text"></span></span><span style="display:flex;gap:6px;align-items:center">' + (conv.muted ? '<span class="mute-icon" title="Sourdine">🔕</span>' : "") + pin + badge + "</span></div>" +
        "</div>";
      li.querySelector(".chat-item-name").textContent = conv.name;
      (conv.tags || []).forEach(function (id) { const l = typeof labelOf === "function" ? labelOf(id) : null; if (!l) return; const dot = document.createElement("i"); dot.className = "tag-dot"; dot.style.background = l.color; dot.title = l.name; li.querySelector(".chat-item-bottom > span:last-child").insertBefore(dot, li.querySelector(".chat-item-bottom > span:last-child").firstChild); });
      li.querySelector(".preview-text").textContent = last ? previewOf(last) : (conv.preview || "");
      if (q && typeof wb !== "undefined" && wb.on && conv.jid && wb.hits[conv.jid]) li.querySelector(".preview-text").textContent = "🔎 " + wb.hits[conv.jid].text;
      paintAvatar(li.querySelector(".avatar"), conv);
      const del = document.createElement("button");
      del.className = "item-del";
      del.title = "Supprimer la discussion";
      del.setAttribute("aria-label", "Supprimer la discussion " + conv.name);
      del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>';
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!confirm("Supprimer la discussion avec " + conv.name + " ?")) return;
        if (conv.live) liveApi("delete.php", { phone: conv.phone });
        CONVERSATIONS.splice(CONVERSATIONS.indexOf(conv), 1);
        if (activeId === conv.id) { activeId = null; closeChat(); }
        save(); renderChatList(); toast("Discussion supprimee");
      });
      li.appendChild(del);
      li.addEventListener("click", function () {
        if (q && typeof wb !== "undefined" && wb.on && conv.jid && wb.hits[conv.jid]) wb.jump = wb.hits[conv.jid].id;
        openConversation(conv.id);
      });
      chatListEl.appendChild(li);
    });
  }

  $("filters").addEventListener("click", function (e) {
    const b = e.target.closest(".chip");
    if (!b) return;
    listFilter = b.dataset.filter;
    document.querySelectorAll("#filters .chip").forEach(function (c) { c.classList.toggle("active", c === b); });
    renderChatList();
  });
  let searchTimer = null;
  searchInput.addEventListener("input", function () {
    renderChatList();
    clearTimeout(searchTimer);
    if (typeof wb === "undefined" || !wb.on) return;
    const q = searchInput.value.trim();
    if (q.length < 2) { if (Object.keys(wb.hits).length) { wb.hits = {}; renderChatList(); } return; }
    searchTimer = setTimeout(function () {
      wbApi("search?q=" + encodeURIComponent(q)).then(function (r) {
        if (!r || !r.ok || searchInput.value.trim() !== q) return;
        wb.hits = {};
        r.items.forEach(function (it) { if (!wb.hits[it.jid]) wb.hits[it.jid] = it; });
        renderChatList();
      });
    }, 250);
  });

  // ---------- Petite boite de saisie (window.prompt n'existe pas dans l'application Windows) ----------
  function askText(title, placeholder, value) {
    return new Promise(function (resolve) {
      const ov = $("ask-overlay"), inp = $("ask-input");
      $("ask-title").textContent = title; inp.placeholder = placeholder || ""; inp.value = value || "";
      ov.classList.remove("hidden"); setTimeout(function () { inp.focus(); inp.select(); }, 30);
      function done(v) { ov.classList.add("hidden"); $("ask-ok").onclick = $("ask-cancel").onclick = inp.onkeydown = null; resolve(v); }
      $("ask-ok").onclick = function () { done(inp.value); };
      $("ask-cancel").onclick = function () { done(null); };
      inp.onkeydown = function (e) { if (e.key === "Enter") done(inp.value); else if (e.key === "Escape") done(null); };
    });
  }

  document.querySelectorAll('.chat-header-actions .icon-btn[title^="Appel"]').forEach(function (b) {
    b.addEventListener("click", function () { toast("Les appels ne sont pas possibles dans PingChat : passe par ton telephone. Les appels entrants s'affichent ici et tu peux les refuser."); });
  });

  // ---------- Nouvelle discussion ----------
  $("new-chat-btn").addEventListener("click", async function () {
    const name = ((await askText("Nom du contact", "Ex : Sara", "")) || "").trim();
    if (!name) return;
    const phone = ((await askText("Numero WhatsApp", wb.on || live.on ? "Ex : +212600000000" : "Numero (optionnel)", "")) || "").trim();
    if (wb.on) {
      const p = normPhone(phone);
      if (!p) return toast("Numero WhatsApp invalide");
      let ex = getConv("x" + p + "@s.whatsapp.net");
      if (!ex) { ex = wbMakeConv({ jid: p + "@s.whatsapp.net", name: name, phone: "+" + p, group: false, unread: 0, ts: Math.floor(Date.now() / 1000), last: "" }); ex.localNew = true; CONVERSATIONS.unshift(ex); }
      renderChatList(); return openConversation(ex.id);
    }
    if (live.on) {
      const p = normPhone(phone);
      if (!p) return toast("Numero WhatsApp invalide");
      const ex = getConv("w" + p);
      if (ex) return openConversation(ex.id);
      const nc = makeLiveConv(p, name);
      CONVERSATIONS.unshift(nc);
      renderChatList(); openConversation(nc.id);
      return;
    }
    const keys = Object.keys(AVATAR_COLORS);
    const id = "c" + Date.now().toString(36);
    AVATAR_COLORS[id] = ["#7c5cd6", "#e05656", "#ff6b57", "#e08a2d", "#3a8dde", "#d6569a"][keys.length % 6];
    CONVERSATIONS.unshift({ id: id, name: name, phone: phone, status: phone || "en ligne", unread: 0, days: [{ date: "Aujourd'hui", messages: [] }] });
    save(); renderChatList(); openConversation(id);
  });

  // ---------- Messages ----------
  function highlight(el, text, q) {
    if (!q) { el.textContent = text; return 0; }
    const lower = text.toLowerCase(), ql = q.toLowerCase();
    let i = 0, n = 0, pos;
    el.textContent = "";
    while ((pos = lower.indexOf(ql, i)) !== -1) {
      el.appendChild(document.createTextNode(text.slice(i, pos)));
      const mk = document.createElement("mark");
      mk.className = "hl";
      mk.textContent = text.slice(pos, pos + q.length);
      el.appendChild(mk);
      i = pos + q.length; n++;
    }
    el.appendChild(document.createTextNode(text.slice(i)));
    return n;
  }

  function renderMessages(conv) {
    stopAllAudio();
    messagesEl.innerHTML = "";
    conv.days.forEach(function (day, dayIndex) {
      const chip = document.createElement("span");
      chip.className = "date-chip";
      chip.textContent = day.date;
      messagesEl.appendChild(chip);
      if (dayIndex === 0 && !conv.live) {
        const notice = document.createElement("span");
        notice.className = "encryption-notice";
        notice.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm-3 8V6a3 3 0 0 1 6 0v3z"/></svg>Les messages sont chiffres de bout en bout (demonstration locale).';
        messagesEl.appendChild(notice);
      }
      day.messages.forEach(function (msg) { messagesEl.appendChild(buildBubble(msg, conv)); });
    });
    if (!allMessages(conv).length) {
      const e = document.createElement("div");
      e.className = "empty-state";
      e.textContent = "Aucun message. Dites bonjour 👋";
      messagesEl.appendChild(e);
    }
    scrollToBottom();
    if (!$("inchat-search").classList.contains("hidden")) runInChatSearch();
  }

  const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
  const CHECK_MENU = "⌄";

  function buildBubble(msg, conv) {
    const row = document.createElement("div");
    row.className = "msg-row " + msg.from;
    row.dataset.id = msg.id;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble" + (msg.type === "image" && !msg.deleted ? " has-img" : "");

    if (msg.deleted) {
      const t = document.createElement("span");
      t.className = "msg-deleted";
      t.textContent = "🚫 Ce message a ete supprime";
      bubble.appendChild(t);
    } else {
      if (msg.sender) {
        const sender = document.createElement("div");
        sender.style.cssText = "font-size:12.5px;font-weight:600;margin-bottom:2px;color:" + (msg.sj ? "hsl(" + wbHue(msg.sj) + ",65%,62%)" : "#e05656") + ";";
        sender.textContent = msg.sender;
        bubble.appendChild(sender);
      }
      if (msg.replyTo) {
        const ref = findMsg(conv, msg.replyTo);
        if (ref) {
          const qd = document.createElement("div");
          qd.className = "quote";
          qd.style.cursor = "pointer";
          const b = document.createElement("b");
          b.textContent = ref.from === "out" ? "Vous" : conv.name;
          qd.appendChild(b);
          qd.appendChild(document.createTextNode(ref.deleted ? "Message supprime" : previewOf(ref)));
          qd.addEventListener("click", function () { jumpTo(ref.id); });
          bubble.appendChild(qd);
        } else if (msg.q) {
          const qd = document.createElement("div");
          qd.className = "quote";
          const b = document.createElement("b");
          b.textContent = msg.q.mine ? "Vous" : conv.name;
          qd.appendChild(b);
          qd.appendChild(document.createTextNode(msg.q.text || "Message"));
          bubble.appendChild(qd);
        }
      }
      if (msg.type === "image") {
        const img = document.createElement("img");
        img.className = "msg-img";
        img.src = msg.src;
        img.alt = msg.text || "Image envoyee";
        img.addEventListener("click", function () { openViewer(msg.src); });
        bubble.appendChild(img);
        if (msg.text) {
          const cap = document.createElement("span");
          cap.className = "msg-caption";
          cap.textContent = msg.text;
          cap.dataset.search = "1";
          bubble.appendChild(cap);
        }
      } else if (msg.type === "voice" || msg.type === "audio") {
        bubble.appendChild(buildVoice(msg));
      } else if (msg.type === "video") {
        const v = document.createElement("video");
        v.className = "msg-img"; v.controls = true; v.preload = "metadata"; v.src = msg.src; if (msg.thumb) v.poster = msg.thumb;
        bubble.appendChild(v); bubble.classList.add("has-img");
        if (msg.text) { const cap = document.createElement("span"); cap.className = "msg-caption"; cap.textContent = msg.text; cap.dataset.search = "1"; bubble.appendChild(cap); }
      } else if (msg.loc) {
        const a = document.createElement("a"); a.className = "loc-card"; a.target = "_blank"; a.rel = "noopener";
        a.href = "https://www.openstreetmap.org/?mlat=" + msg.loc.lat + "&mlon=" + msg.loc.lng + "#map=16/" + msg.loc.lat + "/" + msg.loc.lng;
        const ic = document.createElement("span"); ic.textContent = "📍"; ic.style.fontSize = "26px";
        const tx = document.createElement("div"); const b = document.createElement("b"); b.textContent = msg.loc.name || "Position"; const sm = document.createElement("small"); sm.textContent = msg.loc.lat.toFixed(5) + ", " + msg.loc.lng.toFixed(5) + " · ouvrir la carte";
        tx.appendChild(b); tx.appendChild(sm); a.appendChild(ic); a.appendChild(tx); bubble.appendChild(a);
      } else if (msg.type === "sticker") {
        const img = document.createElement("img");
        img.className = "msg-sticker"; img.src = msg.src; img.alt = "sticker";
        bubble.appendChild(img);
      } else if (msg.type === "document") {
        const d = document.createElement("div"); d.className = "doc-card";
        const ic = document.createElement("span"); ic.className = "doc-ic"; ic.textContent = "📄";
        const tx = document.createElement("div"); tx.className = "doc-tx";
        const nm = document.createElement("b"); nm.textContent = msg.name || "Document";
        const sz = document.createElement("small"); sz.textContent = msg.size ? Math.max(1, Math.round(msg.size / 1024)) + " Ko" : "";
        tx.appendChild(nm); tx.appendChild(sz);
        d.appendChild(ic); d.appendChild(tx);
        if (msg.src) { const a = document.createElement("a"); a.href = msg.src; a.download = msg.name || "fichier"; a.textContent = "Enregistrer"; a.className = "doc-dl"; d.appendChild(a); }
        bubble.appendChild(d);
        if (msg.text) { const cap = document.createElement("span"); cap.className = "msg-caption"; cap.textContent = msg.text; cap.dataset.search = "1"; bubble.appendChild(cap); }
      } else {
        const text = document.createElement("span");
        text.className = "msg-text";
        text.dataset.search = "1";
        text.textContent = msg.text;
        bubble.appendChild(text);
      }
    }

    const meta = document.createElement("span");
    meta.className = "msg-meta";
    meta.innerHTML = "<span>" + (msg.star ? "★ " : "") + (msg.edited ? "modifie · " : "") + msg.time + "</span>" + (msg.from === "out" ? (msg.state === "failed" ? '<span class="failed" title="' + (msg.error || "Echec").replace(/"/g, "") + '">⚠ non envoye</span>' : ticksSvg(msg.state)) : "");
    bubble.appendChild(meta);

    const allR = (msg.others || []).concat(msg.reaction ? [msg.reaction] : []);
    if (!msg.deleted && allR.length) {
      const rb = document.createElement("span");
      rb.className = "reaction-badge";
      const uniq = allR.filter(function (x, k) { return allR.indexOf(x) === k; });
      rb.textContent = uniq.join("") + (allR.length > 1 ? " " + allR.length : "");
      if (msg.reaction) rb.title = "Retirer ma reaction";
      rb.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!msg.reaction) return;
        if (conv.wb) return wbReact(conv, msg, "");
        msg.reaction = null; save(); renderMessages(conv);
      });
      bubble.appendChild(rb);
      bubble.classList.add("has-reaction");
    }

    if (!msg.deleted) {
      const mb = document.createElement("button");
      mb.className = "msg-menu-btn";
      mb.textContent = CHECK_MENU;
      mb.setAttribute("aria-label", "Options du message");
      mb.addEventListener("click", function (e) { e.stopPropagation(); openMsgMenu(mb, msg, conv); });
      bubble.appendChild(mb);
    }
    row.appendChild(bubble);
    return row;
  }

  // ---------- Menu d'un message ----------
  let msgMenuEl = null;
  function closeMsgMenu() { if (msgMenuEl) { msgMenuEl.remove(); msgMenuEl = null; } }
  document.addEventListener("click", closeMsgMenu);
  function openMsgMenu(btn, msg, conv) {
    closeMsgMenu();
    const m = document.createElement("div");
    m.className = "dropdown";
    const r = btn.getBoundingClientRect();
    m.style.cssText = "position:fixed;min-width:200px;top:" + Math.min(r.bottom + 4, window.innerHeight - 220) + "px;left:" + Math.max(8, r.right - 200) + "px;";
    const rr = document.createElement("div");
    rr.className = "react-row";
    ["👍","❤️","😂","😮","😢","🙏"].forEach(function (em) {
      const b = document.createElement("button");
      b.textContent = em;
      if (msg.reaction === em) b.className = "sel";
      b.addEventListener("click", function () {
        closeMsgMenu();
        if (conv.wb) return wbReact(conv, msg, msg.reaction === em ? "" : em);
        msg.reaction = msg.reaction === em ? null : em;
        playSound("react"); save(); renderMessages(conv);
      });
      rr.appendChild(b);
    });
    m.appendChild(rr);
    function item(label, fn, cls) {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener("click", function () { closeMsgMenu(); fn(); });
      m.appendChild(b);
    }
    item("Repondre", function () { setReply(msg, conv); });
    if (conv.wb) {
      item("Transferer", function () { wbForwardPick(conv, msg); });
      item(msg.star ? "Retirer des favoris" : "Ajouter aux favoris", function () { msg.star = !msg.star; renderMessages(conv); wbApi("star", { jid: conv.jid, id: wbRid(msg), on: !!msg.star }); });
      if (msg.from === "out" && msg.type === "text" && Date.now() / 1000 - msg.ts < 900) item("Modifier", function () {
        askText("Modifier le message", "", msg.text).then(function (v) {
          if (v === null || !v.trim()) return;
          wbApi("edit", { jid: conv.jid, id: wbRid(msg), text: v }).then(function (r) { if (!r || !r.ok) toast((r && r.error) || "Modification impossible"); });
        });
      });
    }
    if (msg.type === "text") item("Copier", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(msg.text).then(function () { toast("Copie"); });
    });
    if (conv.wb) {
      item("Supprimer pour moi", function () {
        conv.days.forEach(function (d) { d.messages = d.messages.filter(function (x) { return x.id !== msg.id; }); });
        renderMessages(conv); renderChatList();
        wbApi("delete-me", { jid: conv.jid, id: wbRid(msg) });
      }, "danger");
      if (msg.from === "out") item("Supprimer pour tous", function () {
        if (!confirm("Supprimer ce message pour tout le monde ?")) return;
        wbApi("delete", { jid: conv.jid, id: wbRid(msg) }).then(function (r) { if (!r || !r.ok) toast((r && r.error) || "Suppression impossible"); });
      }, "danger");
    }
    if (!conv.wb) item("Supprimer", function () { msg.deleted = true; if (msg.srvId) liveApi("delete.php", { id: msg.srvId }); save(); renderMessages(conv); renderChatList(); }, "danger");
    document.body.appendChild(m);
    msgMenuEl = m;
  }

  function jumpTo(id) {
    const row = messagesEl.querySelector('[data-id="' + id + '"]');
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.classList.remove("flash");
    void row.offsetWidth;
    row.classList.add("flash");
  }

  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  // ---------- Reponse a un message ----------
  function setReply(msg, conv) {
    replyTo = msg.id;
    const q = $("reply-quote");
    q.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = msg.from === "out" ? "Vous" : conv.name;
    q.appendChild(b);
    q.appendChild(document.createTextNode(previewOf(msg)));
    $("reply-bar").classList.remove("hidden");
    messageInput.focus();
  }
  function clearReply() { replyTo = null; $("reply-bar").classList.add("hidden"); }
  $("reply-cancel").addEventListener("click", clearReply);

  // ---------- Navigation ----------
  function openConversation(id) {
    const conv = getConv(id);
    if (!conv) return;
    activeId = id;
    conv.unread = 0;
    clearReply();
    closeInChatSearch();
    cancelRecording();
    welcomeEl.classList.add("hidden");
    chatAreaEl.classList.add("open");
    chatAvatarEl.textContent = initials(conv.name);
    chatAvatarEl.style.background = avatarColor(conv.id);
    chatTitleEl.textContent = conv.name;
    chatStatusEl.textContent = conv.phone || conv.status;
    paintAvatar(chatAvatarEl, conv);
    if (conv.wb) wbPaintStatus(conv);
    renderMessages(conv);
    if (conv.wb) wbLoad(conv);
    save();
    renderChatList();
    messageInput.focus();
  }
  function closeChat() {
    chatAreaEl.classList.remove("open");
    welcomeEl.classList.remove("hidden");
    activeId = null;
    stopAllAudio();
  }
  backBtn.addEventListener("click", function () { chatAreaEl.classList.remove("open"); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeViewer(); closeMsgMenu(); closeMenus(); if (sv) closeStoryViewer(); closeComposer();
      if (!$("inchat-search").classList.contains("hidden")) closeInChatSearch();
    }
  });

  // ---------- Envoi ----------
  function pushMessage(conv, msg) {
    if (conv.wb) {
      const q = replyTo ? String(replyTo).replace(/^w/, "") : undefined; clearReply();
      if (msg.type === "text") return wbSend(conv, msg.text, q);
      if (msg.type === "image") {
        const mm = /^data:([^;]+);base64,(.*)$/.exec(msg.src || "");
        if (!mm) return toast("Image illisible");
        return wbSendMedia(conv, { kind: "image", mime: mm[1], data: mm[2], caption: msg.text || "", quotedId: q });
      }
      if (msg.type === "voice") return toast("L'envoi de messages vocaux n'est pas encore disponible (les messages vocaux recus fonctionnent).");
      return toast("Type de message non gere");
    }
    if (conv.live) {
      if (msg.type !== "text") return toast("WhatsApp : seuls les messages texte sont geres pour l'instant");
      return liveSend(conv, msg.text, false);
    }
    msg.id = "m" + Date.now().toString(36) + (uid++);
    msg.from = "out";
    msg.time = nowTime();
    msg.state = "delivered";
    if (replyTo) { msg.replyTo = replyTo; clearReply(); }
    conv.days[conv.days.length - 1].messages.push(msg);
    save();
    renderMessages(conv);
    renderChatList();
    scrollToBottom();
    playSound("send");
    simulateReply(conv);
  }

  function sendText() {
    const text = messageInput.value.trim();
    if (!text || !activeId) return;
    messageInput.value = "";
    updateSendIcon();
    pushMessage(getConv(activeId), { type: "text", text: text });
  }

  function simulateReply(conv) {
    typingAvatarEl.textContent = initials(conv.name);
    typingAvatarEl.style.background = avatarColor(conv.id);
    typingEl.classList.remove("hidden");
    chatStatusEl.textContent = "ecrit...";
    scrollToBottom();
    setTimeout(function () {
      typingEl.classList.add("hidden");
      chatStatusEl.textContent = conv.phone || conv.status;
      // Les messages envoyes passent en "lu"
      allMessages(conv).forEach(function (m) { if (m.from === "out") m.state = "read"; });
      const reply = {
        id: "m" + Date.now().toString(36) + (uid++),
        type: "text", from: "in",
        text: conv.id === "a0" ? INSTINCT_REPLY : AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)],
        time: nowTime(),
      };
      conv.days[conv.days.length - 1].messages.push(reply);
      if (activeId !== conv.id) conv.unread += 1;
      notifyIncoming(conv, reply.text);
      save();
      if (activeId === conv.id) { renderMessages(conv); scrollToBottom(); }
      renderChatList();
    }, 1400);
  }

  function updateSendIcon() {
    const hasText = messageInput.value.trim().length > 0;
    sendBtn.querySelector(".icon-mic").classList.toggle("hidden", hasText || recording);
    sendBtn.querySelector(".icon-send").classList.toggle("hidden", !(hasText || recording));
  }
  messageInput.addEventListener("input", updateSendIcon);
  messageInput.addEventListener("keydown", function (e) { if (e.key === "Enter") sendText(); });
  sendBtn.addEventListener("click", function () {
    if (recording) return finishRecording(true);
    if (messageInput.value.trim()) return sendText();
    startRecording();
  });

  // ---------- Emojis ----------
  (function () {
    const panel = $("emoji-panel");
    EMOJIS.forEach(function (em) {
      const b = document.createElement("button");
      b.textContent = em;
      b.addEventListener("click", function () {
        messageInput.value += em;
        updateSendIcon();
        messageInput.focus();
      });
      panel.appendChild(b);
    });
    $("emoji-btn").addEventListener("click", function () { panel.classList.toggle("hidden"); });
  })();

  // ---------- Images ----------
  function openViewer(src) {
    $("overlay-img").src = src;
    $("overlay-row").classList.add("hidden");
    $("img-overlay").classList.remove("hidden");
  }
  function closeViewer() { $("img-overlay").classList.add("hidden"); pendingImage = null; }
  $("overlay-close").addEventListener("click", closeViewer);
  $("img-overlay").addEventListener("click", function (e) { if (e.target === this) closeViewer(); });

  function prepareImage(file) {
    if (!activeId) return toast("Ouvrez d'abord une discussion");
    if (!file) return;
    if (!file.type.startsWith("image/")) return sendFile(file);
    if (file.size > 16 * 1024 * 1024) return toast("Image trop lourde (16 Mo max)");
    const reader = new FileReader();
    reader.onload = function () {
      pendingImage = reader.result;
      $("overlay-img").src = pendingImage;
      $("overlay-caption").value = "";
      $("overlay-row").classList.remove("hidden");
      $("img-overlay").classList.remove("hidden");
      $("overlay-caption").focus();
    };
    reader.readAsDataURL(file);
  }
  function sendPendingImage() {
    if (!pendingImage || !activeId) return;
    const src = pendingImage, cap = $("overlay-caption").value.trim();
    $("img-overlay").classList.add("hidden");
    pendingImage = null;
    pushMessage(getConv(activeId), { type: "image", src: src, text: cap });
  }
  $("attach-btn").addEventListener("click", function () { $("file-input").click(); });
  function sendFile(file) {
    const conv = getConv(activeId);
    if (!conv || !conv.wb) return toast("Ce fichier n'est pas une image (l'envoi de fichiers marche avec WhatsApp Web)");
    if (file.size > 30 * 1024 * 1024) return toast("Fichier trop lourd (30 Mo max)");
    const reader = new FileReader();
    reader.onload = function () {
      const mm = /^data:([^;]*);base64,(.*)$/.exec(reader.result || "");
      if (!mm) return toast("Fichier illisible");
      const mime = file.type || "application/octet-stream";
      const kind = mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "document";
      const q = replyTo ? String(replyTo).replace(/^w/, "") : undefined; clearReply();
      toast("Envoi de " + file.name + "...");
      wbSendMedia(conv, { kind: kind, mime: mime, name: file.name, data: mm[2], quotedId: q });
    };
    reader.readAsDataURL(file);
  }
  $("file-input").addEventListener("change", function () {
    if (this.files[0]) prepareImage(this.files[0]);
    this.value = "";
  });
  $("overlay-send").addEventListener("click", sendPendingImage);
  $("overlay-caption").addEventListener("keydown", function (e) { if (e.key === "Enter") sendPendingImage(); });
  messageInput.addEventListener("paste", function (e) {
    const items = (e.clipboardData || {}).items || [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file") { e.preventDefault(); prepareImage(items[i].getAsFile()); return; }
    }
  });
  chatAreaEl.addEventListener("dragover", function (e) { e.preventDefault(); chatAreaEl.classList.add("drop-hint"); });
  chatAreaEl.addEventListener("dragleave", function () { chatAreaEl.classList.remove("drop-hint"); });
  chatAreaEl.addEventListener("drop", function (e) {
    e.preventDefault();
    chatAreaEl.classList.remove("drop-hint");
    if (e.dataTransfer.files[0]) prepareImage(e.dataTransfer.files[0]);
  });

  // ---------- Messages vocaux ----------
  let recording = false, recorder = null, recStream = null, recChunks = [], recStart = 0, recTimer = null, recCancelled = false;

  function startRecording() {
    if (!activeId) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) return toast("Enregistrement non supporte par ce navigateur");
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recStream = stream;
      recChunks = [];
      recCancelled = false;
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = function (e) { if (e.data.size) recChunks.push(e.data); };
      recorder.onstop = onRecorderStop;
      recorder.start();
      recording = true;
      recStart = Date.now();
      composerEl.classList.add("is-recording");
      $("recording-bar").classList.remove("hidden");
      sendBtn.classList.add("recording");
      $("rec-time").textContent = "0:00";
      recTimer = setInterval(function () { $("rec-time").textContent = fmtDur((Date.now() - recStart) / 1000); }, 250);
      updateSendIcon();
    }).catch(function () { toast("Micro indisponible ou acces refuse"); });
  }
  function resetRecordingUi() {
    recording = false;
    clearInterval(recTimer);
    composerEl.classList.remove("is-recording");
    $("recording-bar").classList.add("hidden");
    sendBtn.classList.remove("recording");
    updateSendIcon();
  }
  function finishRecording(send) {
    if (!recorder) return;
    recCancelled = !send;
    const dur = (Date.now() - recStart) / 1000;
    recorder._dur = dur;
    resetRecordingUi();
    try { recorder.stop(); } catch (e) {}
    if (recStream) recStream.getTracks().forEach(function (t) { t.stop(); });
  }
  function cancelRecording() { if (recording) finishRecording(false); }
  function onRecorderStop() {
    const dur = recorder._dur || 1;
    if (recCancelled || !activeId || dur < 0.6) { if (!recCancelled) toast("Message vocal trop court"); return; }
    const blob = new Blob(recChunks, { type: recorder.mimeType || "audio/webm" });
    const vconv = getConv(activeId);
    if (vconv && vconv.wb) {
      const rd = new FileReader();
      rd.onload = function () {
        const mm = /^data:([^;,]+)[^,]*;base64,(.*)$/.exec(String(rd.result));
        if (!mm) { toast("Vocal illisible"); return; }
        wbSendMedia(vconv, { kind: "voice", mime: blob.type || mm[1], data: mm[2] });
      };
      rd.readAsDataURL(blob);
      return;
    }
    pushMessage(vconv, { type: "voice", src: URL.createObjectURL(blob), duration: dur });
  }
  $("rec-cancel").addEventListener("click", function () { finishRecording(false); });

  let audios = [];
  function stopAllAudio() { audios.forEach(function (a) { a.pause(); }); audios = []; }

  function buildVoice(msg) {
    const wrap = document.createElement("div");
    wrap.className = "voice";
    const btn = document.createElement("button");
    btn.className = "voice-play";
    btn.innerHTML = PLAY;
    btn.setAttribute("aria-label", "Lire le message vocal");
    const wave = document.createElement("div");
    wave.className = "voice-wave";
    const bars = [];
    let seed = 0;
    for (let i = 0; i < msg.id.length; i++) seed = (seed * 31 + msg.id.charCodeAt(i)) % 9973;
    for (let i = 0; i < 28; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const b = document.createElement("i");
      b.style.height = (5 + Math.round((seed / 233280) * 22)) + "px";
      wave.appendChild(b); bars.push(b);
    }
    const time = document.createElement("span");
    time.className = "voice-time";
    time.textContent = fmtDur(msg.duration);

    const audio = new Audio(msg.src);
    audio.preload = "metadata";
    function paint() {
      const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : msg.duration;
      const n = Math.round((audio.currentTime / dur) * bars.length);
      bars.forEach(function (b, i) { b.classList.toggle("done", i < n); });
      time.textContent = fmtDur(audio.paused && audio.currentTime === 0 ? msg.duration : audio.currentTime);
    }
    audio.addEventListener("timeupdate", paint);
    audio.addEventListener("ended", function () { audio.currentTime = 0; btn.innerHTML = PLAY; paint(); });
    audio.addEventListener("pause", function () { btn.innerHTML = PLAY; });
    audio.addEventListener("play", function () { btn.innerHTML = PAUSE; });
    btn.addEventListener("click", function () {
      if (audio.paused) {
        audios.forEach(function (a) { if (a !== audio) a.pause(); });
        if (audios.indexOf(audio) < 0) audios.push(audio);
        audio.play().catch(function () { toast("Lecture impossible"); });
      } else audio.pause();
    });
    wave.addEventListener("click", function (e) {
      const r = wave.getBoundingClientRect();
      const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : msg.duration;
      audio.currentTime = ((e.clientX - r.left) / r.width) * dur;
      paint();
    });
    wrap.appendChild(btn); wrap.appendChild(wave); wrap.appendChild(time);
    return wrap;
  }

  // ---------- Recherche dans la discussion ----------
  let hits = [], hitIdx = -1;
  function runInChatSearch() {
    const q = $("inchat-input").value.trim();
    messagesEl.querySelectorAll("[data-search]").forEach(function (el) {
      const id = el.closest(".msg-row").dataset.id;
      const m = findMsg(getConv(activeId), id);
      if (m) highlight(el, m.text, q);
    });
    hits = Array.prototype.slice.call(messagesEl.querySelectorAll("mark.hl"));
    hitIdx = hits.length ? hits.length - 1 : -1;
    paintHit();
  }
  function paintHit() {
    hits.forEach(function (h, i) { h.classList.toggle("current", i === hitIdx); });
    $("inchat-count").textContent = $("inchat-input").value.trim()
      ? (hits.length ? (hitIdx + 1) + "/" + hits.length : "0 resultat") : "";
    if (hits[hitIdx]) hits[hitIdx].scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function stepHit(d) {
    if (!hits.length) return;
    hitIdx = (hitIdx + d + hits.length) % hits.length;
    paintHit();
  }
  function closeInChatSearch() {
    $("inchat-search").classList.add("hidden");
    $("inchat-input").value = "";
    hits = []; hitIdx = -1;
    if (activeId) renderMessages(getConv(activeId));
  }
  $("inchat-search-btn").addEventListener("click", function () {
    if (!activeId) return;
    $("inchat-search").classList.remove("hidden");
    $("inchat-input").focus();
  });
  $("inchat-input").addEventListener("input", runInChatSearch);
  $("inchat-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") stepHit(e.shiftKey ? 1 : -1);
  });
  $("inchat-prev").addEventListener("click", function () { stepHit(-1); });
  $("inchat-next").addEventListener("click", function () { stepHit(1); });
  $("inchat-close").addEventListener("click", closeInChatSearch);

  // ---------- Mode WhatsApp reel (serveur PHP local) ----------
  // Actif seulement si la page est servie par XAMPP (http://localhost/pingchat/)
  // et que server/config.php est rempli. Sinon l'application reste en mode demo.
  const live = { on: false, lastId: 0, first: true, country: "212", timer: null, busy: false };
  function normPhone(p) {
    const raw = String(p || "");
    let d = raw.replace(/\D+/g, "");
    if (!d) return "";
    if (raw.indexOf("+") === -1) {
      if (d.indexOf("00") === 0) d = d.slice(2);
      else if (d.charAt(0) === "0") d = live.country + d.slice(1);
    }
    return d;
  }
  function liveApi(path, body) {
    if (!live.on && path !== "status.php") return Promise.resolve(null);
    const opt = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
    return fetch("server/api/" + path, opt).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); })
      .catch(function () { return { ok: false, error: "network", message: "Serveur local injoignable (XAMPP demarre ?)" }; });
  }
  function makeLiveConv(phone, name) {
    const id = "w" + phone;
    AVATAR_COLORS[id] = "#ffb547";
    return { id: id, live: true, name: name || ("+" + phone), phone: "+" + phone, status: "+" + phone, unread: 0, days: [{ date: "Aujourd'hui", messages: [] }] };
  }
  function dayLabel(ts) {
    const d = new Date(ts * 1000), n = new Date();
    if (d.toDateString() === n.toDateString()) return "Aujourd'hui";
    const y = new Date(); y.setDate(n.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Hier";
    return d.toLocaleDateString("fr-FR");
  }
  function hhmm(ts) { const d = new Date(ts * 1000); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function mapState(s) { return s === "read" ? "read" : s === "failed" ? "failed" : "delivered"; }

  function syncLive() {
    if (!live.on || live.busy) return;
    live.busy = true;
    liveApi("messages.php?since=" + live.lastId).then(function (res) {
      live.busy = false;
      if (!res || !res.ok) return;
      let changed = false;
      (res.messages || []).forEach(function (m) {
        live.lastId = Math.max(live.lastId, m.id);
        let conv = getConv("w" + m.phone);
        if (!conv) { conv = makeLiveConv(m.phone, (res.names || {})[m.phone]); CONVERSATIONS.unshift(conv); }
        if (findMsg(conv, "srv" + m.id)) return;
        let day = conv.days.find(function (d) { return d.date === dayLabel(m.ts); });
        if (!day) { day = { date: dayLabel(m.ts), messages: [] }; conv.days.push(day); }
        day.messages.push({ id: "srv" + m.id, srvId: m.id, type: "text", from: m.direction === "in" ? "in" : "out",
          text: m.body, time: hhmm(m.ts), state: mapState(m.status), error: m.error || "" });
        changed = true;
        if (m.direction === "in" && !live.first) {
          if (activeId !== conv.id) conv.unread = (conv.unread || 0) + 1;
          notifyIncoming(conv, m.body);
        } else if (m.direction === "in" && live.first && m.ts * 1000 > Date.now() - 3600000 && activeId !== conv.id) {
          conv.unread = (conv.unread || 0) + 1;
        }
      });
      // noms des contacts + statuts (envoye / lu / echec)
      CONVERSATIONS.forEach(function (c) {
        if (c.live && res.names && res.names[c.phone.slice(1)] && c.name === c.phone) { c.name = res.names[c.phone.slice(1)]; changed = true; }
      });
      (res.statuses || []).forEach(function (s) {
        CONVERSATIONS.forEach(function (c) {
          if (!c.live) return;
          const m = findMsg(c, "srv" + s.id);
          const ns = mapState(s.status);
          if (m && (m.state !== ns || m.error !== (s.error || m.error))) { m.state = ns; if (s.error) m.error = s.error; changed = true; }
        });
      });
      live.first = false;
      if (changed) {
        renderChatList();
        if (activeId) { const c = getConv(activeId); if (c && c.live) { renderMessages(c); } }
      }
    });
  }

  function liveSend(conv, text, template) {
    return liveApi("send.php", template ? { to: conv.phone, template: true } : { to: conv.phone, text: text }).then(function (res) {
      if (res && res.ok) { playSound("send"); syncLive(); return; }
      if (res && res.error === "window_closed") {
        if (confirm("Fenetre WhatsApp de 24 h fermee pour ce contact.\nEnvoyer le modele d'ouverture (hello_world) a la place ?")) return liveSend(conv, text, true);
        return;
      }
      toast("WhatsApp : " + ((res && (res.message || res.error)) || "echec"));
    });
  }

  function startLive() {
    liveApi("status.php").then(function (s) {
      if (!s || !s.ok) return; // pas de serveur : mode demo
      live.on = true; live.country = s.default_country || "212";
      if (!s.configured) toast("Serveur detecte, mais server/config.php n'est pas rempli");
      else toast("Connecte a WhatsApp ✔");
      syncLive();
      live.timer = setInterval(function () { if (!document.hidden || live.first) syncLive(); }, 3000);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) syncLive(); });
    });
  }

  // ---------- Mode WhatsApp Web (pont Node non officiel, bridge/) ----------
  const wb = { on: false, es: null, status: "starting", acc: null, accounts: [], av: {}, avMiss: {}, hits: {}, jump: null, settings: { readReceipts: true, typing: true } };
  function wbApi(path, body) {
    const q = (path.indexOf("?") < 0 ? "?" : "&") + "acc=" + encodeURIComponent(wb.acc || "");
    const opt = body ? { method: "POST", headers: { "Content-Type": "application/json", "X-PingChat": "1" }, body: JSON.stringify(Object.assign({ acc: wb.acc }, body)) } : {};
    return fetch("api/" + path + (body ? "" : q), opt).then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: "Pont injoignable (l'application est-elle ouverte ?)" }; });
  }
  function accName(a, idx) {
    if (!a) return "Compte";
    return a.label || (a.me && a.me.name) || a.phone || ("Compte " + ((idx >= 0 ? idx : 0) + 1));
  }
  function accById(id) { return wb.accounts.find(function (a) { return a.id === id; }); }
  function accNameById(id) { const k = wb.accounts.findIndex(function (a) { return a.id === id; }); return accName(wb.accounts[k], k); }
  function wbColor(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return "hsl(" + h + ",45%,45%)"; }
  function wbMakeConv(c) {
    const id = "x" + c.jid;
    AVATAR_COLORS[id] = wbColor(c.jid);
    return { id: id, wb: true, live: true, jid: c.jid, name: c.name || c.phone || c.jid.split("@")[0], phone: c.phone || "", status: c.group ? "groupe" : (c.phone || ""),
      unread: c.unread || 0, ts: c.ts || 0, preview: c.last || "", timeLabel: c.ts ? hhmm(c.ts) : "", loaded: false, pinned: !!c.pinned, archived: !!c.archived, muted: !!c.muted, tags: c.tags || [], days: [{ date: "Aujourd'hui", messages: [] }] };
  }
  function wbRefreshChats() {
    return wbApi("chats").then(function (r) {
      if (!r || !r.ok) return;
      const known = {};
      r.chats.forEach(function (c) { known["x" + c.jid] = true; });
      for (let i = CONVERSATIONS.length - 1; i >= 0; i--) {
        const c = CONVERSATIONS[i];
        if (c.wb && !known[c.id] && !c.localNew) {
          if (activeId === c.id) { activeId = null; closeChat(); }
          CONVERSATIONS.splice(i, 1);
        }
      }
      r.chats.forEach(function (c) {
        const ex = getConv("x" + c.jid);
        if (!ex) { CONVERSATIONS.push(wbMakeConv(c)); return; }
        ex.name = c.name || ex.name; ex.unread = activeId === ex.id ? 0 : c.unread; ex.ts = c.ts; ex.preview = c.last; ex.timeLabel = c.ts ? hhmm(c.ts) : "";
        ex.pinned = !!c.pinned; ex.archived = !!c.archived; ex.muted = !!c.muted; ex.tags = c.tags || [];
      });
      renderChatList(); wbLoadStatuses(); wbLoadPro();
    });
  }
  function wbSetReactions(o, r) {
    o.reaction = (r && r.me) || null;
    o.others = r ? Object.keys(r).filter(function (k) { return k !== "me"; }).map(function (k) { return r[k]; }) : [];
  }
  function wbToMsg(m) {
    const o = { id: "w" + m.id, type: "text", from: m.fromMe ? "out" : "in", text: m.text, time: hhmm(m.ts), ts: m.ts, state: mapState(m.status), sender: m.sender };
    if (m.deleted) o.deleted = true;
    if (m.edited) o.edited = true;
    if (m.star) o.star = true;
    if (m.sj) o.sj = m.sj;
    if (m.loc) o.loc = m.loc;
    if (m.type === "call") o.type = "call";
    else if (m.type && m.media) {
      const f = m.media.file ? "api/media?acc=" + encodeURIComponent(wb.acc) + "&f=" + encodeURIComponent(m.media.file) : "";
      o.type = m.type; o.text = m.caption || ""; o.name = m.media.name; o.size = m.media.size; o.duration = m.media.dur; o.thumb = m.media.thumb;
      o.src = f || ((m.type === "image" || m.type === "sticker") ? m.media.thumb : "");
      if (!o.src && m.type !== "document") { o.type = "text"; o.text = m.text + " (non telecharge)"; }
    }
    if (m.q) { o.replyTo = "w" + m.q.id; o.q = m.q; }
    if (m.reactions) wbSetReactions(o, m.reactions);
    return o;
  }
  function wbReact(conv, msg, emoji) {
    msg.reaction = emoji || null; renderMessages(conv); playSound("react");
    wbApi("react", { jid: conv.jid, id: String(msg.id).replace(/^w/, ""), emoji: emoji }).then(function (r) {
      if (!r || !r.ok) toast("Reaction non envoyee : " + ((r && r.error) || "echec"));
    });
  }
  function applyBrand() {
    const b = (wb.pro && wb.pro.brand) || {}; const st = document.documentElement.style;
    if (b.color) st.setProperty("--accent", b.color); else st.removeProperty("--accent");
  }
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, ""); const first = text.split(/\r?\n/)[0] || ""; const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : (first.indexOf("\t") >= 0 ? "\t" : ",");
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) { const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(function (x) { return x.trim(); })) rows.push(row); row = []; } else cur += ch; }
    row.push(cur); if (row.some(function (x) { return x.trim(); })) rows.push(row); return rows;
  }
  function csvToPatients(rows) {
    const norm = function (x) { return String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, ""); };
    const H = rows[0].map(norm); const find = function (names) { for (let i = 0; i < H.length; i++) if (names.indexOf(H[i]) >= 0) return i; return -1; };
    const ci = { name: find(["nom", "name", "patient", "nomprenom", "nomcomplet"]), phone: find(["telephone", "tel", "phone", "numero", "gsm", "mobile", "whatsapp"]), label: find(["etiquette", "label", "tag", "categorie"]), at: find(["rdv", "rendezvous", "date", "daterdv", "datetime"]), note: find(["motif", "note", "remarque"]) };
    if (ci.phone < 0) return { error: "Colonne telephone introuvable (titres reconnus : telephone, tel, phone, numero, gsm, mobile)." };
    const out = rows.slice(1).map(function (r) { const g = function (i) { return i >= 0 ? (r[i] || "").trim() : ""; }; let at = 0; const d = g(ci.at); if (d) { let m = /^(\d{4})-(\d{2})-(\d{2})[ T]?(\d{1,2})?:?(\d{2})?/.exec(d) || null; let dt = null; if (m) dt = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 9), +(m[5] || 0)); else { m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})[ T]?(\d{1,2})?:?(\d{2})?/.exec(d); if (m) dt = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 9), +(m[5] || 0)); } if (dt && !isNaN(dt)) at = dt.getTime(); } return { name: g(ci.name), phone: g(ci.phone), label: g(ci.label), at: at, note: g(ci.note) }; });
    return { rows: out, cols: ci };
  }
  function csvPreview(text, out) {
    out.innerHTML = ""; const rows = parseCSV(text); if (rows.length < 2) { out.appendChild(el("p", "pro-note", "Fichier vide ou une seule ligne.")); return; }
    const r = csvToPatients(rows); if (r.error) { out.appendChild(el("p", "pro-note", r.error)); return; }
    const nAt = r.rows.filter(function (x) { return x.at > Date.now(); }).length;
    out.appendChild(el("p", "pro-note", r.rows.length + " ligne(s) lues dont " + nAt + " rendez-vous a venir. Apercu des 5 premieres :"));
    r.rows.slice(0, 5).forEach(function (x) { const row = el("div", "pro-item"); const tx = el("div"); tx.appendChild(el("b", "", (x.name || "(sans nom)") + " · " + x.phone)); tx.appendChild(el("small", "", (x.label ? "Etiquette : " + x.label + " · " : "") + (x.at ? "RDV : " + when(x.at) : ""))); row.appendChild(tx); out.appendChild(row); });
    const go = el("button", "btn", "Importer " + r.rows.length + " patient(s)"); go.onclick = function () { if (!confirm("Importer " + r.rows.length + " ligne(s) dans le compte " + accNameById(wb.acc) + " ?\n\nAucun message n'est envoye. Les rappels de rendez-vous partiront automatiquement a l'heure prevue (si PingChat est ouvert).")) return; go.disabled = true; wbApi("import", { rows: r.rows }).then(function (x) { go.disabled = false; if (!x || !x.ok) return toast("Echec : " + ((x && x.error) || "")); const R = x.result; out.innerHTML = ""; out.appendChild(el("p", "pro-note", R.added + " patient(s) importes, " + R.names + " nom(s), " + R.tagged + " etiquette(s), " + R.appts + " rendez-vous." + (R.skipped.length ? " Ignores : " + R.skipped.slice(0, 8).map(function (s) { return "ligne " + s.line + " (" + s.why + ")"; }).join(", ") + (R.skipped.length > 8 ? "..." : "") : ""))); wbLoadPro(); wbRefreshChats(); }); }; out.appendChild(go);
  }
  function wbExportChat(conv) {
    if (!conv.wb) return toast("Export disponible avec WhatsApp Web");
    if (!confirm("Exporter cette discussion en fichier HTML imprimable (a ouvrir puis Ctrl+P > Enregistrer au format PDF) ?\n\nLe fichier contient des donnees patient en clair : garde-le sur un support que tu controles.")) return;
    const esc = function (x) { return String(x == null ? "" : x).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); };
    wbApi("messages?jid=" + encodeURIComponent(conv.jid)).then(function (r) {
      const list = (r && (r.messages || r.items)) || [];
      if (!list.length) return toast("Rien a exporter");
      let h = "<!doctype html><meta charset=utf-8><title>" + esc(conv.name) + "</title><style>body{font:14px Arial,sans-serif;max-width:700px;margin:20px auto}h1{font-size:20px}.m{margin:6px 0;padding:6px 10px;border-radius:8px;background:#eee;page-break-inside:avoid}.me{background:#dcf8c6;margin-left:60px}.t{color:#666;font-size:11px}</style>" + ((wb.pro && wb.pro.brand && wb.pro.brand.logo) ? "<img src='" + wb.pro.brand.logo + "' height=48>" : "") + "<h1>" + esc((wb.pro && wb.pro.brand && wb.pro.brand.name) ? wb.pro.brand.name + " : " : "") + "Discussion avec " + esc(conv.name) + "</h1><p class=t>Exportee le " + esc(new Date().toLocaleString("fr-FR")) + " depuis PingChat. Document confidentiel.</p>";
      list.forEach(function (m) { const ts = m.ts ? new Date(m.ts * 1000).toLocaleString("fr-FR") : ""; const body = m.text || m.caption || (m.type ? "[" + m.type + "]" : "") || (m.media ? "[" + (m.media.name || "media") + "]" : ""); h += "<div class='m" + (m.fromMe ? " me" : "") + "'><div class=t>" + esc(m.fromMe ? "Moi" : conv.name) + " · " + esc(ts) + "</div>" + esc(body).replace(/\n/g, "<br>") + "</div>"; });
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([h], { type: "text/html" })); a.download = "discussion-" + String(conv.name).replace(/[^\w-]+/g, "_") + ".html"; document.body.appendChild(a); a.click(); a.remove(); toast("Discussion exportee (" + list.length + " messages)");
    });
  }
  function wbSendMedia(conv, body) {
    return wbApi("send-media", Object.assign({ jid: conv.jid }, body)).then(function (r) {
      if (r && r.ok) { playSound("send"); return; }
      toast("WhatsApp : " + ((r && r.error) || "echec"));
    });
  }
  function wbAppend(conv, m) {
    if (findMsg(conv, "w" + m.id)) return false;
    const lab = dayLabel(m.ts);
    let day = conv.days[conv.days.length - 1];
    if (!day || (day.date !== lab && conv.days.length)) { day = conv.days.find(function (d) { return d.date === lab; }); }
    if (!day) { day = { date: lab, messages: [] }; conv.days.push(day); }
    day.messages.push(wbToMsg(m));
    return true;
  }
  function wbLoad(conv) {
    wbApi("messages?jid=" + encodeURIComponent(conv.jid)).then(function (r) {
      if (!r || !r.ok) return;
      conv.days = []; conv.loaded = true;
      r.messages.forEach(function (m) { wbAppend(conv, m); });
      if (!conv.days.length) conv.days = [{ date: "Aujourd'hui", messages: [] }];
      if (activeId === conv.id) renderMessages(conv);
      renderChatList();
      if (wb.jump) { const j = wb.jump; wb.jump = null; setTimeout(function () { jumpTo("w" + j); }, 60); }
    });
  }
  function wbSend(conv, text, quotedId) {
    wbApi("send", { jid: conv.jid, text: text, quotedId: quotedId }).then(function (r) {
      if (r && r.ok) { playSound("send"); return; }
      toast("WhatsApp : " + ((r && r.error) || "echec"));
    });
  }
  function wbShowState(s) {
    wb.status = s.status;
    const ov = $("wb-overlay");
    const open = s.status === "open";
    ov.classList.toggle("hidden", open);
    $("wb-logout-btn").classList.toggle("hidden", !open);
    $("wb-title").textContent = "Connecter WhatsApp" + (wb.accounts.length > 1 ? " : " + accNameById(wb.acc) : "");
    const img = $("wb-qr");
    if (s.qr) { img.src = s.qr; img.classList.remove("hidden"); $("wb-msg").textContent = "Scanne ce code avec WhatsApp"; }
    else {
      img.classList.add("hidden");
      $("wb-msg").textContent = s.status === "reconnecting" ? "Reconnexion..." : s.status === "logged_out" ? "Deconnecte. Nouveau code en preparation..." : "Preparation du code QR...";
    }
    if (open) { wbRefreshChats(); }
  }
  function wbRenderRail() {
    const rail = $("acc-rail"); if (!rail) return;
    rail.classList.remove("hidden"); document.body.classList.add("has-rail");
    rail.innerHTML = "";
    wb.accounts.forEach(function (a, k) {
      const b = document.createElement("button");
      b.className = "acc-btn" + (a.id === wb.acc ? " active" : "");
      const nm = accName(a, k);
      b.title = nm + (a.phone ? " (" + a.phone + ")" : "") + (a.status !== "open" ? " - non connecte" : "");
      const av = document.createElement("span"); av.className = "acc-av"; av.style.background = wbColor(a.id + nm);
      av.textContent = (nm.replace(/^\+/, "").trim()[0] || "?").toUpperCase();
      b.appendChild(av);
      const dot = document.createElement("i"); dot.className = "acc-dot " + (a.status === "open" ? "ok" : "off"); b.appendChild(dot);
      if (a.unread && a.id !== wb.acc) { const u = document.createElement("span"); u.className = "acc-badge"; u.textContent = a.unread > 99 ? "99+" : a.unread; b.appendChild(u); }
      b.onclick = function () { wbSwitch(a.id); };
      b.oncontextmenu = function (e) { e.preventDefault(); wbManage(); };
      rail.appendChild(b);
    });
    const add = document.createElement("button"); add.className = "acc-btn acc-add"; add.title = "Ajouter un compte WhatsApp"; add.textContent = "+";
    add.onclick = function () { wbAddAccount(); }; rail.appendChild(add);
    const man = document.createElement("button"); man.className = "acc-btn acc-man"; man.title = "Gerer les comptes"; man.textContent = "⚙";
    man.onclick = function () { wbManage(); }; rail.appendChild(man);
    updateTitle();
  }
  function wbSetAccounts(list) {
    wb.accounts = list || [];
    if (!accById(wb.acc) && wb.accounts.length) { wbSwitch(wb.accounts[0].id); return; }
    wbRenderRail();
    if (!$("acc-overlay").classList.contains("hidden")) wbRenderManage();
  }
  function wbSwitch(id) {
    if (!accById(id)) return Promise.resolve();
    wb.acc = id;
    CONVERSATIONS.length = 0; activeId = null; closeChat(); wb.pro = null; renderChatList(); wbRenderRail();
    return fetch("api/state?acc=" + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (s) {
      if (wb.acc !== id) return;
      wb.accounts = s.accounts || wb.accounts; wbRenderRail(); wbShowState(s);
    }).catch(function () {});
  }
  function wbAddAccount() {
    if (wb.accounts.length >= 10) return toast("Maximum 10 comptes");
    if (wb.accounts.length >= 4 && !confirm("Chaque compte garde une connexion WhatsApp ouverte (environ 50 a 100 Mo de memoire chacun). Ajouter quand meme ?")) return;
    askText("Nom du nouveau compte (optionnel)", "Ex : Perso, Boutique...", "").then(function (label) {
      if (label === null) return;
      wbApi("accounts/add", { label: label }).then(function (r) {
        if (!r || !r.ok) return toast((r && r.error) || "Echec");
        wb.accounts = r.accounts; wbSwitch(r.id);
      });
    });
  }
  function wbRenderManage() {
    const box = $("acc-list"); box.innerHTML = "";
    wb.accounts.forEach(function (a, k) {
      const row = document.createElement("div"); row.className = "acc-row";
      const t = document.createElement("div"); t.className = "acc-row-t";
      t.innerHTML = "<b></b><small></small>";
      t.firstChild.textContent = accName(a, k) + (a.id === wb.acc ? " (actif)" : "");
      t.lastChild.textContent = (a.phone || "pas encore connecte") + " · " + (a.status === "open" ? "connecte" : a.status === "qr" ? "attend le QR" : a.status) + (a.unread ? " · " + a.unread + " non lus" : "");
      row.appendChild(t);
      const rn = document.createElement("button"); rn.textContent = "Renommer";
      rn.onclick = function () {
        askText("Nom du compte", "Nom", a.label || "").then(function (v) {
          if (v === null) return;
          wbApi("accounts/rename", { acc: a.id, label: v }).then(function (r) { if (r && r.ok) wbSetAccounts(r.accounts); });
        });
      };
      const rm = document.createElement("button"); rm.textContent = "Supprimer"; rm.className = "danger";
      rm.onclick = function () {
        if (!confirm("Supprimer le compte \"" + accName(a, k) + "\" ?\nSa session et ses discussions sauvegardees ici seront effacees (ton WhatsApp sur le telephone n'est pas touche).")) return;
        const wasActive = a.id === wb.acc;
        wbApi("accounts/remove", { acc: a.id }).then(function (r) {
          if (!r || !r.ok) return toast("Echec");
          wb.accounts = r.accounts;
          if (wasActive) { wb.acc = null; }
          if (!wb.accounts.length) { wbApi("accounts/add", { label: "" }).then(function (x) { if (x && x.ok) { wb.accounts = x.accounts; wbSwitch(x.id); } }); }
          else wbSetAccounts(wb.accounts);
        });
      };
      row.appendChild(rn); row.appendChild(rm); box.appendChild(row);
    });
  }
  function wbManage() { wbRenderManage(); $("acc-overlay").classList.remove("hidden"); }
  function wbRid(msg) { return String(msg.id).replace(/^w/, ""); }
  function wbHue(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360; return h; }
  function paintAvatar(el, conv) {
    if (!el || !conv || !conv.wb || !wb.acc || wb.avMiss[conv.jid]) return;
    const jid = conv.jid, img = new Image();
    img.alt = ""; img.className = "avatar-img";
    img.onload = function () { el.textContent = ""; el.style.background = "none"; el.appendChild(img); };
    img.onerror = function () { wb.avMiss[jid] = true; };
    img.src = "api/avatar?acc=" + encodeURIComponent(wb.acc) + "&jid=" + encodeURIComponent(jid) + (wb.av[jid] ? "&t=" + wb.av[jid] : "");
  }
  function wbPaintStatus(ex) {
    let t = ex.phone || ex.status || "";
    if (ex.presence === "composing") t = (ex.presenceWho ? ex.presenceWho + " " : "") + "ecrit...";
    else if (ex.presence === "recording") t = (ex.presenceWho ? ex.presenceWho + " " : "") + "enregistre un vocal...";
    else if (ex.presence === "available") t = "en ligne";
    if (activeId === ex.id) chatStatusEl.textContent = t;
  }
  function wbPaintSettings() {
    $("rr-state").textContent = wb.settings.readReceipts ? "on" : "off";
    $("typing-state").textContent = wb.settings.typing ? "on" : "off";
  }
  function openList(title, items, filterable, emptyText, opts) {
    opts = opts || {};
    const ov = $("list-overlay"), box = $("list-box"), inp = $("list-filter");
    $("list-title").textContent = title; inp.classList.toggle("hidden", !filterable); inp.value = "";
    function close() { ov.classList.add("hidden"); }
    function paint() {
      const q = inp.value.trim().toLowerCase(); box.innerHTML = "";
      const sel = items.filter(function (i) { return !q || (i.title + " " + (i.sub || "")).toLowerCase().includes(q); });
      if (!sel.length) { const e = document.createElement("div"); e.className = "list-empty"; e.textContent = emptyText || "Rien a afficher"; box.appendChild(e); }
      sel.forEach(function (i) {
        const row = document.createElement("div"); row.className = "acc-row";
        const t = document.createElement("div"); t.className = "acc-row-t";
        const b = document.createElement("b"); b.textContent = i.title; const sm = document.createElement("small"); sm.textContent = i.sub || "";
        t.appendChild(b); t.appendChild(sm); row.appendChild(t);
        if (i.badge) { const bd = document.createElement("span"); bd.className = "list-badge"; bd.textContent = i.badge; row.appendChild(bd); }
        if (opts.multi) { row.style.cursor = "pointer"; row.classList.toggle("sel", !!i.sel); row.onclick = function () { i.sel = !i.sel; row.classList.toggle("sel", i.sel); }; }
        else if (i.onClick) { row.style.cursor = "pointer"; row.onclick = function () { close(); i.onClick(); }; }
        box.appendChild(row);
      });
    }
    const okb = $("list-ok"); okb.classList.toggle("hidden", !opts.multi); okb.textContent = opts.okText || "Valider";
    okb.onclick = function () { const picked = items.filter(function (x) { return x.sel; }); close(); if (opts.onOk) opts.onOk(picked); };
    inp.oninput = paint; paint(); ov.classList.remove("hidden"); $("list-close").onclick = close;
    if (filterable) setTimeout(function () { inp.focus(); }, 30);
  }
  function wbForwardPick(conv, msg) {
    const items = CONVERSATIONS.filter(function (c) { return c.wb; }).map(function (c) {
      return { title: c.name, sub: c.phone || "", onClick: function () {
        wbApi("forward", { to: c.jid, jid: conv.jid, id: wbRid(msg) }).then(function (r) { toast(r && r.ok ? "Message transfere a " + c.name : "Transfert impossible : " + ((r && r.error) || "")); });
      } };
    });
    openList("Transferer a...", items, true);
  }
  function wbStarred() {
    wbApi("starred").then(function (r) {
      if (!r || !r.ok) return toast("Echec");
      openList("Messages favoris", r.items.map(function (it) {
        return { title: it.name || it.jid, sub: (it.fromMe ? "Toi : " : "") + (it.text || "").slice(0, 120), badge: hhmm(it.ts), onClick: function () {
          wb.jump = it.id;
          if (getConv("x" + it.jid)) openConversation("x" + it.jid); else toast("Discussion introuvable");
        } };
      }), false, "Aucun favori. Ouvre le menu d'un message > Ajouter aux favoris.");
    });
  }
  function wbInfo(conv) {
    if (!/@g\.us$/.test(conv.jid)) {
      return openList(conv.name, [{ title: "Numero", sub: conv.phone || conv.jid.split("@")[0] }, { title: "Medias, docs et liens", onClick: function () { wbGallery(conv); } }], false);
    }
    wbApi("group?jid=" + encodeURIComponent(conv.jid)).then(function (r) {
      if (!r || !r.ok) return toast("Infos du groupe indisponibles : " + ((r && r.error) || ""));
      const g = r.group;
      const act = function (body, msg) { return wbApi("group-manage", Object.assign({ jid: conv.jid }, body)).then(function (x) { if (x && x.ok) { toast(msg); if (body.action !== "leave") wbInfo(conv); else { wbRefreshChats(); } } else toast("Impossible : " + ((x && x.error) || "echec")); }); };
      const items = [];
      if (g.desc) items.push({ title: "Description", sub: g.desc });
      items.push({ title: "Medias, docs et liens", onClick: function () { wbGallery(conv); } });
      if (g.meAdmin) {
        items.push({ title: "Renommer le groupe", onClick: function () { askText("Nouveau nom du groupe", "", g.name).then(function (v) { if (v && v.trim()) act({ action: "subject", value: v.trim() }, "Groupe renomme"); }); } });
        items.push({ title: "Changer la description", onClick: function () { askText("Description du groupe", "", g.desc).then(function (v) { if (v !== null) act({ action: "desc", value: v }, "Description changee"); }); } });
        items.push({ title: "Ajouter des participants", sub: "numeros avec indicatif, separes par une virgule", onClick: function () { askText("Numeros a ajouter", "+212 6xx xx xx xx, +33 ...").then(function (v) { if (v && v.trim()) act({ action: "add", participants: v.split(/[,;\n]+/) }, "Demande envoyee"); }); } });
      }
      items.push({ title: g.size + " participants", sub: g.owner ? "Cree par " + g.owner : "" });
      g.participants.forEach(function (p) {
        const it = { title: p.name || p.phone || "Contact", sub: p.name ? p.phone : "", badge: p.admin ? "admin" : "" };
        if (g.meAdmin) it.onClick = function () {
          openList(it.title, [
            p.admin ? { title: "Retirer comme admin", onClick: function () { act({ action: "demote", participants: [p.jid] }, "Admin retire"); } } : { title: "Nommer admin", onClick: function () { act({ action: "promote", participants: [p.jid] }, "Nomme admin"); } },
            { title: "Retirer du groupe", onClick: function () { if (confirm("Retirer " + it.title + " du groupe ?")) act({ action: "remove", participants: [p.jid] }, "Participant retire"); } }
          ], false);
        };
        items.push(it);
      });
      items.push({ title: "Quitter le groupe", onClick: function () { if (confirm("Quitter ce groupe ?")) act({ action: "leave" }, "Groupe quitte"); } });
      openList(g.name, items, false);
    });
  }
  function wbNewGroup() {
    askText("Nom du nouveau groupe", "Ex : Equipe boutique").then(function (name) {
      if (!name || !name.trim()) return;
      const items = CONVERSATIONS.filter(function (c) { return c.wb && /@s\.whatsapp\.net$/.test(c.jid); }).map(function (c) { return { title: c.name, sub: c.phone || "", jid: c.jid }; });
      openList("Participants de \"" + name.trim() + "\"", items, true, "Aucun contact", { multi: true, okText: "Creer le groupe", onOk: function (picked) {
        if (!picked.length) return toast("Choisis au moins une personne");
        wbApi("group-create", { name: name.trim(), participants: picked.map(function (x) { return x.jid; }) }).then(function (r) {
          if (r && r.ok) { toast("Groupe cree"); wbRefreshChats().then(function () { if (getConv("x" + r.jid)) openConversation("x" + r.jid); }); }
          else toast("Creation impossible : " + ((r && r.error) || "echec"));
        });
      } });
    });
  }
  function wbFlag(conv, body, msg) {
    return wbApi("chat-flag", Object.assign({ jid: conv.jid }, body)).then(function (r) {
      if (r && r.ok) { const c = r.chat; conv.pinned = !!c.pinned; conv.archived = !!c.archived; conv.muted = !!c.muted; renderChatList(); toast(msg); }
      else toast("Echec : " + ((r && r.error) || ""));
    });
  }
  function wbGallery(conv) {
    wbApi("gallery?jid=" + encodeURIComponent(conv.jid)).then(function (r) {
      if (!r || !r.ok) return toast("Echec");
      const ov = $("gal-overlay"), box = $("gal-box"); $("gal-title").textContent = conv.name;
      const furl = function (f) { return "api/media?acc=" + encodeURIComponent(wb.acc) + "&f=" + encodeURIComponent(f); };
      function tab(t) {
        Array.prototype.forEach.call(ov.querySelectorAll(".gal-tabs .chip"), function (b) { b.classList.toggle("active", b.dataset.t === t); });
        box.innerHTML = ""; box.classList.toggle("rows", t !== "media");
        const list = r[t] || [];
        if (!list.length) { const e = document.createElement("div"); e.className = "list-empty"; e.textContent = "Rien pour le moment"; box.appendChild(e); return; }
        list.forEach(function (it) {
          if (t === "media") {
            const d = document.createElement("div"); d.className = "gal-cell";
            const src = it.file ? furl(it.file) : it.thumb;
            if (it.type === "video" && it.file) { const v = document.createElement("video"); v.src = src; v.preload = "metadata"; if (it.thumb) v.poster = it.thumb; d.appendChild(v); const pl = document.createElement("span"); pl.className = "gal-play"; pl.textContent = "▶"; d.appendChild(pl); }
            else if (src) { const im = document.createElement("img"); im.src = src; im.alt = ""; d.appendChild(im); }
            d.onclick = function () { ov.classList.add("hidden"); wb.jump = it.id; if (activeId === conv.id) { jumpTo("w" + it.id); } };
            box.appendChild(d);
          } else {
            const d = document.createElement("div"); d.className = "gal-row";
            const b = document.createElement("b"); const sm = document.createElement("small");
            if (t === "docs") { b.textContent = "📄 " + it.name; sm.textContent = (it.size ? Math.max(1, Math.round(it.size / 1024)) + " Ko · " : "") + hhmm(it.ts); d.onclick = function () { if (it.file) { const a = document.createElement("a"); a.href = furl(it.file); a.download = it.name; a.click(); } else toast("Fichier non telecharge"); }; }
            else { b.textContent = it.url; sm.textContent = hhmm(it.ts); d.onclick = function () { window.open(it.url, "_blank", "noopener"); }; }
            d.appendChild(b); d.appendChild(sm); box.appendChild(d);
          }
        });
      }
      ov.querySelectorAll(".gal-tabs .chip").forEach(function (b) { b.onclick = function () { tab(b.dataset.t); }; });
      $("gal-close").onclick = function () { ov.classList.add("hidden"); };
      tab("media"); ov.classList.remove("hidden");
    });
  }
  function wbSendLoc(conv, lat, lng, name) {
    wbApi("location", { jid: conv.jid, lat: lat, lng: lng, name: name || "" }).then(function (r) { if (r && r.ok) { playSound("send"); toast("Position envoyee"); } else toast("Position non envoyee : " + ((r && r.error) || "")); });
  }
  function wbLocation(conv) {
    function manual() {
      askText("Position : latitude, longitude (ou lien Google Maps)", "34.0331, -4.9998").then(function (v) {
        if (!v) return;
        const m = /(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(v) || /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(v);
        if (!m) return toast("Je n'ai pas compris cette position");
        wbSendLoc(conv, Number(m[1]), Number(m[2]), "");
      });
    }
    if (!navigator.geolocation) return manual();
    toast("Recherche de ta position...");
    navigator.geolocation.getCurrentPosition(function (p) { wbSendLoc(conv, p.coords.latitude, p.coords.longitude, ""); }, function () { manual(); }, { timeout: 6000 });
  }
  // statuts WhatsApp reels
  const seenKey = function () { return "pingchat.stseen." + wb.acc; };
  function wbLoadStatuses() {
    wbApi("statuses").then(function (r) {
      if (!r || !r.ok) return;
      let seen = {}; try { seen = JSON.parse(localStorage.getItem(seenKey()) || "{}"); } catch (e) {}
      const out = [];
      r.statuses.forEach(function (g) {
        g.items.forEach(function (s) {
          const o = { id: s.id, owner: g.fromMe ? "me" : g.who, name: g.fromMe ? "Moi" : (g.name || "Contact"), ts: s.ts * 1000, seen: !!seen[s.id], wbs: true };
          if (s.type === "text") { o.kind = "text"; o.text = s.text; o.bg = s.bg || "#312e81"; }
          else { o.kind = "image"; o.vid = s.type === "video"; o.text = s.caption || ""; o.src = s.media && s.media.file ? "api/media?acc=" + encodeURIComponent(wb.acc) + "&f=" + encodeURIComponent(s.media.file) : (s.media && s.media.thumb) || ""; }
          out.push(o);
        });
      });
      stories = out; renderStories();
    });
  }
  let callInfo = null;
  function wbOnCall(d) {
    const ban = $("call-banner");
    if (d.status === "offer" || d.status === "ringing") {
      callInfo = d;
      const who = d.name + (wb.accounts.length > 1 ? " · " + accNameById(d.acc) : "");
      $("call-who").textContent = who;
      $("call-sub").textContent = (d.video ? "Appel video" : "Appel vocal") + " entrant. PingChat ne peut pas decrocher : reponds sur ton telephone.";
      ban.classList.remove("hidden"); playSound("in");
      if (settings.notif && document.hidden && "Notification" in window && Notification.permission === "granted") {
        try { new Notification("Appel de " + who, { body: "Reponds sur ton telephone", icon: "assets/logo.svg" }); } catch (x) {}
      }
      clearTimeout(wbOnCall.t); wbOnCall.t = setTimeout(function () { ban.classList.add("hidden"); }, 40000);
    } else if (callInfo && callInfo.id === d.id) { ban.classList.add("hidden"); callInfo = null; }
  }
  function startWb() {
    return fetch("api/state").then(function (r) { return r.json(); }).then(function (s) {
      if (!s || s.bridge !== "baileys") return false;
      wb.on = true;
      wb.accounts = s.accounts || []; wb.acc = (wb.accounts[0] || {}).id || null;
      // on remplace les discussions de demo par les vraies
      CONVERSATIONS.length = 0; activeId = null; closeChat();
      stories = stories.filter(function (x) { return x.owner === "me"; }); renderStories();
      renderChatList(); wbRenderRail(); wbShowState(s);
      wbApi("settings").then(function (r) { if (r && r.ok) { wb.settings = { readReceipts: r.readReceipts, typing: r.typing }; wbPaintSettings(); } });
      $("chat-header-info-click").onclick = function () { const c = getConv(activeId); if (c && c.wb) wbInfo(c); };
      let typOn = false, typTimer = null;
      messageInput.addEventListener("input", function () {
        const c = getConv(activeId); if (!c || !c.wb || !messageInput.value) return;
        if (!typOn) { typOn = true; wbApi("typing", { jid: c.jid, on: true }); }
        clearTimeout(typTimer);
        typTimer = setTimeout(function () { typOn = false; wbApi("typing", { jid: c.jid, on: false }); }, 3500);
      });
      $("call-dismiss").onclick = function () { $("call-banner").classList.add("hidden"); };
      $("call-reject").onclick = function () {
        if (!callInfo) return;
        fetch("api/call/reject", { method: "POST", headers: { "Content-Type": "application/json", "X-PingChat": "1" }, body: JSON.stringify({ acc: callInfo.acc, id: callInfo.id, from: callInfo.from }) })
          .then(function (r) { return r.json(); }).then(function (r) { toast(r && r.ok ? "Appel refuse" : "Refus impossible : " + ((r && r.error) || "")); });
        $("call-banner").classList.add("hidden");
      };
      $("acc-close").onclick = function () { $("acc-overlay").classList.add("hidden"); };
      $("acc-new").onclick = function () { $("acc-overlay").classList.add("hidden"); wbAddAccount(); };
      $("wb-remove-btn").onclick = function () {
        const a = accById(wb.acc); if (!a) return;
        if (!confirm("Supprimer ce compte (" + accName(a, wb.accounts.indexOf(a)) + ") ?")) return;
        wbApi("accounts/remove", { acc: a.id }).then(function (r) {
          if (!r || !r.ok) return toast("Echec");
          wb.accounts = r.accounts; wb.acc = null;
          if (!wb.accounts.length) wbApi("accounts/add", { label: "" }).then(function (x) { if (x && x.ok) { wb.accounts = x.accounts; wbSwitch(x.id); } });
          else wbSetAccounts(wb.accounts);
        });
      };
      const es = new EventSource("api/events"); wb.es = es;
      const mine = function (d) { return d.acc === wb.acc; };
      es.addEventListener("accounts", function (e) { wbSetAccounts(JSON.parse(e.data).accounts); });
      es.addEventListener("state", function (e) { const d = JSON.parse(e.data); if (mine(d)) { const was = wb.status; wbShowState(d); if (d.status === "open" && was !== "open") toast("Connecte : " + accNameById(wb.acc) + " ✔"); } });
      es.addEventListener("chats", function (e) { const d = JSON.parse(e.data); if (mine(d) && wb.status === "open") wbRefreshChats(); });
      es.addEventListener("chat", function (e) {
        const c = JSON.parse(e.data); if (!mine(c)) return; let ex = getConv("x" + c.jid);
        if (!ex) { ex = wbMakeConv(c); CONVERSATIONS.push(ex); }
        ex.name = c.name || ex.name; ex.ts = c.ts; ex.preview = c.last; ex.timeLabel = c.ts ? hhmm(c.ts) : "";
        ex.pinned = !!c.pinned; ex.archived = !!c.archived; ex.muted = !!c.muted; ex.tags = c.tags || [];
        ex.unread = activeId === ex.id ? 0 : c.unread; renderChatList();
      });
      es.addEventListener("pro", function (e) { const d = JSON.parse(e.data); if (mine(d)) wbLoadPro(); });
      es.addEventListener("appt", function (e) { const d = JSON.parse(e.data); if (mine(d)) toast(d.name + (d.reply === "confirmed" ? " a CONFIRME son rendez-vous" : " a ANNULE son rendez-vous") + " (" + when(d.at) + ")"); });
      es.addEventListener("statuses", function (e) { const d = JSON.parse(e.data); if (mine(d)) wbLoadStatuses(); });
      es.addEventListener("message", function (e) {
        const d = JSON.parse(e.data);
        if (!mine(d)) { if (!d.msg.fromMe) notifyIncoming({ id: "", name: d.name || "Message" }, d.msg.text, accNameById(d.acc), d.acc); return; }
        const ex = getConv("x" + d.jid); if (!ex) return;
        if (ex.loaded && wbAppend(ex, d.msg) && activeId === ex.id) { renderMessages(ex); scrollToBottom(); }
        if (!d.msg.fromMe) notifyIncoming(ex, d.msg.text, wb.accounts.length > 1 ? accNameById(wb.acc) : "", wb.acc);
      });
      es.addEventListener("reaction", function (e) {
        const d = JSON.parse(e.data); if (!mine(d)) return; const ex = getConv("x" + d.jid); if (!ex) return;
        const m = findMsg(ex, "w" + d.id); if (!m) return;
        wbSetReactions(m, d.reactions); if (activeId === ex.id) renderMessages(ex);
      });
      es.addEventListener("msgupdate", function (e) {
        const d = JSON.parse(e.data); if (!mine(d)) return; const ex = getConv("x" + d.jid); if (!ex) return;
        const m = findMsg(ex, "w" + d.msg.id); if (!m) return;
        Object.assign(m, wbToMsg(d.msg)); if (activeId === ex.id) renderMessages(ex);
      });
      es.addEventListener("call", function (e) { wbOnCall(JSON.parse(e.data)); });
      es.addEventListener("avatar", function (e) {
        const d = JSON.parse(e.data); delete wb.avMiss[d.jid]; wb.av[d.jid] = Date.now();
        renderChatList(); const c = getConv(activeId); if (c && c.jid === d.jid) paintAvatar(chatAvatarEl, c);
      });
      es.addEventListener("presence", function (e) {
        const d = JSON.parse(e.data); const ex = getConv("x" + d.jid); if (!ex) return;
        ex.presence = d.state; ex.presenceWho = d.who || ""; wbPaintStatus(ex);
        clearTimeout(ex._pt);
        if (d.state === "composing" || d.state === "recording") ex._pt = setTimeout(function () { ex.presence = ""; wbPaintStatus(ex); }, 7000);
      });
      es.addEventListener("status", function (e) {
        const d = JSON.parse(e.data); if (!mine(d)) return; const ex = getConv("x" + d.jid); if (!ex) return;
        const m = findMsg(ex, "w" + d.id);
        if (m) { m.state = mapState(d.status); if (activeId === ex.id) renderMessages(ex); }
      });
      return true;
    }).catch(function () { return false; });
  }

  // ---------- Statuts (stories) ----------
  const DAY = 24 * 3600 * 1000;
  const STORY_COLORS = ["#ff6b57", "#7c5cd6", "#e05656", "#e08a2d", "#3a8dde", "#d6569a", "#111b21"];
  let stories = [];
  (function loadStories() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORY_KEY) || "null"); } catch (e) {}
    if (raw) stories = raw;
    else stories = DEMO_STORIES.map(function (s) { return Object.assign({}, s, { ts: Date.now() - s.ageH * 3600 * 1000 }); });
    stories = stories.filter(function (s) { return Date.now() - s.ts < DAY; });
  })();
  function saveStories() {
    if (typeof wb !== "undefined" && wb.on) return;
    try { localStorage.setItem(STORY_KEY, JSON.stringify(stories.filter(function (s) { return s.kind === "text"; }))); } catch (e) {}
  }
  function storiesOf(owner) { return stories.filter(function (s) { return s.owner === owner && Date.now() - s.ts < DAY; }); }
  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? "a l'instant" : m < 60 ? "il y a " + m + " min" : "il y a " + Math.floor(m / 60) + " h";
  }

  function renderStories() {
    const bar = $("stories-bar");
    bar.innerHTML = "";
    function bubbleFor(owner, name, color, ring, onOpen, plus) {
      const b = document.createElement("div");
      b.className = "story-item";
      const av = document.createElement("div");
      av.className = "story-avatar" + (ring === "new" ? " ring" : ring === "seen" ? " ring seen" : "");
      const inner = document.createElement("span");
      inner.style.background = color;
      inner.textContent = name === "Mon statut" ? "+" : initials(name);
      av.appendChild(inner);
      b.appendChild(av);
      const l = document.createElement("span");
      l.className = "story-label";
      l.textContent = name === "Mon statut" ? "Moi" : name.split(" ")[0];
      b.appendChild(l);
      b.addEventListener("click", onOpen);
      if (plus) {
        const p = document.createElement("button");
        p.className = "story-plus"; p.textContent = "+"; p.setAttribute("aria-label", "Ajouter un statut");
        p.addEventListener("click", function (e) { e.stopPropagation(); openComposer(); });
        b.appendChild(p);
      }
      return b;
    }
    const mine = storiesOf("me");
    bar.appendChild(bubbleFor("me", "Mon statut", "#ff6b57", mine.length ? "seen" : "", function () {
      if (mine.length) openStoryViewer("me"); else openComposer();
    }, mine.length > 0));
    const owners = []; stories.forEach(function (s) { if (s.owner !== "me" && owners.indexOf(s.owner) < 0) owners.push(s.owner); });
    owners.forEach(function (o) {
      const list = storiesOf(o); if (!list.length) return;
      const unseen = list.some(function (s) { return !s.seen; });
      bar.appendChild(bubbleFor(o, list[0].name, wbColor(String(o)), unseen ? "new" : "seen", function () { openStoryViewer(o); }));
    });
  }

  let sv = null; // etat de la visionneuse
  function openStoryViewer(owner) {
    const list = storiesOf(owner);
    if (!list.length) return;
    const firstUnseen = list.findIndex(function (s) { return !s.seen; });
    sv = { owner: owner, list: list, i: firstUnseen > 0 && owner !== "me" ? firstUnseen : 0, timer: null };
    $("story-viewer").classList.remove("hidden");
    showStory();
  }
  function showStory() {
    clearTimeout(sv.timer);
    const s = sv.list[sv.i];
    s.seen = true;
    if (s.wbs) { try { const k = seenKey(); const o = JSON.parse(localStorage.getItem(k) || "{}"); o[s.id] = 1; localStorage.setItem(k, JSON.stringify(o)); } catch (e) {} }
    const body = $("story-body");
    body.innerHTML = "";
    if (s.kind === "image") {
      body.style.background = "#000";
      if (s.vid && s.src) { const v = document.createElement("video"); v.src = s.src; v.autoplay = true; v.controls = true; body.appendChild(v); }
      else { const img = document.createElement("img"); img.src = s.src; img.alt = "Statut"; body.appendChild(img); }
      if (s.text) { const cp = document.createElement("p"); cp.className = "story-cap"; cp.textContent = s.text; body.appendChild(cp); }
    } else {
      body.style.background = s.bg;
      const p = document.createElement("p"); p.textContent = s.text; body.appendChild(p);
    }
    $("story-who").textContent = s.owner === "me" ? "Mon statut" : s.name;
    $("story-when").textContent = ago(s.ts);
    $("story-del").classList.toggle("hidden", s.owner !== "me");
    const pr = $("story-progress");
    pr.innerHTML = "";
    sv.list.forEach(function (_, k) {
      const seg = document.createElement("i");
      const fill = document.createElement("b");
      if (k < sv.i) fill.style.width = "100%";
      if (k === sv.i) fill.className = "run";
      seg.appendChild(fill); pr.appendChild(seg);
    });
    sv.timer = setTimeout(function () { stepStory(1); }, s.vid ? 15000 : 5000);
  }
  function stepStory(d) {
    if (!sv) return;
    const n = sv.i + d;
    if (n < 0) return showStory();
    if (n >= sv.list.length) return closeStoryViewer();
    sv.i = n; showStory();
  }
  function closeStoryViewer() {
    if (sv) clearTimeout(sv.timer);
    sv = null;
    $("story-viewer").classList.add("hidden");
    saveStories(); renderStories();
  }
  $("story-next").addEventListener("click", function () { stepStory(1); });
  $("story-prev").addEventListener("click", function () { stepStory(-1); });
  $("story-close").addEventListener("click", closeStoryViewer);
  $("story-del").addEventListener("click", function () {
    if (!sv || !confirm("Supprimer ce statut ?")) return;
    const s = sv.list[sv.i];
    if (s.wbs) wbApi("status-delete", { id: s.id }).then(function (r) { if (!r || !r.ok) toast("Suppression impossible : " + ((r && r.error) || "")); });
    stories = stories.filter(function (x) { return x !== s; });
    sv.list.splice(sv.i, 1);
    saveStories();
    if (!sv.list.length) { closeStoryViewer(); toast("Statut supprime"); return; }
    if (sv.i >= sv.list.length) sv.i = sv.list.length - 1;
    showStory(); toast("Statut supprime");
  });

  // Creation d'un statut
  let scColor = STORY_COLORS[0];
  (function () {
    const box = $("sc-colors");
    STORY_COLORS.forEach(function (c) {
      const b = document.createElement("button");
      b.style.background = c; b.setAttribute("aria-label", "Couleur " + c);
      b.addEventListener("click", function () { scColor = c; paintColors(); });
      box.appendChild(b);
    });
  })();
  function paintColors() {
    $("sc-card").style.background = scColor;
    Array.prototype.forEach.call($("sc-colors").children, function (b, i) { b.classList.toggle("sel", STORY_COLORS[i] === scColor); });
  }
  function openComposer() {
    if (typeof wb !== "undefined" && wb.on) return toast("Publication de statut desactivee pour l'instant (pas de choix de l'audience). Tu peux voir les statuts de tes contacts."); $("sc-text").value = ""; paintColors(); $("story-composer").classList.remove("hidden"); $("sc-text").focus(); }
  function closeComposer() { $("story-composer").classList.add("hidden"); }
  $("sc-close").addEventListener("click", closeComposer);
  $("sc-publish").addEventListener("click", function () {
    const t = $("sc-text").value.trim();
    if (!t) return toast("Ecrivez quelque chose");
    if (wb.on) { closeComposer(); toast("Publication du statut..."); wbApi("status-post", { kind: "text", text: t, bg: scColor }).then(function (r) { if (r && r.ok) { toast("Statut publie pour 24 h"); wbLoadStatuses(); } else toast("Statut non publie : " + ((r && r.error) || "")); }); return; }
    stories.push({ id: "s" + Date.now().toString(36), owner: "me", name: "Moi", kind: "text", text: t, bg: scColor, ts: Date.now() });
    saveStories(); closeComposer(); renderStories(); toast("Statut publie pour 24 h");
  });
  $("sc-photo").addEventListener("click", function () { $("sc-file").click(); });
  $("sc-file").addEventListener("change", function () {
    const f = this.files[0]; this.value = "";
    if (!f || !f.type.startsWith("image/")) return;
    if (f.size > 8 * 1024 * 1024) return toast("Image trop lourde (8 Mo max)");
    const r = new FileReader();
    r.onload = function () {
      if (wb.on) { const mm = /^data:([^;]*);base64,(.*)$/.exec(r.result || ""); if (!mm) return toast("Image illisible"); closeComposer(); toast("Publication du statut...");
        wbApi("status-post", { kind: "image", mime: f.type, data: mm[2], caption: $("sc-text").value.trim() }).then(function (x) { if (x && x.ok) { toast("Statut publie pour 24 h"); wbLoadStatuses(); } else toast("Statut non publie : " + ((x && x.error) || "")); }); return; }
      stories.push({ id: "s" + Date.now().toString(36), owner: "me", name: "Moi", kind: "image", src: r.result, ts: Date.now() });
      closeComposer(); renderStories(); toast("Statut photo publie (non conserve apres rechargement)");
    };
    r.readAsDataURL(f);
  });

  // ---------- v1.5 : outils cabinet ----------
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function wbLoadPro() {
    return wbApi("pro").then(function (r) { if (r && r.ok) { wb.pro = r; applyBrand(); wbPaintTagChips(); renderChatList(); if (!$("pro-overlay").classList.contains("hidden") && wb.proTab) proTab(wb.proTab, true); } });
  }
  function labelOf(id) { return ((wb.pro && wb.pro.labels) || []).find(function (l) { return l.id === id; }); }
  function wbPaintTagChips() {
    const f = $("filters"); Array.prototype.slice.call(f.querySelectorAll(".chip[data-tag]")).forEach(function (c) { c.remove(); });
    const labels = (wb.pro && wb.pro.labels) || [];
    if (listFilter.indexOf("tag:") === 0 && !labels.some(function (l) { return "tag:" + l.id === listFilter; })) { listFilter = "all"; const all = f.querySelector('[data-filter="all"]'); if (all) all.classList.add("active"); }
    labels.forEach(function (l) {
      const b = el("button", "chip" + (listFilter === "tag:" + l.id ? " active" : ""), "● " + l.name); b.dataset.filter = "tag:" + l.id; b.dataset.tag = "1"; b.style.borderColor = l.color; f.appendChild(b);
    });
  }
  function wbTagPick(conv) {
    const labels = (wb.pro && wb.pro.labels) || [];
    if (!labels.length) { toast("Cree d'abord des etiquettes : menu > Cabinet > Etiquettes"); return proOpen("tags"); }
    const items = labels.map(function (l) { return { title: l.name, sub: "", id: l.id, sel: (conv.tags || []).indexOf(l.id) >= 0 }; });
    openList("Etiquettes de " + conv.name, items, false, "", { multi: true, okText: "Enregistrer", onOk: function () {
      const jobs = items.filter(function (i) { return i.sel !== ((conv.tags || []).indexOf(i.id) >= 0); }).map(function (i) { return wbApi("tag-chat", { jid: conv.jid, tag: i.id, on: i.sel }); });
      Promise.all(jobs).then(function (rs) { const last = rs[rs.length - 1]; if (last && last.ok) conv.tags = last.tags; wbRefreshChats(); toast("Etiquettes mises a jour"); });
    } });
  }
  // reponses rapides : /raccourci puis Tab ou Entree
  (function () {
    const pop = el("div", "qr-pop hidden"); pop.id = "qr-pop"; messageInput.closest("footer").appendChild(pop);
    let cur = [], idx = 0;
    function hide() { pop.classList.add("hidden"); cur = []; }
    function expand(q) {
      const c = getConv(activeId); let t = q.text;
      const first = c && c.name && !/^[+\d]/.test(c.name) ? c.name.split(" ")[0] : "";
      t = t.replace(/\{nom\}/g, first).replace(/\s+([,.!?])/g, "$1");
      messageInput.value = t; hide(); messageInput.dispatchEvent(new Event("input")); messageInput.focus();
    }
    function paint() {
      pop.innerHTML = "";
      cur.forEach(function (q, k) {
        const r = el("div", "qr-row" + (k === idx ? " sel" : "")); r.appendChild(el("b", "", "/" + q.k)); r.appendChild(el("span", "", q.text.slice(0, 80)));
        r.onmousedown = function (e) { e.preventDefault(); expand(q); }; pop.appendChild(r);
      });
      pop.classList.toggle("hidden", !cur.length);
    }
    messageInput.addEventListener("input", function () {
      const m = /^\/(\S*)$/.exec(messageInput.value);
      if (!m || !wb.on || !wb.pro) return hide();
      cur = (wb.pro.quick || []).filter(function (q) { return q.k.indexOf(m[1].toLowerCase()) === 0; }).slice(0, 6); idx = 0; paint();
    });
    messageInput.addEventListener("keydown", function (e) {
      if (!cur.length) return;
      if (e.key === "ArrowDown") { idx = (idx + 1) % cur.length; paint(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { idx = (idx + cur.length - 1) % cur.length; paint(); e.preventDefault(); }
      else if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); expand(cur[idx]); }
      else if (e.key === "Escape") hide();
    }, true);
  })();

  // panneau Cabinet
  const PRO_TABS = [["quick", "Reponses rapides"], ["auto", "Absence"], ["tags", "Etiquettes"], ["sched", "Programmes"], ["agenda", "Agenda"], ["appts", "Rendez-vous"], ["lock", "Verrouillage"], ["types", "Types de rdv"], ["import", "Import"], ["brand", "Identite"], ["lib", "Fichiers"], ["find", "Recherche"], ["report", "Rapport"], ["vac", "Conge"], ["link", "Lien / QR"], ["backup", "Sauvegarde"], ["share", "Poste partage"]];
  function proOpen(tab, preJid) {
    if (!wb.on) return toast("Les outils cabinet marchent avec WhatsApp Web");
    wb.proPre = preJid || null;
    const t = $("pro-tabs"); t.innerHTML = "";
    PRO_TABS.forEach(function (x) { const b = el("button", "chip", x[1]); b.dataset.t = x[0]; b.onclick = function () { proTab(x[0]); }; t.appendChild(b); });
    $("pro-close").onclick = function () { $("pro-overlay").classList.add("hidden"); };
    $("pro-acc").textContent = "Compte : " + accNameById(wb.acc);
    $("pro-overlay").classList.remove("hidden");
    (wb.pro ? Promise.resolve() : wbLoadPro()).then(function () { proTab(tab || "quick"); });
  }
  function field(label, node) { const w = el("label", "pro-f"); w.appendChild(el("span", "", label)); w.appendChild(node); return w; }
  function inp(type, val, ph) { const i = el("input", "ask-input"); i.type = type; if (val != null) i.value = val; if (ph) i.placeholder = ph; return i; }
  function ta(val, ph) { const t = el("textarea", "ask-input pro-ta"); t.value = val || ""; if (ph) t.placeholder = ph; return t; }
  function chatSelect(pre) {
    const s = el("select", "ask-input");
    CONVERSATIONS.filter(function (c) { return c.wb && !/@g\.us$/.test(c.jid); }).sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (c) { const o = el("option", "", c.name + (c.phone && c.name !== c.phone ? " (" + c.phone + ")" : "")); o.value = c.jid; if (c.jid === pre) o.selected = true; s.appendChild(o); });
    return s;
  }
  function when(ms) { const d = new Date(ms); return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
  const ST_LABEL = { pending: "en attente", sent: "envoye", missed: "manque (app fermee)", failed: "echec", cancelled: "annule", reminded: "rappel envoye", confirmed: "CONFIRME", past: "passe" };
  function saveKey(key, value, msg) { return wbApi("pro-set", { key: key, value: value }).then(function (r) { if (r && r.ok) { toast(msg || "Enregistre"); wbLoadPro(); } else toast("Echec : " + ((r && r.error) || "")); }); }
  function proTab(t, keep) {
    wb.proTab = t; const body = $("pro-body"); body.innerHTML = "";
    Array.prototype.forEach.call($("pro-tabs").children, function (b) { b.classList.toggle("active", b.dataset.t === t); });
    const P = wb.pro || { quick: [], auto: { days: [] }, labels: [], remind: {} };
    if (t === "quick") {
      body.appendChild(el("p", "pro-note", "Tape /raccourci dans une discussion puis Tab ou Entree. {nom} est remplace par le prenom du contact."));
      const rows = P.quick.map(function (q) { return { k: q.k, text: q.text }; }); const box = el("div");
      function paint() { box.innerHTML = ""; rows.forEach(function (q, i) { const r = el("div", "pro-row"); const k = inp("text", q.k, "raccourci"); k.style.maxWidth = "130px"; k.oninput = function () { q.k = k.value; }; const x = ta(q.text, "texte du message"); x.oninput = function () { q.text = x.value; }; const d = el("button", "btn secondary", "✕"); d.onclick = function () { rows.splice(i, 1); paint(); }; r.appendChild(k); r.appendChild(x); r.appendChild(d); box.appendChild(r); }); }
      paint(); body.appendChild(box);
      const add = el("button", "btn secondary", "+ Ajouter"); add.onclick = function () { rows.push({ k: "", text: "" }); paint(); };
      const sv = el("button", "btn", "Enregistrer"); sv.onclick = function () { saveKey("quick", rows); };
      const bar = el("div", "pro-bar"); bar.appendChild(add); bar.appendChild(sv); body.appendChild(bar);
    } else if (t === "auto") {
      const A = P.auto; body.appendChild(el("p", "pro-note", "Maintenant : " + (P.open ? "cabinet OUVERT (pas de reponse automatique)" : "cabinet FERME") + ". Une seule reponse par contact et par periode de fermeture. Les groupes sont ignores. Marche seulement quand PingChat est ouvert et connecte."));
      const on = el("input"); on.type = "checkbox"; on.checked = !!A.on; const lw = el("label", "pro-f inline"); lw.appendChild(on); lw.appendChild(el("span", "", "Activer la reponse automatique hors horaires")); body.appendChild(lw);
      const txt = ta(A.text); body.appendChild(field("Message", txt));
      const names = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"]; const days = []; 
      [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
        const cfg = (A.days || []).find(function (x) { return x.d === d; }) || { d: d, on: false, start: "09:00", end: "18:00" };
        const r = el("div", "pro-row"); const c = el("input"); c.type = "checkbox"; c.checked = cfg.on; const s = inp("time", cfg.start), e = inp("time", cfg.end);
        r.appendChild(c); r.appendChild(el("span", "pro-day", names[d])); r.appendChild(s); r.appendChild(el("span", "", "a")); r.appendChild(e); body.appendChild(r);
        days.push(function () { return { d: d, on: c.checked, start: s.value || "09:00", end: e.value || "18:00" }; });
      });
      const sv = el("button", "btn", "Enregistrer"); sv.onclick = function () { saveKey("auto", { on: on.checked, text: txt.value, days: days.map(function (f) { return f(); }) }, on.checked ? "Reponse automatique activee" : "Reponse automatique desactivee"); }; body.appendChild(sv);
    } else if (t === "tags") {
      body.appendChild(el("p", "pro-note", "Cree tes etiquettes (ex : Suivi, Urgent, A rappeler). Pour en poser une : menu de la discussion > Etiquettes. Filtre dans la liste des discussions."));
      const rows = P.labels.map(function (l) { return { id: l.id, name: l.name, color: l.color }; }); const box = el("div");
      function paint() { box.innerHTML = ""; rows.forEach(function (l, i) { const r = el("div", "pro-row"); const n = inp("text", l.name, "nom"); n.oninput = function () { l.name = n.value; }; const c = inp("color", l.color); c.style.maxWidth = "56px"; c.oninput = function () { l.color = c.value; }; const d = el("button", "btn secondary", "✕"); d.onclick = function () { rows.splice(i, 1); paint(); }; r.appendChild(n); r.appendChild(c); r.appendChild(d); box.appendChild(r); }); }
      paint(); body.appendChild(box);
      const add = el("button", "btn secondary", "+ Etiquette"); add.onclick = function () { rows.push({ id: "", name: "", color: "#7c5cd6" }); paint(); };
      const sv = el("button", "btn", "Enregistrer"); sv.onclick = function () { saveKey("labels", rows); }; const bar = el("div", "pro-bar"); bar.appendChild(add); bar.appendChild(sv); body.appendChild(bar);
    } else if (t === "sched") {
      body.appendChild(el("p", "pro-note", "Le message part seulement si PingChat est ouvert et connecte a l'heure prevue (retard accepte : 30 min). Sinon il est marque « manque » et n'est PAS envoye. Rien n'est envoye depuis un serveur."));
      const sel = chatSelect(wb.proPre); const txt = ta("", "Message"); const dt = inp("datetime-local", ""); body.appendChild(field("Contact", sel)); body.appendChild(field("Message", txt)); body.appendChild(field("Date et heure", dt));
      const go = el("button", "btn", "Programmer"); go.onclick = function () { if (!sel.value || !txt.value.trim() || !dt.value) return toast("Contact, message et date sont obligatoires"); wbApi("sched-add", { jid: sel.value, text: txt.value, at: new Date(dt.value).getTime() }).then(function (r) { if (r && r.ok) { toast("Message programme"); proTab("sched"); } else toast("Echec : " + ((r && r.error) || "")); }); }; body.appendChild(go);
      const list = el("div", "pro-list"); body.appendChild(list);
      wbApi("sched").then(function (r) { (r.items || []).slice().sort(function (a, b) { return b.at - a.at; }).forEach(function (s) { const row = el("div", "pro-item"); const tx = el("div"); tx.appendChild(el("b", "", s.name + " · " + when(s.at))); tx.appendChild(el("small", "", s.text.slice(0, 100))); row.appendChild(tx); row.appendChild(el("span", "list-badge st-" + s.status, ST_LABEL[s.status] || s.status)); const d = el("button", "btn secondary", s.status === "pending" ? "Annuler" : "✕"); d.onclick = function () { wbApi("sched-del", { id: s.id }).then(function () { proTab("sched"); }); }; row.appendChild(d); list.appendChild(row); }); if (!(r.items || []).length) list.appendChild(el("div", "list-empty", "Aucun message programme")); });
    } else if (t === "appts") {
      body.appendChild(el("p", "pro-note", "Un rappel est envoye automatiquement avant le rendez-vous (PingChat doit etre ouvert a ce moment). Si le patient repond OUI/OK/confirme (ou NON/annule), le statut change. Detection par mots-cles : une reponse ambigue reste « rappel envoye »."));
      const sel = chatSelect(wb.proPre); const dt = inp("datetime-local", ""); const note = inp("text", "", "Motif (facultatif)"); body.appendChild(field("Patient", sel)); body.appendChild(field("Date et heure", dt)); body.appendChild(field("Note", note));
      const tsel = el("select", "ask-input"); tsel.appendChild(new Option("Rappel standard", "")); (P.types || []).forEach(function (x) { tsel.appendChild(new Option(x.name, x.id)); }); if ((P.types || []).length) body.appendChild(field("Type (message de rappel)", tsel)); const go = el("button", "btn", "Ajouter le rendez-vous"); go.onclick = function () { if (!sel.value || !dt.value) return toast("Patient et date obligatoires"); wbApi("appt-add", { jid: sel.value, at: new Date(dt.value).getTime(), note: note.value, type: tsel.value }).then(function (r) { if (r && r.ok) { toast("Rendez-vous ajoute"); proTab("appts"); } else toast("Echec : " + ((r && r.error) || "")); }); }; body.appendChild(go);
      const rh = inp("number", P.remind.hours || 24); rh.min = 1; rh.max = 168; const rt = ta(P.remind.text); body.appendChild(el("h4", "", "Message de rappel")); body.appendChild(field("Heures avant le rendez-vous", rh)); body.appendChild(field("Texte ({nom} {date} {heure})", rt));
      const r2 = inp("number", P.remind.hours2 || 0); r2.min = 0; r2.max = 167; body.appendChild(field("2e rappel X heures avant (0 = pas de 2e rappel ; seulement si le patient n'a pas repondu, max 1 de plus)", r2)); const sv = el("button", "btn secondary", "Enregistrer le rappel"); sv.onclick = function () { saveKey("remind", { hours: Number(rh.value), hours2: Number(r2.value), text: rt.value }); }; body.appendChild(sv);
      body.appendChild(el("h4", "", "Journal des reponses (pourquoi une reponse a ete ignoree)")); const lg = el("div", "pro-list"); body.appendChild(lg);
      wbApi("pro-log").then(function (r) { (r.items || []).slice(0, 12).forEach(function (x) { const row = el("div", "pro-item"); const tx = el("div"); tx.appendChild(el("b", "", x.name + " · " + when(x.t) + " · « " + x.text + " »")); tx.appendChild(el("small", "pro-why", x.why)); row.appendChild(tx); lg.appendChild(row); }); if (!(r.items || []).length) lg.appendChild(el("div", "list-empty", "Rien pour le moment")); });
      const list = el("div", "pro-list"); body.appendChild(list);
      wbApi("appts").then(function (r) { (r.items || []).slice().sort(function (a, b) { return a.at - b.at; }).forEach(function (a) { const row = el("div", "pro-item"); const tx = el("div"); tx.appendChild(el("b", "", a.name + " · " + when(a.at))); if (a.note) tx.appendChild(el("small", "", a.note)); row.appendChild(tx); row.appendChild(el("span", "list-badge st-" + a.status, ST_LABEL[a.status] || a.status)); const d = el("button", "btn secondary", "✕"); d.onclick = function () { wbApi("appt-del", { id: a.id }).then(function () { proTab("appts"); }); }; row.appendChild(d); list.appendChild(row); }); if (!(r.items || []).length) list.appendChild(el("div", "list-empty", "Aucun rendez-vous")); });
    } else if (t === "agenda") {
      if (!wb.agDay) { const n = new Date(); wb.agDay = n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0"); }
      const bar0 = el("div", "pro-bar"); const dI = inp("date", wb.agDay);
      function shift(n) { const d = new Date(dI.value + "T12:00:00"); d.setDate(d.getDate() + n); wb.agDay = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); proTab("agenda"); }
      const pv = el("button", "btn secondary", "‹ Veille"), nx = el("button", "btn secondary", "Lendemain ›"), td = el("button", "btn secondary", "Aujourd'hui");
      pv.onclick = function () { shift(-1); }; nx.onclick = function () { shift(1); }; td.onclick = function () { wb.agDay = null; proTab("agenda"); }; dI.onchange = function () { if (dI.value) { wb.agDay = dI.value; proTab("agenda"); } };
      bar0.appendChild(pv); bar0.appendChild(dI); bar0.appendChild(nx); bar0.appendChild(td); body.appendChild(bar0);
      const d0 = new Date(wb.agDay + "T00:00:00").getTime(), d1 = d0 + 86400000; const hm = function (ms) { return new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); };
      body.appendChild(el("h4", "", new Date(d0).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })));
      const box = el("div", "pro-list"); body.appendChild(box);
      Promise.all([wbApi("appts"), wbApi("sched")]).then(function (rs) {
        const rows = [];
        (rs[0].items || []).forEach(function (a) { if (a.at >= d0 && a.at < d1) rows.push({ at: a.at, a: a }); });
        (rs[1].items || []).forEach(function (x) { if (x.at >= d0 && x.at < d1 && x.status !== "cancelled") rows.push({ at: x.at, s: x }); });
        rows.sort(function (x, y) { return x.at - y.at; });
        if (!rows.length) box.appendChild(el("div", "list-empty", "Rien de prevu ce jour"));
        rows.forEach(function (r) {
          const row = el("div", "pro-item"); const tx = el("div");
          if (r.a) {
            tx.appendChild(el("b", "", hm(r.at) + " · " + r.a.name)); if (r.a.note) tx.appendChild(el("small", "", r.a.note));
            row.appendChild(tx); row.appendChild(el("span", "list-badge st-" + r.a.status, ST_LABEL[r.a.status] || r.a.status));
            [["confirmed", "Confirme"], ["cancelled", "Annule"]].forEach(function (b) { if (r.a.status === b[0]) return; const bt = el("button", "btn secondary", b[1]); bt.onclick = function () { wbApi("appt-set", { id: r.a.id, status: b[0] }).then(function () { proTab("agenda"); }); }; row.appendChild(bt); });
          } else {
            tx.appendChild(el("b", "", hm(r.at) + " · message a " + r.s.name)); tx.appendChild(el("small", "", r.s.text.slice(0, 80)));
            row.appendChild(tx); row.appendChild(el("span", "list-badge st-" + r.s.status, ST_LABEL[r.s.status] || r.s.status));
          }
          box.appendChild(row);
        });
        const n = rows.filter(function (r) { return r.a; }).length; body.appendChild(el("p", "pro-note", n + " rendez-vous · " + (rows.length - n) + " message(s) programme(s). Les boutons Confirme / Annule changent seulement le statut ici, rien n'est envoye au patient."));
      });
    } else if (t === "note") {
      const jid = wb.proPre; const conv = CONVERSATIONS.filter(function (c) { return c.jid === jid; })[0];
      body.appendChild(el("h4", "", "Note privee : " + (conv ? conv.name : "")));
      body.appendChild(el("p", "pro-note", "Visible seulement par toi. Jamais envoyee au patient. Stockee en clair dans le dossier de donnees de PingChat sur ce PC (pas dans le cloud)."));
      const T = ta("", "Antecedents, allergies, remarques..."); T.rows = 8; body.appendChild(T);
      const meta = el("small", "pro-note", ""); body.appendChild(meta);
      wbApi("note?jid=" + encodeURIComponent(jid)).then(function (r) { T.value = r.text || ""; meta.textContent = r.at ? "Derniere modification : " + when(r.at) : ""; });
      const sv = el("button", "btn", "Enregistrer la note"); sv.onclick = function () { wbApi("note", { jid: jid, text: T.value }).then(function (r) { toast(r && r.ok ? "Note enregistree" : "Echec"); if (r && r.ok) meta.textContent = r.note.at ? "Derniere modification : " + when(r.note.at) : "Note supprimee"; }); };
      body.appendChild(sv);
    } else if (t === "types") {
      body.appendChild(el("p", "pro-note", "Un message de rappel different par type de rendez-vous (ex. consultation, controle, premiere visite). Choisi quand tu ajoutes le rendez-vous ; sans type, le rappel standard est utilise. Variables : {nom} {date} {heure}."));
      const rows = (P.types || []).map(function (x) { return { id: x.id, name: x.name, text: x.text }; }); const box = el("div");
      function paint() { box.innerHTML = ""; rows.forEach(function (q, i) { const r = el("div", "pro-row"); const k = inp("text", q.name, "Nom du type"); k.style.maxWidth = "150px"; k.oninput = function () { q.name = k.value; }; const x = ta(q.text, "Message de rappel"); x.oninput = function () { q.text = x.value; }; const d = el("button", "btn secondary", "✕"); d.onclick = function () { rows.splice(i, 1); paint(); }; r.appendChild(k); r.appendChild(x); r.appendChild(d); box.appendChild(r); }); }
      paint(); body.appendChild(box);
      const add = el("button", "btn secondary", "+ Ajouter un type"); add.onclick = function () { rows.push({ name: "", text: "Bonjour {nom}, rappel de votre rendez-vous le {date} a {heure}. Repondez OUI pour confirmer ou NON pour annuler." }); paint(); };
      const sv = el("button", "btn", "Enregistrer"); sv.onclick = function () { saveKey("types", rows); };
      const bar = el("div", "pro-bar"); bar.appendChild(add); bar.appendChild(sv); body.appendChild(bar);
    } else if (t === "brand") {
      const B = P.brand || {};
      body.appendChild(el("p", "pro-note", "Identite de CE compte : nom du cabinet (rapport, exports), couleur principale de l'application (quand ce compte est actif) et logo (tableau de bord et exports). Le logo reste sur ce PC, il n'est envoye a personne et ne change pas ta photo WhatsApp."));
      const nm = inp("text", B.name || "", "Nom du cabinet"); body.appendChild(field("Nom du cabinet", nm));
      const col = inp("color", B.color || "#f2553f"); const reset = el("button", "btn secondary", "Couleur par defaut"); let color = B.color || ""; col.oninput = function () { color = col.value; };
      reset.onclick = function () { color = ""; col.value = "#f2553f"; }; body.appendChild(field("Couleur principale", col)); body.appendChild(reset);
      let logo = B.logo || ""; const prev = document.createElement("img"); prev.height = 64; prev.style.cssText = "background:#fff;border-radius:10px;padding:4px;margin-top:8px"; if (logo) prev.src = logo; else prev.style.display = "none"; body.appendChild(prev);
      const fi = document.createElement("input"); fi.type = "file"; fi.accept = "image/png,image/jpeg,image/webp"; fi.className = "hidden";
      fi.onchange = function () { const f = fi.files[0]; if (!f) return; const im = new Image(); const u = URL.createObjectURL(f); im.onload = function () { const c = document.createElement("canvas"); const sc = Math.min(1, 256 / Math.max(im.width, im.height)); c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); logo = c.toDataURL("image/png"); prev.src = logo; prev.style.display = ""; }; im.onerror = function () { toast("Image illisible"); }; im.src = u; };
      const pick = el("button", "btn secondary", "Choisir un logo..."); pick.onclick = function () { fi.click(); }; const rm = el("button", "btn secondary", "Retirer le logo"); rm.onclick = function () { logo = ""; prev.style.display = "none"; };
      const bar0 = el("div", "pro-bar"); bar0.appendChild(pick); bar0.appendChild(rm); body.appendChild(bar0); body.appendChild(fi);
      const sv = el("button", "btn", "Enregistrer"); sv.onclick = function () { saveKey("brand", { name: nm.value, color: color, logo: logo }, "Identite enregistree"); }; body.appendChild(sv);
    } else if (t === "import") {
      body.appendChild(el("p", "pro-note", "Importe une liste de patients depuis un fichier CSV (dans Excel : Enregistrer sous > CSV). Colonnes reconnues par leur titre : nom, telephone (obligatoire), etiquette, rdv (date et heure, ex. 2026-12-03 10:30), motif. Rien n'est envoye aux patients : ca enregistre les noms (localement dans PingChat, pas dans ton telephone), les etiquettes et les rendez-vous a venir. Les numeros marocains 06.. / 07.. sont convertis en +212. PingChat ne verifie PAS que le numero a WhatsApp."));
      const out = el("div"); const fi = document.createElement("input"); fi.type = "file"; fi.accept = ".csv,text/csv,text/plain"; fi.className = "hidden";
      fi.onchange = function () { const f = fi.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = function () { csvPreview(String(rd.result), out); }; rd.readAsText(f); };
      const pick = el("button", "btn", "Choisir un fichier CSV..."); pick.onclick = function () { fi.click(); }; body.appendChild(pick); body.appendChild(fi); body.appendChild(out);
    } else if (t === "lib") {
      body.appendChild(el("p", "pro-note", "Tes documents types (ordonnance type, consignes avant analyse, plan d'acces...). Un clic = envoi a UN patient que tu choisis, jamais en masse. Ne mets pas de document propre a un patient ici. Stockes en clair sur ce PC."));
      const sel = chatSelect(wb.proPre); body.appendChild(field("Envoyer a", sel));
      const list = el("div", "pro-list"); body.appendChild(list);
      const fi = document.createElement("input"); fi.type = "file"; fi.className = "hidden";
      fi.onchange = function () { const f = fi.files[0]; if (!f) return; if (f.size > 20 * 1024 * 1024) return toast("20 Mo max"); const rd = new FileReader(); rd.onload = function () { const mm = /^data:([^;,]*)[^,]*;base64,(.*)$/.exec(String(rd.result)); if (!mm) return toast("Fichier illisible"); wbApi("lib-add", { name: f.name, mime: f.type || mm[1], data: mm[2] }).then(function (r) { toast(r && r.ok ? "Fichier ajoute" : "Echec : " + ((r && r.error) || "")); proTab("lib"); }); }; rd.readAsDataURL(f); };
      const add = el("button", "btn", "+ Ajouter un fichier"); add.onclick = function () { fi.click(); }; body.appendChild(add); body.appendChild(fi);
      wbApi("library").then(function (r) { (r.items || []).forEach(function (f) { const row = el("div", "pro-item"); const tx = el("div"); tx.appendChild(el("b", "", f.name)); tx.appendChild(el("small", "", Math.round(f.size / 1024) + " Ko")); row.appendChild(tx);
        const sd = el("button", "btn secondary", "Envoyer"); sd.onclick = function () { if (!sel.value) return toast("Choisis un patient"); const nm = sel.options[sel.selectedIndex].text; if (!confirm("Envoyer « " + f.name + " » a " + nm + " ?")) return; wbApi("lib-send", { jid: sel.value, id: f.id }).then(function (x) { toast(x && x.ok ? "Fichier envoye" : "Echec : " + ((x && x.error) || "")); }); };
        const dl = el("button", "btn secondary", "✕"); dl.onclick = function () { if (confirm("Supprimer " + f.name + " de la bibliotheque ?")) wbApi("lib-del", { id: f.id }).then(function () { proTab("lib"); }); };
        row.appendChild(sd); row.appendChild(dl); list.appendChild(row); }); if (!(r.items || []).length) list.appendChild(el("div", "list-empty", "Bibliotheque vide")); });
    } else if (t === "find") {
      body.appendChild(el("p", "pro-note", "Cherche dans les messages de CE compte, par mot, par nom de contact et/ou par dates."));
      const q = inp("text", "", "Mot ou phrase"), nm = inp("text", "", "Nom ou numero du contact"), f1 = inp("date", ""), f2 = inp("date", "");
      body.appendChild(field("Mot", q)); body.appendChild(field("Contact", nm)); body.appendChild(field("Du", f1)); body.appendChild(field("Au", f2));
      const out = el("div", "pro-list");
      const go = el("button", "btn", "Chercher"); go.onclick = function () { out.innerHTML = ""; wbApi("search?q=" + encodeURIComponent(q.value) + "&name=" + encodeURIComponent(nm.value) + "&from=" + f1.value + "&to=" + f2.value).then(function (r) { const items = (r && r.items) || []; if (!items.length) { out.appendChild(el("div", "list-empty", "Aucun resultat")); return; } items.forEach(function (m) { const row = el("div", "pro-item"); const tx = el("div"); tx.appendChild(el("b", "", (m.name || "") + " · " + when(m.ts * 1000))); tx.appendChild(el("small", "", String(m.text).slice(0, 120))); row.appendChild(tx); const op = el("button", "btn secondary", "Ouvrir"); op.onclick = function () { $("pro-overlay").classList.add("hidden"); const c = getConv("x" + m.jid); if (c) openConversation(c.id); else toast("Discussion introuvable"); }; row.appendChild(op); out.appendChild(row); }); if (items.length >= 80) out.appendChild(el("p", "pro-note", "80 premiers resultats : precise ta recherche.")); }); };
      body.appendChild(go); body.appendChild(out);
    } else if (t === "report") {
      body.appendChild(el("p", "pro-note", "Resume des 7 derniers jours de CE compte, calcule en local. Tu peux le copier ou l'imprimer (rien n'est envoye)."));
      const nm = inp("text", (P.brand && P.brand.name) || "", "Nom du cabinet"); const svn = el("button", "btn secondary", "Enregistrer le nom"); svn.onclick = function () { saveKey("brand", Object.assign({}, P.brand || {}, { name: nm.value }), "Nom enregistre"); };
      body.appendChild(field("Nom du cabinet (en-tete du rapport et des exports)", nm)); body.appendChild(svn);
      const box = el("pre", "pro-note"); box.style.whiteSpace = "pre-wrap"; body.appendChild(box);
      wbApi("dashboard").then(function (d) {
        if (!d || !d.ok) { box.textContent = "Rapport indisponible"; return; }
        const tin = d.days.reduce(function (a, x) { return a + x.in; }, 0), tout = d.days.reduce(function (a, x) { return a + x.out; }, 0), W = d.week;
        const d1 = new Date(d.days[0].t).toLocaleDateString("fr-FR"), d2 = new Date(d.days[6].t).toLocaleDateString("fr-FR");
        const txt = ((P.brand && P.brand.name) ? P.brand.name + "\n" : "") + "Rapport hebdomadaire " + d1 + " - " + d2 + " (" + accNameById(wb.acc) + ")\n\nMessages recus : " + tin + "\nMessages envoyes : " + tout + "\nRappels de rendez-vous envoyes : " + W.reminded + "\nConfirmes : " + W.confirmed + "\nAnnules : " + W.cancelled + "\nSans reponse : " + W.noReply + "\nDiscussions sans reponse de ta part (7 j) : " + d.unansweredCount + "\nMessages non lus : " + d.unreadTotal + "\nMessages programmes en attente : " + d.sched.pending + " (manques : " + d.sched.missed + ")";
        box.textContent = txt;
        const bar = el("div", "pro-bar"); const cp = el("button", "btn", "Copier"); cp.onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast("Copie"); }, function () { toast("Copie impossible : selectionne le texte"); }); };
        const pr = el("button", "btn secondary", "Telecharger (HTML imprimable)"); pr.onclick = function () { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["<!doctype html><meta charset=utf-8><title>Rapport</title><pre style='font:15px Arial;white-space:pre-wrap;max-width:700px;margin:30px auto'>" + txt.replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }) + "</pre>"], { type: "text/html" })); a.download = "rapport-hebdo.html"; document.body.appendChild(a); a.click(); a.remove(); };
        bar.appendChild(cp); bar.appendChild(pr); body.appendChild(bar);
      });
    } else if (t === "vac") {
      const V = P.vacation || { on: false, until: "", text: "" };
      body.appendChild(el("p", "pro-note", "Mode conge : pendant cette periode, la 1re fois qu'un patient t'ecrit il recoit ce message (une seule fois par contact et par conge, groupes ignores). Il se coupe tout seul apres la date de retour. Marche seulement quand PingChat est ouvert et connecte."));
      const on = el("input"); on.type = "checkbox"; on.checked = !!V.on; const lw = el("label", "pro-f inline"); lw.appendChild(on); lw.appendChild(el("span", "", "Activer le mode conge")); body.appendChild(lw);
      const un = inp("date", V.until || ""); body.appendChild(field("Date de retour (derniere journee de conge incluse)", un));
      const tx = ta(V.text); body.appendChild(field("Message ({date} = date de retour)", tx));
      const sv = el("button", "btn", "Enregistrer"); sv.onclick = function () { if (on.checked && !un.value) return toast("Choisis la date de retour"); saveKey("vacation", { on: on.checked, until: un.value, text: tx.value }, on.checked ? "Mode conge active" : "Mode conge desactive"); }; body.appendChild(sv);
    } else if (t === "link") {
      body.appendChild(el("p", "pro-note", "Lien wa.me de ce compte : le patient clique (ou scanne le QR) et une discussion s'ouvre avec ton numero. Utile sur une carte de visite ou une affiche."));
      const tx = inp("text", "", "Message pre-rempli (facultatif)"); body.appendChild(field("Message pre-rempli", tx));
      const out = el("div"); body.appendChild(out);
      function gen() { out.innerHTML = ""; wbApi("wame?text=" + encodeURIComponent(tx.value)).then(function (r) {
        if (!r || !r.ok) { out.appendChild(el("p", "pro-note", "Impossible : " + ((r && r.error) || "echec"))); return; }
        const im = document.createElement("img"); im.src = r.qr; im.width = 220; im.height = 220; im.style.background = "#fff"; im.style.borderRadius = "10px"; im.alt = "QR"; out.appendChild(im);
        const li = inp("text", r.link); li.readOnly = true; out.appendChild(li);
        const bar = el("div", "pro-bar"); const cp = el("button", "btn", "Copier le lien"); cp.onclick = function () { li.select(); (navigator.clipboard ? navigator.clipboard.writeText(r.link) : Promise.reject()).then(function () { toast("Lien copie"); }, function () { document.execCommand("copy"); toast("Lien copie"); }); };
        const sa = el("button", "btn secondary", "Enregistrer le QR"); sa.onclick = function () { const a = document.createElement("a"); a.href = r.qr; a.download = "pingchat-qr.png"; document.body.appendChild(a); a.click(); a.remove(); };
        bar.appendChild(cp); bar.appendChild(sa); out.appendChild(bar); }); }
      const go = el("button", "btn secondary", "Generer"); go.onclick = gen; body.appendChild(go); gen();
    } else if (t === "backup") {
      body.appendChild(el("p", "pro-note", "La sauvegarde contient les discussions, messages, contacts, notes, rendez-vous et reglages de CE compte (" + accNameById(wb.acc) + "). Elle ne contient PAS la session WhatsApp ni les photos/documents. ATTENTION : c'est une donnee de sante en clair, sauf si tu mets un mot de passe. Garde-la sur un support que tu controles (cle USB chiffree, disque du cabinet), jamais dans un cloud public."));
      const pw = inp("password", "", "Mot de passe (facultatif mais conseille)"); body.appendChild(field("Mot de passe de chiffrement", pw));
      const dl = el("button", "btn", "Telecharger une sauvegarde"); dl.onclick = function () {
        fetch("api/backup", { method: "POST", headers: { "Content-Type": "application/json", "X-PingChat": "1" }, body: JSON.stringify({ acc: wb.acc, pass: pw.value }) }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); }).then(function (b) { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "pingchat-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json"; document.body.appendChild(a); a.click(); a.remove(); toast(pw.value ? "Sauvegarde chiffree telechargee" : "Sauvegarde (non chiffree) telechargee"); }).catch(function (e) { toast("Echec : " + e.message); });
      };
      function doRestore(body2, label) {
        if (!confirm("Restaurer " + label + " ?\n\nLes discussions, notes, rendez-vous et reglages de ce compte seront REMPLACES. Une copie de l'etat actuel est gardee avant (pre-restore).")) return;
        wbApi("restore", Object.assign({ pass: pw.value }, body2)).then(function (r) { if (r && r.ok) { toast("Sauvegarde restauree (" + r.chats + " discussions)"); wbLoadPro(); if (typeof wbRefreshChats === "function") wbRefreshChats(); else setTimeout(function () { location.reload(); }, 800); } else toast("Echec : " + ((r && r.error) || "")); });
      }
      const fi = document.createElement("input"); fi.type = "file"; fi.accept = ".json"; fi.className = "hidden";
      fi.onchange = function () { const f = fi.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = function () { doRestore({ text: String(rd.result) }, "le fichier " + f.name); }; rd.readAsText(f); };
      const rs = el("button", "btn secondary", "Restaurer depuis un fichier..."); rs.onclick = function () { fi.click(); };
      const bar = el("div", "pro-bar"); bar.appendChild(dl); bar.appendChild(rs); body.appendChild(bar); body.appendChild(fi);
      body.appendChild(el("h4", "", "Sauvegardes automatiques (1 par jour, les 10 dernieres)"));
      body.appendChild(el("p", "pro-note", "Faites quand PingChat est ouvert, dans le dossier du compte sur ce PC. Elles ne sont pas chiffrees : elles protegent d'une erreur, pas d'une panne de disque."));
      const list = el("div", "pro-list"); body.appendChild(list);
      wbApi("backups").then(function (r) { (r.items || []).forEach(function (b) { const row = el("div", "pro-item"); const tx = el("div"); tx.appendChild(el("b", "", (b.name.indexOf("pre-") === 0 ? "Avant restauration · " : "Auto · ") + when(b.at))); tx.appendChild(el("small", "", Math.round(b.size / 1024) + " Ko")); row.appendChild(tx); const bt = el("button", "btn secondary", "Restaurer"); bt.onclick = function () { doRestore({ file: b.name }, "cette sauvegarde"); }; row.appendChild(bt); list.appendChild(row); }); if (!(r.items || []).length) list.appendChild(el("div", "list-empty", "Pas encore de sauvegarde automatique (la premiere est faite apres 1 minute d'utilisation)")); });
    } else if (t === "lock") {
      const L = lockCfg(); body.appendChild(el("p", "pro-note", "Le code verrouille l'ecran de PingChat (demarrage et inactivite) et masque le texte des notifications. Ce n'est PAS un chiffrement : les fichiers de donnees sur le disque restent lisibles par quelqu'un qui a acces a la session Windows. Active aussi BitLocker et un mot de passe Windows."));
      body.appendChild(el("p", "", L ? "Verrouillage actif (apres " + L.mins + " min d'inactivite)." : "Aucun code defini."));
      const set = el("button", "btn", L ? "Changer le code" : "Definir un code"); set.onclick = function () { askText("Nouveau code (4 a 8 chiffres)", "1234").then(function (v) { if (v === null) return; if (!/^\d{4,8}$/.test(v)) return toast("4 a 8 chiffres"); lockSet(v, L ? L.mins : 5).then(function () { toast("Code enregistre"); proTab("lock"); }); }); }; body.appendChild(set);
      if (L) {
        const mi = inp("number", L.mins); mi.min = 1; mi.max = 120; body.appendChild(field("Verrouiller apres (minutes d'inactivite)", mi));
        const sm = el("button", "btn secondary", "Enregistrer le delai"); sm.onclick = function () { const c = lockCfg(); c.mins = Math.max(1, Math.min(120, Number(mi.value) || 5)); localStorage.setItem(LOCK_KEY, JSON.stringify(c)); toast("Delai enregistre"); }; body.appendChild(sm);
        const now = el("button", "btn secondary", "Verrouiller maintenant"); now.onclick = function () { $("pro-overlay").classList.add("hidden"); lockShow(); }; body.appendChild(now);
        const off = el("button", "btn secondary", "Supprimer le code"); off.onclick = function () { askText("Code actuel", "").then(function (v) { if (v === null) return; lockCheck(v).then(function (ok) { if (ok) { localStorage.removeItem(LOCK_KEY); toast("Code supprime"); proTab("lock"); } else toast("Code incorrect"); }); }); }; body.appendChild(off);
      }
    } else if (t === "share") {
      body.appendChild(el("p", "pro-note", "Medecin + secretaire sur deux PC : PingChat ne partage PAS les donnees entre deux PC (pas de cloud, par choix). La solution la plus simple et sure : sur le 2e PC, installe PingChat et scanne son QR avec le meme telephone (Appareils connectes : WhatsApp en accepte jusqu'a 4). Les deux PC recoivent les messages et peuvent repondre."));
      ["Activer la reponse automatique et les rappels de rendez-vous sur UN SEUL PC, sinon le patient recoit les messages en double.", "Les etiquettes, rendez-vous, reponses rapides et messages programmes ne sont pas synchronises entre les deux PC.", "Les deux PC ecrivent sous le meme numero : le patient ne voit pas qui repond."].forEach(function (x) { body.appendChild(el("p", "pro-note", "• " + x)); });
    }
  }
  // verrouillage par code
  const LOCK_KEY = "pingchat.lock";
  function lockCfg() { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || "null"); } catch (e) { return null; } }
  function sha(s) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, "0"); }).join(""); }); }
  function lockSet(pin, mins) { const salt = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(12)), function (x) { return x.toString(16).padStart(2, "0"); }).join(""); return sha(salt + pin).then(function (h) { localStorage.setItem(LOCK_KEY, JSON.stringify({ salt: salt, hash: h, mins: mins || 5 })); lockArm(); }); }
  function lockCheck(pin) { const c = lockCfg(); if (!c) return Promise.resolve(true); return sha(c.salt + pin).then(function (h) { return h === c.hash; }); }
  let lockFails = 0, lockUntil = 0, idleT = null;
  function lockShow() { if (!lockCfg()) return; wb.locked = true; $("lock-overlay").classList.remove("hidden"); $("lock-input").value = ""; $("lock-msg").textContent = ""; setTimeout(function () { $("lock-input").focus(); }, 30); }
  function lockTry() {
    if (Date.now() < lockUntil) { $("lock-msg").textContent = "Trop d'essais. Attends " + Math.ceil((lockUntil - Date.now()) / 1000) + " s."; return; }
    lockCheck($("lock-input").value).then(function (ok) {
      if (ok) { lockFails = 0; wb.locked = false; $("lock-overlay").classList.add("hidden"); lockArm(); }
      else { lockFails++; $("lock-input").value = ""; $("lock-msg").textContent = "Code incorrect"; if (lockFails >= 5) { lockUntil = Date.now() + 30000; lockFails = 0; } }
    });
  }
  function lockArm() { clearTimeout(idleT); const c = lockCfg(); if (!c || wb.locked) return; idleT = setTimeout(lockShow, c.mins * 60000); }
  $("lock-ok").addEventListener("click", lockTry);
  $("lock-input").addEventListener("keydown", function (e) { if (e.key === "Enter") lockTry(); });
  ["mousemove", "keydown", "click"].forEach(function (ev) { document.addEventListener(ev, function () { if (!wb.locked) lockArm(); }, true); });
  if (lockCfg()) lockShow();

  fetch("api/version").then(function (r) { return r.json(); }).then(function (v) { if (v && v.version) $("about-line").textContent = "A propos : PingChat version " + v.version; }).catch(function () {});
  // ---------- v1.6 : tableau de bord ----------
  const DS_LABEL = { pending: "en attente", reminded: "rappel envoye", confirmed: "CONFIRME", cancelled: "ANNULE", past: "passe" };
  let dashTimer = null, dashSel = "all";
  function hm(ms) { return new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
  function ageOf(ts) { const m = Math.round((Date.now() / 1000 - ts) / 60); return m < 60 ? m + " min" : m < 1440 ? Math.floor(m / 60) + " h" : Math.floor(m / 1440) + " j"; }
  function dashOpen() {
    if (!wb.on) return toast("Le tableau de bord marche avec WhatsApp Web");
    dashSel = wb.accounts.length > 1 ? "all" : (wb.acc || "all");
    $("dash-overlay").classList.remove("hidden"); $("dash-close").onclick = dashClose;
    (function () { const h = document.querySelector("#dash-overlay .dash-head h2"); let im = $("dash-logo"); const lg = wb.pro && wb.pro.brand && wb.pro.brand.logo; if (!im && lg && h) { im = document.createElement("img"); im.id = "dash-logo"; im.height = 32; im.style.cssText = "background:#fff;border-radius:8px;padding:2px;margin-right:10px;vertical-align:middle"; h.parentNode.insertBefore(im, h); } if (im) { if (lg) { im.src = lg; im.style.display = ""; } else im.style.display = "none"; } })();
    dashLoad(); clearInterval(dashTimer); dashTimer = setInterval(dashLoad, 30000);
  }
  function dashClose() { $("dash-overlay").classList.add("hidden"); clearInterval(dashTimer); }
  function dashTabs() {
    const t = $("dash-tabs"); t.innerHTML = "";
    const mk = function (id, name) { const b = el("button", "chip" + (dashSel === id ? " active" : ""), name); b.onclick = function () { dashSel = id; dashTabs(); dashLoad(); }; t.appendChild(b); };
    if (wb.accounts.length > 1) mk("all", "Tous les comptes");
    wb.accounts.forEach(function (a, k) { mk(a.id, accName(a, k)); });
  }
  function dashLoad() {
    dashTabs();
    const q = dashSel === "all" ? "dashboard-all" : "dashboard?acc=" + encodeURIComponent(dashSel);
    fetch("api/" + q).then(function (r) { return r.json(); }).then(function (r) {
      if (!r || !r.ok) return;
      $("dash-stamp").textContent = "Mis a jour " + hm(Date.now());
      if (dashSel === "all") dashAll(r.items); else dashOne(r);
    }).catch(function () { $("dash-body").textContent = "Pont injoignable"; });
  }
  function kpi(n, label, tone) { const k = el("div", "kpi " + (tone || "")); k.appendChild(el("b", "", String(n))); k.appendChild(el("span", "", label)); return k; }
  function card(title, wide) { const c = el("section", "dcard" + (wide ? " wide" : "")); c.appendChild(el("h3", "", title)); return c; }
  function empty(t) { return el("div", "list-empty", t); }
  function stDot(s) { const i = el("i", "conn-dot " + (s === "open" ? "ok" : "off")); return i; }
  const CONN = { open: "connecte", qr: "QR a scanner", starting: "demarrage", reconnecting: "reconnexion", logged_out: "deconnecte", error: "erreur" };
  function dashAll(items) {
    const b = $("dash-body"); b.innerHTML = "";
    const g = el("div", "dgrid");
    const tot = items.reduce(function (o, d) { o.ap += d.today.length; o.un += d.unreadTotal; o.sa += d.unansweredCount; o.sp += d.sched.pending; return o; }, { ap: 0, un: 0, sa: 0, sp: 0 });
    const kp = el("div", "kpis wide"); kp.appendChild(kpi(tot.ap, "rendez-vous aujourd'hui")); kp.appendChild(kpi(tot.un, "messages non lus", tot.un ? "warn" : "")); kp.appendChild(kpi(tot.sa, "sans reponse", tot.sa ? "warn" : "")); kp.appendChild(kpi(tot.sp, "messages programmes")); g.appendChild(kp);
    const c = card("Comptes", true);
    items.forEach(function (d, k) {
      const a = wb.accounts.find(function (x) { return x.id === d.acc; }) || {};
      const row = el("div", "pro-item"); row.style.cursor = "pointer"; row.appendChild(stDot(d.status));
      const tx = el("div"); tx.appendChild(el("b", "", accName(a, k) + (d.me ? " · " + d.me : ""))); tx.appendChild(el("small", "", (CONN[d.status] || d.status) + " · " + d.today.length + " rdv aujourd'hui · " + d.unreadTotal + " non lus · " + d.unansweredCount + " sans reponse · " + d.sched.pending + " programmes · reponse auto " + (d.auto.on ? "ON" : "off")));
      row.appendChild(tx); row.onclick = function () { dashSel = d.acc; dashLoad(); }; c.appendChild(row);
    });
    g.appendChild(c); b.appendChild(g);
  }
  function openChatOf(acc, jid) {
    dashClose();
    const go = function () { if (getConv("x" + jid)) openConversation("x" + jid); else toast("Discussion introuvable"); };
    if (acc !== wb.acc) { wbSwitch(acc); setTimeout(go, 2000); } else go();
  }
  function dashOne(d) {
    const b = $("dash-body"); b.innerHTML = "";
    const g = el("div", "dgrid");
    const kp = el("div", "kpis wide");
    kp.appendChild(kpi(d.today.length, "rendez-vous aujourd'hui")); kp.appendChild(kpi(d.unreadTotal, "messages non lus (" + d.unreadChats + " disc.)", d.unreadTotal ? "warn" : ""));
    kp.appendChild(kpi(d.unansweredCount, "sans reponse (7 j)", d.unansweredCount ? "warn" : "")); kp.appendChild(kpi(d.sched.pending, "programmes en attente" + (d.sched.missed ? " · " + d.sched.missed + " manques" : ""), d.sched.missed ? "bad" : ""));
    g.appendChild(kp);
    // agenda du jour
    let c = card("Agenda du jour"); if (!d.today.length) c.appendChild(empty("Aucun rendez-vous aujourd'hui"));
    d.today.forEach(function (a) { const r = el("div", "pro-item"); const tx = el("div"); tx.appendChild(el("b", "", hm(a.at) + " · " + a.name)); if (a.note) tx.appendChild(el("small", "", a.note)); r.appendChild(tx); r.appendChild(el("span", "list-badge st-" + a.status, DS_LABEL[a.status] || a.status)); c.appendChild(r); }); g.appendChild(c);
    c = card("A venir (7 jours)"); if (!d.upcoming.length) c.appendChild(empty("Rien de prevu"));
    d.upcoming.forEach(function (a) { const r = el("div", "pro-item"); const tx = el("div"); tx.appendChild(el("b", "", when(a.at) + " · " + a.name)); r.appendChild(tx); r.appendChild(el("span", "list-badge st-" + a.status, DS_LABEL[a.status] || a.status)); c.appendChild(r); }); g.appendChild(c);
    // discussions
    c = card("Non lus"); if (!d.unread.length) c.appendChild(empty("Tout est lu"));
    d.unread.forEach(function (u) { const r = el("div", "pro-item"); r.style.cursor = "pointer"; const tx = el("div"); tx.appendChild(el("b", "", u.name)); tx.appendChild(el("small", "", u.unread + " non lu(s) · il y a " + ageOf(u.ts))); r.appendChild(tx); r.onclick = function () { openChatOf(d.acc, u.jid); }; c.appendChild(r); }); g.appendChild(c);
    c = card("Sans reponse (dernier message du patient)"); if (!d.unanswered.length) c.appendChild(empty("Rien en attente"));
    d.unanswered.forEach(function (u) { const r = el("div", "pro-item"); r.style.cursor = "pointer"; const tx = el("div"); tx.appendChild(el("b", "", u.name + " · il y a " + ageOf(u.ts))); tx.appendChild(el("small", "", u.text)); r.appendChild(tx); r.onclick = function () { openChatOf(d.acc, u.jid); }; c.appendChild(r); }); g.appendChild(c);
    // programmes
    c = card("Messages programmes"); c.appendChild(el("p", "pro-note", d.sched.pending + " en attente · " + d.sched.missed + " manques · " + d.sched.failed + " en echec"));
    d.sched.next.forEach(function (s) { const r = el("div", "pro-item"); const tx = el("div"); tx.appendChild(el("b", "", when(s.at) + " · " + s.name)); tx.appendChild(el("small", "", s.text)); r.appendChild(tx); c.appendChild(r); }); g.appendChild(c);
    // automatisations
    c = card("Automatisations");
    [["Reponse auto hors horaires", d.auto.on ? "ON" + (d.auto.open ? " (cabinet ouvert maintenant)" : " (cabinet ferme maintenant)") : "OFF"], ["Rappels de rendez-vous", d.auto.reminderHours + " h avant"], ["PC qui les execute", d.auto.pc + " (seulement quand PingChat est ouvert et connecte ici)"], ["Connexion", (CONN[d.status] || d.status) + (d.me ? " · " + d.me : "")]].forEach(function (x) { const r = el("div", "pro-item"); const tx = el("div"); tx.appendChild(el("b", "", x[0])); tx.appendChild(el("small", "pro-why", x[1])); r.appendChild(tx); c.appendChild(r); }); g.appendChild(c);
    // etiquettes
    c = card("Patients par etiquette"); if (!d.labels.length) c.appendChild(empty("Aucune etiquette (Cabinet > Etiquettes)"));
    const mx = Math.max(1, Math.max.apply(null, d.labels.map(function (l) { return l.n; })));
    d.labels.forEach(function (l) { const r = el("div", "bar-row"); r.appendChild(el("span", "bar-l", l.name)); const t = el("div", "bar-t"); const f = el("div", "bar-f"); f.style.width = Math.round(100 * l.n / mx) + "%"; f.style.background = l.color; t.appendChild(f); r.appendChild(t); r.appendChild(el("b", "", String(l.n))); c.appendChild(r); }); g.appendChild(c);
    // semaine
    c = card("Semaine (7 jours)", true);
    const mm = Math.max(1, Math.max.apply(null, d.days.map(function (x) { return Math.max(x.in, x.out); })));
    const ch = el("div", "wk-chart");
    d.days.forEach(function (x) { const col = el("div", "wk-col"); const bars = el("div", "wk-bars"); const bi = el("i", "wk-in"); bi.style.height = Math.round(100 * x.in / mm) + "%"; bi.title = x.in + " recus"; const bo = el("i", "wk-out"); bo.style.height = Math.round(100 * x.out / mm) + "%"; bo.title = x.out + " envoyes"; bars.appendChild(bi); bars.appendChild(bo); col.appendChild(bars); col.appendChild(el("small", "", new Date(x.t).toLocaleDateString("fr-FR", { weekday: "short" }))); col.appendChild(el("small", "wk-n", x.in + "/" + x.out)); ch.appendChild(col); });
    c.appendChild(ch); c.appendChild(el("p", "pro-note", "Barres : messages recus (indigo) / envoyes (corail) par jour, discussions individuelles, seulement ce que PingChat a vu."));
    const kw = el("div", "kpis"); kw.appendChild(kpi(d.week.reminded, "rappels envoyes")); kw.appendChild(kpi(d.week.confirmed, "confirmations", "good")); kw.appendChild(kpi(d.week.cancelled, "annulations", d.week.cancelled ? "warn" : "")); kw.appendChild(kpi(d.week.noReply, "sans reponse au rappel", d.week.noReply ? "warn" : ""));
    c.appendChild(kw); g.appendChild(c);
    b.appendChild(g);
  }

  // ---------- Demarrage ----------
  paintSettings();
  renderStories();
  startWb().then(function (ok) { if (!ok) startLive(); });
  renderChatList();
})();
