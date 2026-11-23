"use strict";

/* ==========================================================================
   Abdullah Ewidah — Portfolio scripts
   Every feature lives in its own init function. They are started at the
   bottom of this file, and one failing feature never stops the others.
   ========================================================================== */

// Cached data and drafts. Visitor preferences live in the state store below.
const STORAGE_KEYS = {
  githubCache: "portfolio-github-repos",
  weatherCache: "portfolio-weather",
  contactDraft: "portfolio-contact-draft",
  visitCounted: "portfolio-visit-counted", // sessionStorage: reloads are not new visits.
};

/* ---------- Small helpers ---------- */

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

// Web Storage throws in some private windows and when storage is blocked,
// so every access goes through these wrappers and the site keeps working.
function createSafeStorage(areaName) {
  return {
    get(key) {
      try {
        return window[areaName].getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window[areaName].setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        window[areaName].removeItem(key);
      } catch {
        // Nothing to clean up when storage is unavailable.
      }
    },
  };
}

const storage = createSafeStorage("localStorage"); // Kept across visits.
const sessionStore = createSafeStorage("sessionStorage"); // Cleared when the tab closes.

// Waits until calls stop for `wait` ms, so typing does not re-render on every key.
function debounce(callback, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), wait);
  };
}

// Lowercase and strip accents so "esp32", "ESP32", and "Esp 32 " compare fairly.
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Restarts a CSS animation, even when the class is already on the element.
function replayAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth; // Reading layout forces the browser to notice the removal.
  element.classList.add(className);
}

function isTypingTarget(element) {
  return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)));
}

// Builds DOM nodes with textContent, which keeps outside data (like API
// responses) from ever being parsed as HTML.
function createElement(tag, { className, text, attrs } = {}, children = []) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  if (attrs) Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
  element.append(...children);
  return element;
}

const relativeTimeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const TIME_UNITS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

// Turns a date into friendly text such as "3 days ago" or "just now".
function timeAgo(date) {
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  for (const [unit, size] of TIME_UNITS) {
    if (Math.abs(seconds) >= size) return relativeTimeFormat.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/* ---------- Shared API helpers (used by the GitHub and weather features) ---------- */

// An Error tagged with a `kind` (offline, timeout, rate-limit, not-found, http,
// or network), so each feature can explain the exact problem in plain words.
function apiError(kind, details = {}) {
  return Object.assign(new Error(kind), { kind }, details);
}

// fetch() with an offline check, a timeout, and tagged errors for every failure.
async function fetchJson(url, { timeoutMs = 10000, headers = {} } = {}) {
  if (!navigator.onLine) throw apiError("offline");

  // fetch has no timeout of its own: abort slow requests so nobody waits forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { headers, signal: controller.signal });
  } catch (error) {
    throw apiError(error.name === "AbortError" ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // 429 means "too many requests"; GitHub also uses 403 with no requests remaining.
    const limitReached = response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
    const kind = limitReached ? "rate-limit" : response.status === 404 ? "not-found" : "http";
    throw apiError(kind, { status: response.status, resetAt: Number(response.headers.get("x-ratelimit-reset")) * 1000 || 0 });
  }

  try {
    return await response.json();
  } catch {
    throw apiError("http"); // The server answered, but not with valid JSON.
  }
}

// A saved copy of API data with the time it was saved, so a page can show
// fresh data instantly and fall back to an older copy when a request fails.
function createApiCache(key, maxAgeMinutes, isValidData) {
  return {
    read() {
      try {
        const entry = JSON.parse(storage.get(key));
        if (entry && typeof entry.savedAt === "number" && isValidData(entry.data)) return entry;
      } catch {
        // A damaged copy is ignored and replaced on the next successful load.
      }
      return null;
    },
    write(data) {
      const entry = { savedAt: Date.now(), data };
      storage.set(key, JSON.stringify(entry));
      return entry;
    },
    isFresh: (entry) => Boolean(entry) && Date.now() - entry.savedAt < maxAgeMinutes * 60 * 1000,
  };
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function onMediaChange(query, handler) {
  // Safari before 14 only supports the older addListener API.
  if (query.addEventListener) {
    query.addEventListener("change", handler);
  } else {
    query.addListener(handler);
  }
}

/* ---------- App state: one store for everything the site remembers ---------- */

// Letters from any language, plus spaces, hyphens, apostrophes, and periods.
const VISITOR_NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} '.-]*$/u;

// Returns an error message for a visitor name, or "" when it is fine.
function checkVisitorName(name) {
  if (!name) return "Please type a name first.";
  if (name.length < 2) return "Your name should be at least 2 characters long.";
  if (name.length > 30) return "Please keep your name to 30 characters or fewer.";
  if (!VISITOR_NAME_PATTERN.test(name)) return "Please use letters only (spaces, hyphens, and apostrophes are fine).";
  return "";
}

const isOneOf = (...options) => (value) => options.includes(value);

// Every remembered setting, with its localStorage key, its default value, how it
// is saved ("text" as-is, or "json"), and a check that rejects damaged or
// outdated saved values. Text values keep the Assignment 2 format, so the
// inline <head> script can still read the theme before the first paint.
const STATE_SCHEMA = {
  theme: { key: "portfolio-theme", fallback: "system", format: "text", isValid: isOneOf("light", "dark", "system") },
  visitorName: { key: "portfolio-visitor-name", fallback: "", format: "text", isValid: (value) => value === "" || checkVisitorName(value) === "" },
  hiddenSections: { key: "portfolio-hidden-sections", fallback: [], format: "json", isValid: (value) => Array.isArray(value) && value.every((id) => typeof id === "string") },
  githubForks: { key: "portfolio-github-forks", fallback: false, format: "json", isValid: (value) => typeof value === "boolean" },
  projectView: { key: "portfolio-project-view", fallback: "all", format: "text", isValid: isOneOf("all", "beginner", "advanced") },
  tempUnit: { key: "portfolio-temp-unit", fallback: "celsius", format: "text", isValid: isOneOf("celsius", "fahrenheit") },
  visits: { key: "portfolio-visits", fallback: 0, format: "json", isValid: (value) => Number.isInteger(value) && value >= 0 },
};

// A tiny publish/subscribe store. Features read values with get(), change them
// with set(), and subscribe() to re-render whenever a value changes, whether
// the change came from this tab or from another open tab of the site.
function createStore(schema) {
  const values = {};
  const listeners = {};
  const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function load(name) {
    const { key, fallback, format, isValid } = schema[name];
    const raw = storage.get(key);
    if (raw === null) return fallback;
    let value = raw;
    if (format === "json") {
      try {
        value = JSON.parse(raw);
      } catch {
        return fallback;
      }
    }
    return isValid(value) ? value : fallback;
  }

  function update(name, value) {
    if (sameValue(value, values[name])) return;
    values[name] = value;
    listeners[name].forEach((listener) => listener(value));
  }

  Object.keys(schema).forEach((name) => {
    values[name] = load(name);
    listeners[name] = new Set();
  });

  // The "storage" event fires when another tab changes localStorage
  // (event.key is null when that tab cleared everything).
  window.addEventListener("storage", (event) => {
    Object.keys(schema).forEach((name) => {
      if (event.key === null || event.key === schema[name].key) update(name, load(name));
    });
  });

  function set(name, value) {
    const { key, fallback, format, isValid } = schema[name];
    if (!isValid(value)) throw new TypeError(`Rejected an invalid value for "${name}".`);
    // Defaults are not stored: an empty storage means "use the default".
    if (sameValue(value, fallback)) storage.remove(key);
    else storage.set(key, format === "json" ? JSON.stringify(value) : value);
    update(name, value);
  }

  return {
    get: (name) => values[name],
    set,
    reset: (name) => set(name, schema[name].fallback),
    names: () => Object.keys(schema),
    // Calls listener(value) on every change; with { now: true } also right away.
    subscribe(name, listener, { now = false } = {}) {
      listeners[name].add(listener);
      if (now) listener(values[name]);
    },
  };
}

const store = createStore(STATE_SCHEMA);

/* ---------- Theme ---------- */

function initTheme() {
  const root = document.documentElement;
  const toggle = $("#theme-toggle");
  const themeColor = $('meta[name="theme-color"]');
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  // The saved choice is "light", "dark", or "system" (follow the device).
  const resolveTheme = () => {
    const choice = store.get("theme");
    if (choice !== "system") return choice;
    return systemDark.matches ? "dark" : "light";
  };

  // The inline script in <head> already chose the first theme before paint.
  function applyTheme(theme) {
    root.dataset.theme = theme;
    toggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
    if (themeColor) themeColor.setAttribute("content", theme === "dark" ? "#101b19" : "#f5f6f3");
  }

  function showResolvedTheme() {
    const next = resolveTheme();
    if (next === root.dataset.theme) return;
    // Cross-fade the whole page where the View Transitions API exists; other
    // browsers switch instantly. A background tab (synced from another tab)
    // cannot run a transition, so it also switches instantly.
    if (document.startViewTransition && !prefersReducedMotion() && document.visibilityState === "visible") {
      document.startViewTransition(() => applyTheme(next));
    } else {
      applyTheme(next);
    }
  }

  applyTheme(resolveTheme());

  toggle.addEventListener("click", () => store.set("theme", root.dataset.theme === "dark" ? "light" : "dark"));

  // Re-render when the choice changes (here, in the Personalize dialog, or in
  // another tab) and when the device theme changes while "system" is chosen.
  store.subscribe("theme", showResolvedTheme);
  onMediaChange(systemDark, showResolvedTheme);
}

/* ---------- Navigation ---------- */

function initNavigation() {
  const nav = $("#site-nav");
  const toggle = $("#menu-toggle");
  const links = $$(".nav-links a");
  const mobileLayout = window.matchMedia("(max-width: 680px)");

  function setMenuOpen(open) {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  }

  const isMenuOpen = () => nav.classList.contains("is-open");

  toggle.addEventListener("click", () => setMenuOpen(!isMenuOpen()));
  links.forEach((link) => link.addEventListener("click", () => setMenuOpen(false)));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isMenuOpen()) {
      setMenuOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (isMenuOpen() && !nav.contains(event.target) && !toggle.contains(event.target)) setMenuOpen(false);
  });

  onMediaChange(mobileLayout, (event) => {
    if (!event.matches) setMenuOpen(false);
  });

  // Highlight the link of whichever section crosses the middle of the screen.
  if (!("IntersectionObserver" in window)) return;

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const currentHash = `#${entry.target.id}`;
        links.forEach((link) => {
          if (link.hash === currentHash) {
            link.setAttribute("aria-current", "true");
          } else {
            link.removeAttribute("aria-current");
          }
        });
      });
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );

  $$("main > section[id]").forEach((section) => sectionObserver.observe(section));
}

