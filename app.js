(function () {
  const $ = (id) => document.getElementById(id);

  // ============================
  // CONFIG (SET THIS)
  // ============================
  const FAMILY_ID = "e538i47rIjVIS7xGdCtC";

  // ============================
  // Firebase (compat)
  // ============================
  const auth = window.auth ? window.auth : (window.firebase ? window.firebase.auth() : null);
  const db = window.db ? window.db : (window.firebase ? window.firebase.firestore() : null);
  const storage = window.storage ? window.storage : (window.firebase ? window.firebase.storage() : null);

  if (!auth || !db || !storage) {
    console.error("Firebase auth/db/storage not found. Ensure compat scripts + firebase.initializeApp() ran (firebase.js).");
  }

  // Email link sign-in settings
  const actionCodeSettings = {
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true
  };

  // ============================
  // App state
  // ============================
  const state = {
    data: [],
    showDeceased: true,
    sortOldestFirst: true,
    q: "",
    user: null,
    familyId: FAMILY_ID
  };

  // ============================
  // Helpers
  // ============================
  function normalize(s) {
    return (s || "").toString().toLowerCase().trim();
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (s) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[s]));
  }

  // Harden: sanitize any string inputs that may have accidental quotes/spaces
  function cleanPath(s) {
    return String(s || "")
      .trim()
      .replace(/^\uFEFF/, "")       // strip BOM if present
      .replace(/^"+|"+$/g, "")      // strip wrapping double quotes
      .replace(/^'+|'+$/g, "");     // strip wrapping single quotes
  }

  function isHttpUrl(s) {
    return /^https?:\/\//i.test(String(s || "").trim());
  }

  function localDateFromYMD(y, m, d) {
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }

  // Parse as LOCAL date to avoid 1-day shifts, supports Firestore Timestamp
  function parseISODate(v) {
    if (v == null || v === "") return null;

    // Date object
    if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
      return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }

    // Firestore Timestamp
    if (v && typeof v.toDate === "function") {
      const d = v.toDate();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    // ISO YYYY-MM-DD
    if (typeof v === "string") {
      const s = v.trim();
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return localDateFromYMD(m[1], m[2], m[3]);

      // fallback
      const d = new Date(s);
      if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      return null;
    }

    return null;
  }

  function todayLocal() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function sameMonthDay(a, b) {
    return a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function nextBirthdayDate(birth, today) {
    if (!birth) return null;
    const d = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
    return (d < today) ? new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate()) : d;
  }

  // Calendar-accurate Y/M/D difference
  function diffYMD(from, to) {
    let y = to.getFullYear() - from.getFullYear();
    let m = to.getMonth() - from.getMonth();
    let d = to.getDate() - from.getDate();

    if (d < 0) {
      m -= 1;
      const daysInPrevMonth = new Date(to.getFullYear(), to.getMonth(), 0).getDate();
      d += daysInPrevMonth;
    }
    if (m < 0) {
      y -= 1;
      m += 12;
    }
    return { y, m, d };
  }

  function fmtYMD(o) {
    if (!o) return "—";
    return [
      `${o.y} year${o.y === 1 ? "" : "s"}`,
      `${o.m} month${o.m === 1 ? "" : "s"}`,
      `${o.d} day${o.d === 1 ? "" : "s"}`
    ].join(", ");
  }

  function fmtDate(d) {
    if (!d) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // ============================
  // Contact info (NEW, fail-safe)
  // ============================
  function normalizeEmail(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    // Keep permissive; only block obvious bad strings that would break mailto UX
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    return ok ? s : "";
  }

  // Create tel: href from a phone string, preserving leading "+" if present.
  function phoneToTelHref(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const hasPlus = /^\s*\+/.test(s);
    const digits = s.replace(/[^\d]/g, "");
    if (!digits) return "";
    if (digits.length < 7) return "";
    return "tel:" + ((hasPlus ? "+" : "") + digits);
  }

  function fmtPhoneDisplay(raw) {
    const s = String(raw || "").trim();
    return s || "";
  }

  // ============================
  // Storage photo URL resolving (hardened)
  // ============================
  const photoUrlCache = new Map(); // key: cleaned path, value: downloadUrl (or null)

  function normalizePhotoPaths(r) {
    const list = [];

    if (Array.isArray(r?.photos)) list.push(...r.photos);
    else if (typeof r?.photos === "string" && r.photos.trim()) list.push(r.photos.trim());

    if (typeof r?.photo === "string" && r.photo.trim()) list.push(r.photo.trim());

    return list
      .map(cleanPath)
      .filter(Boolean);
  }

  async function getDownloadUrlForPath(storagePathRaw) {
    const storagePath = cleanPath(storagePathRaw);
    if (!storagePath) return null;

    // If already a URL, use as-is
    if (isHttpUrl(storagePath)) return storagePath;

    if (photoUrlCache.has(storagePath)) return photoUrlCache.get(storagePath);

    try {
      const url = await storage.ref(storagePath).getDownloadURL();
      photoUrlCache.set(storagePath, url);
      return url;
    } catch (e) {
      // Cache negative result to prevent repeated hammering
      photoUrlCache.set(storagePath, null);
      console.warn("Could not load photo URL for:", storagePath, e?.code || "", e?.message || e);
      return null;
    }
  }

  async function hydratePeoplePhotoUrls(peopleArray) {
    if (!Array.isArray(peopleArray) || !peopleArray.length) return peopleArray;

    for (const p of peopleArray) {
      const paths = normalizePhotoPaths(p);
      if (!paths.length) {
        p._photoUrls = [];
        continue;
      }

      const urls = [];
      for (const path of paths) {
        const u = await getDownloadUrlForPath(path);
        if (u && isHttpUrl(u)) urls.push(u);
      }

      p._photoUrls = urls;
    }

    return peopleArray;
  }

  // Harden: NEVER return raw storage paths for <img src>. Only return http(s) URLs.
  function photoList(r) {
    if (Array.isArray(r?._photoUrls) && r._photoUrls.length) {
      return r._photoUrls.filter(isHttpUrl);
    }

    const arr = Array.isArray(r?.photos) ? r.photos : (typeof r?.photos === "string" ? [r.photos] : []);
    const urls = (arr || [])
      .map(cleanPath)
      .filter(Boolean)
      .filter(isHttpUrl);

    const single = (typeof r?.photo === "string") ? cleanPath(r.photo) : "";
    if (single && isHttpUrl(single)) urls.unshift(single);

    return urls;
  }

  // ============================
  // Data computation
  // ============================
  function computeRow(r) {
    const birth = parseISODate(r.birthdate);
    const passed = parseISODate(r.passed);

    const today = todayLocal();
    const passedEffective = (passed && passed.getTime() <= today.getTime()) ? passed : null;

    const ref = passedEffective ?? today;
    const ageObj = birth ? diffYMD(birth, ref) : null;

    const isBirthdayToday = !!(birth && !passedEffective && s
