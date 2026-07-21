import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, onSnapshot, serverTimestamp, getDocs, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),$=id=>document.getElementById(id);
let user=null,p=null,s={},txs=[],withdrawals=[],notifications=[],captchaCode="",autoTimer=null;
const baseFee=1999, money=n=>"₹"+Number(n||0).toLocaleString("en-IN");
function toast(t){$("toast").textContent=t;$("toast").classList.remove("hidden");setTimeout(()=>$("toast").classList.add("hidden"),2500)}
function page(id){
 document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));
 $(id)?.classList.remove("hidden");
 sessionStorage.setItem("tp_page",id);
 setTimeout(()=>window.scrollTo(0,Number(sessionStorage.getItem("tp_scroll")||0)),0);
}
window.addEventListener("scroll",()=>sessionStorage.setItem("tp_scroll",String(window.scrollY)),{passive:true});
function restoreView(){
 const id=sessionStorage.getItem("tp_page")||"homePage";
 if($(id)) page(id); else page("homePage");
 setTimeout(()=>window.scrollTo(0,Number(sessionStorage.getItem("tp_scroll")||0)),50);
}
function norm(v){return String(v||"").trim().toLowerCase().replace(/\s+/g,"")}
function newCaptcha(){$("captcha").textContent=captchaCode=Math.random().toString(36).slice(2,8).toUpperCase()}


function bindAuthButtons(){
  const showRegisterBtn=$("showRegister");
  const showLoginBtn=$("showLogin");
  const supportBtn=$("authSupportBtn");

  showRegisterBtn?.addEventListener("click",(e)=>{
    e.preventDefault();
    $("loginBox")?.classList.add("hidden");
    $("registerBox")?.classList.remove("hidden");
    newCaptcha();
    window.scrollTo({top:0,behavior:"smooth"});
  });

  showLoginBtn?.addEventListener("click",(e)=>{
    e.preventDefault();
    $("registerBox")?.classList.add("hidden");
    $("loginBox")?.classList.remove("hidden");
    window.scrollTo({top:0,behavior:"smooth"});
  });

  supportBtn?.addEventListener("click",(e)=>{
    e.preventDefault();
    toast("Login के बाद configured support options उपलब्ध होंगे.");
  });
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",bindAuthButtons,{once:true});
}else{
  bindAuthButtons();
}

$("registerBtn").onclick=async()=>{
 try{
  const username=$("regUsername").value.trim(),email=$("regEmail").value.trim(),phone=$("regPhone").value.trim(),pw=$("regPassword").value,cp=$("regConfirm").value;
  if(!username||!email||!phone||!pw)throw Error("सभी required fields भरें.");
  if(pw!==cp)throw Error("Passwords match नहीं करते.");
  if($("regCaptcha").value.trim().toUpperCase()!==captchaCode)throw Error("Verification code गलत है.");
  if(!$("agreeTerms").checked)throw Error("Terms, Privacy और Refund Policy agree करें.");
  const unameId=norm(username),emailId=norm(email),phoneId=phone.replace(/\D/g,"");
  const refs=[doc(db,"uniqueUsernames",unameId),doc(db,"uniqueEmails",emailId),doc(db,"uniquePhones",phoneId)];
  // Firebase Auth account is created first, so Firestore uniqueness checks run as an authenticated user.
  const cred=await createUserWithEmailAndPassword(auth,email,pw);
  try{
   await runTransaction(db,async t=>{
    for(const r of refs){const snap=await t.get(r);if(snap.exists())throw Error("Username, email या phone पहले से registered है.");}
    const uid=cred.user.uid,userId="TP"+uid.slice(0,7).toUpperCase();
    t.set(refs[0],{uid,createdAt:serverTimestamp()});t.set(refs[1],{uid,createdAt:serverTimestamp()});t.set(refs[2],{uid,createdAt:serverTimestamp()});
    t.set(doc(db,"users",uid),{uid,userId,username,email,phone,createdAt:serverTimestamp(),paymentStatus:"not_submitted",activationVerified:false,accountStatus:"stopped",invalidUtrCount:0,penaltyTotal:0,isBlocked:false,mainSetup:{accountDetail:false,atmSetup:false,accountRun:false},fundSetups:{},balance:0,commission:0,bonusClaimed:false});
   });
  }catch(e){await cred.user.delete();throw e}
  await signOut(auth);$("showLogin").click();toast("Registration successful.");
 }catch(e){toast(e.message)}
};
$("loginBtn").onclick=async()=>{try{await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value)}catch(e){toast(e.message)}}
$("logoutBtn").onclick=()=>signOut(auth);

