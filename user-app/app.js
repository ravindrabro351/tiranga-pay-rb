
import{firebaseConfig}from"./firebase-config.js";
import{initializeApp}from"https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import{getAuth,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut,onAuthStateChanged,sendPasswordResetEmail}from"https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import{getDatabase,ref,set,get,update,push,onValue,runTransaction}from"https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

window.addEventListener("error",e=>console.error("Tiranga Pay error:",e.message,e.filename,e.lineno));
window.addEventListener("unhandledrejection",e=>console.error("Tiranga Pay promise error:",e.reason));

const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getDatabase(app);
const $=id=>document.getElementById(id);
const money=n=>"₹"+Number(n||0).toLocaleString("en-IN");
const escapeHtml=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
let me=null,u={},settings={},paymentRequests={},payment={},activities=[],transactions=[],fundAccounts={},fundCodes={},captcha="";
const locked=new Set(["gaming","stock","mix","political","outside","performance","history","commission","withdrawal","bonus"]);
const fundDefs={
 gaming:{icon:"🎮",name:"Gaming Fund",rate:"gamingFundRate",defaultRate:15},
 stock:{icon:"📈",name:"Stock Fund",rate:"stockFundRate",defaultRate:30},
 mix:{icon:"◔",name:"Mix Fund",rate:"mixFundRate",defaultRate:25},
 political:{icon:"🏛",name:"Political Fund",rate:"politicalFundRate",defaultRate:10},
 outside:{icon:"🌐",name:"Outside Fund",rate:"outsideFundRate",defaultRate:20},
 performance:{icon:"🎯",name:"Performance Bonus",rate:"performanceBonusRate",defaultRate:5}
};
const defs=[
 ["gaming","🎮","Gaming Fund","gamingFundRate",15],["stock","📈","Stock Fund","stockFundRate",30],
 ["mix","◔","Mix Fund","mixFundRate",25],["political","🏛","Political Fund","politicalFundRate",10],
 ["outside","🌐","Outside Fund","outsideFundRate",20],["performance","🎯","Performance Bonus","performanceBonusRate",5],
 ["history","📄","Transaction History","",0],["commission","👥","Commission","",0],
 ["withdrawal","👛","Withdrawal","",0],["bonus","🎁","Bonus Claim","",0]
];
const indianBanks=["State Bank of India","HDFC Bank","ICICI Bank","Axis Bank","Punjab National Bank","Bank of Baroda","Canara Bank","Union Bank of India","Bank of India","Indian Bank","Central Bank of India","UCO Bank","Bank of Maharashtra","Punjab & Sind Bank","IDBI Bank","Kotak Mahindra Bank","IndusInd Bank","Yes Bank","Federal Bank","IDFC FIRST Bank","RBL Bank","South Indian Bank","Karnataka Bank","Karur Vysya Bank","Tamilnad Mercantile Bank","Bandhan Bank","AU Small Finance Bank","Ujjivan Small Finance Bank","Equitas Small Finance Bank","Jana Small Finance Bank","ESAF Small Finance Bank","Suryoday Small Finance Bank","Utkarsh Small Finance Bank","Fincare Small Finance Bank","India Post Payments Bank","Airtel Payments Bank","Paytm Payments Bank","NSDL Payments Bank","Jio Payments Bank"];

window.showRegister=()=>{$("loginBox").classList.add("hidden");$("registerBox").classList.remove("hidden");newCaptcha()};
window.showLogin=()=>{$("registerBox").classList.add("hidden");$("loginBox").classList.remove("hidden")};
function newCaptcha(){captcha=String(Math.floor(100000+Math.random()*900000));$("captchaView").value=captcha}
newCaptcha();

async function adminFeed(title,message,type="activity"){
 const k=push(ref(db,"adminActivityFeed")).key;
 await set(ref(db,"adminActivityFeed/"+k),{uid:me?.uid||"",userEmail:me?.email||"",title,message,type,createdAt:Date.now(),unread:true});
}
async function addActivity(type,title,message){
 const k=push(ref(db,"activityLogs/"+me.uid)).key;
 await set(ref(db,"activityLogs/"+me.uid+"/"+k),{type,title,message,createdAt:Date.now()});
}

