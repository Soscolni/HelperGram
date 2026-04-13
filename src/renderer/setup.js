/**
 * Setup wizard logic — handles the 3-step flow
 */

let config = {
  telegram: { botToken: "", chatId: "" },
  llm: { vendor: "", model: "", apiKey: "" },
  startOnBoot: false,
  setupComplete: false,
};

let vendors = {};
let currentStep = 1;

// ─── Step Navigation ────────────────────────────────────────────────────────

function goToStep(step) {
  // Hide all cards
  document.querySelectorAll(".card").forEach((c) => c.classList.remove("active"));
  // Show target card
  document.getElementById(`step-${step}`).classList.add("active");

  // Update dots
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(`dot-${i}`);
    dot.classList.remove("active", "done");
    if (i < step) dot.classList.add("done");
    else if (i === step) dot.classList.add("active");
  }

  currentStep = step;

  if (step === 3) buildSummary();
}

// ─── Step 1: Telegram ───────────────────────────────────────────────────────

async function validateToken() {
  const token = document.getElementById("bot-token").value.trim();
  if (!token) return;

  const statusEl = document.getElementById("token-status");
  statusEl.innerHTML = '<div class="status loading"><span class="spinner"></span> Validating...</div>';

  const result = await window.api.validateTelegramToken(token);

  if (result.success) {
    config.telegram.botToken = token;
    statusEl.innerHTML = `<div class="status success">✓ Bot: @${result.bot.username} (${result.bot.first_name})</div>`;

    // Show chat ID detection phase
    document.getElementById("chat-phase").classList.remove("hidden");
    document.getElementById("validate-token").disabled = true;

    // Start polling for /start
    await window.api.startChatIdDetection(token);
  } else {
    statusEl.innerHTML = `<div class="status error">✗ ${result.error}</div>`;
  }
}

// Listen for chat ID detection
window.api.onChatIdDetected((chatId) => {
  config.telegram.chatId = chatId;
  document.getElementById("chat-status").innerHTML = `<div class="status success">✓ Connected! Chat ID: ${chatId}</div>`;
  document.getElementById("chat-status").className = "";
  document.getElementById("step1-next").style.display = "flex";
});

window.api.onDetectionError((error) => {
  document.getElementById("chat-status").innerHTML = `<div class="status error">✗ ${error}</div>`;
});

// ─── Step 2: LLM ───────────────────────────────────────────────────────────

async function loadVendors() {
  vendors = await window.api.getLLMVendors();
  const select = document.getElementById("llm-vendor");
  for (const [key, vendor] of Object.entries(vendors)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = vendor.name;
    select.appendChild(opt);
  }
}

function onVendorChange() {
  const vendor = document.getElementById("llm-vendor").value;
  const modelSelect = document.getElementById("llm-model");
  const apiKeyField = document.getElementById("api-key-field");

  // Clear model options
  modelSelect.innerHTML = "";

  if (!vendor || !vendors[vendor]) {
    modelSelect.disabled = true;
    modelSelect.innerHTML = '<option value="">Select provider first...</option>';
    return;
  }

  const vendorData = vendors[vendor];
  modelSelect.disabled = false;

  for (const model of vendorData.models) {
    const opt = document.createElement("option");
    opt.value = model.id;
    opt.textContent = model.name;
    modelSelect.appendChild(opt);
  }

  // Show/hide API key based on vendor
  if (vendorData.requiresApiKey) {
    apiKeyField.classList.remove("hidden");
  } else {
    apiKeyField.classList.add("hidden");
  }

  config.llm.vendor = vendor;
  config.llm.model = vendorData.models[0].id;

  // Reset validation
  document.getElementById("llm-status").innerHTML = "";
  document.getElementById("step2-next").style.display = "none";
}

async function validateLLM() {
  const vendor = document.getElementById("llm-vendor").value;
  const model = document.getElementById("llm-model").value;
  const apiKey = document.getElementById("api-key").value.trim();

  if (!vendor || !model) return;
  if (vendors[vendor].requiresApiKey && !apiKey) return;

  const statusEl = document.getElementById("llm-status");
  statusEl.innerHTML = '<div class="status loading"><span class="spinner"></span> Validating API key...</div>';

  config.llm.vendor = vendor;
  config.llm.model = model;
  config.llm.apiKey = apiKey;

  const result = await window.api.validateLLMKey(vendor, model, apiKey);

  if (result.success) {
    statusEl.innerHTML = `<div class="status success">✓ ${result.info || "API key valid!"}</div>`;
    document.getElementById("step2-next").style.display = "flex";
    document.getElementById("validate-llm").parentElement.style.display = "none";
  } else {
    statusEl.innerHTML = `<div class="status error">✗ ${result.error}</div>`;
  }
}

// ─── Step 3: Confirm & Launch ───────────────────────────────────────────────

function buildSummary() {
  const vendorName = vendors[config.llm.vendor]?.name || config.llm.vendor;
  const modelName = vendors[config.llm.vendor]?.models.find((m) => m.id === config.llm.model)?.name || config.llm.model;

  document.getElementById("summary").innerHTML = `
    <div class="summary-item">
      <span class="summary-label">Telegram Bot</span>
      <span class="summary-value">${config.telegram.botToken.slice(0, 10)}...</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Chat ID</span>
      <span class="summary-value">${config.telegram.chatId}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">AI Provider</span>
      <span class="summary-value">${vendorName}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Model</span>
      <span class="summary-value">${modelName}</span>
    </div>
  `;
}

async function launchBot() {
  const btn = document.getElementById("launch-btn");
  const statusEl = document.getElementById("launch-status");
  btn.disabled = true;
  statusEl.innerHTML = '<div class="status loading"><span class="spinner"></span> Starting HelperGram...</div>';

  config.startOnBoot = document.getElementById("start-on-boot").checked;
  config.setupComplete = true;

  await window.api.saveConfig(config);
  const result = await window.api.launchBot();

  if (result.launched) {
    statusEl.innerHTML = '<div class="status success">✓ HelperGram is running! This window will close.</div>';
    setTimeout(() => window.close(), 1500);
  } else {
    statusEl.innerHTML = `<div class="status error">✗ Failed to launch: ${result.error}</div>`;
    btn.disabled = false;
  }
}

// ─── Init ───────────────────────────────────────────────────────────────────

loadVendors();