const funds={gaming:["Gaming Fund","🎮"],stock:["Stock Fund","📊"],mix:["Mix Fund","◕"],political:["Political Fund","🏛"],outside:["Outside Fund","🌐"]};
function pct(k){return s?.fundPercentages?.[k]??({gaming:15,stock:30,mix:25,political:40,outside:50}[k])}
function unlocked(){return !!(p?.activationVerified&&p?.accountStatus==="running"&&!p?.isBlocked)}
function payable(){return baseFee+Number(p?.penaltyTotal||0)}
function renderLocks(){
 document.querySelectorAll("[data-pct]").forEach(e=>e.textContent=pct(e.dataset.pct));
 document.querySelectorAll("#quickGrid [data-feature]").forEach(el=>{
  const f=el.dataset.feature,l=el.querySelector("[data-lock]");if(!l)return;
  if(f==="support"){l.textContent="Always Open";l.className="open"}
  else if(unlocked()){l.textContent="✓ Unlocked";l.className="open"}
  else{l.textContent="🔒 Locked";l.className="lock"}
 });
}
function renderSetup(){
 const m=p?.mainSetup||{},arr=[["Account Detail",m.accountDetail],["ATM Setup",m.atmSetup],["Account Run Setup",m.accountRun],["Account Running",unlocked()]];
 $("setupSteps").innerHTML=arr.map((x,i)=>`<div class="step"><div class="dot">${i+1}</div><b>${x[0]}</b><span class="badge ${x[1]?"done":(i===0||arr[i-1][1]?"pending":"locked")}">${x[1]?"Completed":(i===0||arr[i-1][1]?"Pending":"Locked")}</span></div>`).join("");
}
function renderSupport(){
 const sp=s.support||{},parts=[];if(sp.description)parts.push(`<div class="notice">${sp.description}</div>`);
 if(sp.phoneEnabled&&sp.phone)parts.push(`<p><a class="btn greenBtn full" href="tel:${sp.phone}">📞 Call: ${sp.phone}</a></p>`);
 if(sp.whatsappEnabled&&sp.whatsapp)parts.push(`<p><a class="btn greenBtn full" href="${sp.whatsapp}" target="_blank">💬 WhatsApp</a></p>`);
 const telegrams=Array.isArray(sp.telegrams)?sp.telegrams.filter(Boolean):[];
 telegrams.forEach((tg,i)=>parts.push(`<p><a class="btn soft full" href="${tg}" target="_blank">✈️ Telegram ${i+1}</a></p>`));
 if(!telegrams.length && sp.telegramEnabled&&sp.telegram)parts.push(`<p><a class="btn soft full" href="${sp.telegram}" target="_blank">✈️ Telegram</a></p>`);
 if(sp.emailEnabled&&sp.email)parts.push(`<p><a class="btn soft full" href="mailto:${sp.email}">✉️ ${sp.email}</a></p>`);
 $("supportButtons").innerHTML=parts.join("")||"<p>Support details अभी configure नहीं हैं.</p>";
}
function render(){
 if(!p)return;
 $("username").textContent=p.username||"";$("userId").textContent=p.userId||"";$("avatar").textContent=(p.username||"TP").slice(0,2).toUpperCase();
 const bonus=p.bonus??s.defaultBonus??2000;$("bonusAmount").textContent=$("bonusCardValue").textContent=money(bonus);
 $("payableAmount").textContent=$("paymentTotal").textContent=money(payable());$("penaltyText").textContent=`Penalty: ${money(p.penaltyTotal||0)} • Invalid attempts: ${p.invalidUtrCount||0}/4`;$("payNowBtn").textContent=`Pay ${money(payable())} Now`;
 $("paymentCard").classList.toggle("hidden",p.paymentStatus==="approved"||p.isBlocked);$("blockedCard").classList.toggle("hidden",!p.isBlocked);
 $("dashboardAfterPayment").classList.toggle("hidden",p.paymentStatus!=="approved"||p.isBlocked);
 $("totalBalance").textContent=money(availableWithdrawable());$("accountStatus").textContent=(p.accountStatus||"stopped").toUpperCase();
 $("profileData").innerHTML=`<p><b>${p.username||""}</b></p><p>User ID: ${p.userId||""}</p><p>${p.email||""}</p><p>${p.phone||""}</p>`;
 $("privacyContent").innerText=s.privacyPolicy||"Privacy Policy अभी Admin ने नहीं जोड़ी.";$("termsContent").innerText=s.terms||"Terms & Conditions अभी Admin ने नहीं जोड़े.";$("refundContent").innerText=s.refundPolicy||"Refund Policy अभी Admin ने नहीं जोड़ी.";
 $("assignedCode").textContent=p.activationCode||"Waiting...";
 const claimed=!!p.bonusClaimed,bonusBal=Number(p.bonusBalance||0);
 if($("bonusClaimMetric"))$("bonusClaimMetric").textContent=claimed?money(bonusBal):money(Number(s.defaultBonus||2000));
 if($("bonusClaimMetricBtn")){$("bonusClaimMetricBtn").textContent=claimed?"Auto Claimed":"Claim Bonus";$("bonusClaimMetricBtn").disabled=claimed||!unlocked();}
 const bonusLock=document.querySelector('[data-feature="bonus"] [data-lock]');
 if(bonusLock){bonusLock.textContent=claimed?`✓ Claimed ${money(bonusBal)}`:(unlocked()?"Claim Bonus":"🔒 Locked");bonusLock.className=claimed||unlocked()?"open":"lock"}
 $("withdrawEligible").textContent=`Eligible Withdrawable: ${money(Number(p.balance||0)+bonusBal)}`;
$("upiId").textContent=s.upiId||"Not configured";$("paymentInstructions").textContent=s.paymentInstructions||"";$("pendingMessage").textContent=s.pendingMessage||"Please wait. Admin will check your payment and give you activation code.";
 if(s.qrUrl){$("qrImg").src=s.qrUrl;$("qrImg").classList.remove("hidden")}else $("qrImg").classList.add("hidden");
 renderLocks();renderSetup();renderSupport();renderTransactions();
}

