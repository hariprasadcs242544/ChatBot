/* ─── script.js — Gemini Chat ──────────────────────────────────────────────
   Put your Gemini API key below.
   Get one for free at: https://aistudio.google.com/app/apikey
   ───────────────────────────────────────────────────────────────────────── */
const GEMINI_API_KEY = "AQ.Ab8RN6KM5FwrP_1ndGBzmeyNNuM-T9BmBPlv-LQ1X6BzELWoTQ";

const API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";

const SYSTEM_INSTRUCTION = {
  parts: [
    {
      text: `You are a helpful, knowledgeable, and friendly AI assistant called My Assistant.
You communicate clearly and concisely. When appropriate, you:
- Use markdown formatting (bold, inline code, code blocks) to make responses easier to read.
- Break complex explanations into steps or bullet points.
- Acknowledge when you're uncertain rather than guessing.
- Keep a warm, approachable tone without being overly casual.
Always strive to give accurate, useful, and thoughtful responses.`,
    },
  ],
};

/* ─────────────────────────────────────────────────────────────────────────
   State
   ───────────────────────────────────────────────────────────────────────── */
let conversationHistory = []; // Array of { role: "user"|"model", parts:[{text}] }
let isWaiting = false;

/* ─────────────────────────────────────────────────────────────────────────
   DOM References
   ───────────────────────────────────────────────────────────────────────── */
const dom = {
  messages: document.getElementById("messages"),
  emptyState: document.getElementById("emptyState"),
  userInput: document.getElementById("userInput"),
  sendBtn: document.getElementById("sendBtn"),
  typingIndicator: document.getElementById("typingIndicator"),
  newChatBtn: document.getElementById("newChatBtn"),
  newChatBtnTop: document.getElementById("newChatBtnTop"),
  sidebarToggle: document.getElementById("sidebarToggle"),
  sidebar: document.getElementById("sidebar"),
  topbarTitle: document.querySelector(".topbar-title"),
};

/* ─────────────────────────────────────────────────────────────────────────
   Markdown Renderer (safe – HTML-first escape)
   ───────────────────────────────────────────────────────────────────────── */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdown(raw) {
  // 1. Extract code blocks first (preserve them, don't escape inner content)
  const codeBlocks = [];
  let text = raw.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang.trim(), code });
    return `\x00CODE_BLOCK_${idx}\x00`;
  });

  // 2. Escape HTML in the remaining text
  text = escapeHtml(text);

  // 3. Inline code (backticks)
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 4. Bold **text**
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // 5. Italic *text* (single asterisk, not followed by another)
  text = text.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");

  // 6. Restore code blocks
  text = text.replace(/\x00CODE_BLOCK_(\d+)\x00/g, (_, idx) => {
    const { lang, code } = codeBlocks[Number(idx)];
    const escapedCode = escapeHtml(code.replace(/^\n|\n$/g, ""));
    const langLabel = lang
      ? `<span class="code-lang">${escapeHtml(lang)}</span>`
      : "";
    return `<div class="code-block-wrapper">${langLabel}<pre><code>${escapedCode}</code></pre></div>`;
  });

  // 7. Paragraphs (double newline → paragraph break)
  const paragraphs = text.split(/\n{2,}/);
  text = paragraphs
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      // Don't wrap code-block-wrappers in <p>
      if (trimmed.startsWith('<div class="code-block-wrapper">')) return trimmed;
      // Single newlines become <br> inside paragraph
      return "<p>" + trimmed.replace(/\n/g, "<br>") + "</p>";
    })
    .join("\n");

  return text;
}

/* ─────────────────────────────────────────────────────────────────────────
   UI Helpers
   ───────────────────────────────────────────────────────────────────────── */
function hideEmptyState() {
  if (dom.emptyState && dom.emptyState.parentNode) {
    dom.emptyState.remove();
  }
}

function showEmptyState() {
  dom.messages.innerHTML = "";
  const emptyState = buildEmptyState();
  dom.messages.appendChild(emptyState);
}