window.registerUser=async()=>{
 try{
  if(!$("regName").value.trim())throw Error("Username required");
  if(!/^[6-9]\d{9}$/.test($("regPhone").value.trim()))throw Error("Valid 10 digit mobile number enter karein");
  if($("regPass").value!==$("regPass2").value)throw Error("Passwords match nahi hain");
  if($("regPass").value.length<6)throw Error("Password minimum 6 characters");
  if($("captchaInput").value.trim()!==captcha)throw Error("Verification code galat hai");
  const c=await createUserWithEmailAndPassword(auth,$("regEmail").value.trim(),$("regPass").value);
  me=c.user;
  await set(ref(db,"users/"+c.user.uid),{
   username:$("regName").value.trim(),phone:$("regPhone").value.trim(),email:c.user.email,
   registeredAt:Date.now(),accountStatus:"stopped",activationStatus:"not_submitted",
   balance:0,commission:0,bonusClaimed:false,invalidAttempts:0,penalty:0,blocked:false,
   setup:{accountDetail:false,atm:false,activate:false,run:false}
  });
  await addActivity("account","Registration completed","Your Tiranga Pay account was created.");
  await adminFeed("New user registered",c.user.email+" created an account","registration");
 }catch(e){$("regMsg").textContent=e.message;newCaptcha()}
};
window.loginUser=async()=>{
 try{const c=await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPass").value);me=c.user;await adminFeed("User login",c.user.email+" logged in","login")}
 catch(e){$("loginMsg").textContent=e.message}
};
window.forgotPassword=async()=>{
 try{if(!$("loginEmail").value.trim())throw Error("Email enter karein");await sendPasswordResetEmail(auth,$("loginEmail").value.trim());alert("Password reset email sent")}
 catch(e){alert(e.message)}
};
window.logoutUser=()=>signOut(auth);
window.goPage=(id,b)=>{document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));$(id).classList.add("active");document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));if(b)b.classList.add("active")};
function running(){return u.accountStatus==="running"&&!u.blocked}
function latestPayment(){
 const all=Object.values(paymentRequests||{}).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
 return all[0]||{};
}
function currentActivationHtml(){
 const fee=Number(settings.activationFee||1999),pen=Number(u.penalty||0),total=fee+pen;
 if(u.blocked)return `<div class="card activate row"><div style="font-size:32px">⛔</div><div style="flex:1"><b>ID Blocked</b><div class="label">Maximum invalid attempts reached. Contact Support.</div></div><button class="btn orange" onclick="openSupport()">Support</button></div>`;
 if(running())return `<div class="card activate"><div class="row between"><div><b>✅ Account Activated & Running</b><div class="label">Permanent Activation Code</div></div><span class="badge">${escapeHtml(u.activationCode||payment.activationCode||"—")}</span></div></div>`;
 if(payment.status==="pending")return `<div class="card activate row"><div style="font-size:32px">⏳</div><div style="flex:1"><b>Admin Verification Pending</b><div class="label">Payment submitted successfully. Admin verification ke baad activation code yahin dikhega.</div></div><button class="btn out" onclick="openActivation()">View</button></div>`;
 if(payment.status==="approved")return `<div class="card activate"><div class="row between"><div><b>✅ Payment Approved</b><div class="label">Verification code enter karke account activate karein.</div></div><span class="badge">${escapeHtml(payment.activationCode||u.activationCode||"Code pending")}</span></div><div class="row" style="margin-top:9px"><input id="dashActivationCode" placeholder="Enter verification code"><button class="btn" onclick="verifyCode('dashActivationCode')">Verify & Activate</button></div></div>`;
 if(payment.status==="rejected")return `<div class="card activate"><div class="row"><div style="font-size:30px">❌</div><div style="flex:1"><b>Payment Rejected</b><div class="label">${escapeHtml(payment.rejectReason||"Invalid UTR / Transaction ID")}</div></div></div><div class="grid3" style="margin-top:9px"><div class="stat"><div class="label">Fee</div><b>${money(fee)}</b></div><div class="stat"><div class="label">Penalty</div><b>${money(pen)}</b></div><div class="stat"><div class="label">Payable</div><b>${money(total)}</b></div></div><button class="btn red" style="width:100%;margin-top:8px" onclick="openActivation()">Pay Again ${money(total)}</button></div>`;
 return `<div class="card activate row"><div style="font-size:32px">🛡️</div><div style="flex:1"><b>Account Not Activated</b><div class="label">Activation fee ${money(total)} complete karein.</div></div><button class="btn orange" onclick="openActivation()">Activate Now</button></div>`;
}

