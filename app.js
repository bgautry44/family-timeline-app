(function () {
  const $ = (id) => document.getElementById(id);

  // ========= On-screen status (uses the existing #whoami element) =========
  function setStatus(msg) {
    const who = $("whoami");
    if (who) who.textContent = msg;
    console.log("[FamilyTimeline]", msg);
  }

  // ========= Surface silent failures =========
  window.addEventListener("error", (e) => {
    setStatus("JS error: " + (e?.message || "unknown"));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const err = e?.reason;
    setStatus("Promise error: " + (err?.code || err?.message || String(err)));
  });

  // ========= Firebase (compat) =========
  const auth = window.auth ? window.auth : (window.firebase ? window.firebase.auth() : null);

  if (!auth) {
    setStatus("Firebase Auth not found. Check firebase.js + SDK script tags.");
    return;
  }

  // Email link sign-in settings (must be an authorized domain)
  const actionCodeSettings = {
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true
  };

  // ========= UI helpers =========
  function setUIAuthed(isAuthed, emailText) {
    const loginForm = $("loginForm");
    const logoutBtn = $("logoutBtn");

    if (loginForm) loginForm.style.display = isAuthed ? "none" : "";
    if (logoutBtn) logoutBtn.hidden = !isAuthed;

    setStatus(isAuthed ? ("Signed in: " + (emailText || "")) : "Not signed in");
  }

  // ========= Complete email-link sign-in =========
  async function completeEmailLinkSignin() {
    const href = window.location.href;

    if (!auth.isSignInWithEmailLink(href)) return;

    const storedEmail = window.localStorage.getItem("emailForSignIn");
    const email = storedEmail || window.prompt("Confirm your email to finish sign-in:");
    if (!email) return;

    setStatus("Completing sign-in…");
    await auth.signInWithEmailLink(email, href);

    window.localStorage.removeItem("emailForSignIn");
    window.history.replaceState({}, document.title, window.location.pathname);
    setStatus("Sign-in complete.");
  }

  // ========= Wire login form =========
  function wireLoginUI() {
    const form = $("loginForm");
    const emailEl = $("loginEmail");
    const sendBtn = $("sendLinkBtn");
    const logoutBtn = $("logoutBtn");

    if (!form || !emailEl || !sendBtn) {
      setStatus("Missing login DOM elements (#loginForm/#loginEmail/#sendLinkBtn).");
      return;
    }

    setStatus("Ready. Enter email and click Send login link.");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = (emailEl.value || "").trim();
      if (!email) {
        setStatus("Enter an email address.");
        return;
      }

      sendBtn.disabled = true;
      const oldText = sendBtn.textContent;
      sendBtn.textContent = "Sending…";

      try {
        setStatus("Sending login link to " + email + "…");
        await auth.sendSignInLinkToEmail(email, actionCodeSettings);
        window.localStorage.setItem("emailForSignIn", email);
        setStatus("Link sent. Check inbox/spam.");
        alert("Login link sent. Open your email on this device and tap the link.");
      } catch (err) {
        console.error("sendSignInLinkToEmail failed:", err);
        setStatus("Send failed: " + (err?.code || err?.message || "unknown"));
        alert(
          "Could not send link.\n\n" +
          "Code: " + (err?.code || "unknown") + "\n" +
          (err?.message || "")
        );
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = oldText || "Send login link";
      }
    });

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

  // ========= Bootstrap =========
  async function bootstrap() {
    wireLoginUI();

    // If arriving from an email link, finish sign-in
    try {
      await completeEmailLinkSignin();
    } catch (e) {
      console.error(e);
      setStatus("Sign-in completion failed: " + (e?.code || e?.message || "unknown"));
    }

    auth.onAuthStateChanged((user) => {
      if (!user) {
        setUIAuthed(false, "");
        return;
      }
      setUIAuthed(true, user.email || "");
    });
  }

  bootstrap();
})();
