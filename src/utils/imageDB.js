const DB_NAME = "chatImagesDB";
const STORE = "images";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // CHỈ tạo nếu chưa tồn tại
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveImage(id, dataUrl) {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);

  store.put({ id, dataUrl });

  return new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

export async function loadImage(id) {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const req = store.get(id);

  return new Promise((res) => {
    req.onsuccess = () => {
      if (req.result) res(req.result.dataUrl);
      else res(null);
    };
    req.onerror = () => res(null);
  });
}