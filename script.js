const GEMINI_API_KEY = "AQ.Ab8RN6KM5FwrP_1ndGBzmeyNNuM-T9BmBPlv-LQ1X6BzELWoTQ";
const MODELS = ["gemini-3.5-flash-lite", "gemini-2.5-flash"];

const SYSTEM_INSTRUCTION =
  "You are My Assistant. Speak in a warm, natural, human-like way: friendly, concise, and conversational. Avoid robotic filler phrases like 'As an AI' or 'Certainly! Here is...'. Use clean markdown when helpful for formatting, lists, or code. Be direct and honest whenever you are uncertain about something.";

// Conversation state in Gemini REST API format
let conversationHistory = [];
let isSending = false;

// DOM Elements
const chatMain = document.getElementById("chat-main");
const messagesList = document.getElementById("messages-list");
const emptyState = document.getElementById("empty-state");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const newChatBtn = document.getElementById("new-chat-btn");
const starterCards = document.querySelectorAll(".starter-prompt-card");

/* ==========================================================================
   Markdown Parsing & Sanitization
   ========================================================================== */

/**
 * Escapes raw text to prevent HTML injection (XSS protection).
 */
function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Safely converts Markdown to HTML:
 * Escapes HTML first, then handles code blocks, inline code, bold, and paragraphs.
 */
