import { chromium } from 'playwright';
const API='http://127.0.0.1:54321', MAIL='http://127.0.0.1:54324';
const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
async function signIn(email){
  await fetch(`${MAIL}/api/v1/messages`,{method:'DELETE'});
  await fetch(`${API}/auth/v1/otp`,{method:'POST',headers:{apikey:ANON,'Content-Type':'application/json'},body:JSON.stringify({email,create_user:false})});
  let code=null;
  for(let i=0;i<30&&!code;i++){await new Promise(r=>setTimeout(r,500));
    const l=await (await fetch(`${MAIL}/api/v1/messages?limit=1`)).json(); const id=l.messages?.[0]?.ID; if(!id)continue;
    const m=await (await fetch(`${MAIL}/api/v1/message/${id}`)).json();
    code=`${m.Text??''}${m.HTML??''}`.match(/\b(\d{6})\b/)?.[1]??null;}
  return await (await fetch(`${API}/auth/v1/verify`,{method:'POST',headers:{apikey:ANON,'Content-Type':'application/json'},body:JSON.stringify({email,token:code,type:'email'})})).json();
}
const b=await chromium.launch();
const p=await (await b.newContext({viewport:{width:390,height:844}})).newPage();
const errs=[];
p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
p.on('pageerror',e=>errs.push('PAGEERROR '+e));
p.on('response',async r=>{ if(r.status()>=400) errs.push(`HTTP ${r.status()} ${r.url().slice(0,120)} :: ${(await r.text().catch(()=>'')).slice(0,200)}`)});
const s=await signIn('runner7@mvmnt.test');
await p.goto('http://127.0.0.1:8081');
await p.evaluate(x=>localStorage.setItem('sb-127-auth-token',JSON.stringify(x)),s);
await p.goto('http://127.0.0.1:8081/leaderboard',{waitUntil:'networkidle'});
await p.waitForTimeout(2000);
// switch to This month
const tab = p.getByText('This month', {exact:true});
if(await tab.isVisible().catch(()=>false)){ await tab.click(); await p.waitForTimeout(2500); }
console.log('--- errors ---'); console.log(errs.length?errs.join('\n'):'none');
console.log('--- visible error text ---');
console.log(await p.getByText('Something went wrong').isVisible().catch(()=>false));
