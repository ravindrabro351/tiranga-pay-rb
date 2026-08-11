import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getDatabase, ref, get, set, update, push, onValue, runTransaction
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const dt = t => t ? new Date(Number(t)).toLocaleString('en-IN') : '—';
const now = () => Date.now();
const FUND_KEYS = ['gaming','stock','mix','political','outside'];
const FUND_INFO = {
  gaming:{name:'Gaming Fund',icon:'🎮',rateKey:'gamingFundRate',fallbackRate:15},
  stock:{name:'Stock Fund',icon:'📈',rateKey:'stockFundRate',fallbackRate:30},
  mix:{name:'Mix Fund',icon:'🔄',rateKey:'mixFundRate',fallbackRate:25},
  political:{name:'Political Fund',icon:'🏛️',rateKey:'politicalFundRate',fallbackRate:30},
  outside:{name:'Outside Fund',icon:'🌐',rateKey:'outsideFundRate',fallbackRate:40},
  performance:{name:'Performance Bonus',icon:'🎯',rateKey:'performanceBonusRate',fallbackRate:8}
};
const PLAN_INFO = {
  gaming:{name:'Gaming Fund Activate',icon:'🎮'},
  stock:{name:'Stock Fund Activate',icon:'📈'},
  mix:{name:'Mix Fund Activate',icon:'🔄'},
  political:{name:'Political Fund Activate',icon:'🏛️'},
  outside:{name:'Outside Fund Activate',icon:'🌐'},
  allFunds:{name:'Activate All Funds Together',icon:'⭐'}
};
const DEFAULT_PLAN = { amount:1999, upi:'', qr:'', enabled:true, instructions:'Pay using UPI/QR and submit the correct UTR / Transaction ID.' };

let me = null;
let unsubscribers = [];
let state = {
  settings:{}, banks:{}, user:{}, payments:{}, transactions:{}, activities:{}, fundAccounts:{}, fundCodes:{},
  withdrawals:{}, overrides:{}, notifications:{}, globalNotifications:{}, bonusClaim:null
};
let txFilter = 'all';
let captcha = '';
let draftBank = null;
let draftAtm = null;

window.addEventListener('error', e => console.error('Tiranga Pay:', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', e => console.error('Tiranga Pay promise:', e.reason));

function showLoading(on){ $('loading').classList.toggle('hidden', !on); }
function toast(message){ const el=$('toast'); el.textContent=message; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.add('hidden'),2800); }
function showAuth(which){
  ['welcomeBox','loginBox','registerBox'].forEach(id=>$(id).classList.add('hidden'));
  $({welcome:'welcomeBox',login:'loginBox',register:'registerBox'}[which]||'welcomeBox').classList.remove('hidden');
  if(which==='register') refreshCaptcha();
}
function refreshCaptcha(){ captcha=String(Math.floor(100000+Math.random()*900000)); $('captchaCode').textContent=captcha.split('').join(' '); $('captchaInput').value=''; }
function modal(html){ $('modalBody').innerHTML=html; $('modal').classList.remove('hidden'); bindModal(); }
function closeModal(){ $('modal').classList.add('hidden'); $('modalBody').innerHTML=''; }
function isBlocked(){ return state.user?.blocked === true; }
function hasNewFundActivationState(){ return !!(state.user?.fundActivations && Object.keys(state.user.fundActivations||{}).length); }
function isFundActive(k){
  if(hasNewFundActivationState()) return state.user?.fundActivations?.[k]?.active === true;
  // Backward compatibility: users who were already verified/running before V6 stay unlocked.
  return state.user?.activationStatus === 'verified' || state.user?.accountStatus === 'running';
}
function commonUnlocked(){ return FUND_KEYS.some(isFundActive); }
function enabledBanks(){ return Object.entries(state.banks||{}).filter(([,b])=>b?.enabled!==false).map(([id,b])=>({id,name:b?.name||id})).sort((a,b)=>a.name.localeCompare(b.name)); }
function fundRate(k){ const f=FUND_INFO[k]; return Number(state.settings?.[f.rateKey] ?? f.fallbackRate); }
function userInitial(){ return (state.user?.username||state.user?.email||'U').trim().charAt(0).toUpperCase() || 'U'; }
function activeFundNames(){ return FUND_KEYS.filter(isFundActive).map(k=>FUND_INFO[k].name); }
function currentDevice(){ const ua=navigator.userAgent||''; if(/Android/i.test(ua))return 'Android Mobile'; if(/iPhone|iPad/i.test(ua))return 'iPhone / iPad'; if(/Windows/i.test(ua))return 'Windows Device'; if(/Mac/i.test(ua))return 'Mac Device'; return 'Web Browser'; }
function normalizePaymentReference(v){return String(v||'').trim().replace(/\s+/g,'');}
function paymentReferenceKind(v){
  const x=normalizePaymentReference(v);
  return /^\d{12}$/.test(x) ? 'utr' : '';
}
function isValidPaymentReference(v){return /^\d{12}$/.test(normalizePaymentReference(v));}
function samePaymentReference(a,b){return normalizePaymentReference(a).toUpperCase()===normalizePaymentReference(b).toUpperCase();}
function normalizeActivationCode(v){
  return String(v||'').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').trim().replace(/\s+/g,'').toUpperCase();
}
function paymentActivationComplete(p){
  if(!p)return false;
  return p.planKey==='allFunds' ? FUND_KEYS.every(isFundActive) : !!p.planKey && isFundActive(p.planKey);
}
function activeActivationRequest(){
  return paymentsArray().find(p=>p.status==='pending'||(p.status==='approved'&&!paymentActivationComplete(p)));
}

function planConfig(key){
  const globalCfg = state.settings?.activationPlans?.[key] || {};
  const override = state.overrides?.[key] || {};
  const legacy = {
    amount:Number(state.settings?.activationFee||1999),
    upi:state.settings?.adminUpiId||'',
    qr:state.settings?.paymentQr||'',
    enabled:true,
    instructions:'Pay using UPI/QR and submit the correct UTR / Transaction ID.'
  };
  return {
    ...DEFAULT_PLAN,
    ...legacy,
    ...globalCfg,
    ...(override.amount!==undefined && override.amount!=='' ? {amount:Number(override.amount)} : {}),
    ...(override.upi ? {upi:override.upi} : {}),
    ...(override.qr ? {qr:override.qr} : {}),
    ...(override.instructions ? {instructions:override.instructions} : {}),
    ...(override.enabled!==undefined ? {enabled:override.enabled} : {})
  };
}
function paymentsArray(){ return Object.entries(state.payments||{}).map(([id,p])=>({id,...p})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); }
function latestPayment(key){ return paymentsArray().find(p=>p.planKey===key); }
function txArray(){ return Object.entries(state.transactions||{}).map(([id,t])=>({id,...t})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); }
function activityArray(){ return Object.entries(state.activities||{}).map(([id,a])=>({id,...a})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); }
function withdrawalArray(){ return Object.entries(state.withdrawals||{}).map(([id,w])=>({id,...w})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); }
function accountArray(fund){ return Object.entries(state.fundAccounts?.[fund]||{}).map(([id,a])=>({id,...a})).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)); }

