import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, onSnapshot, serverTimestamp, addDoc, runTransaction, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),$=id=>document.getElementById(id);
let admin=null,users=[],acts=[],settings={},transactions=[],currentQrUrl=null;

async function adminOk(u){
 const t=await u.getIdTokenResult(true);
 if(t.claims.admin===true)return true;
 const s=await getDoc(doc(db,"admins",u.uid));
 return s.exists()&&["admin","super_admin"].includes(s.data().role)
}
$("loginBtn").onclick=async()=>{try{await signInWithEmailAndPassword(auth,$("email").value,$("password").value)}catch(e){$("loginMsg").textContent=e.message}};
$("logoutBtn").onclick=()=>signOut(auth);
onAuthStateChanged(auth,async u=>{
 if(!u){$("adminView").classList.add("hidden");$("loginView").classList.remove("hidden");return}
 if(!await adminOk(u)){$("loginMsg").textContent="Not authorized as Admin.";await signOut(auth);return}
 admin={uid:u.uid,email:u.email};$("loginView").classList.add("hidden");$("adminView").classList.remove("hidden");$("adminId").textContent=u.email;bind();
 if(sessionStorage.getItem("tp_after_support_save")==="1"){
   sessionStorage.removeItem("tp_after_support_save");
   setTimeout(()=>page("supportSettings"),100);
 };
 if(sessionStorage.getItem("tp_after_policy_save")==="1"){
   sessionStorage.removeItem("tp_after_policy_save");
   setTimeout(()=>page("content"),100);
 }
});

function page(id){document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));$(id).classList.remove("hidden");document.querySelectorAll(".sidebar [data-page]").forEach(x=>x.classList.toggle("active",x.dataset.page===id))}
document.addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)page(b.dataset.page)});
$("closeModal").onclick=()=>$("modal").classList.add("hidden");

async function audit(action,targetUid="",newValue=null,reason=""){
 await addDoc(collection(db,"auditLogs"),{adminUid:admin.uid,adminEmail:admin.email,action,targetUid,newValue,reason,createdAt:serverTimestamp()})
}


async function loadPolicyDocuments(){
  try{
    const [privacySnap,termsSnap,refundSnap]=await Promise.all([
      getDoc(doc(db,"content","privacyPolicy")),
      getDoc(doc(db,"content","terms")),
      getDoc(doc(db,"content","refundPolicy"))
    ]);

    if($("privacyPolicy")){
      $("privacyPolicy").value=privacySnap.exists()
        ? String(privacySnap.data().body||"")
        : String(settings.privacyPolicy||"");
    }
    if($("terms")){
      $("terms").value=termsSnap.exists()
        ? String(termsSnap.data().body||"")
        : String(settings.terms||"");
    }
    if($("refundPolicy")){
      $("refundPolicy").value=refundSnap.exists()
        ? String(refundSnap.data().body||"")
        : String(settings.refundPolicy||"");
    }
  }catch(err){
    console.error("Policy load failed:",err);
    if($("policySaveStatus"))$("policySaveStatus").textContent="Load error: "+err.message;
  }
}


function fillSupportForm(sp={}){
  const tgs=Array.isArray(sp.telegrams)?sp.telegrams:[sp.telegram||""];
  if($("supportPhone"))$("supportPhone").value="";
  if($("phoneEnabled"))$("phoneEnabled").checked=false;
  if($("supportWhatsapp"))$("supportWhatsapp").value=sp.whatsapp||"";
  if($("whatsappEnabled"))$("whatsappEnabled").checked=!!sp.whatsappEnabled;
  if($("supportTelegram1"))$("supportTelegram1").value=tgs[0]||"";
  if($("supportTelegram2"))$("supportTelegram2").value=tgs[1]||"";
  if($("supportTelegram3"))$("supportTelegram3").value=tgs[2]||"";
  if($("supportTelegram4"))$("supportTelegram4").value=tgs[3]||"";
  if($("supportTelegram5"))$("supportTelegram5").value=tgs[4]||"";
  if($("supportTelegram6"))$("supportTelegram6").value=tgs[5]||"";
  if($("telegramEnabled"))$("telegramEnabled").checked=!!sp.telegramEnabled;
  if($("supportEmail"))$("supportEmail").value=sp.email||"";
  if($("emailEnabled"))$("emailEnabled").checked=!!sp.emailEnabled;
  if($("supportDescription"))$("supportDescription").value=sp.description||"";
}