function render(){
 if(!me)return;
 $("uName").textContent=u.username||"User";$("uId").textContent=me.uid.slice(0,10).toUpperCase();
 $("bonusTop").textContent=money(settings.bonusAmount||2000);$("balance").textContent=money(u.balance);
 $("commission").textContent=money(u.commission);$("txCount").textContent=transactions.length;
 const old=document.querySelector(".activate");if(old)old.outerHTML=currentActivationHtml();
 const setup=u.setup||{};
 $("steps").innerHTML=[["Account Detail",!!setup.accountDetail],["ATM Setup",!!setup.atm],["Activate",u.activationStatus==="verified"],["Account Run",running()]]
 .map(([n,d],i)=>`<div class="step"><div class="num">${d?"✓":i+1}</div><b>${n}</b><span class="badge ${d?"":"gray"}">${d?"Completed":"Pending"}</span></div>`).join("");
 $("quickGrid").innerHTML=defs.map(([k,i,n,sk,d])=>`<div class="q" onclick="openFeature('${k}','${n}')"><div class="i">${i}</div><b>${n}</b><small>${sk?(settings[sk]??d)+"%":running()?"Available":"🔒 Locked"}</small></div>`).join("");
 $("activityList").innerHTML=activities.length?activities.map(a=>`<div class="card item"><b>${escapeHtml(a.title)}</b><div class="label">${escapeHtml(a.message||"")}</div><div class="label">${new Date(a.createdAt||0).toLocaleString("en-IN")}</div></div>`).join(""):`<div class="card item">No activity yet.</div>`;
 $("txList").innerHTML=transactions.length?transactions.map(t=>`<div class="card item row between"><div><b>${escapeHtml(t.title||t.type)}</b><div class="label">${new Date(t.createdAt||0).toLocaleString("en-IN")}</div></div><div><b class="amount ${Number(t.amount)>=0?"pos":"neg"}">${Number(t.amount)>=0?"+":""}${money(t.amount)}</b><div class="label">${escapeHtml(t.status||"completed")}</div></div></div>`).join(""):`<div class="card item">No transactions yet.</div>`;
 $("runStatus").textContent=u.blocked?"ID BLOCKED":running()?"ACCOUNT RUNNING":"ACCOUNT STOPPED";
 $("runCopy").textContent=running()?"All eligible options are active.":u.blocked?"Only Customer Support is available.":"Complete activation verification.";
 $("runHistory").innerHTML=activities.filter(a=>["account","payment"].includes(a.type)).slice(0,10).map(a=>`<div class="item"><b>${escapeHtml(a.title)}</b><div class="label">${new Date(a.createdAt||0).toLocaleString("en-IN")}</div></div>`).join("");
 $("pName").textContent=u.username||"User";$("pEmail").textContent=u.email||"";$("pPhone").textContent=u.phone||"";$("pStatus").textContent=u.blocked?"Blocked":u.accountStatus||"stopped";
 renderProfileMenu();
}
function renderProfileMenu(){
 const m=[["Personal Information","personal"],["Fund Bank Accounts","fundbanks"],["Account Setup Status","setup"],["Bonus Details","bonusdetails"],["Change Password","password"],["Privacy Policy","privacy"],["Terms & Conditions","terms"],["Fund Policy","fundpolicy"],["Withdrawal Policy","withdrawalpolicy"],["Bonus Policy","bonuspolicy"],["Support Policy","supportpolicy"],["Contact Support","support"],["Logout","logout"]];
 $("profileMenu").innerHTML=m.map(([n,k])=>`<button onclick="profileAction('${k}')">${n} ›</button>`).join("");
}