function render(){
  if(!me) return;
  renderHome(); renderTransactions(); renderActivity(); renderRunStatus(); renderProfile(); renderNotificationsBadge();
}

function setAvatar(el){
  const photo=state.user?.profilePhoto;
  el.textContent=photo?'':userInitial();
  el.style.backgroundImage=photo?`url(${JSON.stringify(photo).slice(1,-1)})`:'';
}

function renderHome(){
  const u=state.user||{};
  $('homeName').textContent=u.username||'User'; $('homeUserCode').textContent=u.userCode||me.uid.slice(0,10).toUpperCase();
  setAvatar($('homeAvatar'));
  $('homeBalance').textContent=money(u.balance); $('homeCommission').textContent=money(u.commission); $('homeTransactions').textContent=txArray().length.toLocaleString('en-IN');
  const unlocked=commonUnlocked(), inProgress=activeActivationRequest();
  $('homeVipBadge').textContent=isBlocked()?'Blocked':unlocked?'VIP Active':'Not Active';
  $('homeVipBadge').className='status-badge '+(isBlocked()?'red':unlocked?'green':'gray');
  $('blockedBanner').classList.toggle('hidden',!isBlocked());
  $('blockedBanner').innerHTML=isBlocked()?'⚠️ Your ID is blocked after repeated invalid payment submissions. Customer Support remains available.':'';
  if(inProgress?.status==='pending'){
    $('activationTitle').textContent='Payment Verification Pending';
    $('activationSubtitle').textContent=`${PLAN_INFO[inProgress.planKey]?.name||inProgress.planName||'Activation'} • Admin verification pending`;
    $('openActivationBtn').textContent='View Pending';
  }else if(inProgress?.status==='approved'){
    $('activationTitle').textContent='Activation Code Ready';
    $('activationSubtitle').textContent=`${PLAN_INFO[inProgress.planKey]?.name||inProgress.planName||'Activation'} • Enter the Admin-approved activation code`;
    $('openActivationBtn').textContent='Enter Code';
  }else{
    $('activationTitle').textContent=unlocked?'Manage Fund Activation':'Activate Funds';
    $('activationSubtitle').textContent=unlocked?'Activate more funds or view existing fund status.':'Choose one fund or activate all funds together.';
    $('openActivationBtn').textContent=unlocked?'Manage':'Activate';
  }
  $('activeFundPills').innerHTML=activeFundNames().map(n=>`<span>✓ ${esc(n)}</span>`).join('');
  $('quickState').textContent=isBlocked()?'Blocked':unlocked?'Common Features Unlocked':'Locked';
  $('quickState').className='status-badge '+(isBlocked()?'red':unlocked?'green':'gray');

  const cards=[
    ['gaming',FUND_INFO.gaming.name,FUND_INFO.gaming.icon,`${fundRate('gaming')}%`],
    ['stock',FUND_INFO.stock.name,FUND_INFO.stock.icon,`${fundRate('stock')}%`],
    ['mix',FUND_INFO.mix.name,FUND_INFO.mix.icon,`${fundRate('mix')}%`],
    ['political',FUND_INFO.political.name,FUND_INFO.political.icon,`${fundRate('political')}%`],
    ['outside',FUND_INFO.outside.name,FUND_INFO.outside.icon,`${fundRate('outside')}%`],
    ['performance',FUND_INFO.performance.name,FUND_INFO.performance.icon,`${fundRate('performance')}%`],
    ['history','Transaction History','📄','Realtime'],
    ['commission','Commission','💰',money(u.commission)],
    ['withdrawal','Withdrawal','🏦','Bank / UPI'],
    ['bonus','Bonus Claim','🎁',u.bonusClaimed?'Claimed':money(state.settings?.bonusAmount||0)]
  ];
  $('quickGrid').innerHTML=cards.map(([k,n,i,sub])=>{
    const allowed = FUND_KEYS.includes(k)?isFundActive(k):(k==='performance'?unlocked:unlocked);
    const effective = allowed && !isBlocked();
    return `<button class="quick-card ${effective?'active':''}" data-feature="${k}"><span class="lock-state">${effective?'✓ Active':'🔒 Locked'}</span><span class="qicon">${i}</span><b>${esc(n)}</b><small>${esc(sub)}</small></button>`;
  }).join('');
  document.querySelectorAll('[data-feature]').forEach(b=>b.onclick=()=>openFeature(b.dataset.feature));
}

function renderTransactions(){
  const filters=['all','credit','debit','commission','bonus','withdrawal'];
  $('txFilters').innerHTML=filters.map(f=>`<button data-txf="${f}" class="${txFilter===f?'active':''}">${f[0].toUpperCase()+f.slice(1)}</button>`).join('');
  document.querySelectorAll('[data-txf]').forEach(b=>b.onclick=()=>{txFilter=b.dataset.txf;renderTransactions()});
  let arr=txArray(); if(txFilter!=='all') arr=arr.filter(t=>t.type===txFilter);
  $('transactionList').innerHTML=arr.length?arr.map(t=>{
    const type=t.type||'credit',negative=['debit','withdrawal'].includes(type),signed=negative?'-':'+',icon=type==='credit'?'↗':type==='commission'?'₹':type==='debit'?'↙':type==='bonus'?'🎁':'🏦',fundName=t.fundName||FUND_INFO[t.fund]?.name||(type==='bonus'?'Bonus':type==='withdrawal'?'Withdrawal':'Account Ledger'),status=(t.status||'completed').toUpperCase();
    return `<article class="tx-history-card ${negative?'negative':'positive'}"><div class="tx-history-icon ${negative?'red':'green'}">${icon}</div><div class="tx-history-main"><div class="tx-history-head"><div><h4>${esc(t.title||'Transaction')}</h4><span class="tx-fund">${esc(fundName)}</span></div><div class="amount ${negative?'minus':'plus'}">${signed}${money(t.amount)}</div></div><div class="tx-meta"><span>${esc(type.toUpperCase())}</span><span>${esc(status)}</span><span>${dt(t.createdAt)}</span></div><div class="tx-id">ID: ${esc(t.transactionId||t.id)}${t.batchId?` • Batch: ${esc(t.batchId)}`:''}${t.sequenceText?` • ${esc(t.sequenceText)}`:t.sequence?` • ${esc(t.sequence)}`:''}</div>${t.commissionRate!==undefined?`<div class="tx-note">Commission Rate: ${esc(t.commissionRate)}%${t.parentTransactionId?` • Credit ID: ${esc(t.parentTransactionId)}`:''}</div>`:''}</div></article>`;
  }).join(''):'<div class="list-card"><b>No transactions yet</b><p>Your realtime transaction history will appear here.</p></div>';
}