function realCommissionTotal(){
  return txs.filter(x=>x.kind==="commission")
            .reduce((a,b)=>a+Number(b.amount||0),0);
}
function grossEligibleWithdrawable(){
  return Number(p?.balance||0)+Number(p?.bonusBalance||0)+realCommissionTotal();
}
function reservedWithdrawals(){
  return withdrawals.filter(w=>w.status!=="rejected" && w.status!=="cancelled")
                    .reduce((a,b)=>a+Number(b.amount||0),0);
}
function availableWithdrawable(){
  return Math.max(0,grossEligibleWithdrawable()-reservedWithdrawals());
}
function renderWithdrawals(){
  if($("withdrawEligible"))$("withdrawEligible").textContent=`Eligible Withdrawable (after reserved withdrawals): ${money(availableWithdrawable())}`;
  if($("withdrawHistory")){
    $("withdrawHistory").innerHTML=withdrawals.length?withdrawals
      .slice().sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))
      .map(w=>`<div class="tx"><div class="txIcon debit">↓</div><div><b>Withdrawal</b><div class="small muted">${w.destination||""} • ${w.status||"pending"}</div></div><div class="txAmt debitText">- ${money(w.amount)}</div></div>`).join("")
      :"<p class='muted'>No withdrawal history.</p>";
  }
}
function renderTransactions(){
 const txHtml=txs.map(x=>`<div class="tx"><div class="txIcon ${x.kind}">${x.kind==="debit"?"↓":x.kind==="commission"?"★":"↑"}</div><div><b>${x.kind||x.category||"Transaction"}</b><div class="small muted">${x.fund||""}</div></div><div class="txAmt ${x.kind==="debit"?"debitText":x.kind==="commission"?"commissionText":"creditText"}">${x.kind==="debit"?"-":"+"} ${money(x.amount)}</div></div>`);
 const wdHtml=withdrawals.map(w=>`<div class="tx"><div class="txIcon debit">↓</div><div><b>Withdrawal</b><div class="small muted">${w.destination||""} • ${w.status||"pending"}</div></div><div class="txAmt debitText">- ${money(w.amount)}</div></div>`);
 $("txList").innerHTML=(txHtml.length||wdHtml.length)?[...txHtml,...wdHtml].join(""):"<p class='muted'>No transactions yet.</p>";
 const com=txs.filter(x=>x.kind==="commission").reduce((a,b)=>a+Number(b.amount||0),0);
 const activityBalance=txs.reduce((sum,x)=>sum+(x.kind==="debit"?-Number(x.amount||0):x.kind==="credit"?Number(x.amount||0):0),0);
 $("totalCommission").textContent=money(com);$("totalTransactions").textContent=txs.length+withdrawals.length;
 if($("activityBalance"))$("activityBalance").textContent=money(activityBalance);
 $("totalBalance").textContent=money(availableWithdrawable());
 $("commissionList").innerHTML=`<h1>${money(com)}</h1><p class="small muted">Commission is included in the eligible withdrawable balance.</p>`;
 renderWithdrawals();
}
$("payNowBtn").onclick=()=>page("paymentPage");
$("submitPaymentBtn").onclick=async()=>{
 try{
  if(p.isBlocked)throw Error("Account blocked है.");
  const raw=$("utrInput").value.trim(),utr=raw.toUpperCase().replace(/[^A-Z0-9]/g,"");if(utr.length<6)throw Error("Valid UTR / Transaction ID डालें.");
  const utrRef=doc(db,"usedUtrs",utr);
  await runTransaction(db,async t=>{
   const used=await t.get(utrRef);if(used.exists())throw Error("यह UTR / Transaction ID पहले use हो चुका है.");
   const pendingQ=query(collection(db,"activationRequests"),where("uid","==",user.uid),where("status","==","pending"));
   const pending=await getDocs(pendingQ);if(!pending.empty)throw Error("एक payment request पहले से pending है.");
   const reqRef=doc(collection(db,"activationRequests"));
   t.set(utrRef,{uid:user.uid,requestId:reqRef.id,createdAt:serverTimestamp()});
   t.set(reqRef,{uid:user.uid,userId:p.userId,username:p.username,utr,amount:payable(),baseFee,penaltyTotal:Number(p.penaltyTotal||0),status:"pending",createdAt:serverTimestamp()});
   t.update(doc(db,"users",user.uid),{paymentStatus:"pending"});
  });
  $("utrInput").value="";page("pendingPage");toast("Payment submitted.");
 }catch(e){toast(e.message)}
};
$("verifyActivationBtn").onclick=async()=>{
 try{
  const code=$("activationInput").value.trim().toUpperCase();if(!code)throw Error("Activation code डालें.");
  await runTransaction(db,async t=>{
   const cr=doc(db,"activationCodes",code),ur=doc(db,"users",user.uid),cs=await t.get(cr),us=await t.get(ur);
   if(!cs.exists())throw Error("Invalid activation code.");const c=cs.data(),u=us.data();
   if(c.assignedUid!==user.uid||c.revoked||c.status!=="active"||u.paymentStatus!=="approved")throw Error("Code valid नहीं है.");
   t.update(cr,{status:"used",usedAt:serverTimestamp()});
   const bonusAmount=Number(s.defaultBonus||2000);
   t.update(ur,{
     activationVerified:true,
     activatedAt:serverTimestamp(),
     bonusClaimed:true,
     bonusBalance:bonusAmount,
     bonusClaimedAt:serverTimestamp()
   });
  });toast(`Activation verified. ${money(Number(s.defaultBonus||2000))} bonus auto-claimed.`);page("homePage")
 }catch(e){toast(e.message)}
};
$("continueSetupBtn").onclick=()=>{buildSetup();page("setupPage")};
function buildSetup(){
 const m=p.mainSetup||{};
 if(!m.accountDetail){$("setupForm").innerHTML=`<h3>1. Account Detail</h3><label>Account Holder Name</label><input id="aHolder"><label>Account Number</label><input id="aNo"><label>IFSC</label><input id="aIfsc"><label>Bank Name</label><input id="aBank"><label>Account Type</label><select id="aType"><option>Saving</option><option>Current</option><option>Corporate</option></select><label>UPI ID</label><input id="aUpi"><button id="saveAccount" class="btn primary full">Save & Continue</button>`;$("saveAccount").onclick=async()=>{await updateDoc(doc(db,"users",user.uid),{"mainSetup.accountDetail":true,bankDetails:{holder:$("aHolder").value,accountNumber:$("aNo").value,ifsc:$("aIfsc").value,bank:$("aBank").value,type:$("aType").value,upi:$("aUpi").value}});toast("Account Detail completed.");page("homePage")};return}
 if(!m.atmSetup){$("setupForm").innerHTML=`<h3>2. ATM Setup</h3><label>Card Holder</label><input id="cHolder"><label>Bank Name</label><input id="cBank"><label>Card Last 4 Digits</label><input id="cLast" maxlength="4"><label>Card Type</label><select id="cType"><option>Debit Card</option><option>Credit Card</option></select><div class="notice small">ATM PIN, CVV, OTP, UPI PIN या full card number कभी न डालें.</div><button id="saveAtm" class="btn primary full">Save & Continue</button>`;$("saveAtm").onclick=async()=>{await updateDoc(doc(db,"users",user.uid),{"mainSetup.atmSetup":true,atmSafe:{holder:$("cHolder").value,bank:$("cBank").value,last4:$("cLast").value,type:$("cType").value}});toast("ATM Setup completed.");page("homePage")};return}
 if(!m.accountRun){$("setupForm").innerHTML=`<h3>3. Account Run Setup</h3><p>Final setup complete करें.</p><button id="saveRun" class="btn primary full">Start Account</button>`;$("saveRun").onclick=async()=>{await updateDoc(doc(db,"users",user.uid),{"mainSetup.accountRun":true,accountStatus:"running",accountRunningAt:serverTimestamp()});toast("ACCOUNT RUNNING");page("homePage")};return}
 $("setupForm").innerHTML="<div class='notice'>All setup completed.</div>"
}
function openFund(k){
 if(!unlocked())return toast("यह option अभी locked है.");
 const d=p.fundSetups?.[k]||{},name=funds[k][0];
 if(!d.completed){$("fundContent").innerHTML=`<div class="card"><h2>${name} — ${pct(k)}%</h2><h3>Fund Account Setup</h3><label>Account Holder</label><input id="fHolder"><label>Account Number</label><input id="fNo"><label>Confirm Account Number</label><input id="fConfirm"><label>IFSC</label><input id="fIfsc"><label>Bank Name</label><input id="fBank"><label>Account Type</label><select id="fType"><option>Saving</option><option>Current</option><option>Corporate</option></select><label>Phone</label><input id="fPhone" value="${p.phone||""}"><label>UPI ID</label><input id="fUpi"><label>Card Last 4 Digits</label><input id="fLast" maxlength="4"><button class="btn primary full" id="saveFund">Save Fund Account</button></div>`;$("saveFund").onclick=async()=>{if($("fNo").value!==$("fConfirm").value)return toast("Account numbers match नहीं करते.");await updateDoc(doc(db,"users",user.uid),{[`fundSetups.${k}`]:{completed:true,holder:$("fHolder").value,accountNumber:$("fNo").value,ifsc:$("fIfsc").value,bank:$("fBank").value,type:$("fType").value,phone:$("fPhone").value,upi:$("fUpi").value,last4:$("fLast").value,completedAt:new Date().toISOString()}});toast(`${name} setup completed.`);page("homePage")};page("fundPage");return}
 const fundTx=txs.filter(x=>x.fund===k);
 $("fundContent").innerHTML=`<div class="card"><h2>${name} — ${pct(k)}%</h2><div class="notice" style="background:#ecfdf5;border-color:#bbf7d0;color:#166534">Account Setup Completed</div><h3>Fund Activity</h3>${fundTx.length?fundTx.map(x=>`<div class="tx"><div class="txIcon ${x.kind}">${x.kind==="debit"?"↓":x.kind==="commission"?"★":"↑"}</div><div><b>${x.kind}</b><div class="small muted">${name}</div></div><div class="txAmt ${x.kind==="debit"?"debitText":x.kind==="commission"?"commissionText":"creditText"}">${x.kind==="debit"?"-":"+"} ${money(x.amount)}</div></div>`).join(""):"<p class='muted'>No activity yet.</p>"}</div>`;page("fundPage")
}