window.openFeature=(k,n)=>{
 if(locked.has(k)&&!running())return showModal(`<h2>🔒 ${n} Locked</h2><p>Verification code se account activate karne ke baad unlock hoga.</p><button class="btn orange" onclick="openActivation()">Activate Account</button>`);
 if(k==="withdrawal")return openWithdrawal();
 if(k==="bonus")return openBonus();
 if(k==="history")return goPage("transactions",document.querySelectorAll(".nav")[2]);
 if(k==="commission")return showModal(`<h2>Commission</h2><p>Total: <b>${money(u.commission)}</b></p><p>${escapeHtml(settings.commissionPolicy||"Admin-controlled commission records.")}</p>`);
 openFund(k,n);
};

function accountListForFund(k){return Object.values(fundAccounts?.[k]||{}).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))}
function openFund(k,n){
 const data=u.funds?.[k]||{},def=fundDefs[k],rate=settings[def.rate]??def.defaultRate,accounts=accountListForFund(k);
 const rows=accounts.length?accounts.map((a,i)=>`<div class="card item"><b>${i+1}. ${escapeHtml(a.bankName)}</b><div class="label">${escapeHtml(a.holderName)} · A/C ****${escapeHtml(String(a.accountNumber).slice(-4))}</div><div class="label">IFSC: ${escapeHtml(a.ifsc)} · ${escapeHtml(a.status||"active")}</div></div>`).join(""):`<div class="notice">No bank account added in this fund.</div>`;
 showModal(`<h2>${def.icon} ${n}</h2><p>Percentage: <b>${rate}%</b> · Available: <b>${money(data.balance)}</b> · Commission: <b>${money(data.commission)}</b></p><div class="notice">Each fund allows maximum 10 bank accounts. प्रत्येक फंड में अधिकतम 10 बैंक खाते जोड़े जा सकते हैं।</div><div class="list" style="margin:10px 0">${rows}</div><button class="btn" onclick="startFundAccountSetup('${k}')">Add Bank Account (${accounts.length}/10)</button><div class="policy" style="margin-top:10px">${escapeHtml(settings.fundPolicy||"Fund policy not added.")}</div>`);
}
window.startFundAccountSetup=k=>{
 const accounts=accountListForFund(k);if(accounts.length>=10)return alert("Maximum 10 accounts allowed in this fund");
 const def=fundDefs[k];
 showModal(`<h2>${def.icon} ${def.name} — Setup 1/3</h2><div class="form"><input id="faHolder" placeholder="Account Holder Name"><input id="faAccount" inputmode="numeric" placeholder="Account Number"><input id="faConfirm" inputmode="numeric" placeholder="Confirm Account Number"><input id="faPhone" inputmode="numeric" placeholder="10 Digit Mobile Number"><input id="faIfsc" maxlength="11" placeholder="IFSC Code"><input id="faBank" list="bankList" placeholder="Type Bank Name"><datalist id="bankList">${indianBanks.map(b=>`<option value="${b}">`).join("")}</datalist><button class="btn" onclick="fundStep2('${k}')">Continue to ATM Details</button></div>`);
};
window.fundStep2=k=>{
 const holder=$("faHolder").value.trim(),acc=$("faAccount").value.trim(),confirm=$("faConfirm").value.trim(),phone=$("faPhone").value.trim(),ifsc=$("faIfsc").value.trim().toUpperCase(),bank=$("faBank").value.trim();
 if(holder.length<3)return alert("Valid holder name required");if(!/^\d{8,18}$/.test(acc))return alert("Account number 8–18 digits hona chahiye");if(acc!==confirm)return alert("Account numbers match nahi hain");if(!/^[6-9]\d{9}$/.test(phone))return alert("Valid mobile number required");if(!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc))return alert("Invalid IFSC format");if(!indianBanks.some(b=>b.toLowerCase()===bank.toLowerCase()))return alert("List se valid bank name select karein");
 sessionStorage.setItem("fundDraft",JSON.stringify({k,holderName:holder,accountNumber:acc,phone,ifsc,bankName:indianBanks.find(b=>b.toLowerCase()===bank.toLowerCase())}));
 showModal(`<h2>${fundDefs[k].icon} ${fundDefs[k].name} — Setup 2/3</h2><div class="notice">Security: ATM PIN, CVV aur full card number kabhi mat dalein. केवल सुरक्षित ATM विवरण रखें।</div><div class="form" style="margin-top:10px"><input id="atmHolder" placeholder="ATM Card Holder Name"><input id="atmLast4" inputmode="numeric" maxlength="4" placeholder="Card Last 4 Digits"><input id="atmExpiry" placeholder="Expiry MM/YY"><select id="atmType"><option value="">Select Card Type</option><option>RuPay</option><option>Visa</option><option>Mastercard</option></select><button class="btn" onclick="fundStep3('${k}')">Continue to Setup Code</button></div>`);
};
window.fundStep3=async k=>{
 const holder=$("atmHolder").value.trim(),last4=$("atmLast4").value.trim(),expiry=$("atmExpiry").value.trim(),type=$("atmType").value;
 if(holder.length<3)return alert("ATM holder name required");if(!/^\d{4}$/.test(last4))return alert("Only last 4 digits required");if(!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry))return alert("Expiry MM/YY format mein dalein");if(!type)return alert("Card type select karein");
 const draft=JSON.parse(sessionStorage.getItem("fundDraft")||"{}");draft.atm={holder,last4,expiry,type};sessionStorage.setItem("fundDraft",JSON.stringify(draft));
 let code=fundCodes?.[k]?.code;
 if(!code){code=(k.slice(0,2).toUpperCase()+Math.random().toString(36).slice(2,8)).toUpperCase().slice(0,8);await set(ref(db,`fundSetupCodes/${me.uid}/${k}`),{code,createdAt:Date.now()})}
 showModal(`<h2>${fundDefs[k].icon} ${fundDefs[k].name} — Setup 3/3</h2><div class="notice"><b>Your permanent fund setup code:</b><div style="font-size:24px;font-weight:900;letter-spacing:3px;margin:8px 0">${escapeHtml(code)}</div>कृपया इस कोड को सुरक्षित रखें। इसी फंड में दूसरा बैंक खाता जोड़ने के लिए यही कोड जरूरी होगा।<br><br>Please keep this code safe. The same code is required whenever you add another bank account in this fund.</div><div class="form" style="margin-top:10px"><input id="fundCodeInput" placeholder="Enter same 8-character code"><button class="btn" onclick="completeFundAccount('${k}')">Verify Code & Complete Setup</button></div>`);
};
window.completeFundAccount=async k=>{
 const entered=$("fundCodeInput").value.trim().toUpperCase(),stored=fundCodes?.[k]?.code;
 if(!stored||entered!==stored)return alert("Setup code does not match");
 const draft=JSON.parse(sessionStorage.getItem("fundDraft")||"{}");if(draft.k!==k)return alert("Setup session expired. Start again.");
 const id=push(ref(db,`fundAccounts/${me.uid}/${k}`)).key;
 await set(ref(db,`fundAccounts/${me.uid}/${k}/${id}`),{...draft,status:"active",createdAt:Date.now()});
 await update(ref(db,`users/${me.uid}/setup`),{accountDetail:true,atm:true});
 await addActivity("account",fundDefs[k].name+" account added",draft.bankName+" account setup completed.");
 await adminFeed("Fund bank account added",me.email+" added account in "+fundDefs[k].name,"fund_account");
 sessionStorage.removeItem("fundDraft");alert("Fund account setup completed");openFund(k,fundDefs[k].name);
};

