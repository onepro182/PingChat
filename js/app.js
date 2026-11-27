/* ==========================================================
   PingChat - logique de l'interface
   Rendu des discussions, navigation, envoi de messages,
   recherche et reponses simulees.
   Aucune dependance externe : pur JavaScript.
   ========================================================== */

(function () {
  "use strict";

  // ---------- References DOM ----------
  const chatListEl = document.getElementById("chat-list");
  const chatAreaEl = document.getElementById("chat-area");
  const messagesEl = document.getElementById("messages");
  const welcomeEl = document.getElementById("welcome-screen");
  const chatAvatarEl = document.getElementById("chat-avatar");
  const chatTitleEl = document.getElementById("chat-title");
  const chatStatusEl = document.getElementById("chat-status");
  const typingEl = document.getElementById("typing-indicator");
  const typingAvatarEl = document.getElementById("typing-avatar");
  const messageInput = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");
  const backBtn = document.getElementById("back-btn");
  const searchInput = document.getElementById("search-input");

  // ---------- Etat local ----------
  let activeId = null;

  // ---------- Utilitaires ----------
  function avatarColor(id) {
    return (typeof AVATAR_COLORS !== "undefined" && AVATAR_COLORS[id]) || "#8696a0";
  }

  function initials(name) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); })
      .join("");
  }

  function lastMessage(conv) {
    for (let d = conv.days.length - 1; d >= 0; d--) {
      const msgs = conv.days[d].messages;
      if (msgs.length) return msgs[msgs.length - 1];
    }
    return null;
  }

  function ticksSvg(state) {
    const cls = state === "read" ? "ticks read" : "ticks";
    return (
      '<span class="' + cls + '">' +
      '<svg viewBox="0 0 18 12"><path d="M12.5 0 5 8.5 2.4 5.7 1 7l4.2 4.2L13.9 1.4z"/>' +
      '<path d="M17.5 0 10 8.5l-.9-1-1.4 1.5 2.5 2.5L18.9 1.4z"/></svg></span>'
    );
  }

  function nowTime() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  // ---------- Rendu : liste des discussions ----------
  function renderChatList(filter) {
    chatListEl.innerHTML = "";
    const q = (filter || "").trim().toLowerCase();

    CONVERSATIONS.filter(function (c) {
      return !q || c.name.toLowerCase().includes(q);
    }).forEach(function (conv) {
      const last = lastMessage(conv);
      const li = document.createElement("li");
      li.className = "chat-item" + (conv.id === activeId ? " active" : "");
      li.setAttribute("role", "option");
      li.dataset.id = conv.id;

      const previewTicks = last && last.from === "out" ? ticksSvg(last.state) : "";
      const previewText = last ? last.text : "";
      const timeText = last ? last.time : "";
      const badge = conv.unread > 0
        ? '<span class="unread-badge">' + conv.unread + "</span>"
        : "";

      li.innerHTML =
        '<div class="avatar" style="background:' + avatarColor(conv.id) + '">' + initials(conv.name) + "</div>" +
        '<div class="chat-item-body">' +
          '<div class="chat-item-top">' +
            '<span class="chat-item-name"></span>' +
            '<span class="chat-item-time' + (conv.unread ? " unread" : "") + '">' + timeText + "</span>" +
          "</div>" +
          '<div class="chat-item-bottom">' +
            '<span class="chat-item-preview">' + previewTicks + '<span class="preview-text"></span></span>' +
            badge +
          "</div>" +
        "</div>";

      // Texte insere en toute securite (pas d'HTML depuis les donnees)
      li.querySelector(".chat-item-name").textContent = conv.name;
      li.querySelector(".preview-text").textContent = previewText;

      li.addEventListener("click", function () { openConversation(conv.id); });
      chatListEl.appendChild(li);
    });
  }

  // ---------- Rendu : messages d'une discussion ----------
  function renderMessages(conv) {
    messagesEl.innerHTML = "";

    conv.days.forEach(function (day, dayIndex) {
      const chip = document.createElement("span");
      chip.className = "date-chip";
      chip.textContent = day.date;
      messagesEl.appendChild(chip);

      if (dayIndex === 0) {
        const notice = document.createElement("span");
        notice.className = "encryption-notice";
        notice.innerHTML =
          '<svg viewBox="0 0 24 24"><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm-3 8V6a3 3 0 0 1 6 0v3z"/></svg>' +
          "Les messages sont chiffres de bout en bout (demonstration locale).";
        messagesEl.appendChild(notice);
      }

      day.messages.forEach(function (msg) {
        messagesEl.appendChild(buildBubble(msg));
      });
    });

    scrollToBottom();
  }

  function buildBubble(msg) {
    const row = document.createElement("div");
    row.className = "msg-row " + msg.from;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    if (msg.sender) {
      const sender = document.createElement("div");
      sender.style.cssText = "font-size:12.5px;font-weight:600;color:#e05656;margin-bottom:2px;";
      sender.textContent = msg.sender;
      bubble.appendChild(sender);
    }

    const text = document.createElement("span");
    text.textContent = msg.text;
    bubble.appendChild(text);

    const meta = document.createElement("span");
    meta.className = "msg-meta";
    meta.innerHTML = "<span>" + msg.time + "</span>" + (msg.from === "out" ? ticksSvg(msg.state) : "");
    bubble.appendChild(meta);

    row.appendChild(bubble);
    return row;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---------- Navigation ----------
  function openConversation(id) {
    const conv = CONVERSATIONS.find(function (c) { return c.id === id; });
    if (!conv) return;

    activeId = id;
    conv.unread = 0;

    welcomeEl.classList.add("hidden");
    chatAreaEl.classList.add("open");

    chatAvatarEl.textContent = initials(conv.name);
    chatAvatarEl.style.background = avatarColor(conv.id);
    chatTitleEl.textContent = conv.name;
    chatStatusEl.textContent = conv.status;

    renderMessages(conv);
    renderChatList(searchInput.value);
    messageInput.focus();
  }

  backBtn.addEventListener("click", function () {
    chatAreaEl.classList.remove("open");
  });

  // ---------- Envoi d'un message ----------
  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !activeId) return;

    const conv = CONVERSATIONS.find(function (c) { return c.id === activeId; });
    const today = conv.days[conv.days.length - 1];
    const msg = { from: "out", text: text, time: nowTime(), state: "delivered" };
    today.messages.push(msg);

    messageInput.value = "";
    updateSendIcon();
    messagesEl.appendChild(buildBubble(msg));
    scrollToBottom();
    renderChatList(searchInput.value);

    simulateReply(conv);
  }

  // ---------- Reponse simulee (demo locale) ----------
  function simulateReply(conv) {
    typingAvatarEl.textContent = initials(conv.name);
    typingAvatarEl.style.background = avatarColor(conv.id);
    typingEl.classList.remove("hidden");
    chatStatusEl.textContent = "ecrit...";

    setTimeout(function () {
      typingEl.classList.add("hidden");
      chatStatusEl.textContent = conv.status;

      if (activeId !== conv.id) {
        conv.unread += 1;
        renderChatList(searchInput.value);
        return;
      }

      const reply = {
        from: "in",
        text: AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)],
        time: nowTime(),
      };
      conv.days[conv.days.length - 1].messages.push(reply);
      messagesEl.appendChild(buildBubble(reply));
      scrollToBottom();
      renderChatList(searchInput.value);
    }, 1400);
  }

  // ---------- Icone micro / envoyer ----------
  function updateSendIcon() {
    const hasText = messageInput.value.trim().length > 0;
    sendBtn.querySelector(".icon-mic").classList.toggle("hidden", hasText);
    sendBtn.querySelector(".icon-send").classList.toggle("hidden", !hasText);
  }

  messageInput.addEventListener("input", updateSendIcon);
  messageInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") sendMessage();
  });
  sendBtn.addEventListener("click", sendMessage);

  // ---------- Recherche ----------
  searchInput.addEventListener("input", function () {
    renderChatList(searchInput.value);
  });

  // ---------- Demarrage ----------
  renderChatList("");
})();
