const V='zc-v1',ASSETS=['/','/index.html','/style.css','/app.js','/season.js','/mp.js','/market.js','/lib.js','/zc.js','/zc.css','/mercado.html','/pwa.js','/criterios.html','/historico.html','/manifest.webmanifest','/favicon.png','/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))));self.clients.claim();});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return; // API sempre da rede
 // estáticos: rede primeiro (pega atualizações), cache como fallback offline
 e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(V).then(x=>x.put(e.request,c));}return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/index.html'))));});