window.openActivation=()=>{
 if(u.blocked)return showModal(`<h2>⛔ ID Blocked</h2><p>4 invalid attempts reached.</p><button class="btn orange" onclick="openSupport()">Contact Support</button>`);
 const fee=Number(settings.activationFee||1999),total=fee+Number(u.penalty||0);
 if(running())return showModal(`<h2>✅ Account Activated</h2><p>Permanent Activation Code:</p><div style="font-size:24px;font-weight:900">${escapeHtml(u.activationCode||payment.activationCode||"—")}</div>`);
 if(payment.status==="pending")return showModal(`<h2>⏳ Admin Verification Pending</h2><p>Your payment of <b>${money(payment.amount)}</b> has been submitted.</p><div class="notice">Admin verification ke baad verification code dashboard par automatic dikhne lagega.</div>`);
 if(payment.status==="approved")return showModal(`<h2>✅ Payment Approved</h2><p>Verification Code: <b>${escapeHtml(payment.activationCode||u.activationCode||"Pending")}</b></p><input id="activationCode"><button class="btn" onclick="verifyCode('activationCode')">Verify & Activate</button>`);
 showModal(`<h2>${payment.status==="rejected"?"❌ Pay Again":"Activate Your Account"}</h2>${payment.status==="rejected"?`<div class="notice">Rejected: ${escapeHtml(payment.rejectReason||"Invalid UTR")}</div>`:""}<p>Activation Fee: <b>${money(fee)}</b></p><p>Penalty: <b>${money(u.penalty||0)}</b></p><p>Total Payable: <b>${money(total)}</b></p><p>UPI ID: <b>${escapeHtml(settings.adminUpiId||"Not set")}</b></p>${settings.paymentQr?`<img src="${escapeHtml(settings.paymentQr)}" style="max-width:220px;width:100%">`:""}<div class="form"><input id="utrInput" placeholder="UTR / Transaction ID"><textarea id="paymentNote" placeholder="Optional note"></textarea><button class="btn" onclick="submitPayment()">Submit Payment Details</button></div><div class="notice">1st reject: ₹100 · 2nd: total ₹300 · 3rd: total ₹600 · 4th: ID auto-block.</div>`);
};
window.submitPayment=async()=>{
 try{
  const utr=$("utrInput").value.trim();if(!/^[A-Za-z0-9-]{8,30}$/.test(utr))throw Error("Valid UTR / Transaction ID required");
  if(payment.status==="pending")throw Error("One payment is already pending");
  const amount=Number(settings.activationFee||1999)+Number(u.penalty||0),id=push(ref(db,`activationPayments/${me.uid}`)).key;
  await set(ref(db,`activationPayments/${me.uid}/${id}`),{requestId:id,uid:me.uid,email:me.email,utr,note:$("paymentNote").value.trim(),amount,status:"pending",attempt:Number(u.invalidAttempts||0)+1,createdAt:Date.now()});
  await update(ref(db,`users/${me.uid}`),{activationStatus:"pending",currentPaymentId:id});
  await addActivity("payment","Activation payment submitted",money(amount)+" verification request sent.");
  await adminFeed("New payment request",me.email+" submitted "+money(amount),"payment");
  closeModal();alert("Payment submitted. Admin verification pending.");
 }catch(e){alert(e.message)}
};
window.verifyCode=async inputId=>{
 try{
  const code=$(inputId)?.value.trim().toUpperCase();const expected=(payment.activationCode||u.activationCode||"").toUpperCase();
  if(!code||code!==expected)throw Error("Invalid verification code");
  await update(ref(db,`users/${me.uid}`),{activationCode:expected,activationStatus:"verified",accountStatus:"running",activatedAt:Date.now(),"setup/activate":true,"setup/run":true});
  await addActivity("account","Account activated","Verification code accepted. Account is now running.");
  await adminFeed("Account activated",me.email+" verified activation code","activation");
  closeModal();alert("Account activated successfully");
 }catch(e){alert(e.message)}
};