function buildEmptyState() {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.id = "emptyState";
  div.innerHTML = `
    <div class="empty-state-icon" aria-hidden="true">
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
        <circle cx="28" cy="28" r="28" fill="url(#esGrad2a)"/>
        <path d="M28 14C28 14 18 20 18 28C18 34 22.5 39 28 39C33.5 39 38 34 38 28C38 20 28 14 28 14Z" fill="white" opacity="0.85"/>
        <path d="M28 22C28 22 22 26 22 29.5C22 32.2 24.7 34.5 28 34.5C31.3 34.5 34 32.2 34 29.5C34 26 28 22 28 22Z" fill="url(#esGrad2b)"/>
        <defs>
          <linearGradient id="esGrad2a" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
            <stop stop-color="#4F8EF7"/><stop offset="1" stop-color="#7C3AED"/>
          </linearGradient>
          <linearGradient id="esGrad2b" x1="22" y1="22" x2="34" y2="34.5" gradientUnits="userSpaceOnUse">
            <stop stop-color="#4F8EF7"/><stop offset="1" stop-color="#7C3AED"/>
          </linearGradient>
        </defs>
      </svg>
    </div>
    <h2 class="empty-state-title">How can I help you today?</h2>
    <p class="empty-state-sub">Ask me anything — My Assistant is here to help.</p>
    <div class="starter-prompts" role="list" aria-label="Suggested conversation starters">
      <button class="starter-prompt" role="listitem" data-prompt="Explain quantum computing in simple terms that a high school student can understand.">
        <span class="starter-icon" aria-hidden="true">⚛️</span>
        <span>Explain quantum computing simply</span>
      </button>
      <button class="starter-prompt" role="listitem" data-prompt="Write a short Python function that checks if a string is a palindrome, with comments explaining each step.">
        <span class="starter-icon" aria-hidden="true">🐍</span>
        <span>Write a Python palindrome checker</span>
      </button>
      <button class="starter-prompt" role="listitem" data-prompt="What are the top 5 productivity tips backed by science? Format them as a numbered list with a brief explanation for each.">
        <span class="starter-icon" aria-hidden="true">🧠</span>
        <span>Top science-backed productivity tips</span>
      </button>
    </div>
  `;
  // Attach starter-prompt listeners
  div.querySelectorAll(".starter-prompt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prompt = btn.dataset.prompt;
      dom.userInput.value = prompt;
      autoGrow(dom.userInput);
      updateSendBtn();
      sendMessage();
    });
  });
  return div;
}