/* ---------- Greeting and local time ---------- */

// Picks a greeting from the visitor's hour, and adds their name once they sign in.
function getGreeting(hour, name = "") {
  if (hour >= 5 && hour < 12) return name ? `Good morning, ${name}` : "Good morning";
  if (hour >= 12 && hour < 17) return name ? `Good afternoon, ${name}` : "Good afternoon";
  if (hour >= 17 && hour < 22) return name ? `Good evening, ${name}` : "Good evening";
  return name ? `Still up, ${name}?` : "Hello, night owl";
}

function initGreeting() {
  const greeting = $("#greeting");
  const localTime = $("#local-time");
  const clock = $("#dhahran-time");

  // The greeting follows the visitor's clock and name; the time line shows mine.
  store.subscribe("visitorName", (name) => (greeting.textContent = getGreeting(new Date().getHours(), name)), { now: true });
  greeting.hidden = false;

  const dhahranTime = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" });
  const updateClock = () => {
    const now = new Date();
    clock.textContent = dhahranTime.format(now);
    clock.dateTime = now.toISOString();
  };

  updateClock();
  localTime.hidden = false;

  // Line the updates up with the start of each minute so the clock is never late.
  setTimeout(() => {
    updateClock();
    setInterval(updateClock, 60 * 1000);
  }, (60 - new Date().getSeconds()) * 1000);
}

/* ---------- Weather in Dhahran (Open-Meteo API) ---------- */

const WEATHER = {
  // Open-Meteo is free and needs no API key. Temperatures always arrive in
  // Celsius and are converted on the page, so switching units needs no request.
  url:
    "https://api.open-meteo.com/v1/forecast?latitude=26.29&longitude=50.11" +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&timezone=Asia%2FRiyadh",
  cacheMinutes: 15, // The service updates its "current" values every 15 minutes.
  timeoutMs: 8000,
};

const WEATHER_ICONS = {
  sun: '<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 11 3.5 3.5 0 0 0 7 18Z" />',
  fog: '<path d="M4 9h16M6 13h12M4 17h16" />',
  rain: '<path d="M7 14h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 7 3.5 3.5 0 0 0 7 14ZM8 17l-1 3M12 17l-1 3M16 17l-1 3" />',
  storm: '<path d="M7 14h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 7 3.5 3.5 0 0 0 7 14ZM12.5 14 10 18h4l-2.5 4" />',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />',
};