function renderActivity(){
  const arr=activityArray();
  $('activityList').innerHTML=arr.length?arr.map(a=>`<article class="list-card"><div class="topline"><h4>${esc(a.title||'Activity')}</h4><span class="status-badge gray">${esc(a.type||'update')}</span></div><p>${esc(a.message||'')}</p><p>${dt(a.createdAt)}</p></article>`).join(''):'<div class="list-card"><b>No activity yet</b></div>';
}

function renderRunStatus(){
  const unlocked=commonUnlocked();
  $('runStatusCard').innerHTML=`<div class="big-icon">${isBlocked()?'⛔':unlocked?'✅':'🛡️'}</div><h2>${isBlocked()?'ACCOUNT BLOCKED':unlocked?'ACCOUNT RUNNING':'ACTIVATION REQUIRED'}</h2><p>${isBlocked()?'Contact Support for account review.':unlocked?'At least one fund is active. Common options are unlocked.':'Activate and verify at least one fund.'}</p>`;
  $('runFunds').innerHTML=[...FUND_KEYS,'performance'].map(k=>{
    const active=k==='performance'?unlocked:isFundActive(k);
    return `<div class="fund-status-row"><div><b>${FUND_INFO[k].icon} ${FUND_INFO[k].name}</b><div class="muted small">${fundRate(k)}%</div></div><span class="status-badge ${active&&!isBlocked()?'green':'gray'}">${active&&!isBlocked()?'Active':'Locked'}</span></div>`;
  }).join('');
}

function renderProfile(){
  const u=state.user||{}, unlocked=commonUnlocked(), bonus=Number(state.settings?.bonusAmount||0);
  setAvatar($('profileAvatar')); $('profileName').textContent=u.username||'User'; $('profileUserCode').textContent=u.userCode||me.uid.slice(0,10).toUpperCase();
  $('profileRegistered').textContent=u.registeredAt?new Date(u.registeredAt).toLocaleDateString('en-IN'):'—';
  $('profileStatus').textContent=isBlocked()?'Blocked':unlocked?'Active':'Not Active';
  $('profileVip').textContent=unlocked?'VIP Verified User':'Activation Required'; $('profileVerified').style.display=unlocked?'grid':'none';
  $('profileBalance').textContent=money(u.balance); $('profileCommission').textContent=money(u.commission); $('profileTransactions').textContent=txArray().length.toLocaleString('en-IN'); $('profileBonus').textContent=u.bonusClaimed?'₹0':money(bonus);
  $('lastLogin').textContent=dt(u.lastLoginAt); $('lastDevice').textContent=u.lastDevice||currentDevice();
  const actions=[
    ['bank','🏦','My Bank Details'],['funds','💳','Fund Accounts'],['password','🔐','Change Password'],['verification','🛡️','KYC & Verification'],
    ['personal','👤','Personal Info'],['notifications','🔔','Notifications'],['support','🎧','Support'],['logout','⏻','Logout']
  ];
  $('profileActions').innerHTML=actions.map(([k,i,n])=>`<button class="profile-action" data-profile-action="${k}"><span>${i}</span><small>${esc(n)}</small></button>`).join('');
  document.querySelectorAll('[data-profile-action]').forEach(b=>b.onclick=()=>profileAction(b.dataset.profileAction));
  const hasAccount=Object.values(state.fundAccounts||{}).some(x=>Object.keys(x||{}).length>0);
  const pct=hasAccount?100:unlocked?75:25; $('progressPercent').textContent=pct+'%'; $('progressBar').style.width=pct+'%'; $('progressText').textContent=`Your account is ${pct}% complete`;
  $('progSetup').textContent=hasAccount?'✓':'2'; $('progActivate').textContent=unlocked?'✓':'3'; $('progComplete').textContent=pct===100?'✓':'4';
}

function renderNotificationsBadge(){
  const count=Object.keys(state.notifications||{}).length+Object.keys(state.globalNotifications||{}).length;
  $('notificationCount').textContent=count; $('notificationCount').classList.toggle('hidden',count===0);
}

function openFeature(k){
  if(k==='history') return commonGate(()=>goPage('transactions'));
  if(k==='commission') return commonGate(()=>commissionModal());
  if(k==='withdrawal') return commonGate(()=>withdrawalModal());
  if(k==='bonus') return commonGate(()=>bonusModal());
  if(k==='performance') return commonGate(()=>openFund('performance'));
  if(FUND_KEYS.includes(k)){
    if(isBlocked()) return supportBlocked();
    if(!isFundActive(k)) return openActivation(k);
    return openFund(k);
  }
}
function commonGate(fn){ if(isBlocked())return supportBlocked(); if(!commonUnlocked())return modal('<div class="status-hero"><div class="status-icon">🔒</div><h2>Feature Locked</h2><p>Activate and verify any one fund to unlock this option.</p><button class="primary wide" id="goActivate">Activate Fund</button></div>'); fn(); }
function supportBlocked(){ modal(`<div class="status-hero"><div class="status-icon">⛔</div><h2>ID Blocked</h2><p>Repeated invalid payment submissions have blocked this ID.</p><button class="primary wide" id="modalSupport">Customer Support</button></div>`); }

function openActivation(preselect=null){
  if(isBlocked()) return supportBlocked();
  const inProgress=activeActivationRequest();
  if(inProgress?.status==='pending') return pendingPaymentModal(inProgress);
  if(inProgress?.status==='approved') return verifyCodeModal(inProgress);
  if(preselect) return openPlan(preselect);
  const cards=Object.entries(PLAN_INFO).map(([k,p])=>{
    const cfg=planConfig(k), active=k==='allFunds'?FUND_KEYS.every(isFundActive):isFundActive(k), latest=latestPayment(k);
    let status=active?'Active':latest?.status==='pending'?'Pending':latest?.status==='approved'?'Code Ready':latest?.status==='rejected'?'Pay Again':'Activate';
    return `<div class="plan-card"><div class="plan-icon">${p.icon}</div><div class="grow"><h4>${esc(p.name)}</h4><p>${active?'Already activated':cfg.enabled===false?'Currently disabled':money(Number(cfg.amount||0)+Number(state.user?.penalty||0))}</p><strong>${status}</strong></div><button data-plan="${k}">›</button></div>`;
  }).join('');
  modal(`<h2>Fund Activation</h2><p>Choose one fund or activate all funds together. Only verified fund(s) will unlock.</p><div class="plan-grid">${cards}</div><div class="notice-box">Fake / invalid UTR may attract penalty. 1st total ₹100 • 2nd total ₹300 • 3rd total ₹600 • 4th rejection: ID block.</div>`);
}