async function claimBonus(){
 try{
  if(!unlocked())throw Error("Bonus claim के लिए account running होना चाहिए.");
  if(p.bonusClaimed)throw Error("Bonus पहले ही claim हो चुका है.");
  const amount=Number(s.defaultBonus||2000),ur=doc(db,"users",user.uid);
  await runTransaction(db,async t=>{
    const us=await t.get(ur),d=us.data();
    if(d.bonusClaimed)throw Error("Bonus पहले ही claim हो चुका है.");
    t.update(ur,{bonusClaimed:true,bonusBalance:amount,bonusClaimedAt:serverTimestamp()});
  });
  toast(`${money(amount)} bonus आपके eligible withdrawable balance में add हो गया.`);
 }catch(e){toast(e.message)}
}
$("bellBtn").onclick=()=>page("notificationsPage");
$("profileTopBtn").onclick=()=>page("profilePage");
$("bonusClaimMetricBtn").onclick=claimBonus;

document.addEventListener("click",e=>{
 const pbtn=e.target.closest("[data-page]");if(pbtn){page(pbtn.dataset.page);return}
 const fbtn=e.target.closest("[data-feature]");if(!fbtn)return;const f=fbtn.dataset.feature;
 if(f==="support"){page("supportPage");return}
 if(!unlocked()){
  if(f==="activate"&&p?.paymentStatus==="approved"&&!p?.activationVerified){page("activationPage");return}
  toast("यह option locked है. Payment, activation और account setup complete करें.");return
 }
 if(funds[f])return openFund(f);if(f==="transactions"||f==="activity")page("transactionsPage");else if(f==="commission")page("commissionPage");else if(f==="withdrawals")page("withdrawalPage");else if(f==="bonus")claimBonus();else if(f==="activate")page("homePage")
});
$("submitWithdrawalBtn").onclick=async()=>{try{if(!unlocked())throw Error("Account running होना चाहिए.");const amount=Number($("withdrawAmount").value),destination=$("withdrawDestination").value.trim();if(!amount||amount<=0||!destination)throw Error("Valid details भरें.");if(amount>availableWithdrawable())throw Error("Insufficient eligible balance.");await addDoc(collection(db,"withdrawals"),{uid:user.uid,userId:p.userId,username:p.username,amount,destination,status:"pending",createdAt:serverTimestamp()});toast("Withdrawal request submitted.")}catch(e){toast(e.message)}}
$("changePassword").onclick=async()=>{try{await sendPasswordResetEmail(auth,user.email);toast(`Password reset link ${user.email} पर भेजा गया.`)}catch(e){toast(e.message)}}