// Turns a WMO weather code (the standard the API uses) into words and an icon.
function describeWeatherCode(code, isDay) {
  if (code === 0) return { text: isDay ? "Clear sky" : "Clear night", icon: isDay ? "sun" : "moon" };
  if (code <= 2) return { text: code === 1 ? "Mainly clear" : "Partly cloudy", icon: isDay ? "sun" : "moon" };
  if (code === 3) return { text: "Overcast", icon: "cloud" };
  if (code === 45 || code === 48) return { text: "Foggy", icon: "fog" };
  if (code >= 51 && code <= 57) return { text: "Drizzle", icon: "rain" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { text: "Rain", icon: "rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { text: "Snow", icon: "snow" };
  if (code >= 95) return { text: "Thunderstorm", icon: "storm" };
  return { text: "Current conditions", icon: "cloud" };
}

// A short local remark, chosen by checking the conditions in order of importance.
function weatherRemark({ temperature, humidity, code }) {
  if (code >= 95) return "Thunderstorms are rare here, so this is a big event.";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "Rain is a rare sight in the Eastern Province.";
  if (temperature >= 40) return "A classic Eastern Province scorcher.";
  if (temperature >= 30 && humidity >= 70) return "Hot and humid, typical for the Gulf coast.";
  if (temperature <= 15) return "Cool by Dhahran standards.";
  return "";
}

const formatTemperature = (celsius, unit) => `${Math.round(unit === "fahrenheit" ? (celsius * 9) / 5 + 32 : celsius)}°${unit === "fahrenheit" ? "F" : "C"}`;

async function fetchDhahranWeather() {
  const data = await fetchJson(WEATHER.url, { timeoutMs: WEATHER.timeoutMs });
  const current = data && data.current;
  const weather = {
    temperature: Number(current && current.temperature_2m),
    feelsLike: Number(current && current.apparent_temperature),
    humidity: Number(current && current.relative_humidity_2m),
    wind: Number(current && current.wind_speed_10m),
    code: Number(current && current.weather_code),
    isDay: Boolean(current && current.is_day),
  };
  // Reject a response with missing or non-numeric values instead of showing "NaN°C".
  const numbers = [weather.temperature, weather.feelsLike, weather.humidity, weather.wind, weather.code];
  if (!numbers.every(Number.isFinite)) throw apiError("http");
  return weather;
}

function describeWeatherError(error) {
  switch (error.kind) {
    case "offline":
      return "You’re offline, so the Dhahran weather can’t load. It will load once you reconnect.";
    case "timeout":
      return "The weather service is slow to respond right now.";
    case "rate-limit":
      return "The weather service is busy right now.";
    default:
      return "The weather in Dhahran is unavailable right now.";
  }
}

const isValidWeather = (data) => Boolean(data) && ["temperature", "feelsLike", "humidity", "wind", "code"].every((field) => Number.isFinite(data[field]));

function initWeather() {
  const panel = $("#weather");
  const body = $("#weather-body");
  const unitRadios = $$('input[name="temp-unit"]', panel);
  const cache = createApiCache(STORAGE_KEYS.weatherCache, WEATHER.cacheMinutes, isValidWeather);

  const state = { entry: null, error: null, loading: false };

  function icon(name) {
    const svg = createElement("span", { className: "weather-icon", attrs: { "aria-hidden": "true" } });
    // Fixed icon markup written in this file; no outside data goes into innerHTML.
    svg.innerHTML = `<svg class="icon" viewBox="0 0 24 24">${WEATHER_ICONS[name]}</svg>`;
    return svg;
  }

  const retryButton = () => {
    const button = createElement("button", { className: "text-button", attrs: { type: "button" } }, [createElement("span", { text: "Try again" })]);
    button.addEventListener("click", () => load({ force: true }));
    return button;
  };

  function render() {
    const unit = store.get("tempUnit");
    unitRadios.forEach((radio) => (radio.checked = radio.value === unit));
    body.textContent = "";

    // No data at all: say what went wrong and offer a retry.
    if (!state.entry) {
      if (state.loading) {
        // A skeleton with the same parts as a real reading, so the card keeps its shape.
        body.append(
          createElement("span", { className: "weather-icon is-skeleton", attrs: { "aria-hidden": "true" } }),
          createElement("div", { className: "weather-text" }, [
            createElement("p", { className: "weather-note" }, [createElement("span", { className: "spinner", attrs: { "aria-hidden": "true" } }), "Checking the weather in Dhahran…"]),
            createElement("span", { className: "skeleton-line", attrs: { "aria-hidden": "true" } }),
            createElement("span", { className: "skeleton-line is-short", attrs: { "aria-hidden": "true" } }),
          ])
        );
      } else if (state.error) {
        body.append(createElement("p", { className: "weather-note is-error" }, [describeWeatherError(state.error), " ", retryButton()]));
      }
      return;
    }

    const weather = state.entry.data;
    const condition = describeWeatherCode(weather.code, weather.isDay);
    const remark = weatherRemark(weather);
    const details = `Feels like ${formatTemperature(weather.feelsLike, unit)} · Humidity ${Math.round(weather.humidity)}% · Wind ${Math.round(weather.wind)} km/h`;
    // An older copy shown after a failed refresh says so, instead of pretending to be live.
    const source = state.error ? `${describeWeatherError(state.error)} Showing the reading from ${timeAgo(state.entry.savedAt)}.` : `Live from Open-Meteo, updated ${timeAgo(state.entry.savedAt)}.`;

    body.append(
      icon(condition.icon),
      createElement("div", { className: "weather-text" }, [
        createElement("p", { className: "weather-now" }, [createElement("strong", { text: formatTemperature(weather.temperature, unit) }), ` ${condition.text} in Dhahran`]),
        createElement("p", { className: "weather-details", text: details }),
        ...(remark ? [createElement("p", { className: "weather-remark", text: remark })] : []),
        createElement("p", { className: state.error ? "weather-source is-error" : "weather-source" }, [source, ...(state.error ? [" ", retryButton()] : [])]),
      ])
    );
  }

  async function load({ force = false } = {}) {
    if (state.loading) return;
    const saved = cache.read();
    if (!force && cache.isFresh(saved)) {
      Object.assign(state, { entry: saved, error: null });
      render();
      return;
    }

    state.loading = true;
    if (!state.entry) state.entry = saved; // Show an older copy while the new one loads.
    render();
    try {
      state.entry = cache.write(await fetchDhahranWeather());
      state.error = null;
    } catch (error) {
      state.error = error;
    } finally {
      state.loading = false;
      render();
    }
  }

  unitRadios.forEach((radio) => radio.addEventListener("change", () => store.set("tempUnit", radio.value)));
  store.subscribe("tempUnit", render);

  // Refresh when the visitor comes back to the tab after the reading went stale,
  // instead of polling in the background, and retry once the connection returns.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !cache.isFresh(state.entry)) load();
  });
  window.addEventListener("online", () => state.error && load({ force: true }));

  // Keep "updated 5 minutes ago" accurate while the page stays open.
  setInterval(() => document.visibilityState === "visible" && state.entry && !state.loading && render(), 60 * 1000);

  load();
}

/* ---------- Timers: graduation countdown, time on page, and visits ---------- */

const GRADUATION = {
  // My expected graduation is December 2026, so the countdown runs to the
  // first moment of that month in Dhahran (UTC+3).
  monthStart: new Date("2026-12-01T00:00:00+03:00"),
  monthEnd: new Date("2027-01-01T00:00:00+03:00"),
};

const pad = (number) => String(number).padStart(2, "0");

// Splits milliseconds into whole days, hours, minutes, and seconds.
function splitDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

