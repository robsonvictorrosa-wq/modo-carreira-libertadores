// Etapa 2: login, salas, lobby, minha carreira
let ME=null,ROOM=localStorage.room||'',RS=null,poll=null;
const H=()=>({'Content-Type':'application/json',...(localStorage.token?{Authorization:'Bearer '+localStorage.token}:{})});
const zSleep=ms=>new Promise(r=>setTimeout(r,ms));
/* fetch com nova tentativa (backoff) quando o Render está reiniciando (502/503/504) ou a rede oscila */
async function zFetch(u,o,tries){tries=tries||4;let last;for(let i=0;i<tries;i++){try{const r=await fetch(u,o);if([502,503,504].includes(r.status)&&i<tries-1){await zSleep(800*2**i);continue}return r}catch(e){last=e;if(i<tries-1)await zSleep(800*2**i)}}const e=new Error('Sem conexão com o servidor. Tente de novo em alguns segundos.');e.zNet=1;e.cause=last;throw e}
async function zJson(r){let j=null;try{j=await r.json()}catch(e){if(r.ok)throw Object.assign(new Error('Resposta inválida do servidor'),{zNet:1});}
 if(r.status===401)ME=null;if(!r.ok){const e=new Error((j&&j.error)||([502,503,504].includes(r.status)?'Servidor reiniciando. Tente de novo em alguns segundos.':'Erro '+r.status));if(r.status>=500)e.zNet=1;e.status=r.status;throw e}return j}