function openPlan(key){
  const p=PLAN_INFO[key], cfg=planConfig(key), latest=latestPayment(key), inProgress=activeActivationRequest();
  if(key==='allFunds' && FUND_KEYS.every(isFundActive)) return modal(`<div class="status-hero"><div class="status-icon">✅</div><h2>All Funds Active</h2><p>Gaming, Stock, Mix, Political and Outside funds are already active.</p></div>`);
  if(inProgress && inProgress.id!==latest?.id){
    if(inProgress.status==='pending') return pendingPaymentModal(inProgress);
    if(inProgress.status==='approved') return verifyCodeModal(inProgress);
  }
  if(key!=='allFunds' && isFundActive(key)) return openFund(key);
  if(cfg.enabled===false) return modal(`<div class="status-hero"><div class="status-icon">⏸️</div><h2>Activation Unavailable</h2><p>${esc(p.name)} is currently disabled by Admin.</p></div>`);
  if(latest?.status==='pending') return pendingPaymentModal(latest);
  if(latest?.status==='approved') return verifyCodeModal(latest);
  return paymentFormModal(key, latest?.status==='rejected'?latest:null);
}

function paymentFormModal(key,rejected=null){
  const p=PLAN_INFO[key],cfg=planConfig(key),penalty=Number(state.user?.penalty||0),base=Number(cfg.amount||0),total=base+penalty;
  modal(`<h2>${rejected?'Pay Again':p.name}</h2>
    ${rejected?`<div class="danger-box"><b>Previous payment rejected</b><br>Reason: ${esc(rejected.rejectReason||'Invalid / Unverified UTR')}<br>Attempts: ${Number(state.user?.invalidAttempts||0)}/4 • Current total penalty: ${money(penalty)}</div>`:''}
    <div class="payment-box"><div class="status-detail"><div><small>Activation Fee</small><b>${money(base)}</b></div><div><small>Penalty</small><b>${money(penalty)}</b></div><div><small>Total Payable</small><b>${money(total)}</b></div><div><small>UPI ID</small><b>${esc(cfg.upi||'Not set')}</b></div></div>
    ${cfg.qr?`<img class="qr-preview" src="${esc(cfg.qr)}" alt="Payment QR">`:''}<div class="notice-box">${esc(cfg.instructions||'Pay the exact amount and submit the correct UTR / Transaction ID.')}</div></div>
    <label>UTR / Transaction ID<input id="paymentUtr" type="tel" inputmode="numeric" autocomplete="off" maxlength="12" pattern="[0-9]{12}" placeholder="Enter 12-digit UTR / Transaction ID"></label>
    <button class="primary wide" id="submitPayment" data-submit-plan="${key}">Submit Payment</button>
    <button class="soft wide" id="modalSupport">Customer Support</button>`);
}

function pendingPaymentModal(p){
  modal(`<div class="status-hero"><div class="status-icon">⏳</div><h2>Payment Verification Pending</h2><p>Your payment request has been submitted. Please wait for Admin verification.</p></div>
  <div class="status-detail"><div><small>Fund</small><b>${esc(PLAN_INFO[p.planKey]?.name||p.planName||p.planKey)}</b></div><div><small>Amount</small><b>${money(p.amount)}</b></div><div><small>UTR / TXN ID</small><b>${esc(p.utr)}</b></div><div><small>Submitted</small><b>${dt(p.createdAt)}</b></div></div><div class="notice-box">Payment form will not reopen while this request is pending.</div><button class="soft wide" id="modalSupport">Customer Support</button>`);
}
function verifyCodeModal(p){
  const approvedCode=normalizeActivationCode(p.activationCode||state.user?.fundActivations?.[p.planKey]?.activationCode||'');
  modal(`<div class="status-hero"><div class="status-icon">✅</div><h2>Payment Approved</h2><p>Admin has verified your payment. Enter the activation code to unlock the selected fund.</p></div>
  <div class="success-box"><b>Your Activation Code</b><br><span style="font-size:20px;letter-spacing:2px">${esc(approvedCode)}</span></div>
  <label>Enter Activation Code<input id="activationCodeInput" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(approvedCode)}" placeholder="Enter activation code"></label>
  <button type="button" class="primary wide" id="verifyActivationBtn" data-plan="${esc(p.planKey)}" data-request="${esc(p.id)}">Verify & Activate</button>`);
}

async function submitPayment(planKey){
  const utr=normalizePaymentReference($('paymentUtr').value);
  if(!isValidPaymentReference(utr)) throw Error('Sirf 12-digit UTR / Transaction ID dalein.');
  if(paymentsArray().some(p=>samePaymentReference(p.utr,utr))) throw Error('Ye UTR / Transaction ID pehle submit ho chuka hai. Naya reference enter karein.');
  const inProgress=activeActivationRequest();
  if(inProgress?.status==='pending') throw Error('Ek payment request already Admin verification me pending hai.');
  if(inProgress?.status==='approved') throw Error('Pehle approved payment ka Activation Code verify karein.');
  const cfg=planConfig(planKey), base=Number(cfg.amount||0), penalty=Number(state.user?.penalty||0);if(!Number.isFinite(base)||base<0)throw Error('Activation amount Admin se configure karwayein.');const r=push(ref(db,`activationPayments/${me.uid}`));
  const request={id:r.key,uid:me.uid,userCode:state.user?.userCode||'',username:state.user?.username||'',email:me.email||state.user?.email||'',planKey,planName:PLAN_INFO[planKey].name,baseAmount:base,penaltySnapshot:penalty,amount:base+penalty,upiSnapshot:cfg.upi||'',qrSnapshot:cfg.qr||'',instructionsSnapshot:cfg.instructions||'',utr,status:'pending',attempt:Number(state.user?.invalidAttempts||0)+1,createdAt:now()};
  try{await set(r,request);}catch(e){console.error(e);if(String(e?.code||e?.message||'').toLowerCase().includes('permission'))throw Error('Payment submit permission denied. Database rules check karein.');throw e;}
  try{await addActivity('payment','Payment Submitted',`${PLAN_INFO[planKey].name} • ${money(request.amount)} • UTR/TXN ${utr}`);}catch(e){console.warn('Payment activity log failed:',e);}
  closeModal(); goPage('home'); render(); toast('Payment submitted. Admin verification pending.');
}