function openWithdrawal(){
 showModal(`<h2>Withdrawal</h2><p>Available Balance: <b>${money(u.balance)}</b></p><p>Minimum: <b>${money(settings.minWithdrawal||0)}</b></p><div class="grid2"><button class="btn out" onclick="withdrawForm('bank')">Bank Account</button><button class="btn out" onclick="withdrawForm('upi')">UPI</button></div><div id="withdrawDynamic" style="margin-top:10px"></div><div class="policy">${escapeHtml(settings.withdrawalPolicy||"")}</div>`);
}
window.withdrawForm=method=>{
 const el=$("withdrawDynamic");
 if(method==="upi")el.innerHTML=`<div class="form"><input id="wAmount" type="number" placeholder="Withdrawal Amount"><input id="wUpi" placeholder="UPI ID (example: name@upi)"><button class="btn" onclick="requestWithdrawal('upi')">Request UPI Withdrawal</button></div>`;
 else el.innerHTML=`<div class="form"><input id="wAmount" type="number" placeholder="Withdrawal Amount"><input id="wHolder" placeholder="Account Holder Name"><input id="wAccount" inputmode="numeric" placeholder="Account Number"><input id="wConfirm" inputmode="numeric" placeholder="Confirm Account Number"><input id="wIfsc" maxlength="11" placeholder="IFSC Code"><input id="wPhone" inputmode="numeric" placeholder="Mobile Number"><input id="wBank" list="wBankList" placeholder="Bank Name"><datalist id="wBankList">${indianBanks.map(b=>`<option value="${b}">`).join("")}</datalist><button class="btn" onclick="requestWithdrawal('bank')">Request Bank Withdrawal</button></div>`;
};
window.requestWithdrawal=async method=>{
 try{
  const amount=Number($("wAmount").value),min=Number(settings.minWithdrawal||0);
  if(!Number.isFinite(amount)||amount<=0||amount<min||amount>Number(u.balance||0))throw Error("Invalid withdrawal amount");
  let details={};
  if(method==="upi"){
   const upi=$("wUpi").value.trim().toLowerCase();
   if(!/^[a-z0-9._-]{2,256}@[a-z]{2,64}$/.test(upi))throw Error("Valid UPI ID enter karein, example name@upi");
   details={upiId:upi};
  }else{
   const holder=$("wHolder").value.trim(),acc=$("wAccount").value.trim(),confirm=$("wConfirm").value.trim(),ifsc=$("wIfsc").value.trim().toUpperCase(),phone=$("wPhone").value.trim(),bank=$("wBank").value.trim();
   if(holder.length<3)throw Error("Valid holder name required");if(!/^\d{8,18}$/.test(acc)||acc!==confirm)throw Error("Account numbers invalid or not matching");if(!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc))throw Error("Invalid IFSC");if(!/^[6-9]\d{9}$/.test(phone))throw Error("Invalid mobile number");if(!indianBanks.some(b=>b.toLowerCase()===bank.toLowerCase()))throw Error("Valid bank select karein");
   details={holderName:holder,accountNumber:acc,ifsc,phone,bankName:indianBanks.find(b=>b.toLowerCase()===bank.toLowerCase())};
  }
  const k=push(ref(db,"withdrawals")).key;
  await set(ref(db,`withdrawals/${k}`),{requestId:k,uid:me.uid,email:me.email,amount,method,status:"pending",details,createdAt:Date.now()});
  await addActivity("withdrawal","Withdrawal requested",money(amount)+" "+method+" request submitted.");
  await adminFeed("Withdrawal request",me.email+" requested "+money(amount),"withdrawal");
  closeModal();alert("Withdrawal request submitted");
 }catch(e){alert(e.message)}
};

