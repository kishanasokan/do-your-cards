// ─── Defaults ───────────────────────────────────────────────────
var DEFAULTS = {
  blockedDomains: ["reddit.com", "twitter.com", "x.com"],
  cardGoal: 20,
  unblockTimeSec: 300,   // single timer: browsing window before block AND reward window after unlock
  forcedBlockSec: 60,    // mandatory wait on the block overlay before "I finished my cards" is enabled
  enabled: true,
  openAnkiWeb: true
};

// ─── First install / migration from legacy config ───────────────
chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.local.get("config", function(r) {
    if (!r.config) {
      chrome.storage.local.set({
        config: JSON.parse(JSON.stringify(DEFAULTS)),
        stats: {}
      });
      return;
    }
    // Migrate old fields -> new schema
    var c = r.config;
    var changed = false;
    if (typeof c.unblockTimeSec !== "number" || c.unblockTimeSec <= 0) {
      if (typeof c.unlockDurationSec === "number" && c.unlockDurationSec > 0) c.unblockTimeSec = c.unlockDurationSec;
      else if (typeof c.scrollTimerSec === "number" && c.scrollTimerSec > 0) c.unblockTimeSec = c.scrollTimerSec;
      else c.unblockTimeSec = DEFAULTS.unblockTimeSec;
      changed = true;
    }
    if (typeof c.forcedBlockSec !== "number" || c.forcedBlockSec < 0) {
      c.forcedBlockSec = DEFAULTS.forcedBlockSec;
      changed = true;
    }
    if (c.scrollTimerSec !== undefined)   { delete c.scrollTimerSec;   changed = true; }
    if (c.unlockDurationSec !== undefined){ delete c.unlockDurationSec; changed = true; }
    if (changed) chrome.storage.local.set({ config: c });
  });
});

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function hostMatches(hostname, domains) {
  if (!hostname || !domains) return false;
  for (var i = 0; i < domains.length; i++) {
    var d = domains[i];
    if (hostname === d || hostname === "www." + d || hostname.endsWith("." + d)) return true;
  }
  return false;
}

function getConfig(callback) {
  chrome.storage.local.get("config", function(r) {
    var cfg = r.config || {};
    if (!cfg.blockedDomains) cfg.blockedDomains = DEFAULTS.blockedDomains.slice();
    if (!cfg.cardGoal) cfg.cardGoal = DEFAULTS.cardGoal;

    if (typeof cfg.unblockTimeSec !== "number" || cfg.unblockTimeSec <= 0) {
      if (typeof cfg.unlockDurationSec === "number" && cfg.unlockDurationSec > 0) cfg.unblockTimeSec = cfg.unlockDurationSec;
      else if (typeof cfg.scrollTimerSec === "number" && cfg.scrollTimerSec > 0) cfg.unblockTimeSec = cfg.scrollTimerSec;
      else cfg.unblockTimeSec = DEFAULTS.unblockTimeSec;
    }
    if (typeof cfg.forcedBlockSec !== "number" || cfg.forcedBlockSec < 0) cfg.forcedBlockSec = DEFAULTS.forcedBlockSec;
    if (cfg.enabled === undefined) cfg.enabled = true;
    if (cfg.openAnkiWeb === undefined) cfg.openAnkiWeb = true;
    callback(cfg);
  });
}

// ─── Per-tab unlock tracking ────────────────────────────────────
var unlocks = {};

function isUnlocked(tabId, hostname) {
  var k = tabId + ":" + hostname;
  if (unlocks[k] && unlocks[k] > Date.now()) return true;
  delete unlocks[k];
  return false;
}

function maybeInject(tabId) {
  getConfig(function(config) {
    if (!config.enabled) return;
    try {
      chrome.tabs.get(tabId, function(t) {
        if (chrome.runtime.lastError || !t || !t.url) return;
        if (t.url.startsWith("chrome") || t.url.startsWith("about") || t.url.startsWith("edge")) return;

        var hostname;
        try { hostname = new URL(t.url).hostname; } catch (e) { return; }
        if (!hostMatches(hostname, config.blockedDomains)) return;

        var unlocked = isUnlocked(tabId, hostname);
        var unlockRem = unlocked ? Math.max(0, Math.round((unlocks[tabId + ":" + hostname] - Date.now()) / 1000)) : 0;

        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: injectedBlocker,
          args: [{
            unblockTimeSec: config.unblockTimeSec,
            forcedBlockSec: config.forcedBlockSec,
            cardGoal: config.cardGoal,
            hostname: hostname,
            unlocked: unlocked,
            unlockRemaining: unlockRem,
            openAnkiWeb: config.openAnkiWeb
          }]
        }, function() {
          if (chrome.runtime.lastError) { /* tab not injectable */ }
        });
      });
    } catch (e) { /* ignore */ }
  });
}

