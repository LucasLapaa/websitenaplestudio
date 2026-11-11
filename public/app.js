'use strict';
const form = document.querySelector('#request-form');
const fileInput = document.querySelector('#image');
const preview = document.querySelector('#image-preview');
const errorBox = document.querySelector('#form-error');
const toastNode = document.querySelector('#toast');
const submitButton = document.querySelector('#submit-btn');
const selectedDevs = document.querySelectorAll('input[name="developer"]');
const ticketButton = document.querySelector('#open-discord');
let submitResult = null;
let ticketUrl = '';
let toastTimer;

async function loadConfig(){try{const r=await fetch('/api/config');if(r.ok){const c=await r.json();ticketUrl=c.discordTicketUrl||'';}}catch{}}
loadConfig();
function notify(text){toastNode.textContent=text;toastNode.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastNode.classList.remove('show'),3600);}
function setError(text){errorBox.textContent=text;errorBox.hidden=!text;}
function previewFile(file){
  preview.replaceChildren();
  if(!file){preview.hidden=true;document.querySelector('#upload-title').textContent='Clique ou arraste sua imagem aqui';document.querySelector('#upload-subtitle').textContent='PNG, JPG ou WEBP • até 5 MB';return;}
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setError('Selecione uma imagem PNG, JPG ou WEBP.');fileInput.value='';previewFile(null);return;}
  if(file.size>5*1024*1024){setError('A imagem deve ter no máximo 5 MB.');fileInput.value='';previewFile(null);return;}
  setError('');
  const img=document.createElement('img');const url=URL.createObjectURL(file);img.src=url;img.alt='Prévia do anexo';img.onload=()=>URL.revokeObjectURL(url);
  const name=document.createElement('span');name.textContent=`${file.name} • ${(file.size/1024/1024).toFixed(2)} MB`;
  const remove=document.createElement('button');remove.type='button';remove.textContent='Remover';remove.addEventListener('click',()=>{fileInput.value='';previewFile(null);});
  preview.append(img,name,remove);preview.hidden=false;
  document.querySelector('#upload-title').textContent='Imagem selecionada';
  document.querySelector('#upload-subtitle').textContent='Pronta para enviar com seu pedido';
}
fileInput.addEventListener('change',()=>previewFile(fileInput.files?.[0]));
const dropzone=document.querySelector('#upload-zone');
for(const event of ['dragenter','dragover'])dropzone.addEventListener(event,e=>{e.preventDefault();dropzone.classList.add('dragover');});
for(const event of ['dragleave','drop'])dropzone.addEventListener(event,e=>{e.preventDefault();dropzone.classList.remove('dragover');});
dropzone.addEventListener('drop',e=>{const files=e.dataTransfer.files;if(files.length){fileInput.files=files;previewFile(files[0]);}});
document.querySelector('#idea').addEventListener('input',e=>{document.querySelector('#char-counter').textContent=`${e.target.value.length} / 4000`;});

function toBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});}
form.addEventListener('submit', async (event)=>{
  event.preventDefault();setError('');
  const developer=[...selectedDevs].find(d=>d.checked)?.value;
  const discord=document.querySelector('#discord').value.trim();
  const title=document.querySelector('#title').value.trim();
  const idea=document.querySelector('#idea').value.trim();
  const accepted=document.querySelector('#consent').checked;
  if(!developer)return setError('Selecione DEV NAPLES ou BRADOCK.');
  if(!discord)return setError('Digite seu nome de usuário no Discord.');
  if(idea.length<20)return setError('Conte sua ideia com pelo menos 20 caracteres.');
  if(!accepted)return setError('Você precisa autorizar o envio da solicitação.');
  const file=fileInput.files?.[0];
  if(file&&(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024))return setError('Anexe uma imagem PNG, JPG ou WEBP de até 5 MB.');
  submitButton.disabled=true;submitButton.textContent='Registrando sua solicitação...';
  try{
    const image=file?{mime:file.type,base64:await toBase64(file)}:null;
    const r=await fetch('/api/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({developer,discord,title,idea,accepted,image})});
    const data=await r.json();if(!r.ok)throw new Error(data.error||'Não foi possível registrar o pedido.');
    submitResult={...data,discord};
    document.querySelector('#request-form-wrap').hidden=true;
    document.querySelector('#success-panel').hidden=false;
    document.querySelector('#success-code').textContent=data.code;
    document.querySelector('#success-dev').textContent=`Desenvolvedor escolhido: ${data.developer}`;
    ticketButton.hidden=!ticketUrl;
    document.querySelector('#success-panel').scrollIntoView({behavior:'smooth',block:'center'});
    notify('Pedido registrado com sucesso!');
  }catch(e){setError(e.message||'Erro ao enviar. Tente novamente.');}
  finally{submitButton.disabled=false;submitButton.textContent='Gerar meu código exclusivo →';}
});
function ticketText(){return `🎫 NAPLES COMMUNITY — SOLICITAÇÃO DE MAPA\n\n🔐 Código: ${submitResult.code}\n👨‍💻 Desenvolvedor: ${submitResult.developer}\n👤 Discord: ${submitResult.discord}\n\nEnviei minha ideia e imagem pelo portal da Naples Community. Equipe: consultem o código no painel privado de moderação.`;}
async function copyTicket(){
  if(!submitResult)return false;
  try{await navigator.clipboard.writeText(ticketText());notify('Mensagem copiada! Cole no seu ticket do Discord.');return true;}
  catch{const field=document.createElement('textarea');field.value=ticketText();field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);field.select();const ok=document.execCommand('copy');field.remove();notify(ok?'Mensagem copiada!':'Não foi possível copiar automaticamente.');return ok;}
}
document.querySelector('#copy-message').addEventListener('click',copyTicket);
ticketButton.addEventListener('click',async()=>{await copyTicket();if(ticketUrl)window.open(ticketUrl,'_blank','noopener,noreferrer');});
document.querySelector('#new-request').addEventListener('click',()=>{
  form.reset();fileInput.value='';previewFile(null);setError('');document.querySelector('#char-counter').textContent='0 / 4000';document.querySelector('#success-panel').hidden=true;document.querySelector('#request-form-wrap').hidden=false;submitResult=null;document.querySelector('#solicitar').scrollIntoView({behavior:'smooth'});
});