async function startAutoActivityAfterAccountSetup(){
  if(autoTimer){clearTimeout(autoTimer);autoTimer=null}
  if(!user || !p || p.isBlocked) return;

  // Only after full setup is RUNNING.
  const ready=!!(
    p.activationVerified &&
    p.accountStatus==="running" &&
    p.mainSetup?.accountDetail &&
    p.mainSetup?.atmSetup &&
    p.mainSetup?.accountRun
  );
  if(!ready) return;

  const rows=[
    {id:"1",kind:"credit",amount:5000,fund:"gaming"},
    {id:"2",kind:"commission",amount:750,fund:"gaming"},
    {id:"3",kind:"debit",amount:2500,fund:"gaming"},
    {id:"4",kind:"credit",amount:3200,fund:"stock"},
    {id:"5",kind:"commission",amount:480,fund:"stock"}
  ];

  // If all fixed rows exist, nothing to do.
  let missing=[];
  for(const row of rows){
    try{
      const ref=doc(db,"transactions",`auto_${user.uid}_${row.id}`);
      if(!(await getDoc(ref)).exists()) missing.push(row);
    }catch(e){
      console.warn("Activity existence check failed",e);
      missing.push(row);
    }
  }
  if(!missing.length){
    if(!p.autoActivityGeneratedAt){
      try{await updateDoc(doc(db,"users",user.uid),{autoActivityGeneratedAt:serverTimestamp()})}catch(_){}
    }
    return;
  }

  // Compute due time. Old RUNNING accounts get repaired almost immediately.
  let runningAtMs=0;
  const ar=p.accountRunningAt;
  if(ar?.toMillis) runningAtMs=ar.toMillis();
  else if(ar?.seconds) runningAtMs=ar.seconds*1000;
  else if(typeof ar==="string") runningAtMs=Date.parse(ar)||0;

  let due=Number(p.autoActivityDueAt||0);
  const oldEnough=runningAtMs>0 && (Date.now()-runningAtMs)>=60000;

  if(!due || oldEnough){
    due=oldEnough ? Date.now()+1200 : Date.now()+60000;
    try{await updateDoc(doc(db,"users",user.uid),{autoActivityDueAt:due})}catch(e){console.warn("Could not save due time",e)}
  }

  const delay=Math.max(800,due-Date.now());

  autoTimer=setTimeout(async()=>{
    try{
      const userSnap=await getDoc(doc(db,"users",user.uid));
      if(!userSnap.exists()) return;
      const ud=userSnap.data();

      const stillReady=!!(
        ud.activationVerified &&
        ud.accountStatus==="running" &&
        ud.mainSetup?.accountDetail &&
        ud.mainSetup?.atmSetup &&
        ud.mainSetup?.accountRun &&
        !ud.isBlocked
      );
      if(!stillReady) return;

      for(const row of rows){
        const tr=doc(db,"transactions",`auto_${user.uid}_${row.id}`);
        const exists=await getDoc(tr);
        if(exists.exists()) continue;

        await setDoc(tr,{
          uid:user.uid,
          userId:ud.userId||"",
          kind:row.kind,
          fund:row.fund,
          amount:row.amount,
          status:"completed",
          source:"simulated_activity",
          simulated:true,
          withdrawable:false,
          createdAt:serverTimestamp()
        });
      }

      await updateDoc(doc(db,"users",user.uid),{
        autoActivityGeneratedAt:serverTimestamp()
      });
    }catch(e){
      console.warn("Auto activity generation failed:",e);
      // Retry automatically instead of silently dying.
      setTimeout(()=>startAutoActivityAfterAccountSetup(),5000);
    }
  },delay);
}