function openBonus(){
 showModal(`<h2>Bonus Claim</h2><p>Available Bonus: <b>${money(settings.bonusAmount||2000)}</b></p><p>Status: <b>${u.bonusClaimed?"Claimed":"Eligible"}</b></p><button class="btn" onclick="claimBonus()" ${u.bonusClaimed?"disabled":""}>${u.bonusClaimed?"Already Claimed":"Claim Bonus Now"}</button><div class="policy">${escapeHtml(settings.bonusPolicy||"")}</div>`);
}
window.claimBonus=async()=>{
 try{
  if(u.bonusClaimed)throw Error("Bonus already claimed");
  const amount=Number(settings.bonusAmount||2000);
  await update(ref(db,`users/${me.uid}`),{bonusClaimed:true,bonusClaimedAt:Date.now(),balance:Number(u.balance||0)+amount});
  const txid=push(ref(db,`transactions/${me.uid}`)).key;
  await set(ref(db,`transactions/${me.uid}/${txid}`),{title:"One-time Bonus",type:"bonus",amount,status:"completed",createdAt:Date.now()});
  await addActivity("bonus","Bonus claimed",money(amount)+" added to Total Balance.");
  await adminFeed("Bonus claimed",me.email+" claimed "+money(amount),"bonus");
  closeModal();alert(money(amount)+" added to your balance");
 }catch(e){alert(e.message)}
};

