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
      e.textContent = q ? "Aucun resultat pour \"" + searchInput.value + "\"" : "Aucune discussion ici.";
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
    const keys = Object.keys(AVATAR_COLORS);
    const id = "c" + Date.now().toString(36);
    AVATAR_COLORS[id] = ["#7c5cd6", "#e05656", "#00a884", "#e08a2d", "#3a8dde", "#d6569a"][keys.length % 6];
    CONVERSATIONS.unshift({ id: id, name: name, status: "en ligne", unread: 0, days: [{ date: "Aujourd'hui", messages: [] }] });
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
    m.style.cssText = "position:fixed;min-width:170px;top:" + Math.min(r.bottom + 4, window.innerHeight - 160) + "px;left:" + Math.max(8, r.right - 170) + "px;";
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
    chatStatusEl.textContent = conv.status;
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
      closeViewer(); closeMsgMenu(); closeMenus();
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
      chatStatusEl.textContent = conv.status;
      // Les messages envoyes passent en "lu"
      allMessages(conv).forEach(function (m) { if (m.from === "out") m.state = "read"; });
      const reply = {
        id: "m" + Date.now().toString(36) + (uid++),
        type: "text", from: "in",
        text: AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)],
        time: nowTime(),
      };
      conv.days[conv.days.length - 1].messages.push(reply);
      if (activeId !== conv.id) conv.unread += 1;
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

  // ---------- Demarrage ----------
  renderChatList();
})();
