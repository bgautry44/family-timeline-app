// firebase.js (family-timeline-app)

const firebaseConfig = {
  apiKey: "PASTE_YOURS",
  authDomain: "PASTE_YOURS",
  projectId: "PASTE_YOURS",
  storageBucket: "PASTE_YOURS",
  messagingSenderId: "PASTE_YOURS",
  appId: "PASTE_YOURS"
};

firebase.initializeApp(firebaseConfig);

// Services we will use
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