// "1h 05m 09s", "2m 14s", or "9s": leading zero units are left out.
function formatElapsed(ms) {
  const { days, hours, minutes, seconds } = splitDuration(ms);
  const totalHours = days * 24 + hours;
  if (totalHours > 0) return `${totalHours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

// Decides which of three phases the countdown is in for a given time.
function graduationPhase(now) {
  if (now < GRADUATION.monthStart.getTime()) return { phase: "before", remaining: GRADUATION.monthStart.getTime() - now };
  if (now < GRADUATION.monthEnd.getTime()) return { phase: "during" };
  return { phase: "after" };
}

const ordinalRules = new Intl.PluralRules("en", { type: "ordinal" });
const ORDINAL_SUFFIXES = { one: "st", two: "nd", few: "rd", other: "th" };
const ordinal = (number) => `${number}${ORDINAL_SUFFIXES[ordinalRules.select(number)]}`;

// One shared one-second ticker for every live counter. It pauses while the tab
// is hidden (nobody can see it, so it would only waste battery) and catches up
// as soon as the tab is visible again.
function createTicker() {
  const listeners = new Set();
  let timer = null;
  const tick = () => listeners.forEach((listener) => listener(Date.now()));

  function start() {
    if (timer !== null || document.visibilityState !== "visible") return;
    tick();
    timer = setInterval(tick, 1000);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  document.addEventListener("visibilitychange", () => (document.visibilityState === "visible" ? start() : stop()));

  return {
    add(listener) {
      listeners.add(listener);
      listener(Date.now());
      start();
    },
  };
}

function initTimers() {
  const ticker = createTicker();

  /* Countdown: three phases, each with its own display. */
  const countdown = $("#countdown");
  const countdownNote = $("#countdown-note");
  const units = ["days", "hours", "minutes", "seconds"].map((unit, index) => {
    const number = createElement("strong");
    // A real space between units, so screen readers say "7d 19h", not "7d19h".
    if (index > 0) countdown.append(" ");
    countdown.append(createElement("span", { className: "countdown-unit" }, [number, createElement("span", { text: unit.charAt(0) })]));
    return { unit, number };
  });
  let lastPhase = "";

  ticker.add((now) => {
    const { phase, remaining } = graduationPhase(now);
    if (phase === "before") {
      const parts = splitDuration(remaining);
      units.forEach(({ unit, number }) => (number.textContent = unit === "days" ? String(parts.days) : pad(parts[unit])));
    }
    if (phase === lastPhase) return; // The rest only changes when the phase does.
    lastPhase = phase;
    countdown.classList.toggle("is-finished", phase !== "before");
    if (phase === "before") {
      countdownNote.textContent = "Until December 2026 begins in Dhahran.";
    } else {
      countdown.textContent = phase === "during" ? "This month!" : "Complete";
      countdownNote.textContent = phase === "during" ? "December 2026 is my expected graduation month." : "My expected graduation month, December 2026, has passed.";
    }
  });

  /* Time on page: only time with the tab in front counts. */
  const timeOnPage = $("#time-on-page");
  let shownMs = 0; // Time already counted from earlier visible stretches.
  let visibleSince = document.visibilityState === "visible" ? performance.now() : null;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      visibleSince = performance.now();
    } else if (visibleSince !== null) {
      shownMs += performance.now() - visibleSince;
      visibleSince = null;
    }
  });

  ticker.add(() => {
    const elapsed = shownMs + (visibleSince === null ? 0 : performance.now() - visibleSince);
    timeOnPage.textContent = formatElapsed(elapsed);
  });

  /* Visits: counted once per browser session, so reloading does not add one. */
  if (!sessionStore.get(STORAGE_KEYS.visitCounted)) {
    store.set("visits", store.get("visits") + 1);
    sessionStore.set(STORAGE_KEYS.visitCounted, "1");
  }

  const renderVisits = () => {
    const visits = Math.max(1, store.get("visits"));
    const name = store.get("visitorName");
    $("#visit-count").textContent = `${ordinal(visits)} visit`;
    if (visits === 1) $("#visit-note").textContent = name ? `Nice to meet you, ${name}!` : "Welcome! Glad you found my portfolio.";
    else $("#visit-note").textContent = name ? `Welcome back, ${name}.` : "Welcome back! Sign in with the person icon to be greeted by name.";
  };
  store.subscribe("visits", renderVisits);
  store.subscribe("visitorName", renderVisits, { now: true });
}

/* ---------- Personalize dialog: sign in, theme, and visible sections ---------- */

function initPersonalize() {
  const dialog = $("#prefs-dialog");
  const openButton = $("#prefs-open");
  // Older browsers without <dialog> support simply keep the button hidden.
  if (typeof dialog.showModal !== "function") return;

  const openLabel = $("#prefs-open-label");
  const initial = $("#avatar-initial");
  const nameForm = $("#name-form");
  const nameInput = $("#visitor-name");
  const nameError = $("#visitor-name-error");
  const signedIn = $("#signed-in");
  const switchList = $("#prefs-sections");
  const themeRadios = $$('input[name="pref-theme"]', dialog);
  const hideables = $$("[data-hideable]");

  /* Signed-in status: the header button, the dialog, and the greeting all follow visitorName. */
  store.subscribe(
    "visitorName",
    (name) => {
      const isSignedIn = name !== "";
      openButton.classList.toggle("is-signed-in", isSignedIn);
      initial.textContent = isSignedIn ? name.charAt(0).toUpperCase() : "";
      openLabel.textContent = isSignedIn ? `Personalize (signed in as ${name})` : "Personalize";
      nameForm.hidden = isSignedIn;
      signedIn.hidden = !isSignedIn;
      $("#signed-in-name").textContent = name;
    },
    { now: true }
  );

  function showNameError(message) {
    nameError.textContent = message;
    nameInput.setAttribute("aria-invalid", String(Boolean(message)));
  }

  nameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = nameInput.value.trim().replace(/\s+/g, " ");
    const error = checkVisitorName(name);
    showNameError(error);
    if (error) {
      nameInput.focus();
      return;
    }
    store.set("visitorName", name);
    nameInput.value = "";
    showToast(`Welcome, ${name}! This browser will remember you.`);
    $("#sign-out").focus();
  });

  nameInput.addEventListener("input", () => nameError.textContent && showNameError(""));

  $("#sign-out").addEventListener("click", () => {
    store.reset("visitorName");
    showToast("Signed out. Your name was removed from this browser.");
    nameInput.focus();
  });

  /* Theme: three choices that mirror the header toggle. */
  store.subscribe("theme", (theme) => themeRadios.forEach((radio) => (radio.checked = radio.value === theme)), { now: true });
  themeRadios.forEach((radio) => radio.addEventListener("change", () => store.set("theme", radio.value)));

  /* Visible sections: one switch per element marked data-hideable. */
  const switches = hideables.map((section) => {
    const input = createElement("input", { attrs: { type: "checkbox", "data-section": section.id } });
    input.addEventListener("change", () => {
      const hidden = store.get("hiddenSections").filter((id) => id !== section.id);
      store.set("hiddenSections", input.checked ? hidden : [...hidden, section.id]);
    });
    switchList.append(
      createElement("label", { className: "switch" }, [input, createElement("span", { className: "switch-track", attrs: { "aria-hidden": "true" } }), createElement("span", { text: section.dataset.hideable })])
    );
    return input;
  });

  store.subscribe(
    "hiddenSections",
    (hiddenIds) => {
      hideables.forEach((section, index) => {
        // A class, not the hidden attribute, so a feature can still show or hide
        // its own element (for example while loading) without the two clashing.
        const isHidden = hiddenIds.includes(section.id);
        section.classList.toggle("is-user-hidden", isHidden);
        switches[index].checked = !isHidden;
        // A hidden section's navigation link would lead nowhere, so hide it too.
        const navLink = $(`.nav-links a[href="#${section.id}"]`);
        if (navLink) navLink.parentElement.classList.toggle("is-user-hidden", isHidden);
      });
    },
    { now: true }
  );

  /* Reset everything the store remembers back to its default. */
  $("#prefs-reset").addEventListener("click", () => {
    store.names().forEach(store.reset);
    showToast("All preferences were reset.");
  });

  /* Opening and closing. showModal() traps focus and closes on Escape for us. */
  openButton.addEventListener("click", () => {
    showNameError("");
    dialog.showModal();
  });
  $("#prefs-close").addEventListener("click", () => dialog.close());
  $("#prefs-done").addEventListener("click", () => dialog.close());
  // A click on the backdrop lands on the <dialog> itself, outside the panel.
  dialog.addEventListener("click", (event) => event.target === dialog && dialog.close());

  openButton.hidden = false;
}

/* ---------- About tabs ---------- */

function initAboutTabs() {
  const tabList = $("#about-tabs [role='tablist']");
  const tabs = $$("[role='tab']", tabList);
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));
  const indicator = $(".tab-indicator", tabList);

  const selectedTab = () => tabs.find((tab) => tab.getAttribute("aria-selected") === "true") || tabs[0];

  function moveIndicator(tab) {
    indicator.style.width = `${tab.offsetWidth}px`;
    indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
  }

  function selectTab(tab, { focus = true, animate = true, measure = true } = {}) {
    tabs.forEach((candidate, index) => {
      const isSelected = candidate === tab;
      candidate.setAttribute("aria-selected", String(isSelected));
      // Roving tabindex: only the active tab is in the Tab order; arrows move between tabs.
      candidate.tabIndex = isSelected ? 0 : -1;
      panels[index].hidden = !isSelected;
      if (isSelected && animate) replayAnimation(panels[index], "is-entering");
    });
    if (measure) moveIndicator(tab);
    if (focus) tab.focus();
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => selectTab(tab)));

  // Keyboard support from the WAI-ARIA tabs pattern.
  tabList.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(document.activeElement);
    const targets = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    if (index === -1 || !(event.key in targets)) return;
    event.preventDefault();
    selectTab(tabs[(targets[event.key] + tabs.length) % tabs.length]);
  });

  tabList.hidden = false;
  selectTab(tabs[0], { focus: false, animate: false, measure: false });

  // Measuring a tab (offsetWidth) right now would force the browser to lay out
  // the whole page in the middle of start-up, while other features are still
  // changing it (Lighthouse measured 87 ms on a phone). In the next frame the
  // layout is done anyway, so measuring there is free. The sliding transition
  // is enabled one frame later still, so the first placement does not slide.
  requestAnimationFrame(() => {
    moveIndicator(tabs[0]);
    requestAnimationFrame(() => indicator.classList.add("is-ready"));
  });
  window.addEventListener("resize", debounce(() => moveIndicator(selectedTab()), 100));
}

/* ---------- Project explorer ---------- */

const PROJECT_FILTERS = {
  all: "all areas",
  ai: "AI / ML",
  embedded: "Embedded",
  iot: "IoT",
  web: "Web",
};

// Dates are "YYYY-MM" strings, which sort correctly as plain text.
// Ties fall back to the featured order so the result never jumps around.
const PROJECT_SORTERS = {
  featured: (a, b) => a.order - b.order,
  newest: (a, b) => b.date.localeCompare(a.date) || a.order - b.order,
  oldest: (a, b) => a.date.localeCompare(b.date) || a.order - b.order,
  name: (a, b) => a.title.localeCompare(b.title),
  status: (a, b) => Number(b.status === "active") - Number(a.status === "active") || a.order - b.order,
};

// Each reader level is a set of rules: which project levels to show, whether
// cards add a plain-language explanation, whether technical highlights open by
// themselves, and what message to show.
const PROJECT_VIEWS = {
  all: {
    label: "everyone",
    levels: ["beginner", "intermediate", "advanced"],
    plainWords: false,
    openHighlights: false,
    message: "",
  },
  beginner: {
    label: "beginners",
    levels: ["beginner", "intermediate"],
    plainWords: true,
    openHighlights: false,
    message: "New to engineering? These are my easiest projects to follow, and each card starts with a short explanation in plain words.",
  },
  advanced: {
    label: "advanced readers",
    levels: ["intermediate", "advanced"],
    plainWords: false,
    openHighlights: true,
    message: "Here for the technical details? These are my most involved projects, with their highlights already open.",
  },
};

function initProjectExplorer() {
  const toolbar = $("#project-toolbar");
  const grid = $("#project-grid");
  const searchInput = $("#project-search");
  const sortSelect = $("#project-sort");
  const chips = $$("[data-filter]", toolbar);
  const countText = $("#project-count");
  const emptyState = $("#project-empty");
  const emptyText = $("#project-empty-text");
  const resetButton = $("#project-reset");
  const levelBar = $("#level-bar");
  const levelMessage = $("#level-message");
  const viewRadios = $$('input[name="project-view"]', levelBar);
  const detailButtons = $$(".details-toggle", grid);

  // The HTML is the single source of truth: read each card once.
  const projects = $$(".project-card", grid).map((card) => ({
    card,
    title: $("h3", card).textContent.trim(),
    categories: card.dataset.categories.split(" "),
    order: Number(card.dataset.order),
    date: card.dataset.date,
    level: card.dataset.level,
    status: card.dataset.status,
    // Index the real content only, not button labels such as "Show highlights".
    searchText: normalizeText(
      [...$$(".project-type, h3, .project-summary, .project-tags li, .project-details li", card).map((el) => el.textContent), card.dataset.keywords || ""].join(" ")
    ),
  }));

  // Start from the URL so a filtered view can be bookmarked or shared. The level
  // comes from the URL first, then from the visitor's saved choice.
  const params = new URLSearchParams(window.location.search);
  const state = {
    query: params.get("q") || "",
    filter: PROJECT_FILTERS[params.get("area")] ? params.get("area") : "all",
    sort: PROJECT_SORTERS[params.get("sort")] ? params.get("sort") : "featured",
    view: PROJECT_VIEWS[params.get("view")] ? params.get("view") : store.get("projectView"),
  };

  const searchTerms = () => normalizeText(state.query).split(" ").filter(Boolean);
  const matchesSearch = (project, terms) => terms.every((term) => project.searchText.includes(term));
  const matchesFilter = (project, filter) => filter === "all" || project.categories.includes(filter);
  const matchesView = (project, view) => PROJECT_VIEWS[view].levels.includes(project.level);

  // A project is shown only if it passes every step: level, then area, then search.
  const isVisible = (project, { view = state.view, filter = state.filter, terms = searchTerms() } = {}) =>
    matchesView(project, view) && matchesFilter(project, filter) && matchesSearch(project, terms);

  function setHighlightsOpen(button, open) {
    button.setAttribute("aria-expanded", String(open));
    document.getElementById(button.getAttribute("aria-controls")).classList.toggle("is-open", open);
    $(".details-label", button).textContent = open ? "Hide highlights" : "Show highlights";
  }

  // Applies the rules of the chosen level to the whole section.
  function applyView() {
    const rules = PROJECT_VIEWS[state.view];
    viewRadios.forEach((radio) => (radio.checked = radio.value === state.view));
    grid.classList.toggle("show-plain-words", rules.plainWords);
    detailButtons.forEach((button) => setHighlightsOpen(button, rules.openHighlights));
    levelMessage.textContent = rules.message;
  }

  function render({ animateAll = false } = {}) {
    const terms = searchTerms();
    let visibleCount = 0;

    // Re-append in sorted order so keyboard focus follows the visual order.
    [...projects].sort(PROJECT_SORTERS[state.sort]).forEach((project) => {
      const isMatch = isVisible(project, { terms });
      const wasHidden = project.card.hidden;
      grid.appendChild(project.card);
      project.card.hidden = !isMatch;
      if (!isMatch) return;
      visibleCount += 1;
      if (animateAll || wasHidden) replayAnimation(project.card, "is-entering");
    });

    // Each chip previews how many results it would give for the current level and search.
    chips.forEach((chip) => {
      const filter = chip.dataset.filter;
      const count = projects.filter((project) => isVisible(project, { filter, terms })).length;
      chip.setAttribute("aria-pressed", String(filter === state.filter));
      $(".chip-count", chip).textContent = String(count);
    });

    updateSummary(visibleCount);
    syncUrl();
  }

  const plural = (count, one, many) => (count === 1 ? one : many);

  function updateSummary(visibleCount) {
    const area = state.filter === "all" ? "" : ` in ${PROJECT_FILTERS[state.filter]}`;
    const audience = state.view === "all" ? "" : ` for ${PROJECT_VIEWS[state.view].label}`;
    const query = state.query.trim();
    const strong = document.createElement("strong");
    strong.textContent = String(visibleCount);

    // Built with text nodes, never innerHTML, so typed text cannot inject markup.
    countText.textContent = "";
    countText.append("Showing ", strong, ` of ${projects.length} projects${audience}${area}${query ? ` matching “${query}”` : ""}.`);

    emptyState.hidden = visibleCount > 0;
    if (visibleCount > 0) return;

    // Tell the visitor what to try next, based on which step removed everything.
    // Each count relaxes exactly one step, so the advice names the real cause.
    const inOtherAreas = state.filter === "all" ? 0 : projects.filter((project) => isVisible(project, { filter: "all" })).length;
    const atOtherLevels = state.view === "all" ? 0 : projects.filter((project) => isVisible(project, { view: "all" })).length;
    const what = query ? `Nothing${audience} mentions “${query}”${area}` : `There are no projects${audience}${area}`;
    const count = (n) => `${n} ${plural(n, "project", "projects")}`;

    if (inOtherAreas > 0 && atOtherLevels > 0) {
      emptyText.textContent = `${what}. Choose “All” areas to see ${count(inOtherAreas)}, or “Everyone” to see ${count(atOtherLevels)}.`;
    } else if (inOtherAreas > 0) {
      emptyText.textContent = `${what}, but ${count(inOtherAreas)} in other areas ${plural(inOtherAreas, "matches", "match")}. Choose “All” to see ${plural(inOtherAreas, "it", "them")}.`;
    } else if (atOtherLevels > 0) {
      emptyText.textContent = `${what}, but ${count(atOtherLevels)} at other levels ${plural(atOtherLevels, "matches", "match")}. Choose “Everyone” to see ${plural(atOtherLevels, "it", "them")}.`;
    } else if (query) {
      emptyText.textContent = `Nothing mentions “${query}”. Check the spelling or try a broader keyword, such as a language or a device.`;
    } else {
      emptyText.textContent = `There are no projects${area} yet. Choose another area or show every project.`;
    }
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    const setParam = (key, value, fallback) => {
      if (value && value !== fallback) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    };
    setParam("q", state.query.trim(), "");
    setParam("area", state.filter, "all");
    setParam("sort", state.sort, "featured");
    setParam("view", state.view, "all");
    try {
      history.replaceState(null, "", url);
    } catch {
      // Some browsers block history changes for local files; filtering still works.
    }
  }

  const renderSoon = debounce(render, 120);

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value;
    renderSoon();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && searchInput.value) {
      event.stopPropagation();
      searchInput.value = "";
      state.query = "";
      render();
    }
  });

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      state.filter = chip.dataset.filter;
      render();
    });
  });

  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    render({ animateAll: true });
  });

  function setView(view) {
    if (view === state.view) return;
    state.view = view;
    applyView();
    render({ animateAll: true });
  }

  // A level chosen here is saved for next time. setView is also called directly,
  // because a level opened from a shared link may differ from the saved one,
  // in which case saving it would not count as a change.
  viewRadios.forEach((radio) =>
    radio.addEventListener("change", () => {
      store.set("projectView", radio.value);
      setView(radio.value);
    })
  );

  // Follows a reset in the Personalize dialog or a choice made in another tab.
  store.subscribe("projectView", setView);

  resetButton.addEventListener("click", () => {
    state.query = "";
    state.filter = "all";
    searchInput.value = "";
    store.set("projectView", "all");
    setView("all");
    render();
    searchInput.focus();
  });

  // Press "/" anywhere (outside a text field) to jump to the search box.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(document.activeElement)) return;
    event.preventDefault();
    searchInput.focus();
  });

  // Expand and collapse project highlights.
  detailButtons.forEach((button) => {
    button.hidden = false;
    button.addEventListener("click", () => setHighlightsOpen(button, button.getAttribute("aria-expanded") !== "true"));
  });

  searchInput.value = state.query;
  sortSelect.value = state.sort;
  toolbar.hidden = false;
  levelBar.hidden = false;
  applyView();
  render();
}

/* ---------- GitHub repositories (public API) ---------- */

const GITHUB = {
  user: "abooodi123",
  cacheMinutes: 30, // GitHub allows 60 anonymous requests an hour, so reuse results.
  timeoutMs: 10000,
  pageSize: 6,
};

// Colors match the ones GitHub uses for each language.
const LANGUAGE_COLORS = {
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  CSS: "#563d7c",
  Go: "#00add8",
  HTML: "#e34c26",
  Java: "#b07219",
  JavaScript: "#f1e05a",
  "Jupyter Notebook": "#da5b0b",
  Kotlin: "#a97bff",
  Python: "#3572a5",
  Rust: "#dea584",
  Shell: "#89e051",
  TypeScript: "#3178c6",
  Verilog: "#b2b7f8",
  VHDL: "#adb2cb",
};

const REPO_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v16H7.5A2.5 2.5 0 0 0 5 20.5v-16ZM5 20.5A2.5 2.5 0 0 0 7.5 23H19v-5" /></svg>';

async function fetchGitHubRepos() {
  const data = await fetchJson(`https://api.github.com/users/${GITHUB.user}/repos?per_page=100&sort=pushed`, {
    timeoutMs: GITHUB.timeoutMs,
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!Array.isArray(data)) throw apiError("http");

  // Keep only the fields the page shows: a smaller cache and simpler rendering.
  return data.map((repo) => ({
    name: String(repo.name),
    description: repo.description ? String(repo.description) : "",
    url: String(repo.html_url),
    language: repo.language ? String(repo.language) : "",
    stars: Number(repo.stargazers_count) || 0,
    fork: Boolean(repo.fork),
    archived: Boolean(repo.archived),
    pushedAt: String(repo.pushed_at),
  }));
}

