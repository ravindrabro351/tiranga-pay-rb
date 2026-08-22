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
const FUND_DAILY_VOLUME={gaming:'₹1,000 – ₹10,000',stock:'₹10,000 – ₹1,00,000',mix:'₹10,000 – ₹50,000',political:'₹1,00,000 – ₹3,00,000',outside:'₹1 Cr – ₹10 Cr'};
const FUND_ACCOUNT_TYPES=['Savings','Current','Merchant','Corporate'];

const DEFAULT_PLAN = { amount:1999, upi:'', qr:'', enabled:true, instructions:'Pay using UPI/QR and submit the correct UTR / Transaction ID.' };

let me = null;
let unsubscribers = [];
let state = {
  settings:{}, banks:{}, partnerships:{}, user:{}, payments:{}, transactions:{}, activities:{}, fundAccounts:{}, fundCodes:{},
  withdrawals:{}, overrides:{}, notifications:{}, globalNotifications:{}, bonusClaim:null
};
let txFilter = 'all';
let captcha = '';
let draftBank = null;
let draftAtm = null;
let noticeDismissed = false;

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
function txArray(){const n=now();return Object.entries(state.transactions||{}).map(([id,t])=>({id,...t})).filter(t=>!t.availableAt||Number(t.availableAt)<=n).sort((a,b)=>(Number(b.availableAt||b.createdAt||0)-Number(a.availableAt||a.createdAt||0)));}
function liveCombinedCommission(){
  return txArray().filter(t=>t.source==='admin_combined_batch'&&t.type==='commission').reduce((sum,t)=>sum+Number(t.amount||0),0);
}
function liveCommission(){ return Number(state.user?.commission||0)+liveCombinedCommission(); }
function liveLedgerBalance(){
  const visible=txArray().filter(t=>t.source==='admin_combined_batch');
  const effect=visible.reduce((sum,t)=>sum+(t.type==='credit'||t.type==='commission'?Number(t.amount||0):t.type==='debit'?-Number(t.amount||0):0),0);
  return Math.max(0,Number(state.user?.balance||0)+effect);
}
function activityArray(){ return Object.entries(state.activities||{}).map(([id,a])=>({id,...a})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); }
function withdrawalArray(){ return Object.entries(state.withdrawals||{}).map(([id,w])=>({id,...w})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); }
function totalWithdrawnOrHeld(){return withdrawalArray().filter(w=>['pending','processing','success','paid'].includes(String(w.status||'pending').toLowerCase())).reduce((sum,w)=>sum+Number(w.amount||0),0);}
function withdrawableBalance(){const held=totalWithdrawnOrHeld();const raw=state.user?.withdrawableBalance;const earned=(raw!==undefined&&raw!==null&&raw!=='')?Number(raw):Number(state.user?.commission||0)+(state.user?.bonusClaimed?Number(state.settings?.bonusAmount||0):0);return Math.max(0,earned-held);}
function accountArray(fund){ return Object.entries(state.fundAccounts?.[fund]||{}).map(([id,a])=>({id,...a})).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)); }

