// Feed page: today's picks, a hard daily minute budget, and a distraction-free player.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const pad = (n) => String(n).padStart(2, "0");
  const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtDur = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  };
  const DAY_NAMES = { free: "Free day", normal: "Normal day", busy: "Busy day" };

  let feed = null;
  let today = localDay();
  const OPTIONS = [20, 30, 60, 75]; // daily minute choices
  const k = () => ({
    budget: `budget:${today}`,      // minutes chosen for today
    watched: `watch:${today}`,      // seconds actually played today
    played: `played:${today}`,      // video ids started today
    finishing: `finishing:${today}`, // the video allowed to finish after the budget ran out
  });

  const watchedSec = () => store.get(k().watched, 0);
  const chosenMin = () => store.get(k().budget, null);
  const budgetMin = () => chosenMin() ?? feed?.budgetMinutes ?? 30;
  const budgetSec = () => budgetMin() * 60;
  // The option closest to what the calendar suggests (taper can land between options).
  const suggestedMin = () => {
    const s = feed?.budgetMinutes ?? 30;
    return OPTIONS.reduce((best, o) => (Math.abs(o - s) < Math.abs(best - s) ? o : best), OPTIONS[0]);
  };
  const fraction = () => watchedSec() / budgetSec();
  const isLocked = () => fraction() >= 1;

  // ---------- Meter + nudge ----------
  function nudgeAllowed() {
    if (!feed?.nudge) return false;
    const shown = store.get("nudgesShown", {});
    const last = shown[feed.nudge.id];
    if (last && last !== today && (Date.parse(today) - Date.parse(last)) / 86400e3 < 30) return false;
    if (!last || last !== today) { shown[feed.nudge.id] = today; store.set("nudgesShown", shown); }
    return true;
  }
  let showNudge = false;

  function renderMeter() {
    const f = fraction();
    const usedMin = Math.floor(watchedSec() / 60);
    const left = Math.max(0, Math.ceil((budgetSec() - watchedSec()) / 60));
    const day = DAY_NAMES[feed?.dayType] || "Today";
    const events = feed?.eventCount;
    $("day-label").textContent = events == null ? day : `${day}, ${events} event${events === 1 ? "" : "s"}`;
    const chosen = chosenMin() !== null;
    $("used-label").textContent = chosen ? `${usedMin} of ${budgetMin()} min` : "Pick today's minutes";
    $("left-num").textContent = chosen ? left : "–";
    $("bar-fill").style.width = `${Math.min(100, f * 100)}%`;
    document.body.classList.toggle("amber", f >= 0.8 && f < 1);
    document.body.classList.toggle("red", f >= 1);

    const n = $("nudge");
    if (showNudge && f < 1) {
      n.hidden = false;
      n.textContent = f >= 0.8 ? feed.nudge.lines.warn : feed.nudge.lines.normal;
      n.classList.toggle("warn", f >= 0.8);
    } else {
      n.hidden = true;
    }
  }

  // ---------- Daily minutes picker ----------
  // mode "start": first open of the day, all options. mode "lower": only options below today's choice.
  let choosing = null;
  function renderChoose() {
    const box = $("choose");
    box.hidden = !choosing;
    if (!choosing) return;
    const lower = choosing === "lower";
    const current = chosenMin();
    const opts = lower ? OPTIONS.filter((o) => o < current) : OPTIONS;
    const day = (DAY_NAMES[feed?.dayType] || "Today").toLowerCase().replace(" day", "");
    $("choose-title").textContent = lower ? "Lower today's limit?" : "How much today?";
    $("choose-sub").textContent = lower
      ? "You can go lower, not higher."
      : `Suggested ${suggestedMin()} min for a ${day} day. You can lower it later, not raise it.`;
    $("choose-cancel").hidden = !lower;
    const wrap = $("choose-options");
    wrap.textContent = "";
    for (const o of opts) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt" + (!lower && o === suggestedMin() ? " suggested" : "");
      b.innerHTML = `${o}<small>${!lower && o === suggestedMin() ? "suggested" : "min"}</small>`;
      b.addEventListener("click", () => {
        store.set(k().budget, o);
        choosing = null;
        renderFeed();
      });
      wrap.append(b);
    }
  }

  $("choose-cancel").addEventListener("click", () => { choosing = null; renderFeed(); });
  $("meter-left").addEventListener("click", () => {
    const current = chosenMin();
    if (current === null || !$("watch-view").hidden || !OPTIONS.some((o) => o < current)) return;
    choosing = "lower";
    renderFeed();
    window.scrollTo(0, 0);
  });

  // ---------- Feed ----------
  function renderFeed() {
    if (chosenMin() === null && feed) choosing = "start";
    renderMeter();
    renderChoose();
    const list = $("picks");
    list.textContent = "";
    if (choosing) {
      $("done").hidden = true;
      $("note").hidden = true;
      return;
    }
    const locked = isLocked();
    $("done").hidden = !locked;
    if (locked) $("done-nudge").textContent = showNudge ? feed.nudge.lines.done : "Go do something good.";

    const note = $("note");
    note.hidden = true;
    if (!feed) { note.hidden = false; note.textContent = "Couldn't load today's feed. Check your connection."; return; }
    if (feed.date !== today) { note.hidden = false; note.textContent = "These are yesterday's picks. Today's arrive around 5am."; }
    if (!feed.picks?.length) { note.hidden = false; note.textContent = "Nothing strong today. That's the point. Picks refresh around 5am."; return; }

    const played = new Set(store.get(k().played, []));
    const leftSec = budgetSec() - watchedSec();
    for (const p of feed.picks) {
      const li = document.createElement("li");
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card" + (played.has(p.videoId) ? " is-played" : "");
      card.disabled = locked && store.get(k().finishing, null) !== p.videoId;
      card.innerHTML = `
        <div class="thumb"><img alt="" loading="lazy"><span class="dur"></span></div>
        <div class="body"><div class="thread"></div><h2 class="title"></h2><p class="channel"></p><p class="why"></p></div>`;
      card.querySelector("img").src = `https://i.ytimg.com/vi/${encodeURIComponent(p.videoId)}/hqdefault.jpg`;
      card.querySelector(".dur").textContent = fmtDur(p.seconds);
      card.querySelector(".thread").textContent = p.thread;
      card.querySelector(".title").textContent = p.title;
      card.querySelector(".channel").textContent = p.older ? `${p.channel} · from the archive` : p.channel;
      card.querySelector(".why").textContent = p.why;
      if (played.has(p.videoId)) {
        const tag = document.createElement("span");
        tag.className = "played"; tag.textContent = "Started";
        card.querySelector(".thumb").append(tag);
      }
      if (!locked && p.seconds > leftSec + 30) {
        const long = document.createElement("p");
        long.className = "long";
        long.textContent = `Longer than the ${Math.max(0, Math.ceil(leftSec / 60))} min you have left`;
        card.querySelector(".body").append(long);
      }
      card.addEventListener("click", () => { location.hash = `#/watch/${p.videoId}`; });
      li.append(card);
      list.append(li);
    }
  }

  // ---------- Player ----------
  let player = null;
  let playerReady = null;
  let currentId = null;
  let ticker = null;
  let lastTick = 0;
  let endWatch = null;

  function loadYT() {
    if (playerReady) return playerReady;
    playerReady = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = resolve;
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.append(s);
    });
    return playerReady;
  }

  function tick() {
    const now = performance.now();
    // Background tabs throttle timers, so use real elapsed time (capped in case the device slept).
    const delta = Math.min(65, (now - lastTick) / 1000);
    lastTick = now;
    const before = fraction();
    store.set(k().watched, watchedSec() + delta);
    if (before < 1 && fraction() >= 1 && currentId) store.set(k().finishing, currentId);
    renderMeter();
    // End-screen guard: block clicks during the last 20 seconds.
    try {
      const left = player.getDuration() - player.getCurrentTime();
      $("guard-end").hidden = !(left <= 20);
    } catch {}
  }

  function startTicking() {
    stopTicking();
    lastTick = performance.now();
    ticker = setInterval(tick, 1000);
  }
  function stopTicking() {
    if (ticker) { tick(); clearInterval(ticker); ticker = null; }
  }

  function showCover(text, btnText, onClick) {
    $("cover").hidden = false;
    $("cover-text").textContent = text;
    $("cover-btn").textContent = btnText;
    $("cover-btn").onclick = onClick;
  }
  const hideCover = () => { $("cover").hidden = true; };

  function onState(e) {
    const S = YT.PlayerState;
    $("guard-corner").hidden = !(e.data === S.UNSTARTED || e.data === S.CUED);
    if (e.data === S.PLAYING) {
      hideCover();
      startTicking();
      const played = new Set(store.get(k().played, []));
      if (!played.has(currentId)) { played.add(currentId); store.set(k().played, [...played]); }
    } else if (e.data === S.PAUSED) {
      stopTicking();
      showCover("Paused", "Resume", () => player.playVideo());
    } else if (e.data === S.ENDED) {
      stopTicking();
      $("guard-end").hidden = true;
      store.set(k().finishing, null);
      showCover(isLocked() ? (showNudge ? feed.nudge.lines.done : "That's today's time.") : "Done.", "Back to feed", () => { location.hash = ""; });
      try { player.stopVideo(); } catch {}
    } else if (e.data === S.BUFFERING) {
      stopTicking();
    }
  }

  async function openWatch(id) {
    const pick = feed?.picks?.find((p) => p.videoId === id);
    const allowed = pick && chosenMin() !== null && (!isLocked() || store.get(k().finishing, null) === id);
    if (!allowed) { location.hash = ""; return; }

    $("feed-view").hidden = true;
    $("watch-view").hidden = false;
    window.scrollTo(0, 0);
    $("w-thread").textContent = pick.thread;
    $("w-title").textContent = pick.title;
    $("w-channel").textContent = pick.channel;
    $("w-why").textContent = pick.why;
    hideCover();
    $("guard-end").hidden = true;
    $("guard-corner").hidden = false;
    currentId = id;

    await loadYT();
    if (currentId !== id) return;
    if (player) { player.cueVideoById(id); return; }
    player = new YT.Player("player", {
      host: "https://www.youtube-nocookie.com",
      videoId: id,
      playerVars: { rel: 0, autoplay: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, fs: 1, disablekb: 0 },
      events: { onStateChange: onState },
    });
  }

  function closeWatch() {
    stopTicking();
    currentId = null;
    try { player?.pauseVideo(); } catch {}
    $("watch-view").hidden = true;
    $("feed-view").hidden = false;
    renderFeed();
  }

  $("back").addEventListener("click", () => { location.hash = ""; });
  $("guard-toggle").addEventListener("click", () => {
    try { player.getPlayerState() === YT.PlayerState.PLAYING ? player.pauseVideo() : player.playVideo(); } catch {}
  });

  function route() {
    const m = location.hash.match(/^#\/watch\/([\w-]{11})$/);
    if (m && feed) openWatch(m[1]);
    else if (!$("watch-view").hidden || !m) closeWatch();
  }

  // Midnight rollover: reset the meter without a reload.
  setInterval(() => {
    const d = localDay();
    if (d !== today) { today = d; showNudge = nudgeAllowed(); if ($("watch-view").hidden) renderFeed(); else renderMeter(); }
  }, 30000);

  async function load() {
    try {
      const res = await fetch(`feed.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      feed = await res.json();
    } catch {
      feed = null;
    }
    showNudge = nudgeAllowed();
    route();
    renderFeed();
  }

  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && $("watch-view").hidden) load(); });
  load();

  if ("serviceWorker" in navigator) {
    // When a new version takes over, reload once so you see it immediately (not mid-video).
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && $("watch-view").hidden) location.reload();
    });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  }
})();
