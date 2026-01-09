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
  // Storage photo URL resolving
  // ============================
  const photoUrlCache = new Map();

  function normalizePhotoPaths(r) {
    const list = [];
    if (Array.isArray(r?.photos)) list.push(...r.photos);
    else if (typeof r?.photos === "string" && r.photos.trim()) list.push(r.photos.trim());
    if (typeof r?.photo === "string" && r.photo.trim()) list.push(r.photo.trim());
    return list.map(x => (x == null ? "" : String(x).trim())).filter(Boolean);
  }

  async function getDownloadUrlForPath(storagePath) {
    if (!storagePath) return null;
    if (/^https?:\/\//i.test(storagePath)) return storagePath;

    if (photoUrlCache.has(storagePath)) return photoUrlCache.get(storagePath);

    const url = await storage.ref(storagePath).getDownloadURL();
    photoUrlCache.set(storagePath, url);
    return url;
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
        try {
          const u = await getDownloadUrlForPath(path);
          if (u) urls.push(u);
        } catch (e) {
          console.warn("Could not load photo URL for:", path, e);
        }
      }
      p._photoUrls = urls;
    }
    return peopleArray;
  }
  function photoList(r) {
  // Prefer resolved download URLs
  if (Array.isArray(r?._photoUrls) && r._photoUrls.length) {
    return r._photoUrls.filter(u => /^https?:\/\//i.test(u));
  }

  // If not resolved, DO NOT return raw storage paths (they will 404 as relative URLs)
  const arr = Array.isArray(r?.photos) ? r.photos : (typeof r?.photos === "string" ? [r.photos] : []);
  const urls = (arr || []).map(x => String(x).trim()).filter(Boolean).filter(u => /^https?:\/\//i.test(u));

  const single = (typeof r?.photo === "string") ? String(r.photo).trim() : "";
  if (single && /^https?:\/\//i.test(single)) urls.unshift(single);

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
      wouldHaveTurned
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
  // Carousel engine
  // ============================
  const carouselTimers = new Map();

  function stopCarouselFor(imgEl) {
    const t = carouselTimers.get(imgEl);
    if (t) clearInterval(t);
    carouselTimers.delete(imgEl);
  }

  function startCarousel(imgEl, photos) {
    stopCarouselFor(imgEl);
    if (!imgEl || !Array.isArray(photos) || photos.length === 0) return;

    let idx = 0;

    const setSrc = () => {
      imgEl.classList.remove("fadeIn");
      void imgEl.offsetWidth;
      imgEl.src = photos[idx];
      imgEl.classList.add("fadeIn");
    };

    imgEl.onerror = () => {
      if (photos.length <= 1) return;
      idx = (idx + 1) % photos.length;
      setSrc();
    };

    setSrc();

    if (photos.length === 1) return;

    const tickMs = 2600;
    const timer = setInterval(() => {
      idx = (idx + 1) % photos.length;
      setSrc();
    }, tickMs);

    carouselTimers.set(imgEl, timer);

    // Tap to advance (kept for avatar small carousel)
    imgEl.addEventListener("click", () => {
      idx = (idx + 1) % photos.length;
      setSrc();
    });
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

    modalState.open = true;
    modalState.photos = Array.isArray(photos) ? photos.filter(Boolean) : [];
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

    // Clear src to prevent flash of previous image on next open
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
    // Conservative swipe detection (prevents accidental triggers)
    const thresholdX = 40;   // minimum horizontal movement
    const restraintY = 60;   // max vertical movement allowed
    const minVelocity = 0.10; // px/ms (very forgiving)

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
      // If user is clearly scrolling vertically, stop tracking
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

      // Must be mostly horizontal
      if (Math.abs(dy) > restraintY) return;

      if (Math.abs(dx) >= thresholdX && vx >= minVelocity) {
        // Prevent click ghosting
        if (e.cancelable) e.preventDefault();

        if (dx < 0) modalNext(); // swipe left -> next
        else modalPrev();        // swipe right -> prev
      }
    };

    // Avoid double wiring
    if (stageEl.dataset.swipeWired === "1") return;
    stageEl.dataset.swipeWired = "1";

    // Important: use passive:false so preventDefault is allowed when needed
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

    // Close if user clicks outside dialog (extra guard)
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closePhotoModal();
    });

    // Also close if clicking backdrop area (covers cases where modal click target differs)
    if (dialog) {
      dialog.addEventListener("click", (e) => {
        // Do nothing; prevents accidental bubbling to modal container
        e.stopPropagation();
      });
    }

    // Swipe on the stage (image area)
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
    await ref.set({
      role: "admin",
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

  // ============================
  // Render (Cousins DOM structure)
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

    // stop all existing carousels before rebuild
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

    cards.innerHTML = "";
    if (filtered.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const frag = document.createDocumentFragment();

    for (const r of filtered) {
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

      // Header row
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

      // Open modal on avatar click (only if photos exist). Stop bubbling to img click.
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

      // Rows (label left, value right)
      const makeRow = (label, value) => {
        const d = document.createElement("div");
        d.className = "row";

        const l = document.createElement("span");
        l.textContent = label;

        const v = document.createElement("span");
        v.className = "value";
        v.textContent = value;

        d.appendChild(l);
        d.appendChild(v);
        return d;
      };

      card.appendChild(makeRow("Birthdate", fmtDate(r._birth)));
      card.appendChild(makeRow(isMemorial ? "Age at passing" : "Current age", r.ageText || "—"));
      card.appendChild(makeRow("Passed", fmtDate(r._passed)));

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

      // Start carousel
      const imgEl = card.querySelector("img.avatar");
      if (imgEl && photos.length) startCarousel(imgEl, photos);
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
