(function () {
  const $ = (id) => document.getElementById(id);

  function setStatus(msg) {
    const who = $("whoami");
    if (who) who.textContent = msg;
    console.log("[FamilyTimeline]", msg);
  }

  // Surface hard failures
  window.addEventListener("error", (e) => setStatus("JS error: " + (e?.message || "unknown")));
  window.addEventListener("unhandledrejection", (e) => {
    const err = e?.reason;
    setStatus("Promise error: " + (err?.code || err?.message || String(err)));
  });

  const auth = window.auth ? window.auth : (window.firebase ? window.firebase.auth() : null);

  if (!auth) {
    setStatus("Firebase Auth not found. Check firebase.js + compat scripts.");
    return;
  }

  const actionCodeSettings = {
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true
  };

  function setUIAuthed(isAuthed, emailText) {
    const loginForm = $("loginForm");
    const logoutBtn = $("logoutBtn");
    const appControls = $("appControls");

    if (loginForm) loginForm.style.display = isAuthed ? "none" : "";
    if (logoutBtn) logoutBtn.hidden = !isAuthed;
    if (appControls) appControls.hidden = !isAuthed;

    setStatus(isAuthed ? ("Signed in: " + (emailText || "")) : "Not signed in");
  }

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

  function wireLoginUI() {
    setStatus("Wiring login UI…");

    const form = $("loginForm");
    const emailEl = $("loginEmail");
    const sendBtn = $("sendLinkBtn");
    const logoutBtn = $("logoutBtn");

    if (!form || !emailEl || !sendBtn) {
      setStatus("Login DOM missing: need #loginForm #loginEmail #sendLinkBtn");
      console.error({ form, emailEl, sendBtn });
      return;
    }

    // Prevent double-wiring if scripts are re-evaluated
    if (form.dataset.wired === "1") {
      setStatus("Login UI already wired.");
      return;
    }
    form.dataset.wired = "1";

    setStatus("Ready. Enter email and click Send login link.");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setStatus("Submitting…");

      const email = (emailEl.value || "").trim();
      if (!email) {
        setStatus("Enter an email address.");
        return;
      }

      sendBtn.disabled = true;
      const oldText = sendBtn.textContent;
      sendBtn.textContent = "Sending…";

      try {
        setStatus("Sending link to " + email + "…");
        await auth.sendSignInLinkToEmail(email, actionCodeSettings);
        window.localStorage.setItem("emailForSignIn", email);
        setStatus("Link sent. Check inbox/spam.");
        alert("Login link sent. Open your email on this device and tap the link.");
      } catch (err) {
        console.error("sendSignInLinkToEmail failed:", err);
        setStatus("Send failed: " + (err?.code || err?.message || "unknown"));
        alert("Could not send link.\n\nCode: " + (err?.code || "unknown") + "\n" + (err?.message || ""));
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = oldText || "Send login link";
      }
    });

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try { await auth.signOut(); } catch (e) { console.error(e); }
      });
    }
  }

  function bootstrap() {
    wireLoginUI();

    completeEmailLinkSignin().catch((e) => {
      console.error(e);
      setStatus("Sign-in completion failed: " + (e?.code || e?.message || "unknown"));
    });

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
