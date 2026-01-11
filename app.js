(function () {
  const $ = (id) => document.getElementById(id);

  // ============================
  // CONFIG (SET THIS)
  // ============================
  const FAMILY_ID = "e538i47rIjVIS7xGdCtC";

  // How many events to show on a card by default (keeps cards readable)
  const MAX_EVENTS_PER_PERSON = 6;

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
    announcements: [],
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

  function cleanPath(s) {
    return String(s || "")
      .trim()
      .replace(/^\uFEFF/, "")
      .replace(/^"+|"+$/g, "")
      .replace(/^'+|'+$/g, "");
  }

  function isHttpUrl(s) {
    return /^https?:\/\//i.test(String(s || "").trim());
  }

  function localDateFromYMD(y, m, d) {
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }

  function parseISODate(v) {
    if (v == null || v === "") return null;

    if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
      return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }

    if (v && typeof v.toDate === "function") {
      const d = v.toDate();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    if (typeof v === "string") {
      const s = v.trim();
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return localDateFromYMD(m[1], m[2], m[3]);

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

  // For Events specifically (force full date)
function fmtEventDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "Date unknown";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

   function sortEventsByDate(events, order = "desc") {
  const dir = order === "asc" ? 1 : -1;

  return [...(Array.isArray(events) ? events : [])].sort((a, b) => {
    const at = (a && a.date instanceof Date) ? a.date.getTime() : NaN;
    const bt = (b && b.date instanceof Date) ? b.date.getTime() : NaN;

    const aValid = Number.isFinite(at);
    const bValid = Number.isFinite(bt);

    // Both invalid: stable-ish, then by title if present
    if (!aValid && !bValid) {
      const ta = String(a?.title || "");
      const tb = String(b?.title || "");
      return ta.localeCompare(tb);
    }

    // Invalid dates always go last
    if (!aValid) return 1;
    if (!bValid) return -1;

    // Valid: compare timestamps
    if (at !== bt) return (at - bt) * dir;

    // Secondary sort: title
    const ta = String(a?.title || "");
    const tb = String(b?.title || "");
    return ta.localeCompare(tb);
  });
}

  // ============================
  // Contact info (fail-safe)
  // ============================
  function normalizeEmail(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    return ok ? s : "";
  }

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
  // Children / Grandchildren helpers
  // ============================
  function normalizeNameArray(v, maxItems = 30) {
    let arr = [];
    if (Array.isArray(v)) arr = v;
    else if (typeof v === "string") {
      const s = v.trim();
      if (s) arr = s.split(/[;,]/g);
    } else {
      arr = [];
    }

    const cleaned = [];
    for (const item of arr) {
      const s = String(item || "").replace(/\s+/g, " ").trim();
      if (!s) continue;
      cleaned.push(s);
      if (cleaned.length >= maxItems) break;
    }

    const seen = new Set();
    const out = [];
    for (const s of cleaned) {
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  }

  function joinNameList(arr, bullet = " • ") {
    const list = Array.isArray(arr) ? arr : [];
    return list.length ? list.join(bullet) : "";
  }

   // ============================
// Events
// ============================
  function normalizeEvents(v, maxItems = 80, order = "asc") {
  // Expect: [{date:"YYYY-MM-DD", title:"...", note:"..."}]
  const arr = Array.isArray(v) ? v : [];
  const out = [];

  for (const item of arr) {
    if (!item || typeof item !== "object") continue;

    const titleRaw = String(item.title ?? "").replace(/\s+/g, " ").trim();
    const note = String(item.note ?? "").replace(/\s+/g, " ").trim();

    // Date may be missing/invalid; keep event anyway
    const d = parseISODate(item.date);

    out.push({
      date: d || null,                 // Date object or null
      dateRaw: item.date || "",        // original string (or blank)
      title: titleRaw || "Event",      // fallback title
      note
    });
  }

  const dir = order === "desc" ? -1 : 1;

  out.sort((a, b) => {
    const at = a.date instanceof Date ? a.date.getTime() : NaN;
    const bt = b.date instanceof Date ? b.date.getTime() : NaN;

    const aValid = Number.isFinite(at);
    const bValid = Number.isFinite(bt);

    // Missing/invalid dates go last
    if (!aValid && !bValid) return a.title.localeCompare(b.title);
    if (!aValid) return 1;
    if (!bValid) return -1;

    // Both valid: compare by date, then title
    if (at !== bt) return (at - bt) * dir;
    return a.title.localeCompare(b.title);
  });

  return out.slice(0, maxItems);
}


  
  // ============================
  // Calendar helpers
  // ============================
  function pad2(n) { return String(n).padStart(2, "0"); }

  function ymdLocal(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function ymdCompact(d) {
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  }

  function safeTextForUrl(s) {
    return encodeURIComponent(String(s || "").replace(/\s+/g, " ").trim());
  }

  function buildBirthdayEvent(r) {
    const date = r.nextBirthday;
    if (!date || isNaN(date.getTime())) return null;

    const title = `${(r.name || "Family member").trim()} — Birthday`;
    const desc = `Birthday reminder for ${((r.name || "family member").trim())}.`;

    const startYmd = ymdCompact(date);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const endYmd = ymdCompact(end);

    return { title, description: desc, date, startYmd, endYmd };
  }

  function googleCalendarUrl(ev) {
    const base = "https://calendar.google.com/calendar/render?action=TEMPLATE";
    const text = `&text=${safeTextForUrl(ev.title)}`;
    const dates = `&dates=${ev.startYmd}/${ev.endYmd}`;
    const details = `&details=${safeTextForUrl(ev.description)}`;
    return base + text + dates + details;
  }

  function outlookCalendarUrl(ev) {
    const start = ymdLocal(ev.date);
    const end = ymdLocal(new Date(ev.date.getFullYear(), ev.date.getMonth(), ev.date.getDate() + 1));

    const base = "https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent";
    const subject = `&subject=${safeTextForUrl(ev.title)}`;
    const body = `&body=${safeTextForUrl(ev.description)}`;
    const startdt = `&startdt=${safeTextForUrl(start)}`;
    const enddt = `&enddt=${safeTextForUrl(end)}`;
    const allDay = `&allday=true`;
    return base + subject + body + startdt + enddt + allDay;
  }

  function icsEscape(s) {
    return String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function downloadIcs(ev) {
    const uid = `family-timeline-${Date.now()}-${Math.random().toString(16).slice(2)}@local`;
    const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Family Timeline//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `SUMMARY:${icsEscape(ev.title)}`,
      `DESCRIPTION:${icsEscape(ev.description)}`,
      `DTSTART;VALUE=DATE:${ev.startYmd}`,
      `DTEND;VALUE=DATE:${ev.endYmd}`,
      "END:VEVENT",
      "END:VCALENDAR"
    ];

    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;

    const fname = `${(ev.title || "birthday").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${ev.startYmd}.ics`;
    a.download = fname || "birthday.ics";

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ============================
  // Storage photo URL resolving (hardened)
  // ============================
  const photoUrlCache = new Map();

  function normalizePhotoPaths(r) {
    const list = [];
    if (Array.isArray(r?.photos)) list.push(...r.photos);
    else if (typeof r?.photos === "string" && r.photos.trim()) list.push(r.photos.trim());
    if (typeof r?.photo === "string" && r.photo.trim()) list.push(r.photo.trim());
    return list.map(cleanPath).filter(Boolean);
  }

  async function getDownloadUrlForPath(storagePathRaw) {
    const storagePath = cleanPath(storagePathRaw);
    if (!storagePath) return null;

    if (isHttpUrl(storagePath)) return storagePath;
    if (photoUrlCache.has(storagePath)) return photoUrlCache.get(storagePath);

    try {
      const url = await storage.ref(storagePath).getDownloadURL();
      photoUrlCache.set(storagePath, url);
      return url;
    } catch (e) {
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

  function photoList(r) {
    if (Array.isArray(r?._photoUrls) && r._photoUrls.length) {
      return r._photoUrls.filter(isHttpUrl);
    }

    const arr = Array.isArray(r?.photos) ? r.photos : (typeof r?.photos === "string" ? [r.photos] : []);
    const urls = (arr || []).map(cleanPath).filter(Boolean).filter(isHttpUrl);

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

    const isBirthdayToday = !!(birth && !passedEffective && sameMonthDay(birth, today));
    const wouldHaveTurned = (birth && passedEffective && sameMonthDay(birth, today))
      ? (today.getFullYear() - birth.getFullYear())
      : null;

    const nextBirthday = birth ? nextBirthdayDate(birth, today) : null;

    const email = normalizeEmail(r?.email);
    const phoneDisplay = fmtPhoneDisplay(r?.phone);
    const phoneHref = phoneToTelHref(phoneDisplay);

    const children = normalizeNameArray((r && r.children != null) ? r.children : r?.offspring);
    const grandchildren = normalizeNameArray(r?.grandchildren);

    const events = normalizeEvents(r?.events, 80, "asc");

    return {
      ...r,
      name: (r?.name ?? "").toString(),
      tribute: (r?.tribute ?? "").toString(),
      _birth: birth,
      _passed: passedEffective,
      ageText: birth ? fmtYMD(ageObj) : "—",
      status: passedEffective ? "deceased" : "alive",
      _photos: photoList(r),
      isBirthdayToday,
      nextBirthday,
      wouldHaveTurned,

      _email: email,
      _phoneDisplay: phoneDisplay,
      _phoneHref: phoneHref,

      _children: children,
      _grandchildren: grandchildren,

      _events: events
    };
  }

  function filterSort(rows) {
    let out = Array.isArray(rows) ? rows : [];

    if (!state.showDeceased) out = out.filter(r => r.status !== "deceased");

    const q = normalize(state.q);
    if (q) out = out.filter(r => normalize(r.name).includes(q));

    out = out.slice().sort((a, b) => {
      const aT = a._birth ? a._birth.getTime() : Number.POSITIVE_INFINITY;
      const bT = b._birth ? b._birth.getTime() : Number.POSITIVE_INFINITY;
      if (aT !== bT) return state.sortOldestFirst ? (aT - bT) : (bT - aT);
      return (a.name ?? "").localeCompare(b.name ?? "");
    });

    return out;
  }

  // ============================
  // Carousel engine (hardened)
  // ============================
  const carouselTimers = new Map();

  function stopCarouselFor(imgEl) {
    const t = carouselTimers.get(imgEl);
    if (t) clearInterval(t);
    carouselTimers.delete(imgEl);

    if (imgEl && imgEl._carouselClickHandler) {
      imgEl.removeEventListener("click", imgEl._carouselClickHandler);
      delete imgEl._carouselClickHandler;
    }

    if (imgEl) {
      imgEl.onerror = null;
      imgEl.onload = null;
    }
  }

  function startCarousel(imgEl, photos) {
    stopCarouselFor(imgEl);
    if (!imgEl || !Array.isArray(photos) || photos.length === 0) return;

    const safePhotos = photos.filter(isHttpUrl);
    if (safePhotos.length === 0) return;

    let idx = 0;
    let consecutiveErrors = 0;

    const setSrc = () => {
      imgEl.classList.remove("fadeIn");
      void imgEl.offsetWidth;
      imgEl.src = safePhotos[idx];
      imgEl.classList.add("fadeIn");
    };

    imgEl.onload = () => { consecutiveErrors = 0; };

    imgEl.onerror = () => {
      consecutiveErrors++;
      if (consecutiveErrors >= safePhotos.length) {
        stopCarouselFor(imgEl);
        return;
      }
      idx = (idx + 1) % safePhotos.length;
      setSrc();
    };

    setSrc();

    if (safePhotos.length === 1) return;

    const tickMs = 2600;
    const timer = setInterval(() => {
      idx = (idx + 1) % safePhotos.length;
      setSrc();
    }, tickMs);

    carouselTimers.set(imgEl, timer);

    imgEl._carouselClickHandler = () => {
      idx = (idx + 1) % safePhotos.length;
      setSrc();
    };
    imgEl.addEventListener("click", imgEl._carouselClickHandler);
  }

  // ============================
  // Photo Modal / Lightbox (with swipe)
  // ============================
  const modalState = { open: false, photos: [], idx: 0, title: "" };

  function openPhotoModal(title, photos, startIdx) {
    const modal = $("photoModal");
    const img = $("photoModalImg");
    const titleEl = $("photoModalTitle");

    if (!modal || !img) return;

    const safePhotos = Array.isArray(photos) ? photos.filter(isHttpUrl) : [];
    if (!safePhotos.length) return;

    modalState.open = true;
    modalState.photos = safePhotos;
    modalState.idx = Math.max(0, Math.min(Number(startIdx || 0), modalState.photos.length - 1));
    modalState.title = title || "Photos";

    if (titleEl) titleEl.textContent = modalState.title;

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    renderModalPhoto();
  }

  function closePhotoModal() {
    const modal = $("photoModal");
    if (!modal) return;

    modalState.open = false;
    modalState.photos = [];
    modalState.idx = 0;
    modalState.title = "";

    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";

    const img = $("photoModalImg");
    if (img) img.removeAttribute("src");
  }

  function renderModalPhoto() {
    const img = $("photoModalImg");
    const counter = $("photoModalCounter");
    const prevBtn = $("photoPrev");
    const nextBtn = $("photoNext");

    const total = modalState.photos.length;
    if (!img) return;

    if (!total) {
      if (counter) counter.textContent = "";
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }

    const src = modalState.photos[modalState.idx];

    img.classList.remove("fadeIn");
    void img.offsetWidth;
    img.src = src;
    img.classList.add("fadeIn");

    if (counter) counter.textContent = `${modalState.idx + 1} / ${total}`;
    if (prevBtn) prevBtn.disabled = total <= 1;
    if (nextBtn) nextBtn.disabled = total <= 1;
  }

  function modalPrev() {
    const total = modalState.photos.length;
    if (total <= 1) return;
    modalState.idx = (modalState.idx - 1 + total) % total;
    renderModalPhoto();
  }

  function modalNext() {
    const total = modalState.photos.length;
    if (total <= 1) return;
    modalState.idx = (modalState.idx + 1) % total;
    renderModalPhoto();
  }

  function wireModalSwipe(stageEl) {
    const thresholdX = 40;
    const restraintY = 60;
    const minVelocity = 0.10;

    let tracking = false;
    let startX = 0;
    let startY = 0;
    let startT = 0;

    const onStart = (e) => {
      if (!modalState.open) return;
      if (modalState.photos.length <= 1) return;

      const t = e.touches && e.touches[0];
      if (!t) return;

      tracking = true;
      startX = t.clientX;
      startY = t.clientY;
      startT = Date.now();
    };

    const onMove = (e) => {
      if (!tracking) return;
      const t = e.touches && e.touches[0];
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (Math.abs(dy) > restraintY && Math.abs(dy) > Math.abs(dx)) {
        tracking = false;
      }
    };

    const onEnd = (e) => {
      if (!tracking) return;
      tracking = false;

      const t = (e.changedTouches && e.changedTouches[0]) || null;
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = Math.max(1, Date.now() - startT);
      const vx = Math.abs(dx) / dt;

      if (Math.abs(dy) > restraintY) return;

      if (Math.abs(dx) >= thresholdX && vx >= minVelocity) {
        if (e.cancelable) e.preventDefault();
        if (dx < 0) modalNext();
        else modalPrev();
      }
    };

    if (stageEl.dataset.swipeWired === "1") return;
    stageEl.dataset.swipeWired = "1";

    stageEl.addEventListener("touchstart", onStart, { passive: true });
    stageEl.addEventListener("touchmove", onMove, { passive: true });
    stageEl.addEventListener("touchend", onEnd, { passive: false });
    stageEl.addEventListener("touchcancel", () => { tracking = false; }, { passive: true });
  }

  function wirePhotoModalOnce() {
    const modal = $("photoModal");
    if (!modal) return;
    if (modal.dataset.wired === "1") return;
    modal.dataset.wired = "1";

    const backdrop = modal.querySelector(".modal__backdrop");
    const dialog = modal.querySelector(".modal__dialog");
    const stage = modal.querySelector(".modal__stage");

    const closeBtn = $("photoModalClose");
    const prevBtn = $("photoPrev");
    const nextBtn = $("photoNext");

    if (backdrop) backdrop.addEventListener("click", closePhotoModal);
    if (closeBtn) closeBtn.addEventListener("click", closePhotoModal);
    if (prevBtn) prevBtn.addEventListener("click", modalPrev);
    if (nextBtn) nextBtn.addEventListener("click", modalNext);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closePhotoModal();
    });

    if (dialog) {
      dialog.addEventListener("click", (e) => e.stopPropagation());
    }

    if (stage) wireModalSwipe(stage);

    document.addEventListener("keydown", (e) => {
      if (!modalState.open) return;
      if (e.key === "Escape") closePhotoModal();
      if (e.key === "ArrowLeft") modalPrev();
      if (e.key === "ArrowRight") modalNext();
    });
  }

  // ============================
  // Firestore loading
  // ============================
  async function ensureMemberDoc(user) {
  const ref = db
    .collection("families")
    .doc(state.familyId)
    .collection("members")
    .doc(user.uid);

  const snap = await ref.get();
  if (snap.exists) return snap.data();

  const email = user.email || "";

  // Must be "member" to satisfy rules; promote to admin manually in console if needed.
  await ref.set({
    role: "member",
    email,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  const snap2 = await ref.get();
  return snap2.exists ? snap2.data() : null;
}

  async function loadPeopleOnce() {
    if (!state.user) return;

    if (!state.familyId || state.familyId.includes("PASTE_")) {
      throw new Error("FAMILY_ID is not set in app.js");
    }
    await ensureMemberDoc(state.user);

    const peopleRef = db.collection("families").doc(state.familyId).collection("people");
    const snap = await peopleRef.get();

    let arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    await hydratePeoplePhotoUrls(arr);

    state.data = arr;
  }

     async function loadAnnouncementsOnce() {
  if (!state.user) return;

  const ref = db
    .collection("families")
    .doc(state.familyId)
    .collection("announcements");

  // 1) Try ordered query (best UX)
  try {
    const snap = await ref
      .orderBy("pinned", "desc")
      .orderBy("createdAt", "desc")
      .limit(5)
      .get();

    state.announcements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return;
  } catch (e) {
    console.warn("Announcements ordered query failed (will retry simple):", e?.code || "", e?.message || e);
  }

  // 2) Fallback: simple query (no index required)
  try {
    const snap2 = await ref.limit(5).get();
    state.announcements = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e2) {
    console.warn("Announcements simple query failed:", e2?.code || "", e2?.message || e2);
    state.announcements = [];
  }
}


  // ============================
  // Calendar UI wiring
  // ============================
  function closeAllCalMenus(exceptMenu) {
    document.querySelectorAll(".calMenu").forEach((m) => {
      if (exceptMenu && m === exceptMenu) return;
      m.hidden = true;
    });
  }

  function buildCalChooser(r) {
    if (r.status !== "alive" || !r.nextBirthday) return null;

    const ev = buildBirthdayEvent(r);
    if (!ev) return null;

    const wrap = document.createElement("div");
    wrap.className = "calWrap";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "calBtn";
    btn.textContent = "Add to calendar";

    const menu = document.createElement("div");
    menu.className = "calMenu";
    menu.hidden = true;

    const g = document.createElement("a");
    g.href = googleCalendarUrl(ev);
    g.target = "_blank";
    g.rel = "noopener";
    g.innerHTML = `<span>Google Calendar</span><small>opens web</small>`;

    const o = document.createElement("a");
    o.href = outlookCalendarUrl(ev);
    o.target = "_blank";
    o.rel = "noopener";
    o.innerHTML = `<span>Outlook Calendar</span><small>opens web</small>`;

    const i = document.createElement("a");
    i.href = "#";
    i.innerHTML = `<span>Download .ics</span><small>universal</small>`;
    i.addEventListener("click", (e) => {
      e.preventDefault();
      downloadIcs(ev);
      menu.hidden = true;
    });

    menu.appendChild(g);
    menu.appendChild(o);
    menu.appendChild(i);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = menu.hidden === true;
      closeAllCalMenus(menu);
      menu.hidden = !willOpen;
    });

    wrap.addEventListener("click", (e) => e.stopPropagation());
    wrap.appendChild(btn);
    wrap.appendChild(menu);

    return wrap;
  }

  document.addEventListener("click", () => closeAllCalMenus());
  document.addEventListener("scroll", () => closeAllCalMenus(), { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllCalMenus();
  });

  // ============================
  // Render
  // ============================
    function render() {
    const cards = $("cards");
    const empty = $("empty");
    const asOf = $("asOf");
    const count = $("count");
    const birthdayLine = $("birthdayLine");

    if (!cards || !empty || !asOf || !count) {
      console.error("Missing required DOM elements (cards, empty, asOf, count).");
      return;
    }

    const upsertAnnouncementsHost = () => {
      let host = $("announcements");
      if (!host) {
        host = document.createElement("div");
        host.id = "announcements";
        const parent = cards.parentNode;
        parent.insertBefore(host, cards);
      }
      return host;
    };
     
     const makeAnnouncementsBlock = (posts) => {
  const list = Array.isArray(posts) ? posts : [];
  if (!list.length) return null;

  const wrap = document.createElement("section");
  wrap.className = "annPanel";

  const title = document.createElement("div");
  title.className = "annTitle";
  title.textContent = "Announcements";
  wrap.appendChild(title);

  const ul = document.createElement("ul");
  ul.className = "annList";

  for (const p of list) {
    if (!p || typeof p !== "object") continue;

    const text = String(p.text ?? p.message ?? "").trim();
    if (!text) continue;

    const li = document.createElement("li");
    li.className = "annItem";

    // Date line (optional)
    const when =
      (p.eventAt && typeof p.eventAt.toDate === "function")
        ? p.eventAt.toDate()
        : parseISODate(p.date)
        || (p.createdAt && typeof p.createdAt.toDate === "function"
            ? p.createdAt.toDate()
            : null);

    if (when instanceof Date && !Number.isNaN(when.getTime())) {
      const d = document.createElement("div");
      d.className = "annDate";
      d.textContent = when.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      });
      li.appendChild(d);
    }

    // Main text
    const body = document.createElement("div");
    body.className = "annText";
    body.textContent = text;
    li.appendChild(body);

    // Location (optional)
    const loc = String(p.location ?? "").trim();
    if (loc) {
      const l = document.createElement("div");
      l.className = "annLocation";
      l.textContent = `Location: ${loc}`;
      li.appendChild(l);
    }

    ul.appendChild(li);
  }

  if (!ul.children.length) return null;

  wrap.appendChild(ul);
  return wrap;
};

   
    if (!cards || !empty || !asOf || !count) {
      console.error("Missing required DOM elements (cards, empty, asOf, count).");
      return;
    }

      const loc = String(p?.location || "").trim();
if (loc) {
  const l = document.createElement("div");
  l.className = "annLocation";
  l.textContent = `📍 ${loc}`;
  li.appendChild(l);
}

    for (const [imgEl] of carouselTimers) stopCarouselFor(imgEl);

    const computed = (state.data || []).map(computeRow);
    const filtered = filterSort(computed);
    const today = todayLocal();

    asOf.textContent = `As of: ${today.toLocaleDateString(undefined, {
      weekday: "short", year: "numeric", month: "short", day: "numeric"
    })}`;

    count.textContent = `Shown: ${filtered.length} / ${computed.length}`;

    if (birthdayLine) {
      const soon = computed
        .filter(r => r.status === "alive" && r._birth && r.nextBirthday)
        .map(r => ({ name: r.name, date: r.nextBirthday }))
        .filter(x => {
          const diffDays = Math.ceil((x.date - today) / 86400000);
          return diffDays >= 0 && diffDays <= 30;
        })
        .sort((a, b) => a.date - b.date);

      if (soon.length) {
        birthdayLine.innerHTML =
          `<strong>Upcoming birthdays (next 30 days):</strong> ` +
          soon.map(x =>
            `<span>${escapeHtml(x.name)} (${x.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })})</span>`
          ).join(" • ");
        birthdayLine.hidden = false;
      } else {
        birthdayLine.hidden = true;
      }
    }

      // --- Announcements (global) ---
      const annHost = upsertAnnouncementsHost();
      annHost.innerHTML = "";
      const annBlock = makeAnnouncementsBlock(state.announcements);
      if (annBlock) {
      annHost.appendChild(annBlock);
      } else {
      // If no announcements, keep the host empty (no blank panel)
    }

    cards.innerHTML = "";
    if (filtered.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const frag = document.createDocumentFragment();

    const makeRow = (label, value) => {
      const d = document.createElement("div");
      d.className = "row";

      const l = document.createElement("span");
      l.textContent = label;

      const v = document.createElement("span");
      v.className = "value";
      v.textContent = (value == null || value === "") ? "—" : String(value);

      d.appendChild(l);
      d.appendChild(v);
      return d;
    };

    const makeLinkRow = (label, href, text) => {
      const d = document.createElement("div");
      d.className = "row";

      const l = document.createElement("span");
      l.textContent = label;

      const v = document.createElement("span");
      v.className = "value";

      if (href && typeof href === "string") {
        const a = document.createElement("a");
        a.href = href;
        a.textContent = text || href;
        a.rel = "noopener";
        a.className = "valueLink";
        v.appendChild(a);
      } else {
        v.textContent = (text == null || text === "") ? "—" : String(text);
      }

      d.appendChild(l);
      d.appendChild(v);
      return d;
    };

    const makeListRow = (label, items) => {
      const list = Array.isArray(items) ? items : [];
      if (!list.length) return null;

      const d = document.createElement("div");
      d.className = "row listRow";

      const l = document.createElement("span");
      l.textContent = label;

      const v = document.createElement("span");
      v.className = "value listValue";
      v.textContent = joinNameList(list, " • ");

      d.appendChild(l);
      d.appendChild(v);
      return d;
    };

       const makeEventsBlock = (events) => {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "events";

  const h = document.createElement("div");
  h.className = "eventsTitle";
  h.textContent = "Events";
  wrap.appendChild(h);

  const ul = document.createElement("ul");
  ul.className = "eventsList";

  const show = list.slice(0, MAX_EVENTS_PER_PERSON);

  for (const ev of show) {
    if (!ev || typeof ev !== "object") continue;

    const li = document.createElement("li");
    li.className = "eventItem";

    const left = document.createElement("div");
    left.className = "eventDate";

    if (ev.date instanceof Date && !Number.isNaN(ev.date.getTime())) {
      left.textContent = fmtEventDate(ev.date);
    } else {
      left.textContent = "Date unknown";
      left.classList.add("isUnknownDate");
    }

    const right = document.createElement("div");
    right.className = "eventText";

    const t = document.createElement("div");
    t.className = "eventTitle";
    t.textContent = String(ev.title || "Event").trim() || "Event";
    right.appendChild(t);

    const noteText = String(ev.note || "").trim();
    if (noteText) {
      const n = document.createElement("div");
      n.className = "eventNote";
      n.textContent = noteText;
      right.appendChild(n);
    }

    li.appendChild(left);
    li.appendChild(right);
    ul.appendChild(li);
  }

  wrap.appendChild(ul);

  if (list.length > MAX_EVENTS_PER_PERSON) {
    const more = document.createElement("div");
    more.className = "eventsMore";
    more.textContent = `+${list.length - MAX_EVENTS_PER_PERSON} more`;
    wrap.appendChild(more);
  }

  return wrap;
};


    for (const r of filtered) {
      try {
        const isMemorial = r.status === "deceased";
        const isBirthday = !!r.isBirthdayToday;

        let badgeClass = isMemorial ? "badge deceased" : "badge alive";
        let badgeText = isMemorial ? "In Memoriam" : "Living";

        if (isBirthday) {
          badgeClass = "badge birthday";
          badgeText = "🎂 Birthday Today";
        }

        const years = (r._birth || r._passed)
          ? `${r._birth ? r._birth.getFullYear() : "—"} – ${r._passed ? r._passed.getFullYear() : "—"}`
          : "";

        const photos = Array.isArray(r._photos) ? r._photos : [];

        const card = document.createElement("section");
        card.className = "card" + (isMemorial ? " memorial" : "") + (isBirthday ? " birthdayToday" : "");

        const top = document.createElement("div");
        top.className = "cardTop";

        const avatarWrap = document.createElement("div");
        avatarWrap.className = "avatarWrap";

        if (photos.length) {
          const img = document.createElement("img");
          img.className = "avatar";
          img.alt = escapeHtml(r.name || "Photo");
          img.loading = "lazy";
          avatarWrap.appendChild(img);

          if (photos.length > 1) {
            const dot = document.createElement("div");
            dot.className = "avatarDot";
            dot.title = "Multiple photos";
            dot.textContent = "↻";
            avatarWrap.appendChild(dot);
          } else if (isMemorial) {
            const dot = document.createElement("div");
            dot.className = "avatarDot";
            dot.title = "In Memoriam";
            dot.textContent = "✦";
            avatarWrap.appendChild(dot);
          }
        } else {
          const placeholder = document.createElement("div");
          placeholder.className = "avatar placeholder";
          placeholder.setAttribute("aria-hidden", "true");
          placeholder.textContent = "No photo";
          avatarWrap.appendChild(placeholder);

          if (isMemorial) {
            const dot = document.createElement("div");
            dot.className = "avatarDot";
            dot.title = "In Memoriam";
            dot.textContent = "✦";
            avatarWrap.appendChild(dot);
          }
        }

        avatarWrap.style.cursor = photos.length ? "pointer" : "default";
        avatarWrap.addEventListener("click", (e) => {
          if (!photos.length) return;
          e.preventDefault();
          e.stopPropagation();
          openPhotoModal(r.name || "Photos", photos, 0);
        });

        const topText = document.createElement("div");
        topText.className = "cardTopText";

        const nameEl = document.createElement("h2");
        nameEl.className = "name";
        nameEl.textContent = r.name || "Unnamed";

        const badgeEl = document.createElement("div");
        badgeEl.className = badgeClass;
        badgeEl.textContent = badgeText;

        topText.appendChild(nameEl);
        topText.appendChild(badgeEl);

        if (isMemorial) {
          const memorialMark = document.createElement("div");
          memorialMark.className = "memorialMark";
          memorialMark.textContent = "In loving memory";
          topText.appendChild(memorialMark);

          if (years) {
            const memorialYears = document.createElement("div");
            memorialYears.className = "memorialYears";
            memorialYears.textContent = years;
            topText.appendChild(memorialYears);
          }
        }

        top.appendChild(avatarWrap);
        top.appendChild(topText);
        card.appendChild(top);

        card.appendChild(makeRow("Birthdate", fmtDate(r._birth)));
        card.appendChild(makeRow(isMemorial ? "Age at passing" : "Current age", r.ageText || "—"));
        card.appendChild(makeRow("Passed", fmtDate(r._passed)));

        if (r._phoneDisplay && r._phoneHref) {
          card.appendChild(makeLinkRow("Phone", r._phoneHref, r._phoneDisplay));
        }
        if (r._email) {
          card.appendChild(makeLinkRow("Email", "mailto:" + r._email, r._email));
        }

        if (!isMemorial && r.nextBirthday) {
          const cal = buildCalChooser(r);
          if (cal) card.appendChild(cal);
        }

        const childrenRow = makeListRow("Children", r._children);
        if (childrenRow) card.appendChild(childrenRow);

        const grandsRow = makeListRow("Grandchildren", r._grandchildren);
        if (grandsRow) card.appendChild(grandsRow);

        const eventsBlock = makeEventsBlock(r._events);
        if (eventsBlock) card.appendChild(eventsBlock);

        if (isMemorial && r.tribute && r.tribute.trim()) {
          const tribute = document.createElement("div");
          tribute.className = "tribute";
          tribute.textContent = `“${r.tribute.trim()}”`;
          card.appendChild(tribute);
        }

        if (isMemorial && r.wouldHaveTurned != null) {
          const wht = document.createElement("div");
          wht.className = "wouldHaveTurned";
          wht.innerHTML =
            `Remembering <strong>${escapeHtml(r.name)}</strong> today — would have turned <strong>${escapeHtml(String(r.wouldHaveTurned))}</strong>.`;
          card.appendChild(wht);
        }

        frag.appendChild(card);

        const imgEl = card.querySelector("img.avatar");
        if (imgEl && photos.length) startCarousel(imgEl, photos);

      } catch (e) {
        console.error("Render error for record:", r?.id || r?.name || "(unknown)", e);
        continue;
      }
    }

    cards.appendChild(frag);
  }

  // ============================
  // Login UI + auth state
  // ============================
  async function completeEmailLinkSignin() {
    const href = window.location.href;

    if (!auth || !auth.isSignInWithEmailLink || !auth.isSignInWithEmailLink(href)) return;

    const storedEmail = window.localStorage.getItem("emailForSignIn");
    const email = storedEmail || window.prompt("Confirm your email to finish sign-in:");
    if (!email) return;

    try {
      await auth.signInWithEmailLink(email, href);
      window.localStorage.removeItem("emailForSignIn");
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (err) {
      console.error(err);
      alert("Sign-in failed. Please request a new login link and try again.");
    }
  }

  function setUIAuthed(isAuthed, emailText) {
    const whoami = $("whoami");
    const logoutBtn = $("logoutBtn");
    const loginForm = $("loginForm");
    const appControls = $("appControls");

    if (loginForm) loginForm.style.display = isAuthed ? "none" : "";
    if (appControls) appControls.hidden = !isAuthed;

    if (whoami) whoami.textContent = isAuthed ? (emailText || "Signed in") : "Not signed in";

    if (logoutBtn) {
      if ("hidden" in logoutBtn) logoutBtn.hidden = !isAuthed;
      else logoutBtn.style.display = isAuthed ? "" : "none";
    }
  }

  function wireLoginUI() {
    const form = $("loginForm");
    const emailEl = $("loginEmail");
    const sendBtn = $("sendLinkBtn");
    const logoutBtn = $("logoutBtn");

    if (form && emailEl && sendBtn) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const email = (emailEl.value || "").trim();
        if (!email) return;

        sendBtn.disabled = true;
        sendBtn.textContent = "Sending…";

        try {
          await auth.sendSignInLinkToEmail(email, actionCodeSettings);
          window.localStorage.setItem("emailForSignIn", email);
          alert("Login link sent. Open your email on this device and tap the link.");
        } catch (err) {
          console.error(err);
          alert(`Could not send link.\n\nError: ${err.code || "unknown"}\n${err.message || ""}`);
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = "Send login link";
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try { await auth.signOut(); } catch (e) { console.error(e); }
      });
    }
  }

  function hookUI() {
    const searchEl = $("search");
    const showDeceasedEl = $("showDeceased");
    const sortBtn = $("sortBtn");

    if (searchEl) {
      searchEl.addEventListener("input", (e) => {
        state.q = e.target.value;
        render();
      });
    }

    if (showDeceasedEl) {
      showDeceasedEl.addEventListener("change", (e) => {
        state.showDeceased = e.target.checked;
        render();
      });
    }

    if (sortBtn) {
      sortBtn.addEventListener("click", () => {
        state.sortOldestFirst = !state.sortOldestFirst;
        sortBtn.textContent = state.sortOldestFirst
          ? "Sort: Oldest → Youngest"
          : "Sort: Youngest → Oldest";
        render();
      });
    }
  }

  // ============================
  // Bootstrap
  // ============================
  async function bootstrap() {
    if (!auth || !db || !storage) return;

    wireLoginUI();
    hookUI();
    wirePhotoModalOnce();

    await completeEmailLinkSignin();

    auth.onAuthStateChanged(async (user) => {
      state.user = user || null;

      if (!user) {
        state.data = [];
        setUIAuthed(false, "");
        render();
        return;
      }

      setUIAuthed(true, user.email || "");

      try {
        await loadPeopleOnce();
        await loadAnnouncementsOnce();
        render();

      } catch (err) {
        console.error(err);
        alert(`Error loading data: ${err.code || "unknown"}\n${err.message || err}`);
        state.data = [];
        render();
      }
    });
  }

  bootstrap();
})();