const post=(u,b)=>zFetch('/api'+u,{method:'POST',headers:H(),body:JSON.stringify(b||{})},/\/auth\//.test(u)?2:3).then(zJson);
const get=u=>zFetch('/api'+u,{headers:H()}).then(zJson);
async function whoami(){try{const j=await get('/me');ME=j.user;$('#who').textContent='👤 '+ME.nick;return j;}catch(e){if(e.zNet)throw e;ME=null;$('#who').textContent='';return null;}}
function loginView(next){app.innerHTML=`<h1>Entrar</h1><div class="sub">Crie um apelido e um PIN (mín. 4 dígitos/caracteres). Use o mesmo para entrar depois em qualquer aparelho.</div>
 <div class="form"><input id="nk" placeholder="Apelido" autocomplete="username"><input id="pn" type="password" placeholder="PIN / senha" autocomplete="current-password">
 <button class="btn" id="bl">Entrar</button><button class="btn sec" id="br">Criar conta</button><div class="err" id="er"></div></div>`;
 const go=async ep=>{try{const j=await post('/auth/'+ep,{nick:$('#nk').value,pin:$('#pn').value});localStorage.token=j.token;await whoami();next();}catch(e){$('#er').textContent=e.message}};
 $('#bl').onclick=()=>go('login');$('#br').onclick=()=>go('register');}
const need=async f=>{if(!ME&&!(await whoami()))return loginView(f);f();};
async function salas(){const j=await whoami();if(!j)return loginView(salas);
 app.innerHTML=`<h1>Salas</h1><div class="sub">Olá, ${esc(ME.nick)}! Crie uma sala e mande o código pros amigos, ou entre com um código.</div>
 <div class="grid"><div class="card" style="cursor:default"><div class="t">Criar sala</div><div class="form" style="margin-top:10px"><input id="rn" placeholder="Nome da sala (ex.: Liga dos Amigos)"><select id="rm">${[2,3,4,5,6,8,10,12,16,20].map(n=>`<option ${n==5?'selected':''}>${n}</option>`)}</select><button class="btn" id="bc">Criar</button></div></div>
 <div class="card" style="cursor:default"><div class="t">Entrar com código</div><div class="form" style="margin-top:10px"><input id="rc" placeholder="Código (ex.: K7P2QX)" style="text-transform:uppercase"><button class="btn" id="bj">Entrar</button></div></div></div><div class="err" id="er"></div>
 <h2>Minhas salas</h2><div class="grid">${j.rooms.map(r=>`<a class="card" href="#/sala/${r.code}"><div class="t">${esc(r.name)}</div><div class="m"><span class="code" style="font-size:15px">${r.code}</span><span>${r.n}/${r.max_managers} técnicos</span></div><div class="m">${r.club_id?'Clube escolhido ✅':'Escolha seu clube ⚠️'}</div></a>`).join('')||'<div class="sub">Nenhuma ainda.</div>'}</div>
 <div style="margin-top:20px"><button class="btn sec" onclick="post('/auth/logout').then(()=>{localStorage.removeItem('token');ME=null;location.hash='#/salas';route()})">Sair</button></div>`;
 $('#bc').onclick=()=>post('/rooms',{name:$('#rn').value,max_managers:$('#rm').value}).then(r=>location.hash='#/sala/'+r.code).catch(e=>$('#er').textContent=e.message);
 $('#bj').onclick=()=>post('/rooms/join',{code:$('#rc').value}).then(r=>location.hash='#/sala/'+r.code).catch(e=>$('#er').textContent=e.message);}
async function sala(code){if(!ME&&!(await whoami()))return loginView(()=>sala(code));ROOM=localStorage.room=code;
 const draw=d=>{RS=d;const mine=d.managers.find(m=>m.user_id===d.me);app.innerHTML=`<a class="back" href="#/salas">← Salas</a><h1>${esc(d.name)}</h1>
  <div class="banner"><div>Código de convite: <span class="code">${d.code}</span></div><button class="btn sec" onclick="navigator.clipboard?.writeText(location.origin+'/#/entrar/${d.code}');this.textContent='Link copiado!'">Copiar link de convite</button></div>
  <div class="kpis"><div class="kpi"><span>Técnicos</span><b>${d.managers.length}/${d.max_managers}</b></div><div class="kpi"><span>Temporada</span><b>${d.season}/${d.season+1}</b></div><div class="kpi"><span>Status</span><b>${d.status==='lobby'?'Lobby':d.status}</b></div></div>
  <a class="btn" href="#/temporada">🏆 Temporada</a> <a class="btn" href="#/mercado">💸 Mercado</a> ${mine.club?`<a class="btn" href="#/carreira">Minha carreira: ${esc(mine.club.name)} →</a>`:`<a class="btn" href="#/clubes">⚽ Escolher meu clube (um dos 40)</a>`}
  ${d.owner_id===d.me?` <select id="mx" class="btn sec">${[2,3,4,5,6,8,10,12,16,20].map(n=>`<option ${n==d.max_managers?'selected':''}>${n}</option>`)}</select> <span class="sub">limite de técnicos</span>`:''}
  <h2>Técnicos</h2><div class="grid">${d.managers.map(m=>`<div class="card mgr" style="cursor:default"><div><div class="t">${esc(m.nick)}${m.user_id===d.owner_id?' 👑':''}${m.user_id===d.me?' (você)':''}</div><div class="m">${m.club?esc(m.club.name)+' · '+esc(m.club.league):'Escolhendo clube…'}</div></div>${m.club?ov(Math.round(m.club.overall)):''}</div>`).join('')}</div>
  <div class="sub" style="margin-top:10px">Os outros clubes da Libertadores ZC são controlados por bots (o mercado continua aberto ao mundo todo).</div>
  <h2>Atividade</h2>${d.events.map(e=>`<div class="ev">${new Date(e.created_at).toLocaleString('pt-BR',{timeStyle:'short',dateStyle:'short'})} · ${esc(e.text)}</div>`).join('')}`;
  const mx=$('#mx');if(mx)mx.onchange=()=>post(`/rooms/${code}/settings`,{max_managers:mx.value}).catch(e=>alert(e.message));};
 try{draw(await get('/rooms/'+code));}catch(e){app.innerHTML=`<div class="err">${esc(e.message)}</div><a class="btn" href="#/entrar/${code}">Entrar nesta sala</a>`;return;}
 poll=setInterval(async()=>{if(location.hash!=='#/sala/'+code)return;try{const d=await get(`/rooms/${code}?v=${RS.version}`);if(!d.unchanged)draw(d);}catch{}},3000);}
async function entrar(code){if(!ME&&!(await whoami()))return loginView(()=>entrar(code));post('/rooms/join',{code}).then(r=>location.hash='#/sala/'+r.code).catch(e=>app.innerHTML=`<div class="err">${esc(e.message)}</div>`);}
async function carreira(){if(!ME&&!(await whoami()))return loginView(carreira);if(!ROOM)return location.hash='#/salas';
 let d;try{d=await get(`/rooms/${ROOM}/career`);}catch(e){return location.hash='#/salas';}
 if(!d.club){app.innerHTML=`<h1>${esc(d.room.name)}</h1><div class="sub">Você ainda não escolheu um clube.</div><a class="btn" href="#/">Escolher clube</a>`;return;}
 const c=d.club;squad=c.players;sortK='overall';sortD=-1;
 app.innerHTML=`<a class="back" href="#/sala/${ROOM}">← Sala ${esc(d.room.name)}</a><h1>${esc(c.name)} <span class="tag">${esc(c.league)}</span></h1><div class="sub">Técnico: ${esc(ME.nick)} · Temporada ${d.room.season}/${d.room.season+1}</div>
 <div class="kpis"><div class="kpi"><span>Orçamento de transferências</span><b>${fm(c.budget)}</b></div><div class="kpi"><span>Folha atual</span><b>${fm(c.wage_bill)}</b></div><div class="kpi"><span>Valor do elenco</span><b>${fm(c.squad_value)}</b></div><div class="kpi"><span>OVR (top 11)</span><b>${c.overall}</b></div></div><div class="tw"><table id="sq"></table></div>`;drawSquad();}
// botão de escolher clube na página do clube / lista
window.pick=id=>post(`/rooms/${ROOM}/club`,{club_id:id}).then(()=>location.hash='#/sala/'+ROOM).catch(e=>alert(e.message));
async function roomBanner(clubId){if(!ROOM||!localStorage.token)return '';try{RS=await get('/rooms/'+ROOM);}catch{return '';}
 const owner=RS.managers.find(m=>m.club_id===clubId);const mine=RS.managers.find(m=>m.user_id===RS.me);
 return `<div class="banner"><span>Sala <b>${esc(RS.name)}</b>${clubId?owner?` · técnico: <b>${esc(owner.nick)}</b>`:' · clube controlado por bot':' · escolha um clube'}</span>${clubId&&!owner&&RS.status==='lobby'?`<button class="btn" onclick="pick(${clubId})">${mine.club?'Trocar para este clube':'Assumir este clube'}</button>`:''}</div>`;}
addEventListener('hashchange',()=>route());whoami().catch(e=>{console.error(e)}).then(()=>route());