function render(){
  if(!me) return;
  renderHome(); renderTransactions(); renderActivity(); renderRunStatus(); renderProfile(); renderNotificationsBadge(); setTimeout(showPreActivationNotice,0); clearTimeout(render.scheduleTimer); render.scheduleTimer=setTimeout(()=>{if(me)render();},1000);
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
  $('homeBalance').textContent=money(Math.max(0,liveLedgerBalance()-totalWithdrawnOrHeld())); $('homeCommission').textContent=money(liveCommission()); $('homeTransactions').textContent=txArray().length.toLocaleString('en-IN');
  const unlocked=commonUnlocked();
  $('homeVipBadge').textContent=isBlocked()?'Blocked':unlocked?'VIP Active':'Not Active';
  $('homeVipBadge').className='status-badge '+(isBlocked()?'red':unlocked?'green':'gray');
  $('blockedBanner').classList.toggle('hidden',!isBlocked());
  $('blockedBanner').innerHTML=isBlocked()?'⚠️ Your ID is blocked after repeated invalid payment submissions. Customer Support remains available.':'';
  $('activationTitle').textContent=unlocked?'Manage Fund Activation':'Activate Funds';
  $('activationSubtitle').textContent=unlocked?'Activate more funds or view existing fund status.':'Choose one fund or activate all funds together.';
  $('openActivationBtn').textContent=unlocked?'Manage':'Activate';
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
    ['commission','Commission','💰',money(liveCommission())],
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
  const historyTotals=$('historyLiveTotals'); if(historyTotals) historyTotals.innerHTML=`<div><small>Total Balance</small><b>${money(Math.max(0,liveLedgerBalance()-totalWithdrawnOrHeld()))}</b></div><div><small>Total Commission</small><b>${money(liveCommission())}</b></div>`;
  $('transactionList').innerHTML=arr.length?arr.map(t=>{
    const negative=['debit','withdrawal'].includes(t.type), type=String(t.type||'credit').toLowerCase(), signed=negative?'−':'+';
    const icon=type==='debit'?'↓':type==='commission'?'%':type==='bonus'?'🎁':type==='withdrawal'?'🏦':'↑';
    return `<article class="list-card premium-tx tx-${esc(type)}"><div class="tx-icon">${icon}</div><div class="tx-main"><div class="topline"><div><h4>${esc(t.title||'Transaction')}</h4><span class="tx-pill">${esc(type.toUpperCase())}</span> <span class="done-pill">COMPLETED</span></div><div class="amount ${negative?'minus':'plus'}">${signed}${money(t.amount)}</div></div><p>${dt(t.availableAt||t.createdAt)}</p><p class="tx-meta">ID: ${esc(t.transactionId||t.id)}${t.batchId?` • Batch: ${esc(t.batchId)}`:''}${t.sequenceText?` • ${esc(t.sequenceText)}`:t.sequence?` • ${esc(t.sequence)}`:''}</p></div></article>`;
  }).join(''):'<div class="list-card"><b>No transactions yet</b><p>Your realtime transaction history will appear here.</p></div>';
}

function renderActivity(){
  const hiddenAdminTxTitles=new Set(['Credit Transactions Added','Debit Transactions Added','Commission Transactions Added','Combined Transactions Added']);
  const arr=activityArray().filter(a=>a.type!=='transaction'&&!hiddenAdminTxTitles.has(a.title));
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
  $('profileBalance').textContent=money(Math.max(0,liveLedgerBalance()-totalWithdrawnOrHeld())); $('profileCommission').textContent=money(liveCommission()); $('profileTransactions').textContent=txArray().length.toLocaleString('en-IN'); $('profileBonus').textContent=u.bonusClaimed?'₹0':money(bonus);
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
  if(preselect) return openPlan(preselect);
  const cards=Object.entries(PLAN_INFO).map(([k,p])=>{
    const cfg=planConfig(k), active=k==='allFunds'?FUND_KEYS.every(isFundActive):isFundActive(k), latest=latestPayment(k);
    let status=active?'Active':latest?.status==='pending'?'Pending':latest?.status==='approved'?'Code Ready':latest?.status==='rejected'?'Pay Again':'Activate';
    return `<div class="plan-card"><div class="plan-icon">${p.icon}</div><div class="grow"><h4>${esc(p.name)}</h4><p>${active?'Already activated':cfg.enabled===false?'Currently disabled':money(Number(cfg.amount||0)+Number(state.user?.penalty||0))}</p><strong>${status}</strong></div><button data-plan="${k}">›</button></div>`;
  }).join('');
  modal(`<h2>Fund Activation</h2><p>Choose one fund or activate all funds together. Only verified fund(s) will unlock.</p><div class="plan-grid">${cards}</div><div class="notice-box">Fake / invalid UTR may attract penalty. 1st total ₹100 • 2nd total ₹300 • 3rd total ₹600 • 4th rejection: ID block.</div>`);
}

function openPlan(key){
  const p=PLAN_INFO[key], cfg=planConfig(key), latest=latestPayment(key);
  if(key==='allFunds' && FUND_KEYS.every(isFundActive)) return modal(`<div class="status-hero"><div class="status-icon">✅</div><h2>All Funds Active</h2><p>Gaming, Stock, Mix, Political and Outside funds are already active.</p></div>`);
  if(key!=='allFunds' && isFundActive(key)) return openFund(key);
  if(cfg.enabled===false) return modal(`<div class="status-hero"><div class="status-icon">⏸️</div><h2>Activation Unavailable</h2><p>${esc(p.name)} is currently disabled by Admin.</p></div>`);
  if(latest?.status==='pending') return pendingPaymentModal(latest);
  if(latest?.status==='approved') return verifyCodeModal(latest);
  return paymentFormModal(key, latest?.status==='rejected'?latest:null);
}

function paymentFormModal(key,rejected=null){
  const p=PLAN_INFO[key],cfg=planConfig(key),penalty=Number(state.user?.penalty||0),base=Numb