async function saveSettingsPatch(patch,label="Settings"){
  await setDoc(doc(db,"settings","app"),patch,{merge:true});
  const snap=await getDoc(doc(db,"settings","app"));
  if(!snap.exists())throw new Error(label+" document missing after save.");
  return snap.data()||{};
}

async function save(patch,action="settings_changed"){
  const saved=await saveSettingsPatch(patch,action);
  try{
    await audit(action,"settings/app",patch);
  }catch(err){
    console.warn("Audit log failed but settings save succeeded:",err);
  }
  return saved;
}


function bind(){
 onSnapshot(collection(db,"users"),s=>{users=s.docs.map(d=>({id:d.id,...d.data()}));renderUsers();renderDash();renderPenalties();renderCommission()});
 onSnapshot(collection(db,"activationRequests"),s=>{acts=s.docs.map(d=>({id:d.id,...d.data()}));renderActs();renderDash()});
 onSnapshot(doc(db,"settings","app"),s=>{settings=s.data()||{};loadSettings();loadPolicyDocuments()});
 onSnapshot(doc(db,"content","support"),snap=>{
   if(snap.exists()){
     fillSupportForm(snap.data()||{});
   }else{
     fillSupportForm({});
   }
 });
 onSnapshot(collection(db,"activationCodes"),s=>{$("codesList").innerHTML=s.empty?"No codes.":s.docs.map(d=>{const x=d.data();return `<p><b>${x.code||d.id}</b> → ${x.assignedUid} • ${x.status}</p>`}).join("")});
 onSnapshot(collection(db,"withdrawals"),s=>{$("withdrawList").innerHTML=s.empty?"No withdrawals.":s.docs.map(d=>{const x=d.data();return `<p><b>${x.username||x.uid}</b> — ₹${x.amount} — ${x.destination} — <select data-wid="${d.id}"><option>${x.status}</option><option>pending</option><option>approved</option><option>processing</option><option>paid</option><option>rejected</option></select></p>`}).join("")});
 onSnapshot(query(collection(db,"transactions"),orderBy("createdAt","desc"),limit(200)),s=>{transactions=s.docs.map(d=>({id:d.id,...d.data()}));renderTransactions();renderDash();renderCommission()});
 onSnapshot(query(collection(db,"auditLogs"),orderBy("createdAt","desc"),limit(100)),s=>{$("logsList").innerHTML=s.empty?"No logs.":s.docs.map(d=>{const x=d.data();return `<p><b>${x.action}</b> — ${x.adminEmail||""} — ${x.targetUid||""} ${x.reason?`— ${x.reason}`:""}</p>`}).join("")})
}

function renderDash(){
 const active=users.filter(x=>x.accountStatus==="running"&&!x.isBlocked).length,pending=acts.filter(x=>x.status==="pending").length,blocked=users.filter(x=>x.isBlocked).length,totalCommission=transactions.filter(x=>x.kind==="commission").reduce((a,b)=>a+Number(b.amount||0),0);
 $("stats").innerHTML=[["Total Users",users.length],["Active Users",active],["Pending Activation",pending],["Transactions",transactions.length],["Commission","₹"+totalCommission.toLocaleString("en-IN")],["Blocked",blocked]].map(x=>`<div class="card stat"><span>${x[0]}</span><b>${x[1]}</b></div>`).join("");
 $("recentUsers").innerHTML=users.slice(-5).reverse().map(x=>`<p>${x.userId||""} • ${x.username||""} • ${x.isBlocked?"BLOCKED":x.accountStatus||"stopped"}</p>`).join("")||"None";
 $("recentActs").innerHTML=acts.filter(x=>x.status==="pending").slice(0,5).map(x=>`<p>${x.username} • ₹${x.amount} • ${x.utr}</p>`).join("")||"None"
}
function renderUsers(q=""){
 q=q.toLowerCase();
 $("usersBody").innerHTML=users.filter(x=>[x.userId,x.username,x.email,x.phone].join(" ").toLowerCase().includes(q)).map(x=>`<tr><td>${x.userId||""}</td><td>${x.username||""}</td><td>${x.email||""}</td><td>${x.phone||""}</td><td>${x.paymentStatus||""}</td><td>₹${x.penaltyTotal||0} (${x.invalidUtrCount||0}/4)</td><td><span class="badge ${x.isBlocked?"blocked":"approved"}">${x.isBlocked?"BLOCKED":x.accountStatus||"stopped"}</span></td><td><button class="btn soft" data-user="${x.id}">Manage</button></td></tr>`).join("")
}
$("search").oninput=e=>{renderUsers(e.target.value);page("users")};

