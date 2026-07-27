
import{firebaseConfig}from"./firebase-config.js";
import{initializeApp}from"https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import{getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged}from"https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import{getDatabase,ref,get,set,update,push,onValue}from"https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";
import{getMessaging,getToken}from"https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging.js";

const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getDatabase(app);
const $=id=>document.getElementById(id),money=n=>"₹"+Number(n||0).toLocaleString("en-IN");
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
let me=null,users={},paymentsTree={},withdrawals={},settings={},feed={},audits={},bonusClaims={},fundAccounts={},fundCodes={};
const fundNames={gaming:"Gaming Fund",stock:"Stock Fund",mix:"Mix Fund",political:"Political Fund",outside:"Outside Fund",performance:"Performance Bonus"};
const menu=[["dashboard","Dashboard"],["users","Users List"],["payments","Payment Requests"],["activationcodes","Activation Codes"],["penalties","Penalty & Block History"],["funds","Fund Management"],["fundaccounts","User Fund Accounts"],["ledger","Transactions & Ledger"],["withdrawals","Withdrawals"],["bonus","Commission & Bonus"],["policies","Policies & App Content"],["notifications","Notifications"],["settings","General Settings"],["audit","Audit Logs"]];
$("menu").innerHTML=menu.map(([k,n],i)=>`<button class="${i===0?"active":""}" onclick="showPanel('${k}',this)">${n}</button>`).join("");
window.showPanel=(k,b)=>{document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));$(k).classList.add("active");document.querySelectorAll(".menu button").forEach(x=>x.classList.remove("active"));if(b)b.classList.add("active");render()};
window.adminLogin=async()=>{try{await signInWithEmailAndPassword(auth,$("adminEmail").value.trim(),$("adminPass").value)}catch(e){$("adminMsg").textContent=e.message}};
window.adminLogout=()=>signOut(auth);
async function isAdmin(u){const s=await get(ref(db,`admins/${u.uid}`));return s.exists()&&["admin","superadmin"].includes(s.val().role)}
async function audit(action,details={}){const k=push(ref(db,"auditLogs")).key;await set(ref(db,`auditLogs/${k}`),{adminUid:me.uid,adminEmail:me.email,action,details,createdAt:Date.now()})}
async function userActivity(uid,type,title,message){const k=push(ref(db,`activityLogs/${uid}`)).key;await set(ref(db,`activityLogs/${uid}/${k}`),{type,title,message,createdAt:Date.now()})}
function flatPayments(){
 const out=[];
 for(const [uid,reqs] of Object.entries(paymentsTree||{}))for(const [rid,p] of Object.entries(reqs||{}))out.push({uid,requestId:rid,...p});
 return out.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
function paymentCard(p){
 const pending=p.status==="pending";
 return `<div class="feeditem"><b>${esc(p.email||p.uid)}</b><div class="label">${money(p.amount)} · UTR ${esc(p.utr||"")} · Attempt ${p.attempt||1}/4</div><div style="margin:6px 0"><span class="badge ${p.status==="rejected"?"red":pending?"orange":""}">${esc(p.status||"pending")}</span>${p.activationCode?` <span class="badge">Code: ${esc(p.activationCode)}</span>`:""}</div>${p.rejectReason?`<div class="label">Reason: ${esc(p.rejectReason)}</div>`:""}${pending?`<button class="action" onclick="reviewPayment('${p.uid}','${p.requestId}','approved')">Approve</button> <button class="action red" onclick="reviewPayment('${p.uid}','${p.requestId}','rejected')">Reject Invalid UTR</button>`:""}</div>`;
}
function render(){
 const ua=Object.values(users),pa=flatPayments(),wa=Object.values(withdrawals),fa=Object.values(feed);
 const kpis=[["Total Users",ua.length],["Total Balance",money(ua.reduce((a,x)=>a+Number(x.balance||0),0))],["Total Commission",money(ua.reduce((a,x)=>a+Number(x.commission||0),0))],["Pending Payments",pa.filter(x=>x.status==="pending").length],["Pending Withdrawals",wa.filter(x=>x.status==="pending").length],["Blocked Users",ua.filter(x=>x.blocked).length]];
 $("kpis").innerHTML=kpis.map(([n,v])=>`<div class="card kpi"><div class="label">${n}</div><b>${v}</b></div>`).join("");$("unread").textContent=fa.filter(x=>x.unread).length;
 $("usersBody").innerHTML=Object.entries(users).map(([id,u])=>`<tr><td>${esc(u.username||id.slice(0,8))}</td><td>${esc(u.email||"")}</td><td>${u.blocked?"Blocked":esc(u.accountStatus||"Stopped")}</td><td>${u.invalidAttempts||0}/4</td><td>${money(u.penalty)}</td><td>${money(u.balance)}</td><td>${money(u.commission)}</td><td><button class="action" onclick="setState('${id}','running')">Run</button> <button class="action orange" onclick="setState('${id}','stopped')">Stop</button> <button class="action red" onclick="toggleBlock('${id}')">${u.blocked?"Unblock":"Block"}</button> <button class="action" onclick="editUser('${id}')">Edit</button></td></tr>`).join("");
 const pending=pa.filter(p=>p.status==="pending");
 $("paymentsBody").innerHTML=pa.length?pa.map(paymentCard).join(""):"<div class='feeditem'>No payment requests.</div>";
 $("dashPayments").innerHTML=pending.length?pending.slice(0,5).map(paymentCard).join(""):"<div class='feeditem'>No pending payments.</div>";
 $("activationCodesBody").innerHTML=Object.entries(users).filter(([_,u])=>u.activationCode).map(([id,u])=>`<div class="feeditem"><b>${esc(u.username||u.email||id)}</b><div class="label">${esc(u.email||"")}</div><span class="badge">Permanent Code: ${esc(u.activationCode)}</span><div class="label">Status: ${esc(u.activationStatus||"")}</div></div>`).join("")||"<div class='feeditem'>No activation codes generated.</div>";
 $("penaltiesBody").innerHTML=Object.entries(users).filter(([_,u])=>Number(u.invalidAttempts||0)>0||u.blocked).map(([id,u])=>`<div class="feeditem"><b>${esc(u.username||u.email||id)}</b><div class="label">Attempts: ${u.invalidAttempts||0}/4 · Penalty: ${money(u.penalty)} · ${u.blocked?"BLOCKED":"Active"}</div><button class="action" onclick="resetPenalty('${id}')">Reset Penalty</button></div>`).join("")||"<div class='feeditem'>No penalty records.</div>";
 $("withdrawalsBody").innerHTML=Object.entries(withdrawals).length?Object.entries(withdrawals).sort((a,b)=>(b[1].createdAt||0)-(a[1].createdAt||0)).map(([id,w])=>`<div class="feeditem"><b>${esc(w.email||w.uid||id)}</b><div class="label">${money(w.amount)} · ${esc(w.method||"bank")}</div><div class="label">${w.method==="upi"?`UPI: ${esc(w.details?.upiId||"")}`:`${esc(w.details?.bankName||"")} · A/C ****${esc(String(w.details?.accountNumber||"").slice(-4))} · IFSC ${esc(w.details?.ifsc||"")}`}</div><div style="margin:6px 0"><span class="badge ${w.status==="rejected"?"red":w.status==="pending"?"orange":""}">${esc(w.status||"pending")}</span></div>${w.status==="pending"?`<button class="action" onclick="setWithdrawal('${id}','approved')">Approve</button> <button class="action red" onclick="setWithdrawal('${id}','rejected')">Reject</button>`:""}${w.status==="approved"?`<button class="action orange" onclick="setWithdrawal('${id}','processing')">Mark Processing</button>`:""}${w.status==="processing"?`<button class="action" onclick="setWithdrawal('${id}','paid')">Mark Paid</button>`:""}</div>`).join(""):"<div class='feeditem'>No withdrawal requests yet.</div>";
 const recent=Object.values(feed).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));$("recentFeed").innerHTML=recent.slice(0,6).map(x=>`<div class="feeditem"><b>${esc(x.title)}</b><div class="label">${esc(x.userEmail||"")}</div></div>`).join("");
 $("adminFeed").innerHTML=Object.entries(feed).sort((a,b)=>(b[1].createdAt||0)-(a[1].createdAt||0)).map(([id,x])=>`<div class="feeditem"><b>${esc(x.title)}</b><div>${esc(x.message||"")}</div><div class="label">${esc(x.userEmail||"")} · ${new Date(x.createdAt||0).toLocaleString("en-IN")}</div><button class="btn out" onclick="markRead('${id}')">Mark Read</button></div>`).join("");
 $("statusOverview").innerHTML=`<p>Running: <b>${ua.filter(x=>x.accountStatus==="running").length}</b></p><p>Pending: <b>${ua.filter(x=>x.activationStatus==="pending").length}</b></p><p>Blocked: <b>${ua.filter(x=>x.blocked).length}</b></p>`;
 const fk=[["gamingFundRate","Gaming Fund %",15],["stockFundRate","Stock Fund %",30],["mixFundRate","Mix Fund %",25],["politicalFundRate","Political Fund %",10],["outsideFundRate","Outside Fund %",20],["performanceBonusRate","Performance Bonus %",5]];
 $("fundForm").innerHTML=fk.map(([k,n,d])=>`<label>${n}<input id="${k}" type="number" value="${settings[k]??d}"></label>`).join("");
 [["bonusAmount","bonusAmount"],["commissionRate","commissionRate"],["fundPolicy","fundPolicy"],["privacyPolicy","privacyPolicy"],["terms","terms"],["withdrawalPolicy","withdrawalPolicy"],["bonusPolicy","bonusPolicy"],["supportPolicy","supportPolicy"],["supportContact","supportContact"],["telegramLink","telegramLink"],["activationFee","activationFee"],["adminUpiId","adminUpiId"],["paymentQr","paymentQr"],["minWithdrawal","minWithdrawal"]].forEach(([id,k])=>{if($(id))$(id).value=settings[k]??""});
 $("auditBody").innerHTML=Object.values(audits).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,100).map(a=>`<div class="feeditem"><b>${esc(a.action)}</b><div class="label">${esc(a.adminEmail||"")} · ${new Date(a.createdAt||0).toLocaleString("en-IN")}</div></div>`).join("");
 renderFundAccounts();
}
function renderFundAccounts(){
 const filter=$("faFundFilter")?.value||"",rows=[];
 for(const [uid,funds] of Object.entries(fundAccounts||{}))for(const [fund,accounts] of Object.entries(funds||{}))if(!filter||filter===fund)for(const [aid,a] of Object.entries(accounts||{}))rows.push({uid,fund,aid,...a});
 if($("fundAccountsBody"))$("fundAccountsBody").innerHTML=rows.length?rows.map(a=>`<div class="feeditem"><b>${esc(fundNames[a.fund]||a.fund)} — ${esc(a.holderName)}</b><div class="label">${esc(a.bankName)} · A/C ****${esc(String(a.accountNumber||"").slice(-4))} · IFSC ${esc(a.ifsc)}</div><div class="label">User: ${esc(users[a.uid]?.email||a.uid)} · Phone ${esc(a.phone)}</div><span class="badge">${esc(a.status||"active")}</span> <button class="action orange" onclick="setFundAccount('${a.uid}','${a.fund}','${a.aid}','disabled')">Disable</button> <button class="action" onclick="setFundAccount('${a.uid}','${a.fund}','${a.aid}','active')">Activate</button></div>`).join(""):"<div class='feeditem'>No fund accounts.</div>";
}
document.addEventListener("change",e=>{if(e.target?.id==="faFundFilter")renderFundAccounts()});

