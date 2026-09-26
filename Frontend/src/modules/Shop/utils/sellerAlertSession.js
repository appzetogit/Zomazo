/**
 * Single seller "pending order" alert session.
 * One looping Audio (or native loop) for all mounts — idempotent start/stop.
 */
import alertSound from "@store/assets/audio/alert.mp3";

const pendingKeys = new Set();
let audio = null;
let unlockAttempted = false;
let muted = false;
let nativeLoopActive = false;
let playInFlight = null;

const resolveAudioSource = (source, cacheKey = "seller-alert-session") => {
  if (!source) return source;
  if (!import.meta.env.DEV) return source;
  const separator = source.includes("?") ? "&" : "?";
  return `${source}${separator}devcache=${cacheKey}`;
};

const isFlutterWebView = () =>
  typeof window !== "undefined" &&
  Boolean(window.flutter_inappwebview) &&
  typeof window.flutter_inappwebview.callHandler === "function";

export function collectSellerOrderAlertKeys(orderLike = {}) {
  if (orderLike == null) return [];
  if (typeof orderLike === "string" || typeof orderLike === "number") {
    const key = String(orderLike).trim();
    return key ? [key] : [];
  }

  const keys = [
    orderLike.orderMongoId,
    orderLike.order_mongo_id,
    orderLike._id,
    orderLike.mongoId,
    orderLike.orderId,
    orderLike.order_id,
    orderLike.id,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);

  return [...new Set(keys)];
}

export function getSellerOrderAlertKey(orderLike = {}) {
  return collectSellerOrderAlertKeys(orderLike)[0] || "";
}

export function isSellerAlertRinging() {
  return pendingKeys.size > 0 && !muted;
}

export function isSellerAlertMuted() {
  return muted;
}

export function getSellerAlertPendingCount() {
  return pendingKeys.size;
}

function ensureAudio() {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio(resolveAudioSource(alertSound));
    audio.preload = "auto";
    audio.loop = true;
    audio.volume = 1;
  }
  return audio;
}

function isWebAudioPlaying() {
  const el = audio;
  return Boolean(el && !el.paused && !el.ended);
}