document.addEventListener("click",e=>{
 const b=e.target.closest("[data-user]");if(!b)return;const u=users.find(x=>x.id===b.dataset.user);
 $("modalContent").innerHTML=`<h2>${u.username}</h2><p>User ID: ${u.userId}</p><p>Payment: ${u.paymentStatus}</p><p>Invalid UTR: ${u.invalidUtrCount||0}/4</p><p>Penalty: ₹${u.penaltyTotal||0}</p><p>Payable: ₹${1999+Number(u.penaltyTotal||0)}</p><p>Status: ${u.isBlocked?"BLOCKED":u.accountStatus}</p><p>Main Setup: ${JSON.stringify(u.mainSetup||{})}</p><button class="btn good" id="resetPenalty">Reset Penalty</button> <button class="btn soft" id="toggleBlock">${u.isBlocked?"Unblock":"Block"}</button>`;
 $("modal").classList.remove("hidden");
 $("resetPenalty").onclick=async()=>{await updateDoc(doc(db,"users",u.id),{invalidUtrCount:0,penaltyTotal:0,isBlocked:false});await audit("penalty_reset",u.id,{invalidUtrCount:0,penaltyTotal:0},"Manual admin reset");$("modal").classList.add("hidden")};
 $("toggleBlock").onclick=async()=>{await updateDoc(doc(db,"users",u.id),{isBlocked:!u.isBlocked,accountStatus:!u.isBlocked?"suspended":"stopped"});await audit(u.isBlocked?"user_unblocked":"user_blocked",u.id,!u.isBlocked);$("modal").classList.add("hidden")}
});

function renderActs(){$("actsBody").innerHTML=acts.map(x=>`<tr><td>${x.username||x.uid}</td><td>₹${x.amount||0}</td><td>${x.utr}</td><td><span class="badge ${x.status}">${x.status}</span></td><td>${x.status==="pending"?`<button class="btn good" data-approve="${x.id}">Approve</button> <button class="btn danger" data-reject="${x.id}">Reject</button>`:""}</td></tr>`).join("")}

document.addEventListener("click",async e=>{
 const ap=e.target.closest("[data-approve]"),rj=e.target.closest("[data-reject]");
 if(ap){
  const x=acts.find(a=>a.id===ap.dataset.approve);
  await runTransaction(db,async t=>{t.update(doc(db,"activationRequests",x.id),{status:"approved",reviewedAt:serverTimestamp(),reviewedBy:admin.uid});t.update(doc(db,"users",x.uid),{paymentStatus:"approved"})});
  await audit("payment_approved",x.uid,{utr:x.utr});openCode(x)
 }
 if(rj){
  const x=acts.find(a=>a.id===rj.dataset.reject);
  $("modalContent").innerHTML=`<h2>Reject Payment</h2><p>${x.username} • ${x.utr}</p><label>Reason</label><select id="rejectReason"><option value="fake_invalid_utr">Fake/Invalid UTR (Penalty applies)</option><option value="wrong_amount">Wrong Amount</option><option value="payment_not_found">Payment Not Found</option><option value="duplicate">Duplicate</option><option value="other">Other</option></select><button class="btn danger" id="confirmReject">Reject</button>`;
  $("modal").classList.remove("hidden");
  $("confirmReject").onclick=async()=>{
   const reason=$("rejectReason").value;
   await runTransaction(db,async t=>{
    const ur=doc(db,"users",x.uid),us=await t.get(ur);let patch={paymentStatus:"rejected"};
    if(reason==="fake_invalid_utr"){const old=us.data(),n=Number(old.invalidUtrCount||0)+1;const add=n===1?100:n===2?200:n===3?300:0;patch.invalidUtrCount=n;patch.penaltyTotal=Number(old.penaltyTotal||0)+add;if(n>=4){patch.isBlocked=true;patch.accountStatus="suspended"}}
    t.update(doc(db,"activationRequests",x.id),{status:"rejected",rejectReason:reason,reviewedAt:serverTimestamp(),reviewedBy:admin.uid});t.update(ur,patch)
   });
   await audit("payment_rejected",x.uid,{utr:x.utr,reason},reason);$("modal").classList.add("hidden")
  }
 }
});