function describeGitHubError(error) {
  switch (error.kind) {
    case "offline":
      return "You seem to be offline. Reconnect to the internet and the list will load automatically.";
    case "timeout":
      return "GitHub took too long to respond. Please try again in a moment.";
    case "rate-limit": {
      const time = error.resetAt ? new Date(error.resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
      return `GitHub limits how often one network can request data, and that limit has been reached. Try again ${time ? `after ${time}` : "later"}, or open my profile on GitHub.`;
    }
    case "not-found":
      return "That GitHub profile could not be found. Please use the profile link below instead.";
    case "http":
      return `GitHub returned an unexpected response${error.status ? ` (error ${error.status})` : ""}. Please try again in a moment.`;
    default:
      return "The request to GitHub failed. Check your connection, then try again.";
  }
}

function createRepoCard(repo) {
  const safeUrl = repo.url.startsWith("https://github.com/") ? repo.url : `https://github.com/${GITHUB.user}`;
  const link = createElement("a", { text: repo.name, attrs: { href: safeUrl, target: "_blank", rel: "noopener noreferrer" } });
  const head = createElement("div", { className: "repo-head" }, [createElement("h3", {}, [link])]);
  head.insertAdjacentHTML("afterbegin", REPO_ICON);
  if (repo.fork) head.append(createElement("span", { className: "repo-badge", text: "Fork" }));
  if (repo.archived) head.append(createElement("span", { className: "repo-badge", text: "Archived" }));

  const description = createElement("p", {
    className: repo.description ? "repo-desc" : "repo-desc is-placeholder",
    text: repo.description || "No description provided yet.",
  });

  const footer = createElement("div", { className: "repo-footer" });
  if (repo.language) {
    const dot = createElement("span", { className: "lang-dot", attrs: { "aria-hidden": "true" } });
    if (LANGUAGE_COLORS[repo.language]) dot.style.setProperty("--lang-color", LANGUAGE_COLORS[repo.language]);
    footer.append(createElement("span", { className: "repo-lang" }, [dot, repo.language]));
  }
  if (repo.stars > 0) footer.append(createElement("span", { text: `${repo.stars} ${repo.stars === 1 ? "star" : "stars"}` }));
  footer.append(createElement("time", { text: `Updated ${timeAgo(repo.pushedAt)}`, attrs: { datetime: repo.pushedAt } }));

  return createElement("li", { className: "repo-card" }, [head, description, footer]);
}

function initGitHubRepos() {
  const section = $("#github");
  const toolbar = $("#repo-toolbar");
  const grid = $("#repo-grid");
  const status = $("#repo-status");
  const announcer = $("#repo-announcer");
  const updatedText = $("#repo-updated");
  const refreshButton = $("#repo-refresh");
  const forksToggle = $("#repo-forks");
  const sortSelect = $("#repo-sort");
  const moreButton = $("#repo-more");

  const state = {
    repos: null,
    savedAt: 0,
    includeForks: store.get("githubForks"),
    expanded: false,
    loading: false,
    failed: false,
  };

  const cache = createApiCache(STORAGE_KEYS.githubCache, GITHUB.cacheMinutes, Array.isArray);

  function showLoading() {
    toolbar.hidden = true;
    moreButton.hidden = true;
    status.textContent = "";
    status.append(createElement("p", { className: "loading-message" }, [createElement("span", { className: "spinner", attrs: { "aria-hidden": "true" } }), "Loading repositories from GitHub…"]));
    grid.setAttribute("aria-busy", "true");
    grid.textContent = "";
    for (let i = 0; i < 3; i += 1) {
      const lines = ["skeleton-line is-title", "skeleton-line", "skeleton-line", "skeleton-line is-short"].map((className) => createElement("span", { className }));
      grid.append(createElement("li", { className: "repo-card is-skeleton", attrs: { "aria-hidden": "true" } }, lines));
    }
  }

  function showNotice(type, message, actions = []) {
    status.textContent = "";
    status.append(createElement("div", { className: `notice notice-${type}` }, [createElement("p", { text: message }), createElement("div", { className: "notice-actions" }, actions)]));
  }

  const retryButton = () => {
    const button = createElement("button", { className: "button button-primary", text: "Try again", attrs: { type: "button" } });
    button.addEventListener("click", () => load({ force: true }));
    return button;
  };

  const profileLink = () =>
    createElement("a", { className: "text-link", text: "Open GitHub profile ↗", attrs: { href: `https://github.com/${GITHUB.user}`, target: "_blank", rel: "noopener noreferrer" } });

  function render() {
    const forkCount = state.repos.filter((repo) => repo.fork).length;
    const sorter = sortSelect.value === "name" ? (a, b) => a.name.localeCompare(b.name) : (a, b) => new Date(b.pushedAt) - new Date(a.pushedAt);
    const list = state.repos.filter((repo) => state.includeForks || !repo.fork).sort(sorter);

    toolbar.hidden = false;
    grid.setAttribute("aria-busy", "false");
    grid.textContent = "";
    status.textContent = "";
    updatedText.textContent = `Updated ${timeAgo(state.savedAt)}`;

    if (list.length === 0) {
      moreButton.hidden = true;
      if (forkCount > 0) {
        const showForks = createElement("button", { className: "button button-secondary", text: "Include forks", attrs: { type: "button" } });
        showForks.addEventListener("click", () => {
          forksToggle.checked = true;
          forksToggle.dispatchEvent(new Event("change"));
        });
        showNotice("info", `No original repositories to show yet. Turn on “Include forks” to see ${forkCount} forked ${forkCount === 1 ? "repository" : "repositories"}.`, [showForks]);
      } else {
        showNotice("info", "There are no public repositories yet. New work will appear here automatically.", [profileLink()]);
      }
      announcer.textContent = "No repositories to show.";
      return;
    }

    const shown = state.expanded ? list : list.slice(0, GITHUB.pageSize);
    grid.append(...shown.map(createRepoCard));
    moreButton.hidden = list.length <= GITHUB.pageSize;
    moreButton.textContent = state.expanded ? "Show fewer" : `Show all ${list.length} repositories`;
    moreButton.setAttribute("aria-expanded", String(state.expanded));
    announcer.textContent = `Showing ${shown.length} of ${list.length} repositories.`;
  }

  function setRefreshing(isLoading) {
    refreshButton.disabled = isLoading;
    refreshButton.classList.toggle("is-loading", isLoading);
    $("span", refreshButton).textContent = isLoading ? "Refreshing…" : "Refresh";
  }

  async function load({ force = false } = {}) {
    if (state.loading) return;
    const saved = cache.read();
    if (!force && cache.isFresh(saved)) {
      Object.assign(state, { repos: saved.data, savedAt: saved.savedAt, failed: false });
      render();
      return;
    }

    state.loading = true;
    setRefreshing(true);
    if (!state.repos) showLoading();

    try {
      const entry = cache.write(await fetchGitHubRepos());
      Object.assign(state, { repos: entry.data, savedAt: entry.savedAt, failed: false });
      render();
    } catch (error) {
      state.failed = true;
      const fallback = state.repos ? { repos: state.repos, savedAt: state.savedAt } : saved && { repos: saved.data, savedAt: saved.savedAt };
      if (fallback) {
        // Stale data is better than none: show it and explain why it is old.
        Object.assign(state, fallback);
        render();
        showNotice("error", `${describeGitHubError(error)} Showing the copy saved ${timeAgo(fallback.savedAt)}.`, [retryButton()]);
      } else {
        grid.textContent = "";
        grid.setAttribute("aria-busy", "false");
        showNotice("error", describeGitHubError(error), [retryButton(), profileLink()]);
      }
    } finally {
      state.loading = false;
      setRefreshing(false);
    }
  }

  forksToggle.checked = state.includeForks;
  forksToggle.addEventListener("change", () => store.set("githubForks", forksToggle.checked));

  // The switch writes to the store; the store change re-renders the list. This
  // also keeps it in step after "Reset all preferences" or a change in another tab.
  store.subscribe("githubForks", (includeForks) => {
    Object.assign(state, { includeForks, expanded: false });
    forksToggle.checked = includeForks;
    if (state.repos) render();
  });

  sortSelect.addEventListener("change", () => state.repos && render());
  refreshButton.addEventListener("click", () => load({ force: true }));

  moreButton.addEventListener("click", () => {
    state.expanded = !state.expanded;
    render();
    // After expanding, move focus to the first new card so keyboard users continue there.
    const firstNew = state.expanded && grid.children[GITHUB.pageSize];
    if (firstNew) $("a", firstNew).focus();
  });

  // Retry automatically when the connection comes back.
  window.addEventListener("online", () => state.failed && load({ force: true }));

  // Keep the "Updated … ago" label honest while the page stays open.
  setInterval(() => {
    if (state.repos && !state.loading) updatedText.textContent = `Updated ${timeAgo(state.savedAt)}`;
  }, 60 * 1000);

  // A fresh cached copy costs nothing, so show it straight away; this also keeps
  // the cards in the keyboard Tab order for visitors who tab quickly down the page.
  if (cache.isFresh(cache.read())) {
    load();
    return;
  }

  // Otherwise call the API only when the section is close to the screen. A
  // section the visitor has hidden is never on screen, so it costs no request.
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        load();
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(section);
  } else {
    load();
  }
}