function renderMarkdown(rawText) {
  if (!rawText) return "";

  // 1. Strictly escape HTML first (XSS prevention)
  let text = escapeHTML(rawText);

  // 2. Extract code blocks with placeholders
  const codeBlocks = [];
  text = text.replace(/```([a-zA-Z0-9_-]*)\r?\n?([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push({
      lang: lang.trim(),
      code: code.trim()
    });
    return `\n\n${placeholder}\n\n`;
  });

  // 3. Inline code (`code`)
  text = text.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

  // 4. Bold formatting (**text** or __text__)
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');

  // Helper to build code block HTML
  const formatCodeBlock = (block) => {
    const langLabel = block.lang || "code";
    return `
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span class="code-lang">${langLabel}</span>
          <button class="btn-copy-code" type="button" aria-label="Copy code block">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy</span>
          </button>
        </div>
        <pre><code>${block.code}</code></pre>
      </div>
    `.trim();
  };

  // 5. Paragraphs, Lists & Blocks
  const chunks = text
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  let html = chunks
    .map((chunk) => {
      // Check code block placeholder
      const codeMatch = chunk.match(/^__CODE_BLOCK_(\d+)__$/);
      if (codeMatch) {
        const index = parseInt(codeMatch[1], 10);
        return formatCodeBlock(codeBlocks[index]);
      }

      // Parse lines: handle text mixed with bullet lists and numbered lists
      const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const blocks = [];
      let currentList = null;

      for (const line of lines) {
        const bulletMatch = line.match(/^[-*]\s+(.*)/);
        const numberMatch = line.match(/^\d+\.\s+(.*)/);

        if (bulletMatch) {
          if (!currentList || currentList.type !== "ul") {
            if (currentList) blocks.push(currentList);
            currentList = { type: "ul", items: [] };
          }
          currentList.items.push(bulletMatch[1]);
        } else if (numberMatch) {
          if (!currentList || currentList.type !== "ol") {
            if (currentList) blocks.push(currentList);
            currentList = { type: "ol", items: [] };
          }
          currentList.items.push(numberMatch[1]);
        } else {
          if (currentList) {
            blocks.push(currentList);
            currentList = null;
          }
          blocks.push({ type: "p", text: line });
        }
      }

      if (currentList) blocks.push(currentList);

      return blocks
        .map((b) => {
          if (b.type === "ul") {
            return `<ul class="chat-list">${b.items.map((it) => `<li>${it}</li>`).join("")}</ul>`;
          }
          if (b.type === "ol") {
            return `<ol class="chat-list">${b.items.map((it) => `<li>${it}</li>`).join("")}</ol>`;
          }
          return `<p>${b.text}</p>`;
        })
        .join("");
    })
    .join("");

  // Restore any nested code block placeholders
  html = html.replace(/__CODE_BLOCK_(\d+)__/g, (match, indexStr) => {
    const index = parseInt(indexStr, 10);
    const block = codeBlocks[index];
    return block ? formatCodeBlock(block) : "";
  });

  return html;
}

/* ==========================================================================
   UI Helpers & Message Rendering
   ========================================================================== */

function scrollToBottom() {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  chatMain.scrollTo({
    top: chatMain.scrollHeight,
    behavior: prefersReduced ? "auto" : "smooth"
  });
}

function hideEmptyState() {
  if (emptyState) {
    emptyState.style.display = "none";
  }
}

function showEmptyState() {
  if (emptyState) {
    emptyState.style.display = "flex";
  }
}

function setWaitingState(waiting) {
  isSending = waiting;
  messageInput.disabled = waiting;
  sendBtn.disabled = waiting;
  if (!waiting) {
    messageInput.focus();
  }
}

function appendUserMessage(text) {
  hideEmptyState();

  const row = document.createElement("div");
  row.className = "message-row user";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble user";
  bubble.textContent = text; // Plain text escaping via textContent

  row.appendChild(bubble);
  messagesList.appendChild(row);
  scrollToBottom();
}

function appendAssistantMessage(markdownText) {
  hideEmptyState();

  const row = document.createElement("div");
  row.className = "message-row assistant";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble assistant";
  bubble.innerHTML = renderMarkdown(markdownText);

  // Copy response button at bottom of bubble
  const actions = document.createElement("div");
  actions.className = "bubble-actions";
  actions.innerHTML = `
    <button type="button" class="btn-copy-bubble" title="Copy response" aria-label="Copy response">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      <span>Copy</span>
    </button>
  `;
  bubble.appendChild(actions);

  row.appendChild(bubble);
  messagesList.appendChild(row);
  scrollToBottom();
}

function showTypingIndicator() {
  removeTypingIndicator();

  const row = document.createElement("div");
  row.id = "typing-indicator";
  row.className = "message-row assistant";
  row.setAttribute("aria-live", "polite");
  row.innerHTML = `
    <div class="message-bubble assistant typing-bubble" aria-label="My Assistant is thinking">
      <div class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;
  messagesList.appendChild(row);
  scrollToBottom();
}

function removeTypingIndicator() {
  const indicator = document.getElementById("typing-indicator");
  if (indicator) {
    indicator.remove();
  }
}

function appendErrorMessage(title, details) {
  hideEmptyState();

  const errorRow = document.createElement("div");
  errorRow.className = "message-row assistant";

  const errorCard = document.createElement("div");
  errorCard.className = "message-error";
  errorCard.setAttribute("role", "alert");
  errorCard.innerHTML = `
    <div class="error-icon" aria-hidden="true">⚠️</div>
    <div class="error-body">
      <strong>${escapeHTML(title)}</strong>
      <p>${details}</p>
    </div>
  `;

  errorRow.appendChild(errorCard);
  messagesList.appendChild(errorRow);
  scrollToBottom();
}

/* ==========================================================================
   API Communication & Fallback
   ========================================================================== */

/**
 * Sends a message and attempts models in sequence.
 * Handles 404/429 fallback and removes failed turn from history on error.
 */
async function sendMessage(userText) {
  if (isSending) return;

  const trimmedText = userText.trim();
  if (!trimmedText) return;

  // Render user turn in UI
  appendUserMessage(trimmedText);

  // Push user turn to conversation history
  conversationHistory.push({
    role: "user",
    parts: [{ text: trimmedText }]
  });

  // Verify API Key
  const isKeyMissing =
    !GEMINI_API_KEY ||
    GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE" ||
    GEMINI_API_KEY.trim() === "";

  if (isKeyMissing) {
    // Remove the failed user turn from history so retrying works
    conversationHistory.pop();
    appendErrorMessage(
      "API Key Missing",
      "Please open <code>script.js</code> and replace <code>YOUR_GEMINI_API_KEY_HERE</code> at the top of the file with your Gemini API key."
    );
    setWaitingState(false);
    return;
  }

  setWaitingState(true);
  showTypingIndicator();

  let replyText = null;
  let lastError = null;

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: SYSTEM_INSTRUCTION }]
            },
            contents: conversationHistory
          })
        }
      );

      // Model fallback condition: 404 Not Found or 429 Rate Limit
      if (response.status === 404 || response.status === 429) {
        lastError = new Error(`Model ${model} returned HTTP ${response.status}`);
        continue; // Try next model in sequence
      }

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        const apiMsg =
          errJson?.error?.message ||
          `HTTP ${response.status}: ${response.statusText || "Request failed"}`;
        throw new Error(apiMsg);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const extractedText = parts.map((p) => p.text || "").join("").trim();

      if (!extractedText) {
        throw new Error("The assistant returned an empty response.");
      }

      replyText = extractedText;
      break; // Successfully received response
    } catch (err) {
      lastError = err;
      // Network failure (e.g. offline) or invalid request error; break fallback
      if (err instanceof TypeError || (err.message && !err.message.includes("404") && !err.message.includes("429"))) {
        break;
      }
    }
  }

  removeTypingIndicator();

  if (replyText !== null) {
    // Append assistant response to history
    conversationHistory.push({
      role: "model",
      parts: [{ text: replyText }]
    });
    appendAssistantMessage(replyText);
  } else {
    // Remove the failed user turn from history so retrying works
    conversationHistory.pop();

    let errorTitle = "Request Failed";
    let errorDetails = lastError
      ? escapeHTML(lastError.message)
      : "Unable to contact the Gemini API. Please verify your connection and try again.";

    if (lastError instanceof TypeError) {
      errorTitle = "Network Error";
      errorDetails = "Unable to connect to the Gemini API. Please check your internet connection.";
    }

    appendErrorMessage(errorTitle, errorDetails);
  }

  setWaitingState(false);
}