async function verifyActivation(planKey,requestId){
  const input=$('activationCodeInput');
  const code=normalizeActivationCode(input?.value);
  if(!code)throw Error('Activation code enter karein.');

  const payment=paymentsArray().find(p=>p.id===requestId) || latestPayment(planKey);
  if(!payment || payment.status!=='approved')throw Error('Approved activation request nahi mili. Page refresh karke dobara try karein.');
  if(payment.uid && payment.uid!==me.uid)throw Error('Ye activation code is account ke liye nahi hai.');

  const fundApproval=state.user?.fundActivations?.[planKey]||{};
  const approvedCode=normalizeActivationCode(fundApproval.activationCode||payment.activationCode);
  if(!approvedCode)throw Error('Admin-approved activation code abhi sync nahi hua. Thodi der baad dobara try karein.');
  if(code!==approvedCode)throw Error('Activation code galat hai. Upar dikhaya gaya exact code enter karein.');
  if(fundApproval.status && fundApproval.status!=='approved' && fundApproval.active!==true)throw Error('Activation approval valid nahi hai. Admin se verify karwayein.');

  showLoading(true);
  try{
    await set(ref(db,`verificationSubmissions/${me.uid}/${planKey}`),{enteredCode:code,verified:true,requestId:payment.id||requestId||'',createdAt:now()});
    if(planKey==='allFunds'){
      for(const fund of FUND_KEYS){
        if(!isFundActive(fund)){
          await set(ref(db,`users/${me.uid}/fundActivations/${fund}/active`),true);
          await set(ref(db,`users/${me.uid}/fundActivations/${fund}/activatedAt`),now());
        }
      }
      if(state.user?.fundActivations?.allFunds?.active!==true) await set(ref(db,`users/${me.uid}/fundActivations/allFunds/active`),true);
    }else if(!isFundActive(planKey)){
      await set(ref(db,`users/${me.uid}/fundActivations/${planKey}/active`),true);
      await set(ref(db,`users/${me.uid}/fundActivations/${planKey}/activatedAt`),now());
    }
    await set(ref(db,`users/${me.uid}/accountStatus`),'running');
    await set(ref(db,`users/${me.uid}/activationStatus`),'verified');
    try{await addActivity('activation','Fund Activated',planKey==='allFunds'?'All funds activated successfully.':`${FUND_INFO[planKey]?.name||planKey} activated successfully.`);}catch(e){console.warn('Activation activity log failed:',e);}
    closeModal(); render(); toast('Activation successful');
  }catch(e){
    console.error('Activation verification failed:',e);
    const msg=String(e?.code||e?.message||'');
    if(msg.toLowerCase().includes('permission'))throw Error('Activation verify permission denied. Code/approval sync check karein.');
    throw e;
  }finally{ showLoading(false); }
}

async function openFund(k){
  if(k!=='performance'&&!isFundActive(k))return openActivation(k); if(k==='performance'&&!commonUnlocked())return commonGate(()=>{});
  const arr=accountArray(k),code=state.fundCodes?.[k];
  modal(`<h2>${FUND_INFO[k].icon} ${esc(FUND_INFO[k].name)}</h2><p>Commission / rate: <b>${fundRate(k)}%</b> • Bank accounts: <b>${arr.length}/10</b></p>
    <button class="primary wide" id="addFundAccount" data-fund="${k}" ${arr.length>=10?'disabled':''}>Add Bank Account</button>
    ${code?`<div class="success-box"><b>Permanent Fund Code</b><br><span style="font-size:20px;letter-spacing:3px">${esc(code)}</span><br><small>Is code ko safe rakhein. Isi fund ke next account ke liye same code lagega.</small></div>`:''}
    <div>${arr.map(a=>`<div class="account-entry"><b>${esc(a.holder)}</b><br><small>${esc(a.bank)} • A/C ****${esc(String(a.account||'').slice(-4))} • Card ****${esc(a.atm?.last4||'')}</small></div>`).join('')||'<div class="notice-box">No bank account added yet.</div>'}</div>`);
}
function fundStep1(k){
  if(accountArray(k).length>=10)return toast('Maximum 10 accounts allowed in this fund.');
  const opts=enabledBanks().map(b=>`<option value="${esc(b.name)}"></option>`).join('');
  modal(`<h2>${FUND_INFO[k].name} • Step 1</h2><p>Bank details</p>
    <label>Account Holder Name<input id="fundHolder" placeholder="Account Holder Name"></label>
    <label>Account Number<input id="fundAccount" inputmode="numeric" placeholder="Account Number"></label>
    <label>Confirm Account Number<input id="fundAccountConfirm" inputmode="numeric" placeholder="Confirm Account Number"></label>
    <label>Mobile Number<input id="fundPhone" inputmode="numeric" maxlength="10" placeholder="Mobile Number"></label>
    <label>IFSC Code<input id="fundIfsc" maxlength="11" placeholder="IFSC Code"></label>
    <label>Bank Name<input id="fundBank" list="bankOptions" placeholder="Select / type bank"><datalist id="bankOptions">${opts}</datalist></label>
    <button class="primary wide" id="fundStep1Next" data-fund="${k}">Continue</button>`);
}
function fundStep2(k){
  const holder=$('fundHolder').value.trim(),account=$('fundAccount').value.trim(),confirm=$('fundAccountConfirm').value.trim(),phone=$('fundPhone').value.trim(),ifsc=$('fundIfsc').value.trim().toUpperCase(),bank=$('fundBank').value.trim();
  if(!holder||!/^[0-9]{6,20}$/.test(account)||account!==confirm||!/^[6-9][0-9]{9}$/.test(phone)||!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)||!enabledBanks().some(b=>b.name===bank))return toast('Valid bank details fill karein.');
  draftBank={holder,account,phone,ifsc,bank};
  modal(`<h2>${FUND_INFO[k].name} • Step 2</h2><p>Safe ATM details only</p>
    <label>ATM Card Holder Name<input id="atmHolder" placeholder="Card Holder Name"></label>
    <label>Last 4 Digits<input id="atmLast4" inputmode="numeric" maxlength="4" placeholder="1234"></label>
    <label>Expiry Date<input id="atmExpiry" maxlength="5" placeholder="MM/YY"></label>
    <label>Card Type<select id="atmType"><option>Debit Card</option><option>Credit Card</option><option>RuPay Debit Card</option></select></label>
    <div class="danger-box"><b>Security:</b> ATM PIN, CVV, OTP, UPI PIN, full card number aur banking password kabhi collect/store nahi kiya jayega.</div>
    <button class="primary wide" id="fundStep2Next" data-fund="${k}">Continue</button>`);
}
async function fundStep3(k){
  const holder=$('atmHolder').value.trim(),last4=$('atmLast4').value.trim(),expiry=$('atmExpiry').value.trim(),type=$('atmType').value;
  if(!holder||!/^[0-9]{4}$/.test(last4)||!/^(0[1-9]|1[0-2])\/[0-9]{2}$/.test(expiry))return toast('Valid safe ATM details fill karein.');
  draftAtm={holder,last4,expiry,type};
  let code=state.fundCodes?.[k]; if(!code){ code=randomFundCode(); await set(ref(db,`fundSetupCodes/${me.uid}/${k}`),code); state.fundCodes={...(state.fundCodes||{}),[k]:code}; }
  modal(`<h2>${FUND_INFO[k].name} • Step 3</h2><div class="success-box"><b>Permanent 8-Character Fund Code</b><br><span style="font-size:23px;letter-spacing:4px">${esc(code)}</span></div>
    <div class="notice-box">इस code को सुरक्षित रखें। इसी fund में अगला bank account add करने के लिए यही permanent code चाहिए होगा.<br><br>Keep this code safe. The same permanent code is required for future accounts in this fund.</div>
    <label>Re-enter Fund Code<input id="fundCodeConfirm" maxlength="8" placeholder="Enter code"></label>
    <button class="primary wide" id="saveFundAccount" data-fund="${k}">Verify & Save Account</button>`);
}
async function saveFundAccount(k){
  const code=($('fundCodeConfirm').value||'').trim().toUpperCase(),expected=(state.fundCodes?.[k]||'').toUpperCase();
  if(code!==expected)throw Error('Fund code mismatch.'); if(accountArray(k).length>=10)throw Error('Maximum 10 accounts allowed.');
  const r=push(ref(db,`fundAccounts/${me.uid}/${k}`)); await set(r,{id:r.key,fund:k,...draftBank,atm:draftAtm,status:'active',createdAt:now()}); await addActivity('fund','Fund Bank Account Added',`${FUND_INFO[k].name} • ${draftBank.bank} • ****${draftBank.account.slice(-4)}`); closeModal(); toast('Fund account saved successfully.');
}
function randomFundCode(){ const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({length:8},()=>chars[Math.floor(Math.random()*chars.length)]).join(''); }