/* ---------- Scroll effects ---------- */

function initScrollEffects() {
  const header = $("#site-header");
  const backToTop = $("#back-to-top");

  // Throttle scroll work to one update per animation frame.
  let ticking = false;
  const update = () => {
    const y = window.scrollY;
    header.classList.toggle("is-scrolled", y > 8);
    backToTop.classList.toggle("is-visible", y > window.innerHeight * 0.9);
    ticking = false;
  };
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    },
    { passive: true }
  );
  // Reading scrollY during start-up would also force an early layout, so the
  // first check waits for the next frame like every later one.
  requestAnimationFrame(update);

  // Move focus to the top too, so keyboard users start again from the page heading.
  backToTop.addEventListener("click", () => {
    $("#hero-title").setAttribute("tabindex", "-1");
    $("#hero-title").focus({ preventScroll: true });
  });

  // Fade sections in as they enter the screen.
  if (!("IntersectionObserver" in window) || prefersReducedMotion()) return;

  const targets = $$(".section:not(.hero) .section-heading, .about-content, .project-toolbar, .project-grid, .repo-grid, .contact-copy, .contact-form");
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px" }
  );

  targets.forEach((target) => {
    // The second column of a two-column layout arrives slightly later.
    if (target.matches(".about-content, .contact-form")) target.style.setProperty("--reveal-delay", "0.12s");
    target.classList.add("reveal");
    revealObserver.observe(target);
  });
}

