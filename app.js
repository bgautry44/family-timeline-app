(function () {
  const $ = (id) => document.getElementById(id);

  const actionCodeSettings = {
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true
  };

  async function completeEmailLinkSignin() {
    const href = window.location.href;

    // Is this a sign-in email link?
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
      alert("Sign-in failed. Please request a new login link and try again.");
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
          alert(`Could not send link.\n\nError: ${err.code || "unknown"}\n${err.message || ""}`);
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

  // Boot
  completeEmailLinkSignin();
  wireLoginUI();

  function setSignedOutUI() {
  const asOf = $("asOf");
  const count = $("count");
  const cards = $("cards");
  const empty = $("empty");

  if (asOf) asOf.textContent = "";
  if (count) count.textContent = "";
  if (cards) cards.innerHTML = "";
  if (empty) {
    empty.hidden = false;
    empty.textContent = "Please sign in to continue.";
  }
}

function setSignedInUI(user) {
  const empty = $("empty");
  if (empty) empty.hidden = true;
  // Next step: we will load Firestore data here
}

auth.onAuthStateChanged((user) => {
  if (user) setSignedInUI(user);
  else setSignedOutUI();
});

})();