function bind(uid){
 onSnapshot(doc(db,"users",uid),snap=>{
  p=snap.data();
  if(!p)return;
  render();
  startAutoActivityAfterAccountSetup();
  if(p.isBlocked)return page("homePage");
  if(p.paymentStatus==="pending")page("pendingPage");
  else if(p.paymentStatus==="approved"&&!p.activationVerified)page("activationPage");
});
 onSnapshot(doc(db,"settings","app"),snap=>{s=snap.data()||{};render()});
 onSnapshot(doc(db,"content","support"),snap=>{
   if(snap.exists()){
     s.support=snap.data()||{};
     render();
   }
 });
 onSnapshot(doc(db,"content","privacyPolicy"),snap=>{if(snap.exists()){s.privacyPolicy=String(snap.data().body||"");render()}});
 onSnapshot(doc(db,"content","terms"),snap=>{if(snap.exists()){s.terms=String(snap.data().body||"");render()}});
 onSnapshot(doc(db,"content","refundPolicy"),snap=>{if(snap.exists()){s.refundPolicy=String(snap.data().body||"");render()}});
 onSnapshot(query(collection(db,"transactions"),where("uid","==",uid)),snap=>{txs=snap.docs.map(d=>({id:d.id,...d.data()}));renderTransactions()});
 onSnapshot(query(collection(db,"withdrawals"),where("uid","==",uid)),snap=>{withdrawals=snap.docs.map(d=>({id:d.id,...d.data()}));renderTransactions();renderWithdrawals()});
 const notifMap=new Map();
 const drawNotifications=()=>{notifications=[...notifMap.values()].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));$("notifCount").textContent=notifications.length?notifications.length:"";$("notificationsList").innerHTML=notifications.length?notifications.map(n=>`<div class="policyItem"><b>${n.title||"Notification"}</b><p>${n.message||""}</p><span class="small muted">${n.type||"general"}</span></div>`).join(""):"<p class='muted'>No notifications.</p>"};
 onSnapshot(query(collection(db,"notifications"),where("targetUid","==",uid)),snap=>{snap.docs.forEach(d=>notifMap.set(d.id,{id:d.id,...d.data()}));drawNotifications()});
 onSnapshot(query(collection(db,"notifications"),where("targetUid","==",null)),snap=>{snap.docs.forEach(d=>notifMap.set(d.id,{id:d.id,...d.data()}));drawNotifications()});
}
onAuthStateChanged(auth,u=>{
 user=u;
 if(u){
   $("authView").classList.add("hidden");$("mainView").classList.remove("hidden");
   bind(u.uid);
   restoreView();
 }else{
   $("mainView").classList.add("hidden");$("authView").classList.remove("hidden");p=null;
   sessionStorage.removeItem("tp_page");sessionStorage.removeItem("tp_scroll");
 }
})