// ─── Injected Blocker ───────────────────────────────────────────
function injectedBlocker(cfg) {
  if (window.__dycV === 7) return;
  window.__dycV = 7;

  var elapsed = 0;
  var engaged = false;
  var blocked = false;
  var tickId = null;
  var forcedId = null;
  var ulId = null;

  function fmtTime(s) {
    var m = Math.floor(s / 60);
    var sc = s % 60;
    return m + ":" + (sc < 10 ? "0" : "") + sc;
  }
  // Countdown format: use MM:SS only if the full duration is >= 60, else bare seconds.
  var useColon = (cfg.forcedBlockSec | 0) >= 60;
  function fmtCD(s) {
    if (s < 0) s = 0;
    if (!useColon) return String(s);
    var m = Math.floor(s / 60);
    var sc = s % 60;
    return m + ":" + (sc < 10 ? "0" : "") + sc;
  }
  function minsText(sec) {
    if (sec < 60) return sec + "s";
    var m = Math.round(sec / 60);
    return m + (m === 1 ? " minute" : " minutes");
  }

  // ── Countdown Badge (until block) ──
  var badge = document.createElement("div");
  badge.setAttribute("style",
    "position:fixed;bottom:16px;right:16px;z-index:2147483646;" +
    "background:#111;border:1px solid #2a2a2a;border-radius:6px;" +
    "padding:8px 14px;font-family:Consolas,'Courier New',monospace;" +
    "text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.4);" +
    "opacity:0;transition:opacity .3s;pointer-events:none"
  );
  var cdSpan = document.createElement("div");
  cdSpan.setAttribute("style", "font-size:18px;font-weight:700;color:#ff3b30;line-height:1;font-variant-numeric:tabular-nums");
  cdSpan.textContent = fmtTime(cfg.unblockTimeSec);
  badge.appendChild(cdSpan);
  var cdLabel = document.createElement("div");
  cdLabel.setAttribute("style", "font-size:9px;color:#666;margin-top:2px;letter-spacing:.1em");
  cdLabel.textContent = "UNTIL BLOCK";
  badge.appendChild(cdLabel);
  document.documentElement.appendChild(badge);
  setTimeout(function() { badge.style.opacity = "1"; }, 200);

  function onEngage() {
    engaged = true;
    document.removeEventListener("scroll", onEngage);
    document.removeEventListener("mousemove", onEngage);
    document.removeEventListener("click", onEngage);
  }
  document.addEventListener("scroll", onEngage, { passive: true });
  document.addEventListener("mousemove", onEngage, { passive: true });
  document.addEventListener("click", onEngage, { passive: true });

  var remaining = cfg.unblockTimeSec;
  tickId = setInterval(function() {
    if (blocked || document.hidden || !engaged) return;
    elapsed++;
    remaining = Math.max(0, cfg.unblockTimeSec - elapsed);
    cdSpan.textContent = fmtTime(remaining);
    if (remaining <= 30) cdSpan.style.color = "#ff3b30";
    else if (remaining <= 60) cdSpan.style.color = "#ff9500";
    if (remaining <= 0) {
      clearInterval(tickId); tickId = null;
      badge.style.opacity = "0";
      setTimeout(function() { try { badge.remove(); } catch(e){} }, 300);
      showBlock();
    }
  }, 1000);

  // ── Block Overlay ──
  function showBlock() {
    if (blocked) return;
    blocked = true;
    try { chrome.runtime.sendMessage({ type: "USER_BLOCKED" }); } catch (e) {}

    var quotes = [
      "Spaced repetition beats doom-scrolling.",
      "Your future self will thank you for this.",
      "Reddit will still be there. Your memory won't wait.",
      "The scroll gives nothing. The cards give everything.",
      "You're building knowledge. They're selling ads.",
      "Each card is a brick. Build something."
    ];
    var quote = quotes[Math.floor(Math.random() * quotes.length)];
    var windowText = minsText(cfg.unblockTimeSec);

    var ankiBlock;
    if (cfg.openAnkiWeb) {
      ankiBlock =
        '<a id="dyc-ankiweb" href="https://ankiweb.net/decks" target="_blank" rel="noopener">' +
          '<div class="dyc-aw-t">Open AnkiWeb →</div>' +
          '<div class="dyc-aw-s">review your cards, then come back</div>' +
        '</a>';
    } else {
      ankiBlock =
        '<div class="dyc-aw-static">' +
          '<div class="dyc-aw-t dyc-aw-t-dim">Open <span class="dyc-aw-anki">Anki</span> and complete your cards</div>' +
          '<div class="dyc-aw-s">then come back here when you\'re done</div>' +
        '</div>';
    }

    var ov = document.createElement("div");
    ov.id = "dyc-overlay";
    ov.setAttribute("style",
      "position:fixed;inset:0;z-index:2147483647;background:#0a0a0a;color:#f0ece4;" +
      "display:flex;flex-direction:column;overflow-y:auto;opacity:0;" +
      "transition:opacity .25s;font-family:Consolas,'Courier New',monospace"
    );

    ov.innerHTML = [
      '<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">',
      '<style>',
        '#dyc-overlay *{box-sizing:border-box}',
        '@keyframes dycS{to{background-position:36px 0}}',
        '@keyframes dycB{0%,100%{opacity:1}50%{opacity:.4}}',
        '@keyframes dycFU{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
        '@keyframes dycPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}',
        '.dyc-bar{position:fixed;left:0;right:0;height:4px;background:repeating-linear-gradient(90deg,#ff3b30 0 18px,#0a0a0a 18px 36px);animation:dycS 1s linear infinite;z-index:1}',
        '.dyc-inner{margin:auto;width:100%;max-width:480px;text-align:center;padding:clamp(18px,3vh,32px) clamp(16px,4vw,24px)}',
        '.dyc-tag{font-size:clamp(9px,1.4vw,11px);letter-spacing:.4em;text-transform:uppercase;color:#ff3b30;margin-bottom:clamp(8px,1.5vh,14px);animation:dycB 2s ease-in-out infinite}',
        '.dyc-title{font-family:"Instrument Serif",Georgia,serif;font-size:clamp(30px,6.5vw,52px);font-weight:400;line-height:1;margin-bottom:6px;color:#f0ece4}',
        '.dyc-title span{color:#ff3b30}',
        '.dyc-sub{font-size:clamp(10px,1.7vw,12px);color:#666;margin:0 0 clamp(14px,2.5vh,24px);line-height:1.6}',
        '.dyc-host{color:#ff3b30;text-decoration:line-through}',
        '.dyc-goal{font-size:clamp(22px,5vw,32px);font-weight:700;color:#f0ece4;line-height:1}',
        '.dyc-goal-sub{font-size:clamp(10px,1.7vw,13px);color:#888;margin-bottom:clamp(14px,2.5vh,22px)}',
        '#dyc-ankiweb,.dyc-aw-static{display:block;background:#161616;border:1px solid #2a2a2a;border-radius:6px;padding:clamp(12px,2vh,16px) clamp(14px,3vw,20px);margin:0 auto clamp(14px,2.5vh,18px);max-width:340px;text-decoration:none;transition:border-color .15s,box-shadow .15s}',
        '#dyc-ankiweb:hover{border-color:#ff3b30;box-shadow:0 4px 16px rgba(255,59,48,.15)}',
        '.dyc-aw-t{font-size:clamp(11px,1.7vw,13px);color:#f0ece4;margin-bottom:4px;letter-spacing:.05em;font-weight:700}',
        '.dyc-aw-t-dim{color:#aaa;font-weight:400}',
        '.dyc-aw-anki{color:#f0ece4;font-weight:700}',
        '.dyc-aw-s{font-size:clamp(9px,1.4vw,10px);color:#555}',
        '#dyc-lock-wrap{max-width:340px;margin:0 auto clamp(6px,1vh,10px);padding:clamp(14px,2.2vh,20px) 12px;background:#0e0e0e;border:1px solid #2a2a2a;border-radius:6px}',
        '#dyc-countdown{font-size:clamp(44px,10.5vw,80px);font-weight:700;color:#ff3b30;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:.02em;animation:dycPulse 1.5s ease-in-out infinite}',
        '.dyc-cd-lbl{font-size:clamp(8px,1.2vw,10px);color:#666;letter-spacing:.25em;margin-top:10px;text-transform:uppercase}',
        '.dyc-btn{font-family:Consolas,"Courier New",monospace;font-size:clamp(11px,1.8vw,13px);font-weight:700;border:none;cursor:pointer;padding:clamp(11px,1.8vh,14px) 20px;letter-spacing:.06em;text-transform:uppercase;width:100%;max-width:340px;display:block;margin:0 auto;border-radius:3px;transition:background .15s}',
        '#dyc-done{background:#ff3b30;color:#f0ece4}',
        '#dyc-done:hover{background:#ff5147}',
        '#dyc-go{background:#30d158;color:#000}',
        '#dyc-go:hover{background:#4ae074}',
        '#dyc-unlocked{animation:dycFU .4s ease;margin-top:18px}',
        '.dyc-ul-lbl{color:#30d158;font-size:clamp(10px,1.7vw,12px);letter-spacing:.2em;text-transform:uppercase;margin-bottom:12px}',
        '.dyc-quote{font-family:"Instrument Serif",Georgia,serif;font-style:italic;font-size:clamp(12px,2vw,15px);color:#444;margin-top:clamp(16px,2.8vh,24px)}',
        '@media (max-height:620px){.dyc-title{font-size:clamp(22px,4.5vw,32px);margin-bottom:4px}.dyc-goal{font-size:clamp(18px,3.8vw,24px)}.dyc-goal-sub{margin-bottom:10px}#dyc-countdown{font-size:clamp(34px,7.5vw,52px)}#dyc-ankiweb,.dyc-aw-static{padding:10px 14px;margin-bottom:10px}.dyc-inner{padding:14px 16px}.dyc-quote{margin-top:12px}}',
        '@media (max-width:360px){.dyc-inner{padding:16px 12px}#dyc-lock-wrap,#dyc-ankiweb,.dyc-aw-static,.dyc-btn{max-width:100%}}',
      '</style>',
      '<div class="dyc-bar" style="top:0"></div>',
      '<div class="dyc-bar" style="bottom:0"></div>',
      '<div class="dyc-inner">',
        '<div class="dyc-tag">⛔ time\'s up</div>',
        '<div class="dyc-title">Do Your <span>Cards</span></div>',
        '<p class="dyc-sub">You\'ve been scrolling <span class="dyc-host">' + cfg.hostname + '</span>.<br>Complete your Anki flashcards to unlock for ' + windowText + '.</p>',
        '<div class="dyc-goal">' + cfg.cardGoal + ' cards</div>',
        '<div class="dyc-goal-sub">is today\'s goal</div>',
        ankiBlock,
        '<div id="dyc-lock-wrap">',
          '<div id="dyc-countdown">' + fmtCD(cfg.forcedBlockSec) + '</div>',
          '<div class="dyc-cd-lbl">Forced block · wait to unlock</div>',
        '</div>',
        '<div id="dyc-actions" style="display:none">',
          '<button id="dyc-done" class="dyc-btn">✓ I finished my cards</button>',
        '</div>',
        '<div id="dyc-unlocked" style="display:none">',
          '<p class="dyc-ul-lbl">✓ unlocked for ' + windowText + '</p>',
          '<button id="dyc-go" class="dyc-btn">Continue browsing →</button>',
        '</div>',
        '<p class="dyc-quote">' + quote + '</p>',
      '</div>'
    ].join("");

    document.documentElement.appendChild(ov);
    requestAnimationFrame(function() { ov.style.opacity = "1"; });
    document.body.style.setProperty("overflow", "hidden", "important");

    // ── Forced block countdown ──
    var forcedRemaining = Math.max(0, cfg.forcedBlockSec | 0);
    var lockWrap  = document.getElementById("dyc-lock-wrap");
    var cdEl      = document.getElementById("dyc-countdown");
    var actionsEl = document.getElementById("dyc-actions");

    function revealUnlockButton() {
      if (lockWrap) lockWrap.style.display = "none";
      if (actionsEl) actionsEl.style.display = "block";
    }

    if (forcedRemaining <= 0) {
      revealUnlockButton();
    } else {
      forcedId = setInterval(function() {
        forcedRemaining--;
        if (forcedRemaining <= 0) {
          clearInterval(forcedId); forcedId = null;
          if (cdEl) cdEl.textContent = fmtCD(0);
          revealUnlockButton();
        } else if (cdEl) {
          cdEl.textContent = fmtCD(forcedRemaining);
        }
      }, 1000);
    }

    // ── Action handlers ──
    document.getElementById("dyc-done").addEventListener("click", function() {
      try { chrome.runtime.sendMessage({ type: "CARDS_COMPLETED" }); } catch (e) {}
      if (actionsEl) actionsEl.style.display = "none";
      var ul = document.getElementById("dyc-unlocked");
      if (ul) ul.style.display = "block";
    });

    document.getElementById("dyc-go").addEventListener("click", function() {
      ov.style.opacity = "0";
      document.body.style.removeProperty("overflow");
      setTimeout(function() {
        try { ov.remove(); } catch(e){}
        blocked = false;
        showUnlockBadge(cfg.unblockTimeSec);
      }, 250);
    });
  }

  // ── Green "until re-block" badge shown while unlocked ──
  function showUnlockBadge(seconds) {
    var ulB = document.createElement("div");
    ulB.setAttribute("style",
      "position:fixed;bottom:16px;right:16px;z-index:2147483646;" +
      "background:#0d1a10;border:1px solid #1a3d24;border-radius:6px;" +
      "padding:8px 14px;font-family:Consolas,'Courier New',monospace;" +
      "text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.3);" +
      "opacity:0;transition:opacity .3s;pointer-events:none"
    );
    var ulNum = document.createElement("div");
    ulNum.setAttribute("style", "font-size:16px;font-weight:700;color:#30d158;line-height:1;font-variant-numeric:tabular-nums");
    ulB.appendChild(ulNum);
    var ulLbl = document.createElement("div");
    ulLbl.setAttribute("style", "font-size:9px;color:#30d158;margin-top:2px;letter-spacing:.1em");
    ulLbl.textContent = "UNTIL RE-BLOCK";
    ulB.appendChild(ulLbl);
    document.documentElement.appendChild(ulB);
    setTimeout(function() { ulB.style.opacity = "1"; }, 50);

    var r = Math.max(1, seconds | 0);
    ulNum.textContent = fmtTime(r);
    ulId = setInterval(function() {
      r--;
      if (r <= 0) {
        clearInterval(ulId); ulId = null;
        ulB.style.opacity = "0";
        setTimeout(function() { try { ulB.remove(); } catch(e){} }, 300);
        showBlock();
        return;
      }
      ulNum.textContent = fmtTime(r);
    }, 1000);
  }

  // If we landed on the page already inside an unlock window, skip straight to the green badge.
  if (cfg.unlocked && cfg.unlockRemaining > 0) {
    try { badge.remove(); } catch(e){}
    clearInterval(tickId); tickId = null;
    showUnlockBadge(cfg.unlockRemaining);
  }
}

