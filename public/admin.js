'use strict';
const loginScreen=document.querySelector('#login-screen');
const dashboard=document.querySelector('#dashboard');
const loginForm=document.querySelector('#login-form');
const loginError=document.querySelector('#login-error');
const list=document.querySelector('#orders-list');
const detail=document.querySelector('#order-detail');
const toast=document.querySelector('#toast');
const filters={ search:document.querySelector('#search'), dev:document.querySelector('#filter-dev'), status:document.querySelector('#filter-status') };
let allOrders=[];let selectedCode=null;let lastImageURL=null;let toastTimer;
function notification(msg){toast.textContent=msg;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),3500);}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function date(s){return new Date(s).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});}
function label(s){return ({novo:'Recebido',andamento:'Em andamento',concluido:'Concluído'})[s]||s;}
async function api(url, options={}){const r=await fetch(url,{credentials:'same-origin',...options});let data;try{data=await r.json();}catch{data={};}if(!r.ok){if(r.status===401){loginScreen.hidden=false;dashboard.hidden=true;}throw new Error(data.error||`Erro HTTP ${r.status}`);}return data;}
function json(method,body){return{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};}
async function check(){try{const auth=await api('/api/admin/me');loginScreen.hidden=auth.authenticated;dashboard.hidden=!auth.authenticated;if(auth.authenticated)await loadOrders();}catch{loginScreen.hidden=false;dashboard.hidden=true;}}
check();
loginForm.addEventListener('submit',async(e)=>{
  e.preventDefault();loginError.hidden=true;const button=document.querySelector('#login-submit');button.disabled=true;button.textContent='Validando acesso...';
  try{await api('/api/admin/login',json('POST',{password:document.querySelector('#admin-password').value}));document.querySelector('#admin-password').value='';loginScreen.hidden=true;dashboard.hidden=false;await loadOrders();}
  catch(err){loginError.textContent=err.message;loginError.hidden=false;}
  finally{button.disabled=false;button.textContent='Acessar painel ↗';}
});
document.querySelector('#logout').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST'});}catch{}selectedCode=null;loginScreen.hidden=false;dashboard.hidden=true;});
document.querySelector('#refresh').addEventListener('click',loadOrders);
Object.values(filters).forEach(el=>el.addEventListener('input',renderList));
function renderMetrics(){document.querySelector('#stat-total').textContent=allOrders.length;for(const [id,status] of [['#stat-new','novo'],['#stat-progress','andamento'],['#stat-done','concluido']])document.querySelector(id).textContent=allOrders.filter(o=>o.status===status).length;}
async function loadOrders(){try{const data=await api('/api/admin/orders');allOrders=data.orders;renderMetrics();renderList();if(selectedCode&&allOrders.some(o=>o.code===selectedCode))await selectOrder(selectedCode);else if(selectedCode){selectedCode=null;detail.innerHTML='<div class="empty-detail"><span>⌕</span><h3>Selecione um pedido</h3></div>';}}catch(e){notification(e.message);}}
function renderList(){
  const q=filters.search.value.trim().toLocaleLowerCase('pt-BR');
  const filtered=allOrders.filter(o=>(!filters.dev.value||filters.dev.value===o.developer)&&(!filters.status.value||filters.status.value===o.status)&&(!q||[o.code,o.title,o.discord,o.ideaPreview].some(x=>String(x||'').toLocaleLowerCase('pt-BR').includes(q))));
  list.replaceChildren();
  if(!filtered.length){const empty=document.createElement('p');empty.className='no-orders';empty.textContent='Nenhuma solicitação encontrada.';list.appendChild(empty);return;}
  for(const item of filtered){
    const el=document.createElement('button');el.type='button';el.className=`order-list-item${item.code===selectedCode?' active':''}`;
    el.innerHTML=`<div class="order-row-top"><b>${esc(item.code)}</b><span class="status-pill ${esc(item.status)}">${esc(label(item.status))}</span></div><p>${esc(item.title||'Projeto sem título')}</p><div class="snippet">${esc(item.ideaPreview||'')}</div><footer><span>${esc(item.developer)} ${item.hasImage?' • 📎':''}</span><span>${esc(date(item.createdAt))}</span></footer>`;
    el.addEventListener('click',()=>selectOrder(item.code));list.appendChild(el);
  }
}
async function selectOrder(code){
  selectedCode=code;renderList();if(lastImageURL){URL.revokeObjectURL(lastImageURL);lastImageURL=null;}
  detail.innerHTML='<div class="empty-detail"><span>⋯</span><h3>Carregando pedido...</h3></div>';
  try{
    const {order:o}=await api(`/api/admin/orders/${encodeURIComponent(code)}`);
    detail.innerHTML=`<div class="detail-title"><div><small>PROTOCOLO / ${esc(o.code)}</small><h2>${esc(o.title||'Solicitação de mapa')}</h2></div><span class="status-pill ${esc(o.status)}">${esc(label(o.status))}</span></div>
      <div class="detail-grid"><div class="detail-cell"><small>DESENVOLVEDOR</small><strong>${esc(o.developer)}</strong></div><div class="detail-cell"><small>USUÁRIO NO DISCORD</small><strong>${esc(o.discord)}</strong></div><div class="detail-cell"><small>CRIADO EM</small><strong>${esc(date(o.createdAt))}</strong></div><div class="detail-cell"><small>ATUALIZADO EM</small><strong>${esc(date(o.updatedAt))}</strong></div></div>
      <section class="detail-section"><h3>Descrição da ideia</h3><div class="detail-description">${esc(o.idea)}</div></section>
      <section class="detail-section"><h3>Imagem de referência</h3><div id="detail-attachment">${o.image?'Carregando anexo...':'<div class="no-image">Nenhuma imagem anexada.</div>'}</div></section>
      <div class="admin-actions"><select id="set-status" aria-label="Status"><option value="novo" ${o.status==='novo'?'selected':''}>Recebido</option><option value="andamento" ${o.status==='andamento'?'selected':''}>Em andamento</option><option value="concluido" ${o.status==='concluido'?'selected':''}>Concluído</option></select><button id="save-status" class="btn btn-primary btn-small">Salvar status</button><button id="remove-order" class="danger-button">Excluir</button></div>`;
    detail.querySelector('#save-status').addEventListener('click',async()=>{try{await api(`/api/admin/orders/${encodeURIComponent(code)}/status`,json('PATCH',{status:detail.querySelector('#set-status').value}));notification('Status atualizado.');await loadOrders();}catch(e){notification(e.message);}});
    detail.querySelector('#remove-order').addEventListener('click',async()=>{
      if(!window.confirm(`Excluir DEFINITIVAMENTE o pedido ${code} e seu anexo?`))return;
      try{await api(`/api/admin/orders/${encodeURIComponent(code)}`,{method:'DELETE'});selectedCode=null;detail.innerHTML='<div class="empty-detail"><span>✓</span><h3>Pedido excluído</h3></div>';notification('Pedido excluído com sucesso.');await loadOrders();}catch(e){notification(e.message);}
    });
    if(o.image){
      try{const r=await fetch(`/api/admin/orders/${encodeURIComponent(code)}/image`,{credentials:'same-origin'});if(!r.ok)throw new Error('Não foi possível abrir o anexo.');const blob=await r.blob();if(selectedCode!==code)return;lastImageURL=URL.createObjectURL(blob);const area=detail.querySelector('#detail-attachment');if(area){area.replaceChildren();const img=document.createElement('img');img.src=lastImageURL;img.className='detail-image';img.alt='Imagem de referência enviada pelo cliente';const link=document.createElement('a');link.href=lastImageURL;link.download=`${code}.${o.image.ext}`;link.className='detail-image-link';link.textContent='Baixar imagem original ↗';area.append(img,link);}}
      catch(e){const area=detail.querySelector('#detail-attachment');if(area)area.textContent=e.message;}
    }
  }catch(e){notification(e.message);}
}
