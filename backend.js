// Jaay backend: Firebase Authentication + Cloud Firestore (per-tab memory cache).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence, inMemoryPersistence, updatePassword, EmailAuthProvider, reauthenticateWithCredential, deleteUser } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, memoryLocalCache, doc, collection, setDoc, deleteDoc, getDoc, onSnapshot, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const CFG = window.JAAY_CONFIG && window.JAAY_CONFIG.firebase;
if(!window.JB && CFG && !/^REPLACE/.test(CFG.apiKey || '')){
  const cfg = CFG;
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  let fs;
  // Each tab keeps its own copy of the data in memory. A copy shared between tabs lets one tab
  // read the database for the others with its own sign-in; with one tab signed out (or signed in
  // as someone else) that caused refusals and sign-outs. Changes made offline still wait in memory
  // and are sent when the connection comes back, as long as the page stays open.
  fs = initializeFirestore(app, { localCache: memoryLocalCache() });
  const norm = e => { const err = new Error(e && e.message || 'error'); err.code = String(e && e.code || 'unknown').replace(/^firestore\//, ''); err.raw = e; return err; };
  const wrap = p => p.catch(e => { throw norm(e); });
  const snapDoc = s => ({ id: s.id, exists: s.exists(), data: () => s.data(), metadata: s.metadata });
  window.JB = {
    ready: setPersistence(auth, browserSessionPersistence).catch(e => console.warn(e)),
    uid: () => auth.currentUser ? auth.currentUser.uid : null,
    onUser: cb => onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null)),
    signIn: (email, pw) => wrap(signInWithEmailAndPassword(auth, email, pw)),
    signUp: (email, pw) => wrap(createUserWithEmailAndPassword(auth, email, pw)).then(c => c.user.uid),
    deleteMe: () => auth.currentUser ? wrap(deleteUser(auth.currentUser)) : Promise.resolve(),
    signOut: () => wrap(signOut(auth)),
    createUser: async (email, pw) => {
      const app2 = initializeApp(cfg, 'staff-' + Date.now());
      const a2 = getAuth(app2);
      await setPersistence(a2, inMemoryPersistence);
      const c = await wrap(createUserWithEmailAndPassword(a2, email, pw));
      const uid = c.user.uid; await signOut(a2).catch(() => {});
      return uid;
    },
    changePassword: async (oldPw, newPw) => {
      const u = auth.currentUser; if(!u) throw norm({ code: 'auth/no-current-user' });
      await wrap(reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, oldPw)));
      await wrap(updatePassword(u, newPw));
    },
    db: {
      doc: p => ({
        set: d => wrap(setDoc(doc(fs, p), d)),
        delete: () => wrap(deleteDoc(doc(fs, p))),
        get: () => wrap(getDoc(doc(fs, p))).then(snapDoc),
        onSnapshot: (next, err) => onSnapshot(doc(fs, p), { includeMetadataChanges: true }, s => next(snapDoc(s)), e => err && err(norm(e)))
      }),
      collection: p => ({
        onSnapshot: (next, err) => onSnapshot(collection(fs, p), { includeMetadataChanges: true }, s => next({ docs: s.docs.map(snapDoc), metadata: s.metadata }), e => err && err(norm(e)))
      })
    },
    batchSet: async (entries, onProgress) => {
      for(let i = 0; i < entries.length; i += 100){
        const b = writeBatch(fs);
        for(const [path, data] of entries.slice(i, i + 100)) b.set(doc(fs, path), data);
        await wrap(b.commit());
        if(onProgress) onProgress(Math.min(entries.length, i + 100), entries.length);
      }
    }
  };
  window.dispatchEvent(new Event('jb-ready'));
}