function openCode(x){
 const c="TP"+Math.random().toString(36).slice(2,10).toUpperCase();
 $("modalContent").innerHTML=`<h2>Activation Code</h2><input id="code" value="${c}"><button class="btn primary" id="saveCode">Save & Send</button>`;$("modal").classList.remove("hidden");
 $("saveCode").onclick=async()=>{const code=$("code").value.trim().toUpperCase();await setDoc(doc(db,"activationCodes",code),{code,assignedUid:x.uid,status:"active",revoked:false,createdAt:serverTimestamp(),createdBy:admin.uid});await updateDoc(doc(db,"users",x.uid),{activationCode:code});await audit("activation_code_assigned",x.uid,code);$("modal").classList.add("hidden")}
}

function renderPenalties(){$("penaltyUsers").innerHTML=users.map(x=>`<p><b>${x.userId||""} ${x.username||""}</b> — Attempts ${x.invalidUtrCount||0}/4 — Penalty ₹${x.penaltyTotal||0} — Payable ₹${1999+Number(x.penaltyTotal||0)} — ${x.isBlocked?"BLOCKED":"ACTIVE"}</p>`).join("")}
function renderTransactions(){$("transactionsList").innerHTML=transactions.length?transactions.map(x=>`<p><b style="color:${x.kind==="debit"?"#ef4444":"#16a34a"}">${(x.kind||x.category||"transaction").toUpperCase()}</b> • ${x.fund||""} • ₹${x.amount||0} • ${x.uid||""}</p>`).join(""):"No transactions."}
function renderCommission(){$("commissionUsers").innerHTML=users.map(u=>{const v=transactions.filter(x=>x.uid===u.id&&x.kind==="commission").reduce((a,b)=>a+Number(b.amount||0),0);return `<p><b>${u.userId||""} ${u.username||""}</b> — Commission ₹${v.toLocaleString("en-IN")}</p>`}).join("")}

function loadSettings(){
 const f=settings.fundPercentages||{},sp=settings.support||{};
 $("upiId").value=settings.upiId||"";$("paymentInstructions").value=settings.paymentInstructions||"";$("pendingMessage").value=settings.pendingMessage||"";
 $("gaming").value=f.gaming??15;$("stock").value=f.stock??30;$("mix").value=f.mix??25;$("political").value=f.political??40;$("outside").value=f.outside??50;$("defaultBonus").value=settings.defaultBonus??2000;
 $("privacyPolicy").value=settings.privacyPolicy||"";$("terms").value=settings.terms||"";$("refundPolicy").value=settings.refundPolicy||"";
 
 $("qrUrl").value=settings.qrUrl||"";currentQrUrl=settings.qrUrl||null;updateQrUi()
}

function validHttpUrl(value){
  try{
    const u=new URL(value);
    return u.protocol==="https:" || u.protocol==="http:";
  }catch(_){return false}
}
function updateQrUi(){
  const url=$("qrUrl")?.value.trim()||currentQrUrl||"";
  if(url && validHttpUrl(url)){
    $("qrPreview").src=url;
    $("qrPreview").classList.remove("hidden");
    $("qrEmpty").classList.add("hidden");
    $("clearQrBtn").classList.remove("hidden");
  }else{
    $("qrPreview").removeAttribute("src");
    $("qrPreview").classList.add("hidden");
    $("qrEmpty").classList.remove("hidden");
    $("clearQrBtn").classList.add("hidden");
  }
}
$("previewQrBtn").onclick=()=>{
  const url=$("qrUrl").value.trim();
  if(!validHttpUrl(url)){alert("Valid http/https QR image link डालें.");return}
  currentQrUrl=url;
  updateQrUi();
  $("qrStatus").textContent="Preview loaded. Save Payment Settings दबाएँ.";
};
$("clearQrBtn").onclick=()=>{
  $("qrUrl").value="";
  currentQrUrl=null;
  $("qrStatus").textContent="QR link cleared. Save Payment Settings to apply.";
  updateQrUi();
};
$("qrPreview").addEventListener("error",()=>{
  $("qrStatus").textContent="Image load नहीं हुई. Direct public image link check करें.";
});
$("qrPreview").addEventListener("load",()=>{
  $("qrStatus").textContent="QR image loaded successfully.";
});