/* ---------- Footer ---------- */

function initFooterYear() {
  $("#year").textContent = String(new Date().getFullYear());
}

/* ---------- Toast and clipboard ---------- */

let toastTimer;

function showToast(message, type = "success") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied: fall through to the older technique below.
  }

  // Fallback for older browsers and pages that are not served securely.
  const previousFocus = document.activeElement;
  const helper = createElement("textarea", { attrs: { readonly: "", "aria-hidden": "true" } });
  helper.value = text;
  helper.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
  document.body.append(helper);
  helper.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  helper.remove();
  if (previousFocus) previousFocus.focus();
  return copied;
}

function initCopyEmail() {
  const button = $("#copy-email");
  const label = $("span", button);
  let resetTimer;
  button.hidden = false;

  button.addEventListener("click", async () => {
    const copied = await copyText(button.dataset.copy);
    if (!copied) {
      showToast("Couldn’t copy automatically. Please select the address and copy it.", "error");
      return;
    }
    showToast("Email address copied to your clipboard.");
    button.classList.add("is-copied");
    label.textContent = "Copied";
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      button.classList.remove("is-copied");
      label.textContent = "Copy";
    }, 2000);
  });
}

/* ---------- Contact form ---------- */

const CONTACT = {
  email: "ewidahabdullah@gmail.com",
  minMessage: 10,
  jobTopic: "Internship or job opportunity", // This topic also asks for a company.
};

// A practical check: something@something.domain, with no spaces.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Common misspellings of popular email domains. Some still pass the pattern
// above (like "gmail.co"), so they are offered as a suggestion, never forced.
const EMAIL_DOMAIN_FIXES = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "outlok.com": "outlook.com",
  "yaho.com": "yahoo.com",
  "kfupm.edu": "kfupm.edu.sa",
};

// Returns the corrected address when the domain is a known typo, otherwise "".
function suggestEmail(email) {
  const at = email.lastIndexOf("@");
  if (at < 1) return "";
  const fix = EMAIL_DOMAIN_FIXES[email.slice(at + 1).toLowerCase()];
  return fix ? `${email.slice(0, at)}@${fix}` : "";
}

// Each rule returns an error message, or an empty string when the value is fine.
const FIELD_RULES = {
  name: (value) => {
    if (!value) return "Please enter your name so I know who is writing.";
    if (value.length < 2) return "Your name should be at least 2 characters long.";
    return "";
  },
  email: (value) => {
    if (!value) return "Please enter your email address so I can reply.";
    if (!EMAIL_PATTERN.test(value)) return "This email address looks incomplete. Use the format name@example.com.";
    return "";
  },
  company: (value) => {
    if (!value) return "Please tell me which company or organization the opportunity is with.";
    if (value.length < 2) return "The company name should be at least 2 characters long.";
    return "";
  },
  message: (value) => {
    if (!value) return "Please write a message before sending.";
    if (value.length < CONTACT.minMessage) {
      const remaining = CONTACT.minMessage - value.length;
      return `Please add a little more detail: ${remaining} more ${remaining === 1 ? "character" : "characters"} needed.`;
    }
    return "";
  },
};

const ICONS = {
  check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>',
  alert: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 17h.01" /></svg>',
};

