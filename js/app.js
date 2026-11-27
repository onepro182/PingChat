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
    try {
      // Les images et vocaux (blobs) restent en memoire : on ne les sauvegarde pas
      const out = CONVERSATIONS.map(function (c) {
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
    const n = CONVERSATIONS.reduce(function (s, c) { return s + (c.unread || 0); }, 0);
    document.title = (n ? "(" + n + ") " : "") + "PingChat";
  }
  function notifyIncoming(conv, text) {
    playSound("in");
    if (settings.notif && document.hidden && "Notification" in window && Notification.permission === "granted") {
      try { new Notification(conv.name, { body: text, icon: "assets/logo.svg" }); } catch (e) {}
    } else if (activeId !== conv.id) {
      toast("💬 " + conv.name + " : " + text);
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
    if (act === "delete-all") {
      if (!CONVERSATIONS.length) return toast("Aucune discussion");
      if (!confirm("Supprimer TOUTES les discussions ?")) return;
      CONVERSATIONS.length = 0; activeId = null; save(); closeChat(); renderChatList();
      toast("Toutes les discussions ont ete supprimees");
    }
    if (act === "read-all") {
      CONVERSATIONS.forEach(function (c) { c.unread = 0; });
      save(); renderChatList(); toast("Toutes les discussions sont lues");
    }
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
    if (act === "pin") { conv.pinned = !conv.pinned; save(); renderChatList(); toast(conv.pinned ? "Discussion epinglee" : "Discussion desepinglee"); }
    if (act === "clear") {
      if (!confirm("Vider cette discussion ?")) return;
      conv.days = [{ date: "Aujourd'hui", messages: [] }];
      save(); renderMessages(conv); renderChatList();
    }
    if (act === "delete") {
      if (!confirm("Supprimer cette discussion ?")) return;
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
      if (!q) return true;
      return c.name.toLowerCase().includes(q) ||
        allMessages(c).some(function (m) { return m.type === "text" && !m.deleted && m.text.toLowerCase().includes(q); });
    }).sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0); });

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
          '<span class="chat-item-time' + (conv.unread ? " unread" : "") + '">' + (last ? last.time : "") + "</span></div>" +
          '<div class="chat-item-bottom"><span class="chat-item-preview">' + previewTicks +
          '<span class="preview-text"></span></span><span style="display:flex;gap:6px;align-items:center">' + pin + badge + "</span></div>" +
        "</div>";
      li.querySelector(".chat-item-name").textContent = conv.name;
      li.querySelector(".preview-text").textContent = previewOf(last);
      const del = document.createElement("button");
      del.className = "item-del";
      del.title = "Supprimer la discussion";
      del.setAttribute("aria-label", "Supprimer la discussion " + conv.name);
      del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>';
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!confirm("Supprimer la discussion avec " + conv.name + " ?")) return;
        CONVERSATIONS.splice(CONVERSATIONS.indexOf(conv), 1);
        if (activeId === conv.id) { activeId = null; closeChat(); }
        save(); renderChatList(); toast("Discussion supprimee");
      });
      li.appendChild(del);
      li.addEventListener("click", function () { openConversation(conv.id); });
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
  searchInput.addEventListener("input", renderChatList);

  // ---------- Nouvelle discussion ----------
  $("new-chat-btn").addEventListener("click", function () {
    const name = (prompt("Nom du contact :") || "").trim();
    if (!name) return;
    const phone = (prompt("Numero de telephone (optionnel) :") || "").trim();
    const keys = Object.keys(AVATAR_COLORS);
    const id = "c" + Date.now().toString(36);
    AVATAR_COLORS[id] = ["#7c5cd6", "#e05656", "#00a884", "#e08a2d", "#3a8dde", "#d6569a"][keys.length % 6];
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
      if (dayIndex === 0) {
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
        sender.style.cssText = "font-size:12.5px;font-weight:600;color:#e05656;margin-bottom:2px;";
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
      } else if (msg.type === "voice") {
        bubble.appendChild(buildVoice(msg));
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
    meta.innerHTML = "<span>" + msg.time + "</span>" + (msg.from === "out" ? ticksSvg(msg.state) : "");
    bubble.appendChild(meta);

    if (!msg.deleted && msg.reaction) {
      const rb = document.createElement("span");
      rb.className = "reaction-badge";
      rb.textContent = msg.reaction;
      rb.title = "Retirer la reaction";
      rb.addEventListener("click", function (e) { e.stopPropagation(); msg.reaction = null; save(); renderMessages(conv); });
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
    if (msg.type === "text") item("Copier", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(msg.text).then(function () { toast("Copie"); });
    });
    item("Supprimer", function () { msg.deleted = true; save(); renderMessages(conv); renderChatList(); }, "danger");
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
    renderMessages(conv);
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
    if (!file || !file.type.startsWith("image/")) return toast("Ce fichier n'est pas une image");
    if (file.size > 8 * 1024 * 1024) return toast("Image trop lourde (8 Mo max)");
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
  $("file-input").addEventListener("change", function () {
    if (this.files[0]) prepareImage(this.files[0]);
    this.value = "";
  });
  $("overlay-send").addEventListener("click", sendPendingImage);
  $("overlay-caption").addEventListener("keydown", function (e) { if (e.key === "Enter") sendPendingImage(); });
  messageInput.addEventListener("paste", function (e) {
    const items = (e.clipboardData || {}).items || [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) { e.preventDefault(); prepareImage(items[i].getAsFile()); return; }
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
    pushMessage(getConv(activeId), { type: "voice", src: URL.createObjectURL(blob), duration: dur });
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

  // ---------- Statuts (stories) ----------
  const DAY = 24 * 3600 * 1000;
  const STORY_COLORS = ["#00a884", "#7c5cd6", "#e05656", "#e08a2d", "#3a8dde", "#d6569a", "#111b21"];
  let stories = [];
  (function loadStories() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORY_KEY) || "null"); } catch (e) {}
    if (raw) stories = raw;
    else stories = DEMO_STORIES.map(function (s) { return Object.assign({}, s, { ts: Date.now() - s.ageH * 3600 * 1000 }); });
    stories = stories.filter(function (s) { return Date.now() - s.ts < DAY; });
  })();
  function saveStories() {
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
    bar.appendChild(bubbleFor("me", "Mon statut", "#00a884", mine.length ? "seen" : "", function () {
      if (mine.length) openStoryViewer("me"); else openComposer();
    }, mine.length > 0));
    CONVERSATIONS.forEach(function (c) {
      const list = storiesOf(c.id);
      if (!list.length) return;
      const unseen = list.some(function (s) { return !s.seen; });
      bar.appendChild(bubbleFor(c.id, c.name, avatarColor(c.id), unseen ? "new" : "seen", function () { openStoryViewer(c.id); }));
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
    const body = $("story-body");
    body.innerHTML = "";
    if (s.kind === "image") {
      body.style.background = "#000";
      const img = document.createElement("img"); img.src = s.src; img.alt = "Statut"; body.appendChild(img);
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
    sv.timer = setTimeout(function () { stepStory(1); }, 5000);
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
  function openComposer() { $("sc-text").value = ""; paintColors(); $("story-composer").classList.remove("hidden"); $("sc-text").focus(); }
  function closeComposer() { $("story-composer").classList.add("hidden"); }
  $("sc-close").addEventListener("click", closeComposer);
  $("sc-publish").addEventListener("click", function () {
    const t = $("sc-text").value.trim();
    if (!t) return toast("Ecrivez quelque chose");
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
      stories.push({ id: "s" + Date.now().toString(36), owner: "me", name: "Moi", kind: "image", src: r.result, ts: Date.now() });
      closeComposer(); renderStories(); toast("Statut photo publie (non conserve apres rechargement)");
    };
    r.readAsDataURL(f);
  });

  // ---------- Demarrage ----------
  paintSettings();
  renderStories();
  renderChatList();
})();
