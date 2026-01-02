(function () {
  const $ = (id) => document.getElementById(id);

  // ============================
  // CONFIG (SET THIS)
  // ============================
  const FAMILY_ID = "e538i47rIjVIS7xGdCtC";

  // ============================
  // Firebase (compat)
  // Requires global: firebase + compat SDK scripts + firebase.initializeApp() in firebase.js
  // ============================
  const auth = window.auth ? window.auth : (window.firebase ? window.firebase.auth() : null);
  const db = window.db ? window.db : (window.firebase ? window.firebase.firestore() : null);
  const storage = window.storage ? window.storage : (window.firebase ? window.firebase.storage() : null);

  if (!auth || !db || !storage) {
    console.error(
      "Firebase auth/db/storage not found. Ensure compat scripts are loaded and firebase.initializeApp() has run (firebase.js)."
    );
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
  const photoUrlCache = new Map(); // key: storagePath, value: downloadUrl

  function normalizePhotoPaths(r) {
    const list = [];

    // photos can be array OR string; photo can be string
    if (Array.isArray(r?.photos)) list.push(...r.photos);
    else if (typeof r?.photos === "string" && r.photos.trim()) list.push(r.photos.trim());

    if (typeof r?.photo === "string" && r.photo.trim()) list.push(r.photo.trim());

    return list
      .map(x => (x == null ? "" : String(x).trim()))
      .filter(Boolean);
  }

  async function getDownloadUrlForPath(storagePath) {
    if (!storagePath) return null;

    // If already a URL, use as-is
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

  // Photos used by carousel: prefer resolved _photoUrls
  function photoList(r) {
    if (Array.isArray(r?._photoUrls) && r._photoUrls.length) return r._photoUrls;

    const arr = Array.isArray(r?.photos) ? r.photos : (typeof r?.photos === "string" ? [r.photos] : []);
    if (arr && arr.length) return arr.map(x => String(x).trim()).filter(Boolean);

    const single = (typeof r?.photo === "string") ? String(r.photo).trim() : "";
    return single ? [single] : [];
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

    // Living only: Birthday Today
    const isBirthdayToday = !!(birth && !passedEffective && sameMonthDay(birth, today));

    // Deceased only: would have turned X on birthday
    const wouldHaveTurned = (birth && passedEffective && sameMonthDay(birth, today))
      ? (today.getFullYear() - birth.getFullYear())
      : null;

    // For upcoming birthdays line (filtered to living in render)
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

    // Sort by DOB only (birth order)
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
      void imgEl.offsetWidth; // restart animation
      imgEl.src = photos[idx];
      imgEl.classList.add("fadeIn");
    };

    // Skip broken images so carousel doesn't get stuck
    imgEl.onerror = () => {
      if (photos.length <= 1) return;
      idx = (idx + 1) % photos.length;
      setSrc();
    };

    setSrc();

    // If only one photo, do not rotate
    if (photos.length === 1) return;

    const tickMs = 2600;
    const timer = setInterval(() => {
      idx = (idx + 1) % photos.length;
      setSrc();
    }, tickMs);

    carouselTimers.set(imgEl, timer);

    // Tap to advance
    imgEl.addEventListener("click", () => {
      idx = (idx + 1) % photos.length;
      setSrc();
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

  function dedupePeopleByNameBirth(arr) {
    const seen = new Map();

    for (const p of arr) {
      const nameKey = normalize(p.name);
      const b = p.birthdate == null ? "" : String(p.birthdate).trim();
      const key = `${nameKey}|${b}`;

      if (!seen.has(key)) {
        seen.set(key, p);
      } else {
        const kept = seen.get(key);
        console.warn("Duplicate person merged:", {
          keptId: kept?.id,
          dupId: p?.id,
          name: p?.name,
          birthdate: p?.birthdate
        });
      }
    }

    return Array.from(seen.values());
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

    // Resolve photo download URLs
    await hydratePeoplePhotoUrls(arr);

    // Deduplicate
    arr = dedupePeopleByNameBirth(arr);

    state.data = arr;
  }

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

    // stop all existing carousels before rebuild
    for (const [imgEl] of carouselTimers) stopCarouselFor(imgEl);

    const computed = (state.data || []).map(computeRow);
    const filtered = filterSort(computed);
    const today = todayLocal();

    asOf.textContent = `As of: ${today.toLocaleDateString(undefined, {
      weekday: "short", year: "numeric", month: "short", day: "numeric"
    })}`;

    count.textContent = `Shown: ${filtered.length} / ${computed.length}`;

    // Upcoming birthdays (next 30 days) - living only
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
          `📅 <strong>Upcoming birthdays (next 30 days):</strong> ` +
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

      const photos = r._photos;

      const card = document.createElement("section");
      card.className =
        "card" +
        (isMemorial ? " memorial" : "") +
        (isBirthday ? " birthdayToday" : "");

      const avatarHtml = photos.length
        ? `
          <div class="avatarWrap">
            <img class="avatar" alt="${escapeHtml(r.name || "Photo")}" loading="lazy" />
            ${
              photos.length > 1
                ? `<div class="avatarDot" title="Multiple photos">↻</div>`
                : (isMemorial ? `<div class="avatarDot" title="In Memoriam">✦</div>` : ``)
            }
          </div>
        `
        : `
          <div class="avatarWrap">
            <div class="avatar placeholder" aria-hidden="true">No photo</div>
            ${isMemorial ? `<div class="avatarDot" title="In Memoriam">✦</div>` : ``}
          </div>
        `;

      const memorialLine = isMemorial
        ? `
          <div class="memorialMark">In loving memory</div>
          ${years ? `<div class="memorialYears">${escapeHtml(years)}</div>` : ``}
        `
        : ``;

      const tributeBlock = (isMemorial && r.tribute && r.tribute.trim())
        ? `<div class="tribute">“${escapeHtml(r.tribute.trim())}”</div>`
        : "";

      const wouldHaveTurnedBlock =
        (isMemorial && r.wouldHaveTurned != null)
          ? `<div class="wouldHaveTurned">Remembering <strong>${escapeHtml(r.name)}</strong> today — would have turned <strong>${r.wouldHaveTurned}</strong>.</div>`
          : "";

      card.innerHTML = `
        <div class="cardTop">
          ${avatarHtml}
          <div class="cardTopText">
            <h2 class="name">${escapeHtml(r.name || "Unnamed")}</h2>
            <div class="${badgeClass}">${badgeText}</div>
            ${memorialLine}
          </div>
        </div>

        <div class="row"><span>Birthdate</span><span class="value">${fmtDate(r._birth)}</span></div>
        <div class="row"><span>${isMemorial ? "Age at passing" : "Current age"}</span><span class="value">${escapeHtml(r.ageText)}</span></div>
        <div class="row"><span>Passed</span><span class="value">${fmtDate(r._passed)}</span></div>
        ${tributeBlock}
        ${wouldHaveTurnedBlock}
      `;

      cards.appendChild(card);

      const imgEl = card.querySelector("img.avatar");
      if (imgEl && photos.length) startCarousel(imgEl, photos);
    }
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
    // index.html may not have loginBox/appBox wrappers; this is safe either way
    const loginBox = $("loginBox");
    const appBox = $("appBox");
    const whoami = $("whoami");
    const logoutBtn = $("logoutBtn");
    const loginForm = $("loginForm");

    if (loginBox) loginBox.style.display = isAuthed ? "none" : "";
    if (appBox) appBox.style.display = isAuthed ? "" : "none";

    // If wrappers do not exist, hide/show the login form directly
    if (!loginBox && loginForm) loginForm.style.display = isAuthed ? "none" : "";

    if (whoami) whoami.textContent = isAuthed ? (emailText || "Signed in") : "Not signed in";

    // Your index.html uses hidden attribute initially; use hidden when available
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
          alert("Login link sent. Open your email on this phone and tap the link.");
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
        try {
          await auth.signOut();
        } catch (e) {
          console.error(e);
        }
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