function commissionModal(){
  const arr=txArray().filter(t=>t.type==='commission');
  modal(`<div class="status-hero"><div class="status-icon">💰</div><h2>Commission</h2><p>Total Commission</p><h1>${money(state.user?.commission)}</h1></div>${arr.slice(0,30).map(t=>`<div class="commission-history-card"><div><b>${esc(t.fundName||FUND_INFO[t.fund]?.name||'Commission')}</b><small>${esc(t.title||'Commission')} • ${dt(t.createdAt)}</small>${t.commissionRate!==undefined?`<small>Rate: ${esc(t.commissionRate)}%</small>`:''}</div><strong>+${money(t.amount)}</strong></div>`).join('')||'<div class="notice-box">No commission entries yet.</div>'}`);
}
function bonusModal(){
  const amount=Number(state.settings?.bonusAmount||0),claimed=state.user?.bonusClaimed===true;
  modal(`<div class="status-hero"><div class="status-icon">🎁</div><h2>Bonus Claim</h2><p>Available Bonus</p><h1>${claimed?'Already Claimed':money(amount)}</h1></div><div class="notice-box">Bonus claim successful hone par amount directly Total Balance mein add hoga aur Transaction History mein Bonus Credit entry बनेगी.</div><button class="primary wide" id="claimBonusBtn" ${claimed?'disabled':''}>${claimed?'Already Claimed':'Claim Bonus'}</button>`);
}
async function claimBonus(){
  if(!commonUnlocked())throw Error('Activate at least one fund first.'); if(state.user?.bonusClaimed)throw Error('Bonus already claimed.'); const amount=Number(state.settings?.bonusAmount||0); if(amount<=0)throw Error('Bonus amount is not configured.');
  showLoading(true);
  try{
    const result=await runTransaction(ref(db,`users/${me.uid}`),u=>{if(!u||u.bonusClaimed)return; u.balance=Number(u.balance||0)+amount;u.bonusClaimed=true;u.bonusClaimedAt=now();return u;});
    if(!result.committed)throw Error('Bonus already claimed or could not be updated.');
    await set(ref(db,`bonusClaims/${me.uid}`),{uid:me.uid,email:me.email||'',amount,status:'claimed',createdAt:now()});
    await set(ref(db,`transactions/${me.uid}/bonus-claim`),{transactionId:'BONUS-'+String(now()).slice(-9),title:'Bonus Credit',type:'bonus',amount,status:'completed',source:'user_bonus_claim',createdAt:now()});
    await addActivity('bonus','Bonus Claim Successful',`${money(amount)} added to Total Balance.`); closeModal(); toast('Bonus added to Total Balance.');
  } finally {showLoading(false);}
}

function withdrawalModal(){
  const arr=withdrawalArray();
  modal(`<h2>Withdrawal</h2><p>Available Balance: <b>${money(state.user?.balance)}</b></p><div class="tabs"><button id="bankTab" class="active">Bank Withdrawal</button><button id="upiTab">UPI Withdrawal</button></div><div id="withdrawForm"></div><h3>Withdrawal History</h3><div>${arr.slice(0,20).map(withdrawStatusHtml).join('')||'<div class="notice-box">No withdrawal requests yet.</div>'}</div>`); renderWithdrawalForm('bank');
}
function withdrawStatusHtml(w){
  const status=w.status||'pending',cls=status==='success'?'success':status==='rejected'?'rejected':'pending',icon=status==='success'?'✓':status==='rejected'?'×':'⌛',dest=w.type==='upi'?(w.details?.upi||'UPI'):`${w.details?.bank||'Bank'} • A/C ****${String(w.details?.account||'').slice(-4)}`;
  return `<article class="withdraw-history-card ${cls}"><div class="withdraw-icon">${icon}</div><div class="withdraw-main"><div class="withdraw-head"><div><b>Withdrawal ${esc(status.toUpperCase())}</b><small>${esc(dest)}</small></div><strong>-${money(w.amount)}</strong></div><div class="withdraw-meta"><span>ID ${esc(w.withdrawalId||w.id)}</span><span>${dt(w.createdAt)}</span></div>${status==='rejected'?`<div class="withdraw-note red-note">Reason: ${esc(w.rejectReason||'Rejected by Admin')}</div>`:''}${status==='success'?`<div class="withdraw-note green-note">Reference: ${esc(w.referenceId||'Completed')} • Completed: ${dt(w.completedAt||w.reviewedAt||w.createdAt)}</div>`:''}${status==='pending'?'<div class="withdraw-note orange-note">Admin verification pending</div>':''}</div></article>`;
}
function renderWithdrawalForm(type){
  if(!$('withdrawForm'))return; $('bankTab').classList.toggle('active',type==='bank'); $('upiTab').classList.toggle('active',type==='upi');
  const opts=enabledBanks().map(b=>`<option value="${esc(b.name)}"></option>`).join('');
  $('withdrawForm').innerHTML=type==='bank'?`<label>Amount<input id="wdAmount" type="number" min="1" placeholder="Amount"></label><label>Account Holder Name<input id="wdHolder" placeholder="Holder Name"></label><label>Account Number<input id="wdAccount" inputmode="numeric" placeholder="Account Number"></label><label>Confirm Account Number<input id="wdConfirm" inputmode="numeric" placeholder="Confirm Account Number"></label><label>IFSC Code<input id="wdIfsc" maxlength="11" placeholder="IFSC"></label><label>Mobile Number<input id="wdPhone" maxlength="10" inputmode="numeric" placeholder="Mobile"></label><label>Bank Name<input id="wdBank" list="withdrawBankList" placeholder="Bank Name"><datalist id="withdrawBankList">${opts}</datalist></label><button class="primary wide" id="submitWithdrawal" data-type="bank">Submit Withdrawal</button>`:`<label>Amount<input id="wdAmount" type="number" min="1" placeholder="Amount"></label><label>Valid UPI ID<input id="wdUpi" placeholder="name@bank"></label><button class="primary wide" id="submitWithdrawal" data-type="upi">Submit Withdrawal</button>`;
  $('submitWithdrawal').onclick=()=>requestWithdrawal(type).catch(e=>toast(e.message));
}
async function requestWithdrawal(type){
  const amount=Number($('wdAmount').value); const min=Number(state.settings?.minWithdrawal||0); if(!Number.isFinite(amount)||amount<=0||amount<min||amount>Number(state.user?.balance||0))throw Error(`Valid amount enter karein. Minimum ${money(min)}.`);
  let details={};
  if(type==='upi'){
    const upi=$('wdUpi').value.trim(); if(!/^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$/.test(upi))throw Error('Valid UPI ID enter karein.'); details={upi};
  } else {
    const holder=$('wdHolder').value.trim(),account=$('wdAccount').value.trim(),confirm=$('wdConfirm').value.trim(),ifsc=$('wdIfsc').value.trim().toUpperCase(),phone=$('wdPhone').value.trim(),bank=$('wdBank').value.trim();
    if(!holder||!/^[0-9]{6,20}$/.test(account)||account!==confirm||!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)||!/^[6-9][0-9]{9}$/.test(phone)||!enabledBanks().some(b=>b.name===bank))throw Error('Valid bank details fill karein.'); details={holder,account,ifsc,phone,bank};
  }
  const r=push(ref(db,`withdrawals/${me.uid}`)),withdrawalId='WDR-'+String(now()).slice(-10); await set(r,{id:r.key,withdrawalId,uid:me.uid,userCode:state.user?.userCode||'',username:state.user?.username||'',email:me.email||'',type,amount,details,status:'pending',createdAt:now()}); await addActivity('withdrawal','Withdrawal Pending',`${money(amount)} • ${withdrawalId}`); closeModal(); toast('Withdrawal request pending.');
}