$("savePayment").onclick=async()=>{
 try{
  const qrUrl=$("qrUrl").value.trim();
  if(qrUrl && !validHttpUrl(qrUrl))throw Error("Valid http/https QR image URL डालें.");
  const patch={
    activationFee:1999,
    upiId:$("upiId").value.trim(),
    paymentInstructions:$("paymentInstructions").value.trim(),
    pendingMessage:$("pendingMessage").value.trim(),
    qrUrl
  };
  await save(patch,"payment_settings_changed");
  const verify=await getDoc(doc(db,"settings","app"));
  const d=verify.data()||{};
  if(String(d.upiId||"")!==patch.upiId || String(d.qrUrl||"")!==patch.qrUrl)throw Error("Payment settings verification failed.");
  currentQrUrl=qrUrl||null;
  updateQrUi();
  $("qrStatus").textContent="Payment settings saved permanently.";
  alert("Payment settings saved permanently.");
 }catch(e){alert("Settings save error: "+e.message)}
};

$("saveFunds").onclick=async()=>{try{
 const patch={fundPercentages:{gaming:Number($("gaming").value),stock:Number($("stock").value),mix:Number($("mix").value),political:Number($("political").value),outside:Number($("outside").value)}};
 await save(patch,"fund_percentages_changed");
 alert("Fund percentages saved permanently.");
}catch(e){alert("Fund save failed: "+e.message)}};
$("saveBonus").onclick=async()=>{try{
 const value=Number($("defaultBonus").value||0);
 await save({defaultBonus:value},"bonus_changed");
 const verify=await getDoc(doc(db,"settings","app"));
 if(Number(verify.data()?.defaultBonus||0)!==value)throw new Error("Bonus verification failed.");
 alert("Bonus saved permanently.");
}catch(e){alert("Bonus save failed: "+e.message)}};


$("sendNotif").onclick=async()=>{try{
 const payload={targetUid:$("notifUid").value.trim()||null,title:$("notifTitle").value.trim(),message:$("notifMessage").value.trim(),type:"general",createdAt:serverTimestamp(),createdBy:admin.uid};
 await addDoc(collection(db,"notifications"),payload);
 try{await audit("notification_sent",payload.targetUid||"ALL",payload.title)}catch(e){console.warn("Notification audit failed:",e)}
 alert("Notification saved permanently.");
}catch(e){alert("Notification save failed: "+e.message)}};

document.addEventListener("change",async e=>{if(e.target.matches("[data-wid]")){await updateDoc(doc(db,"withdrawals",e.target.dataset.wid),{status:e.target.value,updatedAt:serverTimestamp(),updatedBy:admin.uid});await audit("withdrawal_status_changed","",e.target.value)}})










document.addEventListener("click",async(e)=>{
  const btn=e.target.closest("#saveContent");
  if(!btn)return;

  e.preventDefault();
  e.stopPropagation();

  const status=$("policySaveStatus");
  try{
    btn.disabled=true;
    if(status)status.textContent="Saving...";

    const privacyPolicy=String($("privacyPolicy")?.value||"");
    const terms=String($("terms")?.value||"");
    const refundPolicy=String($("refundPolicy")?.value||"");
    const now=serverTimestamp();

    // Save each policy independently so one large text cannot wipe the others.
    await Promise.all([
      setDoc(doc(db,"content","privacyPolicy"),{
        type:"privacyPolicy",
        body:privacyPolicy,
        updatedAt:now,
        updatedBy:admin?.uid||""
      },{merge:true}),
      setDoc(doc(db,"content","terms"),{
        type:"terms",
        body:terms,
        updatedAt:now,
        updatedBy:admin?.uid||""
      },{merge:true}),
      setDoc(doc(db,"content","refundPolicy"),{
        type:"refundPolicy",
        body:refundPolicy,
        updatedAt:now,
        updatedBy:admin?.uid||""
      },{merge:true})
    ]);

    // Read back all 3 and verify exact persistence.
    const [pSnap,tSnap,rSnap]=await Promise.all([
      getDoc(doc(db,"content","privacyPolicy")),
      getDoc(doc(db,"content","terms")),
      getDoc(doc(db,"content","refundPolicy"))
    ]);

    if(!pSnap.exists()||!tSnap.exists()||!rSnap.exists()){
      throw new Error("One or more policy documents were not created.");
    }

    if(
      String(pSnap.data().body||"")!==privacyPolicy ||
      String(tSnap.data().body||"")!==terms ||
      String(rSnap.data().body||"")!==refundPolicy
    ){
      throw new Error("Saved text verification failed.");
    }

    // Keep settings/app compatibility marker only; user app reads content docs directly after this update.
    await setDoc(doc(db,"settings","app"),{
      policiesVersion:(Date.now()),
      policiesUpdatedAt:serverTimestamp()
    },{merge:true});

    if(status)status.textContent="Saved successfully. Refreshing...";
    sessionStorage.setItem("tp_after_policy_save","1");
    setTimeout(()=>window.location.reload(),700);
  }catch(err){
    console.error("Policy save failed:",err);
    if(status)status.textContent="Save failed: "+err.message;
    alert("Policy save failed: "+err.message);
    btn.disabled=false;
  }
});



