const V='zc-v26',ASSETS=['/','/index.html','/style.css','/app.js','/season.js','/mp.js','/market.js','/lib.js','/zc.js','/zc.css','/mercado.html','/pwa.js','/criterios.html','/historico.html','/manifest.webmanifest','/favicon.png','/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))));self.clients.claim();});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return; // API sempre da rede
 // estáticos: rede primeiro (pega atualizações), cache como fallback offline
 const nav=e.request.mode==='navigate';
 const fb=()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||(nav?caches.match('/index.html'):undefined));
 // rede primeiro; se o servidor responder erro (502/503 no reinício do Render) ou cair, usa o cache. Nunca entrega HTML no lugar de JS.
 e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(V).then(x=>x.put(e.request,c));return r}return fb().then(c=>c||r)}).catch(()=>fb().then(c=>c||Response.error())));});