function profileAction(k){
  if(k==='logout')return signOut(auth);
  if(k==='support')return supportModal();
  if(k==='password')return sendPasswordResetEmail(auth,me.email).then(()=>toast('Password reset email sent.')).catch(e=>toast(e.message));
  if(k==='notifications')return notificationsModal();
  if(k==='verification')return openActivation();
  if(k==='funds')return fundAccountsSummary();
  if(k==='bank')return fundAccountsSummary();
  if(k==='personal')return personalInfoModal();
}
function personalInfoModal(){ modal(`<h2>Personal Information</h2><div class="account-entry"><b>Username</b><br><small>${esc(state.user?.username||'')}</small></div><div class="account-entry"><b>Email</b><br><small>${esc(me.email||'')}</small></div><div class="account-entry"><b>Mobile</b><br><small>${esc(state.user?.phone||'')}</small></div><div class="account-entry"><b>User ID</b><br><small>${esc(state.user?.userCode||'')}</small></div><button class="soft wide" id="policiesBtn">Privacy / Terms / Policies</button>`); }
function fundAccountsSummary(){ const html=[...FUND_KEYS,'performance'].map(k=>`<div class="account-entry"><b>${FUND_INFO[k].icon} ${FUND_INFO[k].name}</b><br><small>${accountArray(k).length}/10 accounts • ${k==='performance'?commonUnlocked():isFundActive(k)?'Active':'Locked'}</small></div>`).join('');modal(`<h2>Fund Bank Accounts</h2>${html}`); }
function supportModal(){ modal(`<h2>Customer Support</h2><div class="notice-box">${esc(state.settings?.supportContact||'Support details are not configured yet.')}</div>${state.settings?.telegramLink?`<button class="primary wide" id="openTelegram">Open Telegram Support</button>`:''}<h3>Support Policy</h3><p>${esc(state.settings?.supportPolicy||'Contact Support remains available even before activation and while an ID is blocked.')}</p>`); }
function notificationsModal(){
  const arr=[...Object.entries(state.notifications||{}).map(([id,n])=>({id,...n})),...Object.entries(state.globalNotifications||{}).map(([id,n])=>({id,...n,global:true}))].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  modal(`<h2>Notifications</h2>${arr.map(n=>`<div class="account-entry"><b>${esc(n.title||'Notification')}</b><br><small>${esc(n.message||'')}<br>${dt(n.createdAt)}</small></div>`).join('')||'<div class="notice-box">No notifications.</div>'}`);
}
function policiesModal(){ modal(`<h2>Policies & App Content</h2><h3>Privacy Policy</h3><p>${esc(state.settings?.privacyPolicy||'Not added')}</p><h3>Terms & Conditions</h3><p>${esc(state.settings?.terms||'Not added')}</p><h3>Fund Policy</h3><p>${esc(state.settings?.fundPolicy||'Not added')}</p><h3>Withdrawal Policy</h3><p>${esc(state.settings?.withdrawalPolicy||'Not added')}</p><h3>Bonus Policy</h3><p>${esc(state.settings?.bonusPolicy||'Not added')}</p>`); }

function bindModal(){
  $('modalClose')?.addEventListener('click',closeModal);
  const paymentUtrInput=$('paymentUtr');
  paymentUtrInput?.addEventListener('input',()=>{ paymentUtrInput.value=paymentUtrInput.value.replace(/\D/g,'').slice(0,12); });
  document.querySelectorAll('[data-plan]').forEach(b=>b.onclick=()=>openPlan(b.dataset.plan));
  $('submitPayment')?.addEventListener('click',()=>{const b=$('submitPayment');if(!b||b.disabled)return;const plan=b.dataset.submitPlan;b.disabled=true;b.textContent='Submitting...';submitPayment(plan).catch(e=>{toast(e.message);if(document.body.contains(b)){b.disabled=false;b.textContent='Submit Payment';}});});
  const activationInput=$('activationCodeInput');
  // Activation code: typing and copy/paste are both allowed, but spaces are never kept.
  // This also removes hidden Unicode spaces that may come from WhatsApp/Telegram/SMS copy-paste.
  activationInput?.addEventListener('keydown',e=>{ if(e.key===' '){ e.preventDefault(); } });
  activationInput?.addEventListener('input',()=>{
    const cleaned=normalizeActivationCode(activationInput.value);
    if(activationInput.value!==cleaned) activationInput.value=cleaned;
  });
  activationInput?.addEventListener('paste',()=>{
    setTimeout(()=>{ if(document.body.contains(activationInput)) activationInput.value=normalizeActivationCode(activationInput.value); },0);
  });
  const verifyBtn=$('verifyActivationBtn');
  verifyBtn?.addEventListener('click',()=>{
    if(verifyBtn.disabled)return;
    const plan=verifyBtn.dataset.plan,requestId=verifyBtn.dataset.request;
    verifyBtn.disabled=true;verifyBtn.textContent='Verifying...';
    verifyActivation(plan,requestId).catch(e=>{toast(e.message);if(document.body.contains(verifyBtn)){verifyBtn.disabled=false;verifyBtn.textContent='Verify & Activate';}});
  });
  $('addFundAccount')?.addEventListener('click',()=>fundStep1($('addFundAccount').dataset.fund));
  $('fundStep1Next')?.addEventListener('click',()=>fundStep2($('fundStep1Next').dataset.fund));
  $('fundStep2Next')?.addEventListener('click',()=>fundStep3($('fundStep2Next').dataset.fund).catch(e=>toast(e.message)));
  $('saveFundAccount')?.addEventListener('click',()=>saveFundAccount($('saveFundAccount').dataset.fund).catch(e=>toast(e.message)));
  $('claimBonusBtn')?.addEventListener('click',()=>claimBonus().catch(e=>toast(e.message)));
  $('bankTab')?.addEventListener('click',()=>renderWithdrawalForm('bank')); $('upiTab')?.addEventListener('click',()=>renderWithdrawalForm('upi'));
  $('modalSupport')?.addEventListener('click',supportModal); $('goActivate')?.addEventListener('click',()=>openActivation());
  $('policiesBtn')?.addEventListener('click',policiesModal);
  $('openTelegram')?.addEventListener('click',()=>{const url=state.settings?.telegramLink;if(url)window.open(url,'_blank','noopener')});
}

