// ─── Hardcoded defaults — used if storage is empty ──────────────
var D_DOMAINS = ["reddit.com", "twitter.com", "x.com"];
var D_GOAL = 20;
var D_UNBLOCK = 300;   // 5m
var D_FORCED = 60;     // 1m
var D_ENABLED = true;
var D_ANKIWEB = true;

// ─── Live state (populated from storage, then mutated by buttons) ─
var unblockTimeSec = D_UNBLOCK;
var forcedBlockSec = D_FORCED;
var cardGoal = D_GOAL;
var blockedDomains = D_DOMAINS.slice();
var enabled = D_ENABLED;
var openAnkiWeb = D_ANKIWEB;

var toastTimer = 0;

function $(id) { return document.getElementById(id); }

function toast(msg) {
  var el = $("toast");
  el.textContent = msg || "Saved";
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.remove("on"); }, 1200);
}

function fmtDur(sec) {
  if (sec < 60) return sec + "s";
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  if (s === 0) return m + "m";
  return m + "m" + s + "s";
}

function buildConfigObj() {
  return {
    blockedDomains: blockedDomains,
    cardGoal: cardGoal,
    unblockTimeSec: unblockTimeSec,
    forcedBlockSec: forcedBlockSec,
    enabled: enabled,
    openAnkiWeb: openAnkiWeb
  };
}

// ─── Write current state to storage ─────────────────────────────
function save(msg) {
  chrome.storage.local.set({ config: buildConfigObj() }, function() {
    if (chrome.runtime.lastError) toast("Error saving");
    else toast(msg || "Saved");
  });
}

function saveSilent() {
  chrome.storage.local.set({ config: buildConfigObj() });
}

// ─── Render UI from current state ───────────────────────────────
function updateUI() {
  $("tglOn").checked = enabled;
  $("ankiTgl").checked = openAnkiWeb;
  $("utV").textContent = fmtDur(unblockTimeSec);
  $("fbV").textContent = fmtDur(forcedBlockSec);
  $("cgV").textContent = String(cardGoal);
}

function renderDomains() {
  var el = $("domList");
  el.innerHTML = "";
  for (var i = 0; i < blockedDomains.length; i++) {
    (function(idx, domain) {
      var row = document.createElement("div");
      row.className = "dm";
      var sp = document.createElement("span");
      sp.textContent = domain;
      row.appendChild(sp);
      var btn = document.createElement("button");
      btn.className = "dm-x";
      btn.textContent = "×";
      btn.addEventListener("click", function() {
        blockedDomains.splice(idx, 1);
        renderDomains();
        save();
      });
      row.appendChild(btn);
      el.appendChild(row);
    })(i, blockedDomains[i]);
  }
}

// ─── Load from storage ──────────────────────────────────────────
chrome.storage.local.get(["config", "stats"], function(result) {
  var c = result.config;
  var needsMigration = false;

  if (c && typeof c === "object") {
    if (Array.isArray(c.blockedDomains) && c.blockedDomains.length > 0) blockedDomains = c.blockedDomains;
    if (typeof c.cardGoal === "number" && c.cardGoal > 0) cardGoal = c.cardGoal;

    // Prefer new field; migrate from legacy if needed
    if (typeof c.unblockTimeSec === "number" && c.unblockTimeSec > 0) {
      unblockTimeSec = c.unblockTimeSec;
    } else if (typeof c.unlockDurationSec === "number" && c.unlockDurationSec > 0) {
      unblockTimeSec = c.unlockDurationSec;
      needsMigration = true;
    } else if (typeof c.scrollTimerSec === "number" && c.scrollTimerSec > 0) {
      unblockTimeSec = c.scrollTimerSec;
      needsMigration = true;
    }

    if (typeof c.forcedBlockSec === "number" && c.forcedBlockSec >= 0) {
      forcedBlockSec = c.forcedBlockSec;
    } else {
      needsMigration = true;
    }

    if (typeof c.enabled === "boolean") enabled = c.enabled;
    if (typeof c.openAnkiWeb === "boolean") openAnkiWeb = c.openAnkiWeb;

    // Legacy fields lingering → rewrite clean config
    if (c.scrollTimerSec !== undefined || c.unlockDurationSec !== undefined) needsMigration = true;

    if (needsMigration) saveSilent();
  } else {
    // No config in storage at all — write defaults silently
    saveSilent();
  }

  updateUI();
  renderDomains();

  // Today's stats
  var today = new Date().toISOString().slice(0, 10);
  var stats = null;
  if (result.stats && typeof result.stats === "object" && result.stats[today]) {
    stats = result.stats[today];
  }
  $("sBlk").textContent = stats ? String(stats.timesBlocked || 0) : "0";
  $("sCrd").textContent = stats ? String(stats.cardsCompleted || 0) : "0";
});

// ─── Button Handlers ────────────────────────────────────────────

// Enable toggle
$("tglOn").addEventListener("change", function() {
  enabled = this.checked;
  save();
});

// AnkiWeb toggle
$("ankiTgl").addEventListener("change", function() {
  openAnkiWeb = this.checked;
  save();
});

// Unblock time: 60s step, min 60 (1m), max 1800 (30m)
$("utM").addEventListener("click", function() {
  unblockTimeSec = Math.max(60, unblockTimeSec - 60);
  $("utV").textContent = fmtDur(unblockTimeSec);
  save();
});
$("utP").addEventListener("click", function() {
  unblockTimeSec = Math.min(1800, unblockTimeSec + 60);
  $("utV").textContent = fmtDur(unblockTimeSec);
  save();
});

// Forced block: 15s step, min 15, max 300 (5m)
$("fbM").addEventListener("click", function() {
  forcedBlockSec = Math.max(15, forcedBlockSec - 15);
  $("fbV").textContent = fmtDur(forcedBlockSec);
  save();
});
$("fbP").addEventListener("click", function() {
  forcedBlockSec = Math.min(300, forcedBlockSec + 15);
  $("fbV").textContent = fmtDur(forcedBlockSec);
  save();
});

// Card goal
$("cgM").addEventListener("click", function() {
  cardGoal = Math.max(1, cardGoal - 5);
  $("cgV").textContent = String(cardGoal);
  save();
});
$("cgP").addEventListener("click", function() {
  cardGoal = Math.min(200, cardGoal + 5);
  $("cgV").textContent = String(cardGoal);
  save();
});

// Add domain
function addDomain() {
  var raw = $("newDom").value.trim().toLowerCase();
  if (!raw) return;
  var v = raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!v) return;
  if (blockedDomains.indexOf(v) !== -1) { toast("Already added"); return; }
  blockedDomains.push(v);
  renderDomains();
  $("newDom").value = "";
  save();
}
$("addBtn").addEventListener("click", addDomain);
$("newDom").addEventListener("keydown", function(e) {
  if (e.key === "Enter") addDomain();
});

// Reset stats
$("rstBtn").addEventListener("click", function() {
  var today = new Date().toISOString().slice(0, 10);
  chrome.storage.local.get("stats", function(r) {
    var stats = r.stats || {};
    stats[today] = { timesBlocked: 0, cardsCompleted: 0 };
    chrome.storage.local.set({ stats: stats }, function() {
      $("sBlk").textContent = "0";
      $("sCrd").textContent = "0";
      toast("Stats Reset");
    });
  });
});
