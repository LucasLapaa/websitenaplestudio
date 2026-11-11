import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naples-portal-test-'));
const port = 43000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], { cwd:root, env:{ ...process.env, DATA_DIR:dir, PORT:String(port), ADMIN_PASSWORD:'TESTE_SENHA_MODERACAO_SEGURA_123456', DISCORD_WEBHOOK_URL:'' }, stdio:['ignore','pipe','pipe'] });
let output='';child.stdout.on('data',c=>{output+=c.toString();});child.stderr.on('data',c=>{output+=c.toString();});

async function waitUp(){for(let i=0;i<70;i++){try{const r=await fetch(`${base}/health`);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,70));}throw new Error(`Servidor não iniciou: ${output}`);}
async function json(route, method, body, cookie=''){const r=await fetch(`${base}${route}`,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});return {r,data:await r.json()};}

await test('Fluxo real do cliente e moderação',async()=>{
  await waitUp();
  try {
    const landing=await fetch(base);assert.equal(landing.status,200);assert.match(await landing.text(),/DEV NAPLES/);
    const adminPage=await fetch(base+'/admin');assert.equal(adminPage.status,200);assert.match(await adminPage.text(),/Acesso/);
    const config=await (await fetch(base+'/api/config')).json();assert.equal(config.discordTicketUrl,'');
    const blocked=await fetch(base+'/api/admin/orders');assert.equal(blocked.status,401);
    const invalid=await json('/api/requests','POST',{ developer:'DEV INVÁLIDO',discord:'abc',idea:'uma descrição muito completa suficiente para passar no teste',accepted:true });assert.equal(invalid.r.status,400);
    const tinyPNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==';
    const newRequest=await json('/api/requests','POST',{developer:'BRADOCK',discord:'cliente_teste',title:'Baile do teste',idea:'Mapa de baile com palco, camarotes e um grande paredão iluminado.',accepted:true,image:{mime:'image/png',base64:tinyPNG}});
    assert.equal(newRequest.r.status,201);assert.match(newRequest.data.code,/^NPL-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const code=newRequest.data.code;
    assert.equal(fs.existsSync(path.join(dir,'pedidos',`${code}.json`)),true);
    assert.equal((await fetch(`${base}/api/admin/orders/${code}/image`)).status,401);
    const wrong=await json('/api/admin/login','POST',{password:'senha_incorreta_teste'});assert.equal(wrong.r.status,401);
    const correct=await json('/api/admin/login','POST',{password:'TESTE_SENHA_MODERACAO_SEGURA_123456'});assert.equal(correct.r.status,200);
    const cookie=correct.r.headers.get('set-cookie').split(';')[0];assert.match(cookie,/naples_admin/);
    const list=await fetch(`${base}/api/admin/orders`,{headers:{cookie}});assert.equal(list.status,200);assert.equal((await list.json()).orders.length,1);
    const details=await fetch(`${base}/api/admin/orders/${code}`,{headers:{cookie}});const detail=await details.json();assert.equal(detail.order.discord,'cliente_teste');assert.equal(detail.order.developer,'BRADOCK');assert.equal(detail.order.image.mime,'image/png');
    const img=await fetch(`${base}/api/admin/orders/${code}/image`,{headers:{cookie}});assert.equal(img.status,200);assert.equal(img.headers.get('content-type'),'image/png');
    const update=await json(`/api/admin/orders/${code}/status`,'PATCH',{status:'andamento'},cookie);assert.equal(update.r.status,200);
    const updated=await (await fetch(`${base}/api/admin/orders/${code}`,{headers:{cookie}})).json();assert.equal(updated.order.status,'andamento');
    const deletion=await fetch(`${base}/api/admin/orders/${code}`,{method:'DELETE',headers:{cookie}});assert.equal(deletion.status,200);assert.equal(fs.existsSync(path.join(dir,'pedidos',`${code}.json`)),false);
    const logout=await fetch(`${base}/api/admin/logout`,{method:'POST',headers:{cookie}});assert.equal(logout.status,200);
    assert.equal((await fetch(`${base}/api/admin/orders`,{headers:{cookie}})).status,401);
  } finally {child.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true});}
});
