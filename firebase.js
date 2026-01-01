// firebase.js (family-timeline-app)

const firebaseConfig = {
  apiKey: "AIzaSyAkk1WBSSYUM-hd48D3jLwYWkz_zambftk",
  authDomain: "family-timeline-e51c5.firebaseapp.com",
  projectId: "family-timeline-e51c5",
  storageBucket: "family-timeline-e51c5.firebasestorage.app",
  messagingSenderId: "738169039790",
  appId: "1:738169039790:web:5709df6e779662e95af63f"
};

firebase.initializeApp(firebaseConfig);

// Services we will use
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