async function callNativeHandlers(handlerNames, payload = {}) {
  if (!isFlutterWebView()) return false;
  for (const handlerName of handlerNames) {
    try {
      await window.flutter_inappwebview.callHandler(handlerName, payload);
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

async function startNativeLoop(orderLike = {}) {
  const keys = collectSellerOrderAlertKeys(orderLike);
  const payload = {
    title: "New seller order",
    body: `Order #${keys[0] || ""}`.trim(),
    orderId: orderLike?.orderId || orderLike?.order_id || keys[0] || "",
    orderMongoId: orderLike?.orderMongoId || orderLike?._id || "",
    loop: true,
    action: "start",
  };

  const started = await callNativeHandlers(
    ["startAlertLoop", "startOrderAlert", "playNotificationSoundLoop"],
    payload,
  );
  if (started) {
    nativeLoopActive = true;
    return true;
  }
  return false;
}

async function stopNativeLoop() {
  if (!nativeLoopActive && !isFlutterWebView()) return;
  await callNativeHandlers(
    ["stopAlertLoop", "stopOrderAlert", "stopNotificationSound"],
    { action: "stop", loop: false },
  );
  nativeLoopActive = false;
}

function pauseWebAudio() {
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.loop = true;
  } catch {
    // ignore
  }
}

async function playWebLoop() {
  const el = ensureAudio();
  if (!el || muted) return false;
  el.muted = false;
  el.volume = 1;
  el.loop = true;
  try {
    if (el.paused) {
      el.currentTime = 0;
      await el.play();
    }
    return true;
  } catch {
    return false;
  }
}

async function ensureRinging(orderLike = {}) {
  if (muted || pendingKeys.size === 0) return false;
  if (nativeLoopActive || isWebAudioPlaying()) return true;

  if (playInFlight) return playInFlight;

  playInFlight = (async () => {
    const nativeStarted = await startNativeLoop(orderLike);
    if (nativeStarted) return true;

    // One-shot native feedback (non-loop) then fall back to web loop.
    await callNativeHandlers(
      ["playNotificationSound", "triggerNotificationFeedback"],
      {
        title: "New seller order",
        body: "New order waiting",
        orderId: getSellerOrderAlertKey(orderLike),
        disableActions: true,
      },
    );

    return playWebLoop();
  })().finally(() => {
    playInFlight = null;
  });

  return playInFlight;
}

/**
 * Unlock autoplay on a user gesture. Safe to call many times.
 */
export async function unlockSellerAlertAudio() {
  if (typeof window === "undefined") return false;
  const el = ensureAudio();
  if (!el) return false;
  if (unlockAttempted && !el.paused) return true;

  unlockAttempted = true;
  try {
    el.muted = true;
    el.loop = false;
    await el.play();
    el.pause();
    el.currentTime = 0;
    el.muted = false;
    el.loop = true;
    if (pendingKeys.size > 0 && !muted) {
      await ensureRinging();
    }
    return true;
  } catch {
    unlockAttempted = false;
    if (el) el.muted = false;
    return false;
  }
}

/**
 * Add pending order keys and start looping sound only if not already ringing.
 */
export async function startSellerAlert(orderLike = {}) {
  const keys = collectSellerOrderAlertKeys(orderLike);
  if (!keys.length) return { ok: false, reason: "no_key" };

  const alreadyPending = pendingKeys.size > 0;
  keys.forEach((k) => pendingKeys.add(k));

  if (muted) {
    return { ok: true, ringing: false, reason: "muted", alreadyPending };
  }

  // Idempotent: another pending order already owns the audible session.
  if (alreadyPending && (nativeLoopActive || isWebAudioPlaying())) {
    return { ok: true, ringing: true, continued: true };
  }

  const started = await ensureRinging(orderLike);
  return { ok: true, ringing: started, continued: alreadyPending };
}

/**
 * Remove this order from the pending set. Stops sound only when none remain.
 */
export function stopSellerAlert(orderLike = {}) {
  const keys = collectSellerOrderAlertKeys(orderLike);
  keys.forEach((k) => pendingKeys.delete(k));

  if (pendingKeys.size === 0) {
    pauseWebAudio();
    void stopNativeLoop();
    return { ok: true, ringing: false };
  }

  return { ok: true, ringing: !muted };
}

export function stopAllSellerAlerts() {
  pendingKeys.clear();
  pauseWebAudio();
  void stopNativeLoop();
  return { ok: true, ringing: false };
}

/**
 * Align session with current confirmed/pending orders from REST poll.
 * Drops keys that are no longer waiting; starts/keeps ring if any remain.
 */
export function syncSellerAlertsWithOrders(orderList = []) {
  const keep = new Set();
  (Array.isArray(orderList) ? orderList : []).forEach((order) => {
    collectSellerOrderAlertKeys(order).forEach((k) => keep.add(k));
  });

  for (const key of [...pendingKeys]) {
    if (!keep.has(key)) pendingKeys.delete(key);
  }

  // Ensure known pending orders are tracked.
  keep.forEach((k) => pendingKeys.add(k));

  if (pendingKeys.size === 0) {
    pauseWebAudio();
    void stopNativeLoop();
    return { ok: true, ringing: false, pending: 0 };
  }

  if (!muted) {
    void ensureRinging(orderList[0] || {});
  }
  return { ok: true, ringing: !muted, pending: pendingKeys.size };
}

export function setSellerAlertMuted(nextMuted) {
  muted = Boolean(nextMuted);
  if (muted) {
    pauseWebAudio();
    void stopNativeLoop();
    return { muted: true, ringing: false };
  }
  if (pendingKeys.size > 0) {
    void ensureRinging();
    return { muted: false, ringing: true };
  }
  return { muted: false, ringing: false };
}

/** Attach once: unlock audio on first user gesture anywhere in the seller app. */
export function attachSellerAlertUnlockListeners() {
  if (typeof window === "undefined") return () => {};

  const onGesture = () => {
    void unlockSellerAlertAudio();
  };

  window.addEventListener("pointerdown", onGesture, { passive: true });
  window.addEventListener("keydown", onGesture);
  window.addEventListener("touchstart", onGesture, { passive: true });

  return () => {
    window.removeEventListener("pointerdown", onGesture);
    window.removeEventListener("keydown", onGesture);
    window.removeEventListener("touchstart", onGesture);
  };
}