window.profileAction=async k=>{
 if(k==="logout")return logoutUser();if(k==="support")return openSupport();
 if(k==="password"){await sendPasswordResetEmail(auth,me.email);return alert("Password reset email sent")}
 if(k==="fundbanks"){const html=Object.keys(fundDefs).map(f=>`<button class="btn out" style="width:100%;margin:4px 0" onclick="openFund('${f}','${fundDefs[f].name}')">${fundDefs[f].icon} ${fundDefs[f].name} (${accountListForFund(f).length}/10)</button>`).join("");return showModal(`<h2>Fund Bank Accounts</h2>${html}`)}
 const map={
  privacy:["Privacy Policy",settings.privacyPolicy],terms:["Terms & Conditions",settings.terms],
  fundpolicy:["Fund Policy",settings.fundPolicy],withdrawalpolicy:["Withdrawal Policy",settings.withdrawalPolicy],
  bonuspolicy:["Bonus Policy",settings.bonusPolicy],supportpolicy:["Support Policy",settings.supportPolicy],
  personal:["Personal Information",`Username: ${escapeHtml(u.username)}<br>Email: ${escapeHtml(u.email)}<br>Mobile: ${escapeHtml(u.phone)}`],
  setup:["Account Setup Status",`Activation: ${escapeHtml(u.activationStatus||"pending")}<br>Account: ${escapeHtml(u.accountStatus||"stopped")}<br>Permanent Code: ${escapeHtml(u.activationCode||"Not activated")}`],
  bonusdetails:["Bonus Details",`Bonus: ${money(settings.bonusAmount||2000)}<br>Claimed: ${u.bonusClaimed?"Yes":"No"}`]
 };
 const [t,c]=map[k]||["Details",""];showModal(`<h2>${t}</h2><div class="policy">${c||"Not added"}</div>`);
};
window.openSupport=()=>showModal(`<h2>Customer Support</h2><div class="policy">${escapeHtml(settings.supportContact||"Support details not set")}</div>${settings.telegramLink?`<a class="btn" href="${escapeHtml(settings.telegramLink)}" target="_blank">Open Telegram</a>`:""}`);
window.showModal=h=>{$("modalBody").innerHTML=h;$("modal").classList.remove("hidden")};
window.closeModal=()=>$("modal").classList.add("hidden");

onAuthStateChanged(auth,x=>{
 me=x;$("authView").classList.toggle("hidden",!!x);$("mainView").classList.toggle("hidden",!x);if(!x)return;
 onValue(ref(db,"settings"),s=>{settings=s.val()||{};render()});
 onValue(ref(db,`users/${x.uid}`),s=>{u=s.val()||{};render()});
 onValue(ref(db,`activationPayments/${x.uid}`),s=>{paymentRequests=s.val()||{};payment=latestPayment();render()});
 onValue(ref(db,`activityLogs/${x.uid}`),s=>{activities=Object.values(s.val()||{}).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));render()});
 onValue(ref(db,`transactions/${x.uid}`),s=>{transactions=Object.values(s.val()||{}).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));render()});
 onValue(ref(db,`fundAccounts/${x.uid}`),s=>{fundAccounts=s.val()||{};render()});
 onValue(ref(db,`fundSetupCodes/${x.uid}`),s=>{fundCodes=s.val()||{};render()});
});
