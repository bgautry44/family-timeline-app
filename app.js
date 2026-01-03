(function () {
  const $ = (id) => document.getElementById(id);

  // ============================
  // CONFIG
  // ============================
  const FAMILY_ID = "e538i47rIjVIS7xGdCtC";

  // ============================
  // Firebase (compat)
  // ============================
  const auth = window.auth ?? firebase.auth();
  const db = window.db ?? firebase.firestore();
  const storage = window.storage ?? firebase.storage();

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
    user: null,
    q: "",
    showDeceased: true,
    sortOldestFirst: true,
    familyId: FAMILY_ID
  };

  // ============================
  // Date helpers
  // ============================
  const todayLocal = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };

  const parseDate = (v) => {
    if (!v) return null;
    if (v.toDate) {
      const d = v.toDate();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    const d = new Date(v);
    return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };

  const fmtDate = (d) =>
    d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

  const diffYMD = (from, to) => {
    let y = to.getFullYear() - from.getFullYear();
    let m = to.getMonth() - from.getMonth();
    let d = to.getDate() - from.getDate();
    if (d < 0) {
      m--;
      d += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
    }
    if (m < 0) {
      y--;
      m += 12;
    }
    return `${y} year${y !== 1 ? "s" : ""}, ${m} month${m !== 1 ? "s" : ""}, ${d} day${d !== 1 ? "s" : ""}`;
  };

  // ============================
  // Photos
  // ============================
  async function resolvePhotos(person) {
    const paths = Array.isArray(person.photos)
      ? person.photos
      : person.photos ? [person.photos] : [];

    const urls = [];
    for (const p of paths) {
      if (/^https?:\/\//i.test(p)) {
        urls.push(p);
      } else {
        try {
          urls.push(await storage.ref(p).getDownloadURL());
        } catch (e) {
          console.warn("Photo load failed:", p);
        }
      }
    }
    person._photos = urls;
  }

  // ============================
  // Compute derived fields
  // ============================
  function compute(person) {
    const birth = parseDate(person.birthdate);
    const passed = parseDate(person.passed);
    const today = todayLocal();
    const deceased = passed && passed <= today;

    return {
      ...person,
      _birth: birth,
      _passed: deceased ? passed : null,
      status: deceased ? "deceased" : "alive",
      ageText: birth ? diffYMD(birth, deceased ? passed : today) : "—",
    };
  }

  // ============================
  // Load Firestore
  // ============================
  async function loadPeople() {
    const snap = await db
      .collection("families")
      .doc(state.familyId)
      .collection("people")
      .get();

    const people = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    for (const p of people) await resolvePhotos(p);
    state.data = people;
  }

  // ============================
  // Render
  // ============================
  function render() {
    const cards = $("cards");
    const empty = $("empty");
    cards.innerHTML = "";

    const rows = state.data.map(compute)
      .filter(p => state.showDeceased || p.status !== "deceased")
      .sort((a, b) =>
        state.sortOldestFirst
          ? (a._birth?.getTime() ?? 0) - (b._birth?.getTime() ?? 0)
          : (b._birth?.getTime() ?? 0) - (a._birth?.getTime() ?? 0)
      );

    if (!rows.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    for (const p of rows) {
      const card = document.createElement("div");
      card.className = `card ${p.status === "deceased" ? "memorial" : ""}`;

      // ---- Header (THIS IS THE FIX) ----
      const top = document.createElement("div");
      top.className = "cardTop";

      const avatarWrap = document.createElement("div");
      avatarWrap.className = "avatarWrap";

      if (p._photos?.length) {
        const img = document.createElement("img");
        img.className = "avatar";
        img.src = p._photos[0];
        img.alt = `Photo of ${p.name}`;
        avatarWrap.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "avatar placeholder";
        ph.textContent = "No photo";
        avatarWrap.appendChild(ph);
      }

      const text = document.createElement("div");
      text.className = "cardTopText";

      const name = document.createElement("h3");
      name.className = "name";
      name.textContent = p.name || "Unnamed";

      const badge = document.createElement("div");
      badge.className = `badge ${p.status}`;
      badge.textContent = p.status === "deceased" ? "In Memoriam" : "Living";

      text.appendChild(name);
      text.appendChild(badge);

      top.appendChild(avatarWrap);
      top.appendChild(text);
      card.appendChil