/* ==========================================================================
   Event Listeners & Form Controls
   ========================================================================== */

// Auto-grow textarea as user types
function resizeTextarea() {
  messageInput.style.height = "auto";
  const maxHeight = 180;
  const newHeight = Math.min(messageInput.scrollHeight, maxHeight);
  messageInput.style.height = `${newHeight}px`;
}

messageInput.addEventListener("input", resizeTextarea);

// Enter sends, Shift+Enter adds new line
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

// Form submit
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (isSending) return;

  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = "";
  messageInput.style.height = "auto";
  sendMessage(text);
});

// Starter prompt cards
starterCards.forEach((card) => {
  card.addEventListener("click", () => {
    if (isSending) return;
    const prompt = card.getAttribute("data-prompt");
    if (prompt) {
      sendMessage(prompt);
    }
  });
});

// New Chat button: clears conversation and resets history
newChatBtn.addEventListener("click", () => {
  conversationHistory = [];
  isSending = false;

  // Clear messages from list
  messagesList.innerHTML = "";
  messagesList.appendChild(emptyState);
  showEmptyState();

  // Reset textarea
  messageInput.value = "";
  messageInput.style.height = "auto";
  setWaitingState(false);
  messageInput.focus();
});

// Delegated click handler for copy buttons (code blocks and bubble replies)
messagesList.addEventListener("click", async (e) => {
  // 1. Copy code block
  const copyCodeBtn = e.target.closest(".btn-copy-code");
  if (copyCodeBtn) {
    const wrapper = copyCodeBtn.closest(".code-block-wrapper");
    const codeEl = wrapper ? wrapper.querySelector("code") : null;
    if (codeEl) {
      try {
        await navigator.clipboard.writeText(codeEl.innerText);
        const span = copyCodeBtn.querySelector("span");
        if (span) {
          span.textContent = "Copied!";
          copyCodeBtn.classList.add("copied");
          setTimeout(() => {
            span.textContent = "Copy";
            copyCodeBtn.classList.remove("copied");
          }, 1800);
        }
      } catch (err) {
        console.warn("Clipboard copy error:", err);
      }
    }
    return;
  }

  // 2. Copy full assistant reply
  const copyBubbleBtn = e.target.closest(".btn-copy-bubble");
  if (copyBubbleBtn) {
    const bubble = copyBubbleBtn.closest(".message-bubble.assistant");
    if (bubble) {
      // Clone bubble, remove actions bar, get text
      const clone = bubble.cloneNode(true);
      const actions = clone.querySelector(".bubble-actions");
      if (actions) actions.remove();
      try {
        await navigator.clipboard.writeText(clone.innerText.trim());
        const span = copyBubbleBtn.querySelector("span");
        if (span) {
          span.textContent = "Copied!";
          setTimeout(() => {
            span.textContent = "Copy";
          }, 1800);
        }
      } catch (err) {
        console.warn("Clipboard copy error:", err);
      }
    }
  }
});