function appendMessage(role, htmlContent, isError = false) {
  hideEmptyState();

  const row = document.createElement("div");
  row.className = `message-row ${role}${isError ? " error" : ""}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "user" ? "U" : "G";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = htmlContent;

  row.appendChild(avatar);
  row.appendChild(bubble);

  dom.messages.appendChild(row);
  scrollToBottom();
  return row;
}

function scrollToBottom() {
  dom.messages.scrollTo({ top: dom.messages.scrollHeight, behavior: "smooth" });
}

function setTyping(visible) {
  dom.typingIndicator.hidden = !visible;
  if (visible) scrollToBottom();
}

function setInputDisabled(disabled) {
  isWaiting = disabled;
  dom.userInput.disabled = disabled;
  dom.sendBtn.disabled = disabled || dom.userInput.value.trim() === "";
}

function updateSendBtn() {
  dom.sendBtn.disabled = isWaiting || dom.userInput.value.trim() === "";
}

/* ─────────────────────────────────────────────────────────────────────────
   Auto-grow textarea
   ───────────────────────────────────────────────────────────────────────── */
function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

/* ─────────────────────────────────────────────────────────────────────────
   API Call
   ───────────────────────────────────────────────────────────────────────── */
async function callGeminiAPI(history, attempt = 1) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      system_instruction: SYSTEM_INSTRUCTION,
      contents: history,
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 8192,
      },
    }),
  });

  // Retry once on 429 / 503 (high demand / rate limit)
  if ((response.status === 429 || response.status === 503) && attempt === 1) {
    await new Promise((r) => setTimeout(r, 3000)); // wait 3s then retry
    return callGeminiAPI(history, 2);
  }

  if (!response.ok) {
    let errMsg = `API error ${response.status}`;
    try {
      const errJson = await response.json();
      const detail = errJson?.error?.message;
      if (detail) errMsg = detail;
    } catch (_) { /* ignore */ }
    throw new Error(errMsg);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from My Assistant.");
  return text;
}

/* ─────────────────────────────────────────────────────────────────────────
   Send Message
   ───────────────────────────────────────────────────────────────────────── */
async function sendMessage() {
  const userText = dom.userInput.value.trim();
  if (!userText || isWaiting) return;

  // Check API key
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
    appendMessage(
      "bot",
      `<p>⚠️ <strong>API key missing.</strong> Please open <code>script.js</code> and replace <code>YOUR_GEMINI_API_KEY_HERE</code> with your <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Gemini API key</a>.</p>`,
      true
    );
    return;
  }

  // Clear input
  dom.userInput.value = "";
  autoGrow(dom.userInput);
  updateSendBtn();

  // Update title on first message
  if (conversationHistory.length === 0) {
    dom.topbarTitle.textContent = userText.length > 50
      ? userText.slice(0, 47) + "…"
      : userText;
  }

  // Render user message
  appendMessage("user", escapeHtml(userText).replace(/\n/g, "<br>"));

  // Push to history
  const userTurn = { role: "user", parts: [{ text: userText }] };
  conversationHistory.push(userTurn);

  // Show typing, disable input
  setTyping(true);
  setInputDisabled(true);

  try {
    const replyText = await callGeminiAPI(conversationHistory);

    // Push model reply to history
    conversationHistory.push({ role: "model", parts: [{ text: replyText }] });

    setTyping(false);
    appendMessage("bot", renderMarkdown(replyText));
  } catch (err) {
    // Remove failed user turn from history
    conversationHistory.pop();

    setTyping(false);
    appendMessage(
      "bot",
      `<p>❌ <strong>Error:</strong> ${escapeHtml(err.message)}</p><p>Please check your API key and internet connection, then try again.</p>`,
      true
    );
    console.error("[Gemini Chat]", err);
  } finally {
    setInputDisabled(false);
    dom.userInput.focus();
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   New Chat
   ───────────────────────────────────────────────────────────────────────── */
function startNewChat() {
  conversationHistory = [];
  isWaiting = false;
  dom.typingIndicator.hidden = true;
  dom.userInput.value = "";
  autoGrow(dom.userInput);
  updateSendBtn();
  dom.topbarTitle.textContent = "New Conversation";
  showEmptyState();
  dom.userInput.focus();
}

/* ─────────────────────────────────────────────────────────────────────────
   Sidebar Toggle
   ───────────────────────────────────────────────────────────────────────── */
let sidebarOpen = true;

function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  dom.sidebar.classList.toggle("collapsed", !sidebarOpen);
  dom.sidebarToggle.setAttribute("aria-expanded", String(sidebarOpen));
}

/* ─────────────────────────────────────────────────────────────────────────
   Event Listeners
   ───────────────────────────────────────────────────────────────────────── */

// Send on Enter, Shift+Enter for newline
dom.userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-grow + enable/disable send button
dom.userInput.addEventListener("input", () => {
  autoGrow(dom.userInput);
  updateSendBtn();
});

// Send button click
dom.sendBtn.addEventListener("click", sendMessage);

// New chat buttons
dom.newChatBtn.addEventListener("click", startNewChat);
dom.newChatBtnTop.addEventListener("click", startNewChat);

// Sidebar toggle
dom.sidebarToggle.addEventListener("click", toggleSidebar);

// Starter prompts (initial render from HTML)
document.querySelectorAll(".starter-prompt").forEach((btn) => {
  btn.addEventListener("click", () => {
    const prompt = btn.dataset.prompt;
    dom.userInput.value = prompt;
    autoGrow(dom.userInput);
    updateSendBtn();
    sendMessage();
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Init
   ───────────────────────────────────────────────────────────────────────── */
(function init() {
  autoGrow(dom.userInput);
  updateSendBtn();
  dom.userInput.focus();

  // On mobile: start with sidebar closed
  if (window.innerWidth < 640) {
    sidebarOpen = false;
    dom.sidebar.classList.add("collapsed");
    dom.sidebarToggle.setAttribute("aria-expanded", "false");
  }
})();
