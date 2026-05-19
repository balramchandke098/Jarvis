import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCHz3nzolKLCKC8W7kYbedcXQgH4XBgVJo",
  authDomain: "jarvis-142fd.firebaseapp.com",
  projectId: "jarvis-142fd",
  storageBucket: "jarvis-142fd.firebasestorage.app",
  messagingSenderId: "269775457171",
  appId: "1:269775457171:web:a3780fd0602b156843b666",
  measurementId: "G-2723LENY35"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

export const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    return signInWithPopup(auth, provider);
}

export const logout = async () => {
    return signOut(auth);
}

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
// testConnection();