function initContactForm() {
  const form = $("#contact-form");
  const status = $("#form-status");
  const topic = $("#topic");
  const counter = $("#message-count");
  const draftNotice = $("#draft-notice");
  const companyField = $("#company-field");
  const emailHint = $("#email-hint");
  const checklist = $("#form-checklist");
  const fields = {
    name: $("#name"),
    email: $("#email"),
    company: $("#company"),
    message: $("#message"),
  };
  const fieldNames = Object.keys(fields);
  const maxMessage = Number(fields.message.getAttribute("maxlength"));

  // Rule: the company is required only for job and internship messages.
  const needsCompany = () => topic.value === CONTACT.jobTopic;
  const activeFields = () => fieldNames.filter((name) => name !== "company" || needsCompany());
  const isFieldValid = (name) => FIELD_RULES[name](fields[name].value.trim()) === "";

  // Errors appear only after a visitor leaves a field or tries to submit,
  // so nobody is scolded while still typing their first word.
  const touched = new Set();

  // Our own messages are clearer than the browser's default bubbles.
  form.noValidate = true;

  function validateField(name) {
    const field = fields[name];
    const message = FIELD_RULES[name](field.value.trim());
    $(`#${name}-error`).textContent = message;
    field.setAttribute("aria-invalid", String(Boolean(message)));
    field.closest(".field").classList.toggle("has-error", Boolean(message));
    return message === "";
  }

  function clearErrors() {
    fieldNames.forEach((name) => {
      $(`#${name}-error`).textContent = "";
      fields[name].removeAttribute("aria-invalid");
      fields[name].closest(".field").classList.remove("has-error");
    });
    touched.clear();
  }

  function updateCounter() {
    const length = fields.message.value.length;
    counter.textContent = `${length} / ${maxMessage}`;
    counter.classList.toggle("is-near-limit", length >= maxMessage * 0.9);
  }

  // Shows or hides the company field to match the chosen topic. A hidden field
  // also loses its error, so it can never block sending.
  function updateCompanyField() {
    const required = needsCompany();
    companyField.hidden = !required;
    fields.company.required = required;
    if (!required) {
      $("#company-error").textContent = "";
      fields.company.removeAttribute("aria-invalid");
      companyField.classList.remove("has-error");
      touched.delete("company");
    }
  }

  // "Did you mean …@gmail.com?" with a button that applies the fix.
  function updateEmailHint() {
    const suggestion = suggestEmail(fields.email.value.trim());
    emailHint.hidden = !suggestion;
    if (suggestion) $("#email-fix").textContent = suggestion;
  }

  // A live checklist of the required fields, ticked off as each becomes valid.
  function updateChecklist() {
    const names = activeFields();
    const ready = names.filter(isFieldValid);
    const list = $("ul", checklist);
    list.textContent = "";
    names.forEach((name) => {
      const done = ready.includes(name);
      const label = $(`label[for="${name}"]`).firstChild.textContent.trim();
      list.append(createElement("li", { className: done ? "is-done" : "" }, [label, createElement("span", { className: "visually-hidden", text: done ? ": done" : ": still needed" })]));
    });
    const allReady = ready.length === names.length;
    checklist.classList.toggle("is-ready", allReady);
    $("#checklist-summary").textContent = allReady ? "Ready to send" : `${ready.length} of ${names.length} ready`;
  }

  function showAlert(type, title, text, actions = []) {
    const alert = createElement("div", { className: `form-alert is-${type}` }, [
      createElement("span", { className: "alert-icon" }),
      createElement("div", {}, [createElement("strong", { text: title }), createElement("p", { text }), ...(actions.length ? [createElement("div", { className: "alert-actions" }, actions)] : [])]),
    ]);
    alert.firstChild.innerHTML = type === "success" ? ICONS.check : ICONS.alert;
    status.textContent = "";
    status.append(alert);
  }

  function textButton(label, onClick) {
    const button = createElement("button", { className: "text-button", text: label, attrs: { type: "button" } });
    button.addEventListener("click", onClick);
    return button;
  }

  // Draft autosave: unsent text survives a refresh or an accidental tab close.
  const readDraft = () => {
    try {
      return JSON.parse(storage.get(STORAGE_KEYS.contactDraft)) || null;
    } catch {
      return null;
    }
  };

  const saveDraft = debounce(() => {
    const draft = { name: fields.name.value, email: fields.email.value, topic: topic.value, company: fields.company.value, message: fields.message.value };
    if (Object.values(draft).some((value) => value.trim())) {
      storage.set(STORAGE_KEYS.contactDraft, JSON.stringify(draft));
    } else {
      storage.remove(STORAGE_KEYS.contactDraft);
    }
  }, 400);

  function resetForm() {
    form.reset();
    clearErrors();
    updateCounter();
    updateCompanyField();
    updateEmailHint();
    updateChecklist();
    storage.remove(STORAGE_KEYS.contactDraft);
    draftNotice.hidden = true;
    status.textContent = "";
  }

  const draft = readDraft();
  if (draft && typeof draft === "object") {
    fieldNames.forEach((name) => {
      if (typeof draft[name] === "string") fields[name].value = draft[name];
    });
    if (typeof draft.topic === "string") topic.value = draft.topic;
    draftNotice.hidden = !fieldNames.some((name) => fields[name].value.trim());
  }
  updateCompanyField(); // A restored job-topic draft brings its company field back.

  // A signed-in visitor's name fills an empty Name field; it never replaces typing.
  store.subscribe(
    "visitorName",
    (visitorName) => {
      if (visitorName && !fields.name.value.trim()) fields.name.value = visitorName;
      updateChecklist();
    },
    { now: true }
  );

  $("#draft-discard").addEventListener("click", () => {
    resetForm();
    showToast("Draft discarded.");
    fields.name.focus();
  });

  fieldNames.forEach((name) => {
    const field = fields[name];
    field.addEventListener("blur", () => {
      if (field.value.trim()) touched.add(name);
      if (touched.has(name)) validateField(name);
    });
    field.addEventListener("input", () => {
      if (touched.has(name)) validateField(name);
      saveDraft();
      updateChecklist();
    });
  });

  fields.message.addEventListener("input", updateCounter);

  // Suggest a fix after the visitor leaves the field, not while they type;
  // once shown, the hint follows their edits and disappears when fixed.
  fields.email.addEventListener("blur", updateEmailHint);
  fields.email.addEventListener("input", () => !emailHint.hidden && updateEmailHint());
  $("#email-fix").addEventListener("click", () => {
    fields.email.value = suggestEmail(fields.email.value.trim());
    updateEmailHint();
    if (touched.has("email")) validateField("email");
    saveDraft();
    updateChecklist();
    fields.email.focus();
  });

  topic.addEventListener("change", () => {
    updateCompanyField();
    updateChecklist();
    saveDraft();
  });

  // This static site has no server, so a valid form opens a pre-filled email draft.
  // Step 1: validate every active field. Step 2: stop on the first problem.
  // Step 3: only when everything passes, build and open the email.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const names = activeFields();
    names.forEach((name) => touched.add(name));
    const invalid = names.filter((name) => !validateField(name));

    if (invalid.length > 0) {
      const which = invalid.length === 1 ? "the highlighted field" : `the ${invalid.length} highlighted fields`;
      showAlert("error", "Almost there", `Please fix ${which}, then press the button again.`);
      fields[invalid[0]].focus();
      return;
    }

    const name = fields.name.value.trim();
    const email = fields.email.value.trim();
    const message = fields.message.value.trim();
    const company = needsCompany() ? fields.company.value.trim() : "";
    const subject = topic.value ? `${topic.value}: message from ${name}${company ? ` (${company})` : ""}` : `Portfolio message from ${name}`;
    const body = `${message}\n\n${name}\n${company ? `${company}\n` : ""}${email}`;

    // The text stays in the form until the visitor clears it, in case the
    // email app does not open on their device.
    draftNotice.hidden = true;
    showAlert("success", `Thanks, ${name}! Your email draft is ready.`, "Your email app should open now with everything filled in. Just press Send there. If nothing opened, copy your message and email me directly.", [
      textButton("Copy my message", async () => {
        const copied = await copyText(`To: ${CONTACT.email}\nSubject: ${subject}\n\n${body}`);
        showToast(copied ? "Message copied. Paste it into any email app." : "Couldn’t copy automatically. Please select the text and copy it.", copied ? "success" : "error");
      }),
      textButton("Clear the form", () => {
        resetForm();
        showToast("Form cleared.");
        fields.name.focus();
      }),
    ]);

    window.location.href = `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });

  counter.hidden = false;
  checklist.hidden = false;
  $("#draft-help").hidden = false;
  updateCounter();
  updateChecklist();
}

/* ---------- Start ---------- */

[initTheme, initNavigation, initGreeting, initWeather, initTimers, initPersonalize, initAboutTabs, initProjectExplorer, initGitHubRepos, initCopyEmail, initContactForm, initScrollEffects, initFooterYear].forEach((init) => {
  try {
    init();
  } catch (error) {
    console.error(`${init.name} could not start:`, error);
  }
});
