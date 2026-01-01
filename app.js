(function () {
  const $ = (id) => document.getElementById(id);

  // ------------- Auth (email link) -------------
  const actionCodeSettings = {
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true
  };

  async function completeEmailLinkSignin() {
    const href = window.location.href;
    if (!auth.isSignInWithEmailLink(href)) return;

    const storedEmail = window.localStorage.getItem("emailForSignIn");
    const email = storedEmail || window.prompt("Confirm your email to finish sign-in:");
    if (!email) return;

    try {
      await auth.signInWithEmailLink(email, href);
      window.localStorage.removeItem("emailForSignIn");
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (err) {
      console.error(err);
      alert(`Sign-in failed.\n\n${err.code || ""}\n${err.message || ""}`);
    }
  }

  function wireLoginUI() {
    const form = $("loginForm");
    const emailEl = $("loginEmail");
    const sendBtn = $("sendLinkBtn");
    const logoutBtn = $("logoutBtn");
    const whoami = $("whoami");

    if (form) {
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
          alert(`Could not send link.\n\n${err.code || ""}\n${err.message || ""}`);
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = "Send login link";
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await auth.signOut();
      });
    }

    auth.onAuthStateChanged((user) => {
      if (user) {
        whoami.textContent = `Signed in: ${user.email || "(no email)"}`;
        if (form) form.hidden = true;
        if (logoutBtn) logoutBtn.hidden = false;
      } else {
        whoami.textContent = "Not signed in";
        if (form) form.hidden = false;
        if (logoutBtn) logoutBtn.hidden = true;
      }
    });
  }

  // ------------- Date helpers (local-safe) -------------
  function localDateFromYMD(y, m, d) {
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }

  function parseISODate(v) {
    if (v == null || v === "") return null;
    if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
      return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }
    if (typeof v === "string") {
      const s = v.trim();
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return localDateFromYMD(m[1], m[2], m[3]);
      const d = new Date(s);
      if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    return null;
  }

  function todayLocal() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (s) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[s]));
  }

  // ------------- App state -------------
  const state = {
    familyId: null,
    people: []
  };

  // ------------- Firestore access control -------------
 const FAMILY_ID = "PASTE_YOUR_FAMILY_DOC_ID_HERE";

async function findMyFamilyId(user) {
  // Single-family MVP: no scanning, no listing.
  // Just verify membership exists under the known familyId.
  const memberRef = db.collection("families").doc(FAMILY_ID).collection("members").doc(user.uid);
  const memberSnap = await memberRef.get();
  return memberSnap.exists ? FAMILY_ID : null;
}


  async function loadPeople(familyId) {
    const snap = await db.collection("families").doc(familyId).collection("people")
      .orderBy("birthdate", "asc")
      .get();

    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ------------- Rendering -------------
  function computeRow(r) {
    const birth = parseISODate(r.birthdate);
    const passed = parseISODate(r.passed);

    const today = todayLocal();
    const passedEffective = (passed && passed.getTime() <= today.getTime()) ? passed : null;

    const ref = passedEffective ?? today;
    const ageObj = birth ? diffYMD(birth, ref) : null;

    return {
      ...r,
      _birth: birth,
      _passed: passedEffective,
      status: passedEffective ? "deceased" : "alive",
      ageText: birth ? fmtYMD(ageObj) : "—"
    };
  }

  function setSignedOutUI() {
    const asOf = $("asOf");
    const count = $("count");
    const cards = $("cards");
    const empty = $("empty");

    if (asOf) asOf.textContent = "";
    if (count) count.textContent = "";
    if (cards) cards.innerHTML = "";
    if (empty) { empty.hidden = false; empty.textContent = "Please sign in to continue."; }
  }

  function render() {
    const cards = $("cards");
    const empty = $("empty");
    const asOf = $("asOf");
    const count = $("count");

    if (!cards || !empty || !asOf || !count) return;

    const today = todayLocal();
    asOf.textContent = `As of: ${today.toLocaleDateString(undefined, {
      weekday: "short", year: "numeric", month: "short", day: "numeric"
    })}`;

    const computed = (state.people || []).map(computeRow);
    count.textContent = `Shown: ${computed.length}`;

    cards.innerHTML = "";
    if (computed.length === 0) {
      empty.hidden = false;
      empty.textContent = "No people yet. Add a person in Firestore.";
      return;
    }
    empty.hidden = true;

    for (const r of computed) {
      const isMemorial = r.status === "deceased";
      const badgeClass = isMemorial ? "badge deceased" : "badge alive";
      const badgeText = isMemorial ? "In Memoriam" : "Living";

      const card = document.createElement("section");
      card.className = "card";
      card.innerHTML = `
        <h2 class="name">${escapeHtml(r.name || "Unnamed")}</h2>
        <div class="row"><span>Status</span><span class="value">${badgeText}</span></div>
        <div class="row"><span>Birthdate</span><span class="value">${fmtDate(r._birth)}</span></div>
        <div class="row"><span>${isMemorial ? "Age at passing" : "Current age"}</span><span class="value">${escapeHtml(r.ageText)}</span></div>
        <div class="row"><span>Passed</span><span class="value">${fmtDate(r._passed)}</span></div>
      `;
      cards.appendChild(card);
    }
  }

  async function setSignedInUI(user) {
    const empty = $("empty");
    if (empty) empty.hidden = true;

    try {
      // Find family membership
      const familyId = await findMyFamilyId(user);
      if (!familyId) {
        if (empty) {
          empty.hidden = false;
          empty.textContent = "Signed in, but you are not authorized for any family yet.";
        }
        state.familyId = null;
        state.people = [];
        render();
        return;
      }

      state.familyId = familyId;
      state.people = await loadPeople(familyId);
      render();
    } catch (err) {
      console.error(err);
      if (empty) {
        empty.hidden = false;
        empty.textContent = `Error loading data: ${err.code || ""} ${err.message || ""}`;
      }
    }
  }

  // ------------- Boot -------------
  completeEmailLinkSignin();
  wireLoginUI();

  auth.onAuthStateChanged((user) => {
    if (user) setSignedInUI(user);
    else setSignedOutUI();
  });
})();