window.reviewPayment=async(uid,rid,status)=>{
 try{
  const p=paymentsTree?.[uid]?.[rid];if(!p)throw Error("Payment request not found");if(p.status!=="pending")throw Error("This payment is already "+p.status);
  if(status==="approved"){
   const existing=users[uid]?.activationCode,code=existing||("TP-"+Math.random().toString(36).slice(2,6).toUpperCase()+"-"+Date.now().toString().slice(-4));
   await update(ref(db),{[`activationPayments/${uid}/${rid}/status`]:"approved",[`activationPayments/${uid}/${rid}/activationCode`]:code,[`activationPayments/${uid}/${rid}/reviewedAt`]:Date.now(),[`activationPayments/${uid}/${rid}/reviewedBy`]:me.uid,[`users/${uid}/activationStatus`]:"approved",[`users/${uid}/activationCode`]:code});
   await userActivity(uid,"payment","Payment approved","Verification code is ready: "+code);await audit("PAYMENT_APPROVED",{uid,rid,code});alert("Payment approved. Code: "+code);
  }else{
   const u=users[uid]||{},next=Math.min(4,Number(u.invalidAttempts||0)+1),penalty=next===1?100:next===2?300:next===3?600:Number(u.penalty||600),blocked=next>=4,reason=prompt("Reject reason","Invalid/Fake UTR");if(reason===null)return;
   await update(ref(db),{[`activationPayments/${uid}/${rid}/status`]:"rejected",[`activationPayments/${uid}/${rid}/rejectReason`]:reason||"Invalid/Fake UTR",[`activationPayments/${uid}/${rid}/reviewedAt`]:Date.now(),[`activationPayments/${uid}/${rid}/reviewedBy`]:me.uid,[`users/${uid}/invalidAttempts`]:next,[`users/${uid}/penalty`]:penalty,[`users/${uid}/blocked`]:blocked,[`users/${uid}/accountStatus`]:"stopped",[`users/${uid}/activationStatus`]:"rejected"});
   await userActivity(uid,"payment",blocked?"ID automatically blocked":"Payment rejected",blocked?"4 invalid attempts reached.":`Penalty: ${money(penalty)} · New payable: ${money(Number(settings.activationFee||1999)+penalty)}`);await audit("PAYMENT_REJECTED",{uid,rid,next,penalty,blocked,reason});alert(blocked?"Rejected. User blocked.":"Rejected. Penalty updated.");
  }
 }catch(e){alert("Action failed: "+e.message)}
};
window.setState=async(id,s)=>{await update(ref(db,`users/${id}`),{accountStatus:s,updatedAt:Date.now()});await userActivity(id,"account","Account status changed","Admin set account to "+s);await audit("USER_STATE",{id,s})};
window.toggleBlock=async id=>{const blocked=!users[id]?.blocked;await update(ref(db,`users/${id}`),{blocked,accountStatus:blocked?"stopped":users[id]?.accountStatus||"stopped"});await userActivity(id,"account",blocked?"Account blocked":"Account unblocked",blocked?"Contact Support remains available.":"Account restored.");await audit(blocked?"USER_BLOCKED":"USER_UNBLOCKED",{id})};
window.resetPenalty=async id=>{if(!confirm("Reset attempts and penalty?"))return;await update(ref(db,`users/${id}`),{invalidAttempts:0,penalty:0,blocked:false});await audit("PENALTY_RESET",{id});alert("Penalty reset")};
window.editUser=async id=>{const u=users[id]||{},b=prompt("Balance",u.balance||0);if(b===null)return;const c=prompt("Commission",u.commission||0);if(c===null)return;await update(ref(db,`users/${id}`),{balance:Number(b),commission:Number(c)});await audit("USER_EDITED",{id,balance:b,commission:c})};
window.setFundAccount=async(uid,fund,aid,status)=>{await update(ref(db,`fundAccounts/${uid}/${fund}/${aid}`),{status,updatedAt:Date.now(),updatedBy:me.uid});await audit("FUND_ACCOUNT_"+status.toUpperCase(),{uid,fund,aid});alert("Fund account "+status)};
window.setWithdrawal=async(id,s)=>{try{const w=withdrawals[id];if(!w)throw Error("Withdrawal not found");await update(ref(db,`withdrawals/${id}`),{status:s,updatedAt:Date.now(),updatedBy:me.uid});if(w.uid)await userActivity(w.uid,"withdrawal","Withdrawal "+s,money(w.amount)+" status updated.");await audit("WITHDRAWAL_"+s.toUpperCase(),{id});alert("Withdrawal status: "+s)}catch(e){alert(e.message)}};
window.setBonusClaim=async()=>{};
window.saveFunds=async()=>{const d={};["gamingFundRate","stockFundRate","mixFundRate","politicalFundRate","outsideFundRate","performanceBonusRate"].forEach(k=>d[k]=Number($(k).value));await update(ref(db,"settings"),d);await audit("FUND_SETTINGS_UPDATED",d);alert("Saved")};
window.addLedger=async()=>{const id=$("ledgerUid").value.trim(),amount=Number($("ledgerAmount").value),type=$("ledgerType").value;if(!id||!Number.isFinite(amount))return alert("UID and amount required");const k=push(ref(db,`transactions/${id}`)).key;await set(ref(db,`transactions/${id}/${k}`),{title:$("ledgerTitle").value||"Ledger Entry",type,amount,status:"completed",createdAt:Date.now(),createdBy:me.uid});const u=users[id]||{};if(type==="commission")await update(ref(db,`users/${id}`),{commission:Number(u.commission||0)+amount});else await update(ref(db,`users/${id}`),{balance:Number(u.balance||0)+amount});await userActivity(id,"transaction","Transaction updated",$("ledgerTitle").value||"Ledger entry added.");await audit("LEDGER_ADDED",{id,amount,type});alert("Added")};
window.saveBonusSettings=async()=>{const d={bonusAmount:Number($("bonusAmount").value||0),commissionRate:Number($("commissionRate").value||0)};await update(ref(db,"settings"),d);await audit("BONUS_SETTINGS_UPDATED",d);alert("Saved")};
window.savePolicies=async()=>{const d={fundPolicy:$("fundPolicy").value,privacyPolicy:$("privacyPolicy").value,terms:$("terms").value,withdrawalPolicy:$("withdrawalPolicy").value,bonusPolicy:$("bonusPolicy").value,supportPolicy:$("supportPolicy").value,supportContact:$("supportContact").value,telegramLink:$("telegramLink").value};await update(ref(db,"settings"),d);await audit("POLICIES_UPDATED",d);alert("Saved")};
window.saveGeneral=async()=>{const d={activationFee:Number($("activationFee").value||1999),adminUpiId:$("adminUpiId").value,paymentQr:$("paymentQr").value,minWithdrawal:Number($("minWithdrawal").value||0)};await update(ref(db,"settings"),d);await audit("GENERAL_SETTINGS_UPDATED",d);alert("Saved")};
window.sendNotification=async()=>{const title=$("notifyTitle").value.trim(),message=$("notifyMessage").value.trim(),uid=$("notifyUid").value.trim();if(!title||!message)return alert("Title and message required");const path=uid?`notifications/${uid}`:"globalNotifications",k=push(ref(db,path)).key;await set(ref(db,`${path}/${k}`),{title,message,createdAt:Date.now(),createdBy:me.uid});await audit("NOTIFICATION_CREATED",{uid,title});alert("Notification saved")};
window.markRead=id=>update(ref(db,`adminActivityFeed/${id}`),{unread:false});
window.allowNotifications=async()=>{try{const p=await Notification.requestPermission();if(p!=="granted")throw Error("Permission denied");if(!settings.webPushVapidKey)throw Error("VAPID key missing");const reg=await navigator.serviceWorker.register("./firebase-messaging-sw.js"),m=getMessaging(app),token=await getToken(m,{vapidKey:settings.webPushVapidKey,serviceWorkerRegistration:reg});await set(ref(db,`adminFcmTokens/${me.uid}/${Date.now()}`),{token,createdAt:Date.now(),userAgent:navigator.userAgent});alert("Notifications enabled")}catch(e){alert(e.message)}};

onAuthStateChanged(auth,async x=>{
 if(!x){$("loginView").classList.remove("hidden");$("panelView").classList.add("hidden");return}
 if(!(await isAdmin(x))){await signOut(auth);return $("adminMsg").textContent="Admin access denied"}
 me=x;$("adminIdentity").textContent=x.email;$("loginView").classList.add("hidden");$("panelView").classList.remove("hidden");
 onValue(ref(db,"users"),s=>{users=s.val()||{};render()});onValue(ref(db,"activationPayments"),s=>{paymentsTree=s.val()||{};render()});
 onValue(ref(db,"withdrawals"),s=>{withdrawals=s.val()||{};render()});onValue(ref(db,"settings"),s=>{settings=s.val()||{};render()});
 onValue(ref(db,"adminActivityFeed"),s=>{feed=s.val()||{};render()});onValue(ref(db,"auditLogs"),s=>{audits=s.val()||{};render()});
 onValue(ref(db,"fundAccounts"),s=>{fundAccounts=s.val()||{};render()});onValue(ref(db,"fundSetupCodes"),s=>{fundCodes=s.val()||{};render()});
});