// ─── Tab Events ─────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener(function(tabId, info) {
  if (info.status === "complete") maybeInject(tabId);
});
chrome.tabs.onActivated.addListener(function(info) {
  maybeInject(info.tabId);
});

// ─── Messages from injected blocker ─────────────────────────────
chrome.runtime.onMessage.addListener(function(msg, sender) {
  var k = todayKey();
  if (msg.type === "USER_BLOCKED") {
    chrome.storage.local.get("stats", function(r) {
      var stats = r.stats || {};
      if (!stats[k]) stats[k] = { timesBlocked: 0, cardsCompleted: 0 };
      stats[k].timesBlocked++;
      chrome.storage.local.set({ stats: stats });
    });
  }
  if (msg.type === "CARDS_COMPLETED") {
    chrome.storage.local.get("stats", function(r) {
      var stats = r.stats || {};
      if (!stats[k]) stats[k] = { timesBlocked: 0, cardsCompleted: 0 };
      stats[k].cardsCompleted++;
      chrome.storage.local.set({ stats: stats });
    });
    if (sender.tab) {
      var tabId = sender.tab.id;
      var hostname = "";
      try { hostname = new URL(sender.tab.url).hostname; } catch (e) {}
      if (tabId && hostname) {
        getConfig(function(config) {
          unlocks[tabId + ":" + hostname] = Date.now() + config.unblockTimeSec * 1000;
        });
      }
    }
  }
  return false;
});