document.addEventListener("click",async(e)=>{
  const btn=e.target.closest("#saveSupport");
  if(!btn)return;

  e.preventDefault();
  e.stopPropagation();

  const status=$("supportSaveStatus");
  try{
    btn.disabled=true;
    if(status)status.textContent="Saving / Replacing...";

    const telegrams=[
      $("supportTelegram1")?.value?.trim()||"",
      $("supportTelegram2")?.value?.trim()||"",
      $("supportTelegram3")?.value?.trim()||"",
      $("supportTelegram4")?.value?.trim()||"",
      $("supportTelegram5")?.value?.trim()||"",
      $("supportTelegram6")?.value?.trim()||""
    ].filter(Boolean);

    const supportDoc={
      type:"support",
      phone:"",
      phoneEnabled:false,
      whatsapp:$("supportWhatsapp")?.value?.trim()||"",
      whatsappEnabled:!!$("whatsappEnabled")?.checked,
      telegrams,
      telegram1:telegrams[0]||"",
      telegram2:telegrams[1]||"",
      telegram3:telegrams[2]||"",
      telegram4:telegrams[3]||"",
      telegram5:telegrams[4]||"",
      telegram6:telegrams[5]||"",
      telegramEnabled:!!$("telegramEnabled")?.checked,
      email:$("supportEmail")?.value?.trim()||"",
      emailEnabled:!!$("emailEnabled")?.checked,
      description:$("supportDescription")?.value||"",
      updatedAt:serverTimestamp(),
      updatedBy:admin?.uid||""
    };

    // Full replace: old values that are removed do not come back.
    await setDoc(doc(db,"content","support"),supportDoc,{merge:false});

    // Verify exact persisted values from the source-of-truth document.
    const verify=await getDoc(doc(db,"content","support"));
    if(!verify.exists())throw new Error("Support document was not created.");
    const saved=verify.data();

    if(
      JSON.stringify(saved.telegrams||[])!==JSON.stringify(telegrams) ||
      String(saved.whatsapp||"")!==String(supportDoc.whatsapp||"") ||
      Boolean(saved.whatsappEnabled)!==Boolean(supportDoc.whatsappEnabled) ||
      String(saved.email||"")!==String(supportDoc.email||"") ||
      Boolean(saved.emailEnabled)!==Boolean(supportDoc.emailEnabled) ||
      String(saved.description||"")!==String(supportDoc.description||"")
    ){
      throw new Error("Support persistence verification failed.");
    }

    // Compatibility mirror only. Refresh/load does NOT use this anymore.
    await setDoc(doc(db,"settings","app"),{
      support:{
        phone:"",
        phoneEnabled:false,
        whatsapp:supportDoc.whatsapp,
        whatsappEnabled:supportDoc.whatsappEnabled,
        telegrams,
        telegramEnabled:supportDoc.telegramEnabled,
        email:supportDoc.email,
        emailEnabled:supportDoc.emailEnabled,
        description:supportDoc.description
      }
    },{merge:true});

    if(status)status.textContent="Saved permanently.";
    alert("Customer Support save/replace हो गया. Refresh के बाद भी यही रहेगा.");
    fillSupportForm(saved);
  }catch(err){
    console.error("Support save failed:",err);
    if(status)status.textContent="Save failed: "+err.message;
    alert("Support save failed: "+err.message);
  }finally{
    btn.disabled=false;
  }
});


window.addEventListener("unhandledrejection",(e)=>{
  console.error("Unhandled admin save error:",e.reason);
});