async function addActivity(type,title,message){ if(!me)return; const r=push(ref(db,`activityLogs/${me.uid}`)); await set(r,{id:r.key,type,title,message,createdAt:now()}); }
function goPage(page){ document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${page}`)); document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===page)); window.scrollTo({top:0,behavior:'smooth'}); }

async function changeProfilePhoto(file){
  if(!file)return; if(file.size>8*1024*1024)throw Error('Image too large.'); const data=await resizeImage(file,320,320,.82); await set(ref(db,`users/${me.uid}/profilePhoto`),data); toast('Profile photo updated.');
}
function resizeImage(file,w,h,q){ return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=reject;r.onload=()=>{const img=new Image();img.onerror=reject;img.onload=()=>{const c=document.createElement('canvas');const ratio=Math.min(w/img.width,h/img.height,1);c.width=Math.max(1,Math.round(img.width*ratio));c.height=Math.max(1,Math.round(img.height*ratio));c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',q))};img.src=r.result};r.readAsDataURL(file)}); }

function clearUserListeners(){ unsubscribers.forEach(fn=>{try{fn()}catch{}}); unsubscribers=[]; }
function subscribe(path,cb){ const off=onValue(ref(db,path),s=>cb(s.val()||{})); unsubscribers.push(off); }

onValue(ref(db,'settings'),s=>{state.settings=s.val()||{}; if(!me){} else render();});
onValue(ref(db,'bankDirectory'),s=>{state.banks=s.val()||{}; if(me)render();});

onAuthStateChanged(auth,async user=>{
  clearUserListeners(); me=user||null;
  if(!user){ $('authView').classList.remove('hidden'); $('appView').classList.add('hidden'); showAuth('welcome'); return; }
  $('authView').classList.add('hidden'); $('appView').classList.remove('hidden'); showLoading(true);
  try{
    const profileSnap=await get(ref(db,`users/${user.uid}`));
    if(profileSnap.exists()){ await set(ref(db,`users/${user.uid}/lastLoginAt`),now()).catch(()=>{}); await set(ref(db,`users/${user.uid}/lastDevice`),currentDevice()).catch(()=>{}); }
    subscribe(`users/${user.uid}`,v=>{state.user=v;render()});
    subscribe(`activationPayments/${user.uid}`,v=>{state.payments=v;render()});
    subscribe(`transactions/${user.uid}`,v=>{state.transactions=v;render()});
    subscribe(`activityLogs/${user.uid}`,v=>{state.activities=v;render()});
    subscribe(`fundAccounts/${user.uid}`,v=>{state.fundAccounts=v;render()});
    subscribe(`fundSetupCodes/${user.uid}`,v=>{state.fundCodes=v;render()});
    subscribe(`withdrawals/${user.uid}`,v=>{state.withdrawals=v;render()});
    subscribe(`userActivationOverrides/${user.uid}`,v=>{state.overrides=v;render()});
    subscribe(`notifications/${user.uid}`,v=>{state.notifications=v;render()});
    subscribe(`globalNotifications`,v=>{state.globalNotifications=v;render()});
    subscribe(`bonusClaims/${user.uid}`,v=>{state.bonusClaim=v;render()});
  } finally {showLoading(false);}
});

document.querySelectorAll('[data-auth]').forEach(b=>b.onclick=()=>showAuth(b.dataset.auth));
$('refreshCaptcha').onclick=refreshCaptcha;
$('loginBtn').onclick=async()=>{ $('loginMsg').textContent=''; try{showLoading(true);await signInWithEmailAndPassword(auth,$('loginEmail').value.trim(),$('loginPassword').value)}catch(e){$('loginMsg').textContent=e.message}finally{showLoading(false)}};
$('forgotBtn').onclick=async()=>{const email=$('loginEmail').value.trim();if(!email)return $('loginMsg').textContent='Email enter karein.';try{await sendPasswordResetEmail(auth,email);$('loginMsg').style.color='#0b7a40';$('loginMsg').textContent='Password reset email sent.'}catch(e){$('loginMsg').textContent=e.message}};
$('registerBtn').onclick=async()=>{
  $('registerMsg').textContent=''; const username=$('regUsername').value.trim(),phone=$('regPhone').value.trim(),email=$('regEmail').value.trim(),pass=$('regPassword').value,confirm=$('regConfirm').value,code=$('captchaInput').value.replace(/\s/g,'');
  if(username.length<2)return $('registerMsg').textContent='Username required.'; if(!/^[6-9][0-9]{9}$/.test(phone))return $('registerMsg').textContent='Valid 10 digit mobile number required.'; if(pass.length<6)return $('registerMsg').textContent='Password minimum 6 characters.'; if(pass!==confirm)return $('registerMsg').textContent='Passwords do not match.'; if(code!==captcha)return $('registerMsg').textContent='Verification code incorrect.';
  try{showLoading(true);const cred=await createUserWithEmailAndPassword(auth,email,pass);const userCode='TP'+String(Date.now()).slice(-7)+Math.floor(Math.random()*90+10);await set(ref(db,`users/${cred.user.uid}`),{uid:cred.user.uid,userCode,username,phone,email,registeredAt:now(),accountStatus:'stopped',activationStatus:'not_submitted',balance:0,commission:0,bonusClaimed:false,invalidAttempts:0,penalty:0,blocked:false,fundActivations:{gaming:{active:false},stock:{active:false},mix:{active:false},political:{active:false},outside:{active:false},allFunds:{active:false}}});const ar=push(ref(db,`activityLogs/${cred.user.uid}`));await set(ar,{id:ar.key,type:'account',title:'Registration Completed',message:'Welcome to Tiranga Pay.',createdAt:now()});toast('Registration successful.')}catch(e){$('registerMsg').textContent=e.message}finally{showLoading(false)}
};
$('supportBeforeLogin').onclick=supportModal;
$('openActivationBtn').onclick=()=>openActivation(); $('logoutHome').onclick=()=>signOut(auth); $('notificationBtn').onclick=notificationsModal;
$('changePhotoBtn').onclick=()=>$('profilePhotoInput').click(); $('profilePhotoInput').onchange=e=>changeProfilePhoto(e.target.files?.[0]).catch(err=>toast(err.message));
document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>goPage(b.dataset.page));
$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal()});

if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{})); }
refreshCaptcha();
