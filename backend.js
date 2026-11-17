// Jaay backend: Firebase Authentication + Cloud Firestore (per-tab memory cache).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence, inMemoryPersistence, updatePassword, EmailAuthProvider, reauthenticateWithCredential, deleteUser } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, memoryLocalCache, doc, collection, setDoc, deleteDoc, getDoc, onSnapshot, writeBatch, serverTimestamp, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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
  // Server times (the activity log) come back as milliseconds; a time not yet confirmed by the server is estimated.
  const plain = d => { if(d) for(const k in d){ if(d[k] && typeof d[k].toMillis === 'function') d[k] = d[k].toMillis(); } return d; };
  const snapDoc = s => ({ id: s.id, exists: s.exists(), data: () => plain(s.data({ serverTimestamps: 'estimate' })), metadata: s.metadata });
  // A change and its activity-log entry are saved in one step: both or neither.
  const logged = (b, log) => { if(log) b.set(doc(fs, log.path), Object.assign({}, log.data, { ts: serverTimestamp() })); };
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
      }),
      // q: { since: Date (on field ts), limit: n }, newest first
      recent: (p, q) => ({
        onSnapshot: (next, err) => onSnapshot(query(collection(fs, p), where('ts', '>=', q.since), orderBy('ts', 'desc'), limit(q.limit || 2000)), { includeMetadataChanges: true }, s => next({ docs: s.docs.map(snapDoc), metadata: s.metadata }), e => err && err(norm(e)))
      })
    },
    // ops: [{ path, data } | { path, del: true }]; log: { path, data } saved in the same step
    commit: (ops, log) => { const b = writeBatch(fs); logged(b, log); for(const o of ops){ if(o.del) b.delete(doc(fs, o.path)); else if(o.merge) b.set(doc(fs, o.path), o.data, { merge:true }); else b.set(doc(fs, o.path), o.data); } return wrap(b.commit()); },
    // makeLog(n) returns the log entry for each group of up to 100 records; each record gets its logId
    batchSet: async (entries, onProgress, makeLog) => {
      for(let i = 0; i < entries.length; i += 100){
        const b = writeBatch(fs), part = entries.slice(i, i + 100), log = makeLog ? makeLog(part.length) : null;
        logged(b, log);
        for(const [path, data] of part) b.set(doc(fs, path), log ? Object.assign({}, data, { logId: log.id }) : data);
        await wrap(b.commit());
        if(onProgress) onProgress(Math.min(entries.length, i + 100), entries.length);
      }
    }
  };
  window.dispatchEvent(new Event('jb-ready'));
}
