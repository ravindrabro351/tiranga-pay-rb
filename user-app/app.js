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
const initialReferralCode = new URLSearchParams(location.search).get('ref') || sessionStorage.getItem('tpReferralCode') || '';
if(initialReferralCode) sessionStorage.setItem('tpReferralCode', initialReferralCode.trim().toUpperCase());
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
  withdrawals:{}, overrides:{}, notifications:{}, globalNotifications:{}, activationNotices:{}, bonusClaim:null, settings:{}
};
let txFilter = 'all';
let captcha = '';
let draftBank = null;
let draftAtm = null;
let noticeDismissed = false;
let autoLogoutTimer = null;

window.addEventListener('error', e => console.error('Tiranga Pay:', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', e => console.error('Tiranga Pay promise:', e.reason));

function showLoading(on){ $('loading').classList.toggle('hidden', !on); }
function toast(message){ const el=$('toast'); el.textContent=message; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.add('hidden'),2800); }
function showAuth(which){
  ['welcomeBox','loginBox','registerBox'].forEach(id=>$(id).classList.add('hidden'));
  $({welcome:'welcomeBox',login:'loginBox',register:'registerBox'}[which]||'welcomeBox').classList.remove('hidden');
  if(which==='register'){ refreshCaptcha(); const r=sessionStorage.getItem('tpReferralCode')||''; if($('regReferralCode'))$('regReferralCode').value=r; if($('referralCodeStatus'))$('referralCodeStatus').textContent=r?'Referral link detected. Please verify the code before registering.':''; }
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

function getDeviceLockId(){
  const key='tirangaPayDeviceLockId'; let id=localStorage.getItem(key);
  if(!id){id=crypto?.randomUUID?crypto.randomUUID():`dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;localStorage.setItem(key,id);}
  return id;
}
let appLockUnsubscribe=null;
function setupAppLock(){
  const deviceId=getDeviceLockId();
  if(appLockUnsubscribe){try{appLockUnsubscribe()}catch{}}
  appLockUnsubscribe=onValue(ref(db,`deviceLocks/${deviceId}`),s=>s.val()?.locked===true?showAppLockPopup(s.val()):hideAppLockPopup());
  return deviceId;
}
function showAppLockPopup(data){
  const o=$('tpAppLockOverlay');if(!o)return;
  o.querySelector('[data-lock-title]').textContent=data.title||'SECURITY ALERT';
  o.querySelector('[data-lock-heading]').textContent=data.heading||'ACCESS RESTRICTED';
  o.querySelector('[data-lock-message]').textContent=data.message||'This application access has been restricted.';
  o.querySelector('[data-lock-status]').textContent=data.status||'Your access to this application is temporarily blocked.';
  o.querySelector('[data-support-title]').textContent=data.support?.title||'SUPPORT CONTACT';
  o.querySelector('[data-support-message]').textContent=data.support?.message||'Please contact the support team for further assistance.';
  const phone=data.support?.phone||'',wa=data.support?.whatsapp||phone,btn=o.querySelector('[data-support-btn]');
  btn.textContent=`🎧 ${data.support?.buttonText||'CONTACT SUPPORT'}`;
  btn.onclick=()=>phone?location.href=`tel:${phone.replace(/[^\d+]/g,'')}`:toast('Support contact is not configured.');
  const pe=o.querySelector('[data-support-phone]');pe.querySelector('span').textContent=phone||'Support unavailable';pe.href=phone?`tel:${phone.replace(/[^\d+]/g,'')}`:'#';
  const we=o.querySelector('[data-support-whatsapp]');we.querySelector('span').textContent=wa||'WhatsApp unavailable';we.href=wa?`https://wa.me/${wa.replace(/\D/g,'')}`:'#';
  o.classList.add('show');document.documentElement.classList.add('tp-app-locked');document.body.classList.add('tp-app-locked');
}
function hideAppLockPopup(){const o=$('tpAppLockOverlay');if(!o)return;o.classList.remove('show');document.documentElement.classList.remove('tp-app-locked');document.body.classList.remove('tp-app-locked');}

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
let activationPopupBusy=false;
let fundPaymentNoticeBusy=false;
function pendingActivationNotices(){
  const notices=[];

  // Legacy activationNotices, if readable in an existing deployment.
  Object.entries(state.activationNotices||{})
    .map(([id,n])=>({id,...n}))
    .filter(n=>!n.acknowledgedAt)
    .forEach(n=>notices.push(n));

  // New popup channel lives under users/{uid}; this avoids the
  // activationNotices permission problem seen in the admin panel.
  const localPrefix=`tirangaFundPopupSeen:${me?.uid}:`;
  Object.entries(state.user?.activationPopups||{})
    .map(([id,n])=>({id,...n,localPopup:true}))
    .filter(n=>!localStorage.getItem(localPrefix+n.id))
    .forEach(n=>{
      if(!notices.some(x=>x.id===n.id)) notices.push(n);
    });

  // One-time popup for an already-active fund that predates the popup feature.
  const active=state.user?.fundActivations||{};
  const seenFunds=new Set(notices.map(n=>String(n.fund||'')));
  Object.keys(FUND_INFO||{}).filter(k=>FUND_KEYS.includes(k)).forEach(k=>{
    const a=active[k];
    const legacyKey=`tirangaFundLegacyPopup:${me?.uid}:${k}`;
    if(a?.active && !seenFunds.has(k) && !localStorage.getItem(legacyKey)){
      notices.push({
        id:`legacy-${k}`,
        fund:k,
        fundName:FUND_INFO[k].name,
        activationFee:Number(planConfig(k).amount||0),
        status:'success',
        activationMethod:'legacy_one_time',
        createdAt:Number(a.activatedAt||0)||now(),
        legacy:true,
        acknowledgedAt:null
      });
    }
  });

  return notices.sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));
}

function showNextFundActivationPopup(){
  if(!me||activationPopupBusy)return;
  const list=pendingActivationNotices();
  if(!list.length)return;

  const n=list[0];
  const fund=n.fund||'gaming';
  const info=FUND_INFO[fund]||{name:n.fundName||fund,icon:'✓'};
  const fee=Number(n.activationFee||0);
  const activatedAt=Number(n.createdAt||0);

  const theme={
    gaming:{bg:'#0b0e13',accent:'#ff3b30',accent2:'#ff7a45',icon:'🎮',title:'GAMING FUND'},
    stock:{bg:'#eef7ff',accent:'#1976d2',accent2:'#49a3ff',icon:'📈',title:'STOCK FUND'},
    outside:{bg:'#effaf1',accent:'#138808',accent2:'#56b870',icon:'🌐',title:'OUTSIDE FUND'},
    mix:{bg:'#f5efff',accent:'#6b35c9',accent2:'#b04cff',icon:'🔄',title:'MIX FUND'},
    political:{bg:'#fff5e8',accent:'#f58220',accent2:'#ffb347',icon:'🏛️',title:'POLITICAL FUND'}
  }[fund]||{bg:'#fff',accent:'#0c8a47',accent2:'#35a866',icon:'✓',title:info.name};

  activationPopupBusy=true;

  // Temporarily center the modal and keep it away from the bottom edge.
  const modalEl=$('modal');
  const oldAlign=modalEl.style.alignItems, oldPadTop=modalEl.style.paddingTop, oldPadBottom=modalEl.style.paddingBottom;
  modalEl.style.alignItems='center';
  modalEl.style.paddingTop='18px';
  modalEl.style.paddingBottom='18px';

  modal(`<div style="position:relative;max-height:88vh;overflow:auto;border-radius:26px;background:${theme.bg};border:3px solid ${theme.accent2};padding:0 18px 18px;text-align:center;box-shadow:0 22px 70px rgba(0,0,0,.35);">
    <div style="height:8px;margin:0 -18px 14px;background:linear-gradient(90deg,#f58220 0 33%,#fff 33% 66%,#138808 66%);border-radius:20px 20px 0 0;"></div>
    <div style="font-size:28px;margin-top:5px;">${theme.icon} ✦ ✦</div>
    <div style="width:88px;height:88px;margin:7px auto;border-radius:50%;display:grid;place-items:center;background:${theme.accent};color:#fff;border:7px solid ${theme.accent2};font-size:52px;font-weight:900;box-shadow:0 8px 25px ${theme.accent}55;">✓</div>
    <div style="font-size:25px;font-weight:950;color:${theme.accent};margin-top:8px;">${esc(theme.title)}</div>
    <div style="font-size:30px;font-weight:900;font-style:italic;color:${theme.accent2};">Successfully!</div>
    <p style="font-size:16px;line-height:1.45;margin:8px 0 16px;color:#344054;"><b>Congratulations! 🎉</b><br>Your fund is now active.</p>
    <div style="background:#fff;border-radius:19px;padding:8px 12px;text-align:left;box-shadow:0 5px 20px rgba(0,0,0,.10);">
      <div style="display:flex;justify-content:space-between;padding:10px 2px;border-bottom:1px solid #edf0f2;"><span>🌐 Fund Name</span><b style="color:${theme.accent};">${esc(info.name)}</b></div>
      <div style="display:flex;justify-content:space-between;padding:10px 2px;border-bottom:1px solid #edf0f2;"><span>₹ Activation Fee</span><b style="color:${theme.accent};">${money(fee)}</b></div>
      <div style="display:flex;justify-content:space-between;padding:10px 2px;border-bottom:1px solid #edf0f2;"><span>✓ Status</span><b style="color:${theme.accent};">ACTIVE</b></div>
      <div style="display:flex;justify-content:space-between;padding:10px 2px;"><span>📅 Activated On</span><b style="color:${theme.accent};text-align:right;">${activatedAt?dt(activatedAt):'Recently'}</b></div>
    </div>
    <p style="font-size:16px;font-weight:800;color:${theme.accent};margin:15px 0 13px;">Your activated fund is ready to use 🚀</p>
    <button class="primary wide" id="activationPopupOk" style="background:linear-gradient(135deg,${theme.accent},${theme.accent2});border:0;border-radius:15px;padding:15px 12px;font-size:17px;font-weight:900;color:#fff;">OK, LET'S GO! 🚀</button>
  </div>`);

  $('activationPopupOk').onclick=async()=>{
    const ackAt=now();
    try{
      if(n.legacy){
        localStorage.setItem(`tirangaFundLegacyPopup:${me.uid}:${fund}`,String(ackAt));
      }else if(n.localPopup){
        localStorage.setItem(`tirangaFundPopupSeen:${me.uid}:${n.id}`,String(ackAt));
      }else{
        await update(ref(db,`activationNotices/${me.uid}/${n.id}`),{acknowledgedAt:ackAt});
      }
      closeModal();
    }catch(e){
      console.error('Activation popup acknowledgement failed:',e);
      toast('Please try again.');
    }finally{
      modalEl.style.alignItems=oldAlign;
      modalEl.style.paddingTop=oldPadTop;
      modalEl.style.paddingBottom=oldPadBottom;
      activationPopupBusy=false;
      setTimeout(showNextFundActivationPopup,120);
    }
  };
}


function showFundPaymentNotices(){
  if(!me||fundPaymentNoticeBusy)return;
  const notices=Object.entries(state.settings?.fundPaymentNotices||{})
    .filter(([,n])=>n?.enabled===true);
  if(!notices.length)return;

  const [fund,n]=notices[0];
  const info=FUND_INFO[fund]||{name:fund,icon:'⚠️'};
  const seenKey=`tirangaFundPaymentNoticeSeen:${me.uid}:${fund}`;
  if(localStorage.getItem(seenKey))return;

  fundPaymentNoticeBusy=true;
  modal(`<div style="position:relative;max-height:82vh;overflow:auto;border-radius:26px;background:#fff;padding:24px 20px;text-align:center;border-top:8px solid #f58220;box-shadow:0 22px 70px rgba(0,0,0,.35)">
    <div style="font-size:48px">⚠️</div>
    <div style="font-size:25px;font-weight:900;color:#138808;margin:8px 0">IMPORTANT NOTICE</div>
    <div style="font-size:22px;font-weight:900;color:#f58220">${esc(info.name)}</div>
    <div style="margin:18px 5px;padding:16px;border-radius:16px;background:#fff7ed;color:#7c2d12;font-size:18px;font-weight:800;line-height:1.5">
      ${esc(n.message||'Is fund mein abhi payment na karein.')}
    </div>
    <div style="font-size:15px;color:#667085;line-height:1.45">Admin ke notice ke anusaar payment karne se pehle fund status check karein.</div>
    <button class="primary wide" id="fundPaymentNoticeOk" style="margin-top:20px;background:linear-gradient(135deg,#138808,#35a866);border:0;border-radius:15px;padding:15px 12px;font-size:17px;font-weight:900;color:#fff">OK, I UNDERSTAND</button>
  </div>`);

  $('fundPaymentNoticeOk').onclick=()=>{
    localStorage.setItem(seenKey,String(now()));
    closeModal();
    fundPaymentNoticeBusy=false;
    setTimeout(showFundPaymentNotices,120);
  };
}
function withdrawalArray(){ return Object.entries(state.withdrawals||{}).map(([id,w])=>({id,...w})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); }
function totalWithdrawnOrHeld(){return withdrawalArray().filter(w=>['pending','processing','success','paid'].includes(String(w.status||'pending').toLowerCase())).reduce((sum,w)=>sum+Number(w.amount||0),0);}
function withdrawableBalance(){const held=totalWithdrawnOrHeld();const raw=Number(state.user?.withdrawableBalance);const bonus=state.user?.bonusClaimed?Number(state.settings?.bonusAmount||0):0;const commissionEarned=Number(liveCommission()||0);const fallback=commissionEarned+bonus;const earned=Number.isFinite(raw)&&raw>0?Math.max(raw,fallback):fallback;return Math.max(0,earned-held);}
function accountArray(fund){ return Object.entries(state.fundAccounts?.[fund]||{}).map(([id,a])=>({id,...a})).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)); }

function render(){renderReferral();
  if(!me) return;
  renderHome(); renderTransactions(); renderActivity(); renderRunStatus(); renderProfile(); renderNotificationsBadge(); setTimeout(showPreActivationNotice,0); setTimeout(showNextFundActivationPopup,120); clearTimeout(render.scheduleTimer); render.scheduleTimer=setTimeout(()=>{if(me)render();},1000);
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

function renderReferral(){
  const code=state.user?.userCode||'—';
  const link=`${location.origin}${location.pathname}?ref=${encodeURIComponent(code)}`;
  if($('referralCodeView'))$('referralCodeView').textContent=`Referral Code: ${code}`;
  if($('referralLinkView'))$('referralLinkView').textContent=link;
  const stats=state.referralStats||{};
  const entries=Object.entries(stats).map(([uid,v])=>({uid,...(v||{})})).sort((a,b)=>(b.registeredAt||0)-(a.registeredAt||0));
  const total=entries.length;
  const active=entries.filter(v=>v.active===true).length;
  const activated=Math.min(active,3);
  if($('referralCount'))$('referralCount').textContent=String(total);
  if($('referralActivatedCount'))$('referralActivatedCount').textContent=String(active);
  if($('tpRefTotal'))$('tpRefTotal').textContent=String(total);
  if($('tpRefActive'))$('tpRefActive').textContent=String(active);
  const prog=$('tpRefProgress');
  if(prog)prog.textContent=`${activated}/3`;
  const list=$('tpRefList');
  if(list){
    list.innerHTML=entries.length?entries.slice(0,20).map(v=>{
      const name=state.referralUsers?.[v.uid]?.username||v.username||'Referred User';
      const status=v.active?'Activated':'Registered';
      return `<div class="tp-ref-item"><div><b>${esc(name)}</b><small>${v.registeredAt?dt(v.registeredAt):'Recently'}</small></div><span class="status-badge ${v.active?'green':'gray'}">${status}</span></div>`;
    }).join(''):'<div class="tp-ref-empty">No referrals yet.</div>';
  }
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
  return showFundPaymentNoticeBeforePayment(key,()=>paymentFormModal(key, latest?.status==='rejected'?latest:null));
}

function showFundPaymentNoticeBeforePayment(key, after){
  const notice=state.settings?.fundPaymentNotices?.[key];
  if(!notice?.enabled)return after();

  const info=FUND_INFO[key]||{name:key,icon:'⚠️'};
  const message=notice.message||'Is fund mein abhi payment na karein.';

  fundPaymentNoticeBusy=true;
  modal(`<div style="position:relative;max-width:520px;border-radius:24px;background:#fff;padding:24px 20px;text-align:center;border-top:7px solid #f58220;box-shadow:0 18px 60px rgba(0,0,0,.28)">
    <button id="fundPaymentNoticeClose" aria-label="Close" style="position:absolute;right:14px;top:12px;width:38px;height:38px;border:0;border-radius:50%;background:#f5f5f5;font-size:24px;cursor:pointer">×</button>
    <div style="font-size:42px;margin-top:4px">⚠️</div>
    <div style="font-size:22px;font-weight:900;color:#138808;margin-top:6px">IMPORTANT NOTICE</div>
    <div style="font-size:18px;font-weight:900;color:#f58220;margin-top:4px">${esc(info.icon||'')} ${esc(info.name)}</div>
    <div style="margin:16px 0;padding:13px;border-radius:14px;background:#fff8e8;color:#5b4630;font-size:15px;font-weight:800;line-height:1.45">${esc(message)}</div>
    <button class="primary wide" id="fundPaymentNoticeContinue" style="background:linear-gradient(135deg,#138808,#35a866);border:0;border-radius:14px;padding:14px;font-size:16px;font-weight:900;color:#fff">OK, I UNDERSTAND</button>
  </div>`);

  const finish=()=>{
    closeModal();
    fundPaymentNoticeBusy=false;
    after();
  };
  $('fundPaymentNoticeClose').onclick=finish;
  $('fundPaymentNoticeContinue').onclick=finish;
}

function paymentFormModal(key,rejected=null){
  const p=PLAN_INFO[key],cfg=planConfig(key),penalty=Number(state.user?.penalty||0),base=Number(cfg.amount||0),total=base+penalty;
  const paymentNotice=state.settings?.fundPaymentNotices?.[key];
  const noticeHtml=paymentNotice?.enabled===true
    ? `<div class="fund-payment-mini-notice" style="margin:10px 0 12px;padding:10px 12px;border-radius:13px;border:1px solid #f3c77b;background:#fff8e8;display:flex;align-items:center;gap:10px;text-align:left;box-shadow:0 4px 12px rgba(0,0,0,.06)">
        <div style="width:34px;height:34px;min-width:34px;border-radius:50%;display:grid;place-items:center;background:#fff0c7;font-size:18px">⚠️</div>
        <div><b style="display:block;color:#b45309;font-size:13px;margin-bottom:2px">IMPORTANT NOTICE</b><span style="font-size:13px;line-height:1.35;color:#5b4630">${esc(paymentNotice.message||'Is fund mein abhi payment na karein.')}</span></div>
      </div>`
    : '';
  modal(`<h2>${rejected?'Pay Again':p.name}</h2>
    ${FUND_DAILY_VOLUME[key]?`<div class="daily-volume-box"><small>PER DAY VOLUME</small><b>${FUND_DAILY_VOLUME[key]}</b><span>Estimated daily transaction volume for this fund</span></div>`:''}
    ${rejected?`<div class="danger-box"><b>Previous payment rejected</b><br>Reason: ${esc(rejected.rejectReason||'Invalid / Unverified UTR')}<br>Attempts: ${Number(state.user?.invalidAttempts||0)}/4 • Current total penalty: ${money(penalty)}</div>`:''}
    <div class="payment-box"><div class="status-detail"><div><small>Activation Fee</small><b>${money(base)}</b></div><div><small>Penalty</small><b>${money(penalty)}</b></div><div><small>Total Payable</small><b>${money(total)}</b></div><div><small>UPI ID</small><b>${esc(cfg.upi||'Not set')}</b></div></div>
    ${noticeHtml}
    ${cfg.qr?`<img class="qr-preview" src="${esc(cfg.qr)}" alt="Payment QR">`:''}<div class="notice-box">${esc(cfg.instructions||'Pay the exact amount and submit the correct UTR / Transaction ID.')}</div></div>
    <label>UTR / Transaction ID<input id="paymentUtr" inputmode="numeric" maxlength="12" pattern="[0-9]{12}" autocomplete="off" placeholder="Enter 12-digit UTR"></label>
    <button class="primary wide" id="submitPayment" data-submit-plan="${key}">Submit Payment</button>
    <button class="soft wide" id="modalSupport">Customer Support</button>`);
}

function pendingPaymentModal(p){
  modal(`<div class="status-hero"><div class="status-icon">⏳</div><h2>Payment Verification Pending</h2><p>Your payment request has been submitted. Please wait for Admin verification.</p></div>
  <div class="status-detail"><div><small>Fund</small><b>${esc(PLAN_INFO[p.planKey]?.name||p.planName||p.planKey)}</b></div><div><small>Amount</small><b>${money(p.amount)}</b></div><div><small>UTR / TXN ID</small><b>${esc(p.utr)}</b></div><div><small>Submitted</small><b>${dt(p.createdAt)}</b></div></div><div class="notice-box">Payment form will not reopen while this request is pending.</div><button class="soft wide" id="modalSupport">Customer Support</button>`);
}
function verifyCodeModal(p){
  modal(`<div class="status-hero"><div class="status-icon">✅</div><h2>Payment Approved</h2><p>Admin has verified your payment. Enter the activation code to unlock the selected fund.</p></div>
  <div class="success-box"><b>Your Activation Code</b><br><span id="issuedActivationCode" style="font-size:20px;letter-spacing:2px">${esc(p.activationCode||'')}</span><br><button class="soft" id="copyActivationCodeBtn" type="button" style="margin-top:10px">📋 Copy Code</button></div>
  <label>Enter Activation Code<input id="activationCodeInput" autocomplete="off" placeholder="Paste activation code here"></label>
  <button class="primary wide" id="verifyActivationBtn" data-verify-plan="${esc(p.planKey)}" data-request="${esc(p.id)}">Verify & Activate</button>`);
}

async function submitPayment(planKey){
  const input=$('paymentUtr');
  const utr=String(input?.value||'').replace(/[^0-9]/g,'').slice(0,12);
  if(input) input.value=utr;
  if(utr.length!==12) throw Error('12 digit UTR enter karein.');
  throw Error('❌ UTR Verification Failed — आपके द्वारा दर्ज किया गया UTR सत्यापित नहीं हो पाया। कृपया दिए गए QR Code से वास्तविक payment करें और payment के बाद प्राप्त सही 12-digit UTR / Transaction ID दर्ज करें। केवल सत्यापित payment का UTR ही स्वीकार किया जाएगा।');
}

function showApkDownloadPrompt(){
  const url=state.settings?.githubApkUrl||state.settings?.apkDownloadUrl||'';
  if(!url){toast('Activation successful. Admin has not configured the GitHub APK download link yet.');return;}
  modal(`<div class="status-hero"><div class="status-icon">📱</div><h2>Activation Successful</h2><p>Your fund activation is complete.</p></div><div class="success-box"><b>Download Tiranga Pay App</b><br><small>The official APK download link configured by Admin is ready.</small></div><a class="primary wide" href="${esc(url)}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none;margin-top:14px">📱 Download App APK</a>`);
}

async function verifyActivation(planKey){
  const code=$('activationCodeInput').value.trim().toUpperCase(); if(!code)throw Error('Activation code enter karein.'); const issued=String(latestPayment(planKey)?.activationCode||state.user?.fundActivations?.[planKey]?.activationCode||'').trim().toUpperCase(); if(!issued||code!==issued)throw Error('Invalid activation code. Please copy the code issued by Admin.');
  showLoading(true);
  try{
    await set(ref(db,`verificationSubmissions/${me.uid}/${planKey}`),{enteredCode:code,verified:true,createdAt:now()});
    if(planKey==='allFunds'){
      for(const fund of FUND_KEYS){
        if(!isFundActive(fund)){
          await set(ref(db,`users/${me.uid}/fundActivations/${fund}/active`),true);
          await set(ref(db,`users/${me.uid}/fundActivations/${fund}/activatedAt`),now());
        }
      }
      if(state.user?.fundActivations?.allFunds?.active!==true) await set(ref(db,`users/${me.uid}/fundActivations/allFunds/active`),true);
    }else{
      await set(ref(db,`users/${me.uid}/fundActivations/${planKey}/active`),true); await set(ref(db,`users/${me.uid}/fundActivations/${planKey}/activatedAt`),now());
    }
    await set(ref(db,`users/${me.uid}/accountStatus`),'running'); await set(ref(db,`users/${me.uid}/activationStatus`),'verified');
    await addActivity('activation','Fund Activated',planKey==='allFunds'?'All funds activated successfully.':`${FUND_INFO[planKey].name} activated successfully.`);
    closeModal(); toast('Activation successful'); setTimeout(showApkDownloadPrompt,120);
  } finally { showLoading(false); }
}

async function openFund(k){
  if(k!=='performance'&&!isFundActive(k))return openActivation(k); if(k==='performance'&&!commonUnlocked())return commonGate(()=>{});
  const arr=accountArray(k),code=state.fundCodes?.[k];
  const credits=txArray().filter(t=>t.type==='credit'&&t.fund===k);
  modal(`<h2>${FUND_INFO[k].icon} ${esc(FUND_INFO[k].name)}</h2>
    <div class="fund-live-totals"><div><small>Total Balance</small><b>${money(Math.max(0,liveLedgerBalance()-totalWithdrawnOrHeld()))}</b></div><div><small>Total Commission</small><b>${money(liveCommission())}</b></div></div>
    <p>Commission / rate: <b>${fundRate(k)}%</b> • Bank accounts: <b>${arr.length}/10</b></p>
    <button class="primary wide" id="addFundAccount" data-fund="${k}" ${arr.length>=10?'disabled':''}>Add Bank Account</button>
    ${code?`<div class="success-box"><b>Permanent Fund Code</b><br><span style="font-size:20px;letter-spacing:3px">${esc(code)}</span></div>`:''}
    <h3 style="margin-top:18px">Credit History</h3><div class="fund-credit-list">${credits.length?credits.slice(0,100).map(t=>`<div class="account-entry"><b>+${money(t.amount)}</b><br><small>${esc(t.title||'Credit')} • ${dt(t.availableAt||t.createdAt)}</small></div>`).join(''):'<div class="notice-box">No credit transactions yet.</div>'}</div>
    <h3 style="margin-top:18px">Bank Accounts</h3><div>${arr.map(a=>`<div class="account-entry"><b>${esc(a.holder)}</b><br><small>${esc(a.bank)} • ${esc(a.accountType||'Savings')} • A/C ****${esc(String(a.account||'').slice(-4))}</small></div>`).join('')||'<div class="notice-box">No bank account added yet.</div>'}</div>`);
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
    <label>Account Type<select id="fundAccountType">${FUND_ACCOUNT_TYPES.map(x=>`<option>${x}</option>`).join('')}</select></label>
    <button class="primary wide" id="fundStep1Next" data-fund="${k}">Continue</button>`);
}
function fundStep2(k){
  const holder=$('fundHolder').value.trim(),account=$('fundAccount').value.trim(),confirm=$('fundAccountConfirm').value.trim(),phone=$('fundPhone').value.trim(),ifsc=$('fundIfsc').value.trim().toUpperCase(),bank=$('fundBank').value.trim(),accountType=$('fundAccountType')?.value||'Savings';
  if(!holder||!/^[0-9]{6,20}$/.test(account)||account!==confirm||!/^[6-9][0-9]{9}$/.test(phone)||!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)||!enabledBanks().some(b=>b.name===bank))return toast('Valid bank details fill karein.');
  draftBank={holder,account,phone,ifsc,bank,accountType};
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
  modal(`<div class="status-hero"><div class="status-icon">💰</div><h2>Commission</h2><p>Total Commission</p><h1>${money(liveCommission())}</h1></div>${arr.slice(0,20).map(t=>`<div class="account-entry"><b>+ ${money(t.amount)}</b><br><small>${esc(t.title||'Commission')} • ${dt(t.availableAt||t.createdAt)}</small></div>`).join('')||'<div class="notice-box">No commission entries yet.</div>'}`);
}
function bonusModal(){
  const amount=Number(state.settings?.bonusAmount||0),claimed=state.user?.bonusClaimed===true;
  modal(`<div class="status-hero"><div class="status-icon">🎁</div><h2>Bonus Claim</h2><p>Available Bonus</p><h1>${claimed?'Already Claimed':money(amount)}</h1></div><div class="notice-box">Bonus claim successful hone par amount directly Total Balance mein add hoga aur Transaction History mein Bonus Credit entry बनेगी.</div><button class="primary wide" id="claimBonusBtn" ${claimed?'disabled':''}>${claimed?'Already Claimed':'Claim Bonus'}</button>`);
}
async function claimBonus(){
  if(!commonUnlocked())throw Error('Activate at least one fund first.'); if(state.user?.bonusClaimed)throw Error('Bonus already claimed.'); const amount=Number(state.settings?.bonusAmount||0); if(amount<=0)throw Error('Bonus amount is not configured.');
  showLoading(true);
  try{
    const result=await runTransaction(ref(db,`users/${me.uid}`),u=>{if(!u||u.bonusClaimed)return;u.balance=Number(u.balance||0)+amount;u.withdrawableBalance=Number.isFinite(Number(u.withdrawableBalance))?Number(u.withdrawableBalance)+amount:Number(u.commission||0)+amount;u.bonusClaimed=true;u.bonusClaimedAt=now();return u;});
    if(!result.committed)throw Error('Bonus already claimed or could not be updated.');
    await set(ref(db,`bonusClaims/${me.uid}`),{uid:me.uid,email:me.email||'',amount,status:'claimed',createdAt:now()});
    await set(ref(db,`transactions/${me.uid}/bonus-claim`),{transactionId:'BONUS-'+String(now()).slice(-9),title:'Bonus Credit',type:'bonus',amount,status:'completed',source:'user_bonus_claim',createdAt:now()});
    await addActivity('bonus','Bonus Claim Successful',`${money(amount)} added to Total Balance.`); closeModal(); toast('Bonus added to Total Balance.');
  } finally {showLoading(false);}
}

let cryptoQuote={btcUsd:0,btcInr:0,updatedAt:0};
async function loadCryptoQuote(){
  try{
    const r=await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,inr',{cache:'no-store'});
    if(!r.ok) throw Error('Quote unavailable');
    const d=await r.json();
    cryptoQuote={btcUsd:Number(d.bitcoin?.usd||0),btcInr:Number(d.bitcoin?.inr||0),updatedAt:Date.now()};
  }catch(e){console.warn('BTC quote unavailable',e);}
  return cryptoQuote;
}
function availableUsdBtc(available){
  const btcUsd=Number(cryptoQuote.btcUsd||0), btcInr=Number(cryptoQuote.btcInr||0);
  const usd=btcInr>0?available*(btcUsd/btcInr):0;
  const btc=btcUsd>0?usd/btcUsd:0;
  return {usd,btc};
}
function cryptoBalanceHtml(available){
  const q=availableUsdBtc(available);
  return `<div class="crypto-balance-grid"><div><small>Available USD</small><b>$${q.usd.toLocaleString('en-US',{maximumFractionDigits:2})}</b></div><div><small>BTC Equivalent</small><b>${q.btc.toFixed(8)} BTC</b></div></div>`;
}
function withdrawalModal(){
  const arr=withdrawalArray(), available=withdrawableBalance(), total=Math.max(0,liveLedgerBalance()-totalWithdrawnOrHeld());
  loadCryptoQuote().then(()=>{const el=$('cryptoBalancePair');if(el)el.innerHTML=cryptoBalanceHtml(available);});
  modal(`<div class="withdraw-head"><div><h2>Withdrawal</h2><p>Commission + claimed bonus only</p></div><div class="balance-pair"><div class="withdraw-balance"><small>Total Balance</small><strong>${money(total)}</strong><span>Credit + available earnings</span></div><div class="withdraw-balance"><small>Withdrawal Balance</small><strong>${money(available)}</strong><span>Commission + claimed bonus only</span></div></div><div id="cryptoBalancePair">${cryptoBalanceHtml(available)}</div><div class="tabs"><button id="bankTab" class="active">Bank Withdrawal</button><button id="upiTab">UPI Withdrawal</button><button id="cryptoTab">Crypto Withdrawal</button></div><div id="withdrawForm"></div><div class="history-title"><div><h3>Withdrawal History</h3><p>Track every request and status</p></div><span class="vip-mini">VIP</span></div><div class="withdraw-history">${arr.slice(0,30).map(withdrawStatusHtml).join('')||'<div class="notice-box">No withdrawal requests yet.</div>'}</div>`); renderWithdrawalForm('bank');
}
function withdrawStatusHtml(w){
  const status=String(w.status||'pending').toLowerCase(), cls=status==='success'||status==='paid'?'success':status==='rejected'?'rejected':status==='processing'?'processing':'pending';
  const icon=cls==='success'?'✓':cls==='rejected'?'×':cls==='processing'?'↻':'↑', label=cls==='success'?'Success':cls[0].toUpperCase()+cls.slice(1);
  const destination=w.type==='crypto'?`${String(w.details?.asset||'').toUpperCase()} • ${w.details?.network||''} • ${String(w.details?.wallet||'').slice(0,12)}…`:(w.type==='upi'?(w.details?.upi||'UPI'):(w.details?.bank||'Bank Withdrawal'));
  return `<article class="withdraw-card ${cls}"><div class="withdraw-icon">${icon}</div><div class="withdraw-info"><div class="topline"><div><h4>${esc((w.type||'bank').toUpperCase())} Withdrawal</h4><p>${esc(destination)}</p></div><div><strong>${money(w.amount)}</strong><span class="status-chip ${cls}">${label}</span></div></div><p>Request ID: ${esc(w.withdrawalId||w.id)} • ${dt(w.createdAt)}</p>${w.status==='rejected'?`<p class="reason">Reason: ${esc(w.rejectReason||'Rejected by Admin')}</p>`:''}${w.referenceId?`<p>Reference: ${esc(w.referenceId)}</p>`:''}</div></article>`;
}
function renderWithdrawalForm(type){
  if(!$('withdrawForm'))return;
  ['bankTab','upiTab','cryptoTab'].forEach(id=>$(id)?.classList.toggle('active',(id==='bankTab'&&type==='bank')||(id==='upiTab'&&type==='upi')||(id==='cryptoTab'&&type==='crypto')));
  const opts=enabledBanks().map(b=>`<option value="${esc(b.name)}"></option>`).join(''), available=withdrawableBalance(), q=availableUsdBtc(available);
  $('withdrawForm').innerHTML=`<div class="withdraw-available">You can withdraw up to <b>${money(available)}</b></div>`+
  (type==='bank'?`<label>Amount<input id="wdAmount" type="number" min="1" max="${available}" placeholder="Amount"></label><label>Account Holder Name<input id="wdHolder" placeholder="Holder Name"></label><label>Account Number<input id="wdAccount" inputmode="numeric" placeholder="Account Number"></label><label>Confirm Account Number<input id="wdConfirm" inputmode="numeric" placeholder="Confirm Account Number"></label><label>IFSC Code<input id="wdIfsc" maxlength="11" placeholder="IFSC"></label><label>Mobile Number<input id="wdPhone" maxlength="10" inputmode="numeric" placeholder="Mobile"></label><label>Bank Name<input id="wdBank" list="withdrawBankList" placeholder="Bank Name"><datalist id="withdrawBankList">${opts}</datalist></label><button class="primary wide" id="submitWithdrawal" data-type="bank">Submit Withdrawal</button>`:
  type==='upi'?`<label>Amount<input id="wdAmount" type="number" min="1" max="${available}" placeholder="Amount"></label><label>Valid UPI ID<input id="wdUpi" placeholder="name@bank"></label><button class="primary wide" id="submitWithdrawal" data-type="upi">Submit Withdrawal</button>`:
  `<div class="crypto-balance-grid"><div><small>USD Available</small><b>$${q.usd.toLocaleString('en-US',{maximumFractionDigits:2})}</b></div><div><small>BTC Available</small><b>${q.btc.toFixed(8)} BTC</b></div></div><label>Crypto<select id="wdCryptoAsset"><option value="usdt">USDT</option><option value="btc">Bitcoin (BTC)</option></select></label><label>Amount<input id="wdAmount" type="number" min="0" step="0.00000001" placeholder="Enter amount"></label><label>Network<input id="wdCryptoNetwork" placeholder="e.g. TRC20 / ERC20 / BTC"></label><label>Wallet Address<input id="wdWallet" autocomplete="off" placeholder="Enter wallet address"></label><div class="notice-box">USDT minimum: 10 USDT. Bitcoin minimum: $10 equivalent BTC. Maximum: available withdrawal balance.</div><button class="primary wide" id="submitWithdrawal" data-type="crypto">Submit Crypto Withdrawal</button>`);
  $('submitWithdrawal').onclick=()=>requestWithdrawal(type).catch(e=>toast(e.message));
}
async function requestWithdrawal(type){
  if(type==='crypto'){
    const asset=$('wdCryptoAsset')?.value||'usdt', amount=Number($('wdAmount')?.value||0), network=($('wdCryptoNetwork')?.value||'').trim(), wallet=($('wdWallet')?.value||'').trim(), available=withdrawableBalance();
    if(!Number.isFinite(amount)||amount<=0)throw Error('Valid crypto amount enter karein.');
    if(!network||!wallet)throw Error('Network aur wallet address required hai.');
    if(asset==='usdt' && amount<10)throw Error('USDT minimum withdrawal 10 USDT hai.');
    if(asset==='btc'){
      const btcUsd=Number(cryptoQuote.btcUsd||0), minBtc=btcUsd>0?10/btcUsd:0;
      if(!btcUsd)throw Error('BTC rate unavailable. Try again.');
      if(amount<minBtc)throw Error(`Bitcoin minimum $10 equivalent hai (${minBtc.toFixed(8)} BTC).`);
    }
    const q=availableUsdBtc(available), valueInr=asset==='usdt'?amount*(Number(cryptoQuote.btcInr||0)/Number(cryptoQuote.btcUsd||1)):amount*(Number(cryptoQuote.btcInr||0));
    if(valueInr>available)throw Error(`Aapke available withdrawal balance se zyada amount hai.`);
    const details={asset,network,wallet,usdEquivalent:asset==='btc'?amount*Number(cryptoQuote.btcUsd||0):amount,btcEquivalent:asset==='btc'?amount:q.btc,quoteAt:cryptoQuote.updatedAt};
    const r=push(ref(db,`withdrawals/${me.uid}`)),withdrawalId='WDR-'+String(now()).slice(-10);await set(r,{id:r.key,withdrawalId,uid:me.uid,userCode:state.user?.userCode||'',username:state.user?.username||'',email:me.email||'',type:'crypto',amount,details,status:'pending',balanceSource:'commission_bonus_only',balanceHeld:true,refunded:false,createdAt:now()});await addActivity('withdrawal','Crypto Withdrawal Pending',`${asset.toUpperCase()} • ${amount} • ${withdrawalId}`);closeModal();toast('Crypto withdrawal request Pending.');return;
  }
  const amount=Number($('wdAmount').value), min=Number(state.settings?.minWithdrawal||0), available=withdrawableBalance();
  if(!Number.isFinite(amount)||amount<=0||amount<min||amount>available)throw Error(`Valid amount enter karein. Aap ${money(available)} tak withdraw kar sakte hain. Minimum ${money(min)}.`);
  const details=type==='upi'?{upi:$('wdUpi').value.trim()}:{holder:$('wdHolder').value.trim(),account:$('wdAccount').value.trim(),confirm:$('wdConfirm').value.trim(),ifsc:$('wdIfsc').value.trim().toUpperCase(),phone:$('wdPhone').value.trim(),bank:$('wdBank').value.trim()};
  if(type==='upi'&&!/^[^\s@]+@[^\s@]+$/.test(details.upi))throw Error('Valid UPI ID enter karein.');
  if(type==='bank'){if(!details.holder||!details.account||details.account!==details.confirm||!details.ifsc||!details.phone||!details.bank)throw Error('Bank details complete karein.');}
  const r=push(ref(db,`withdrawals/${me.uid}`)),withdrawalId='WDR-'+String(now()).slice(-10);await set(r,{id:r.key,withdrawalId,uid:me.uid,userCode:state.user?.userCode||'',username:state.user?.username||'',email:me.email||'',type,amount,details,status:'pending',balanceSource:'commission_bonus_only',balanceHeld:true,refunded:false,createdAt:now()});await addActivity('withdrawal','Withdrawal Pending',`${money(amount)} • ${withdrawalId}`);closeModal();toast('Withdrawal Pending. Amount held from Total & Withdrawal Balance.');
}

function showPreActivationNotice(){
  if(!me||noticeDismissed||document.getElementById('importantActivationNotice'))return;
  const wrap=document.createElement('div');wrap.id='importantActivationNotice';wrap.className='important-notice-overlay';
  wrap.innerHTML=`<div class="important-notice-card"><button class="important-notice-close" aria-label="Close">×</button><div class="notice-shield">!</div><h2><span>महत्वपूर्ण सूचना</span> | IMPORTANT NOTICE</h2><div class="tricolor-rule"></div><section><b>🇮🇳 हिंदी</b><p>हम आपसे Activation Payment और Bonus इसलिए लेते/देते हैं ताकि आपका account हमारे working panel में add और activate हो सके और आप हमारे साथ उपलब्ध work features का उपयोग कर सकें।</p><p>Activation पूरा होने के बाद आपका account eligible work features के लिए enable किया जाता है। पात्र users को Bonus platform के नियमों और eligibility के अनुसार दिया जाता है।</p><p><b>कृपया payment करने से पहले सभी details ध्यान से जाँचें। Activation, Bonus या किसी सुविधा को guaranteed income या investment return न समझें।</b></p></section><section><b>🌐 English</b><p>The Activation Payment is part of the process used to register and activate your account on the Tiranga Pay working panel so you can use the available work features.</p><p>Eligible users may receive a Bonus according to platform rules and eligibility conditions.</p><p><b>Please verify all details before making a payment. Activation, bonuses, or other platform features are not guaranteed income or investment returns.</b></p></section><button class="primary wide important-understand">समझ गया / I Understand</button></div>`;
  document.body.appendChild(wrap);const close=()=>{noticeDismissed=true;wrap.remove();}; const next=()=>{noticeDismissed=true;wrap.remove();setTimeout(activationGuidePopup,80);}; wrap.querySelector('.important-notice-close').onclick=close;wrap.querySelector('.important-understand').textContent='NEXT →';wrap.querySelector('.important-understand').onclick=next;
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
function supportModal(){ supportGuidePopup(); }
function notificationsModal(){
  const arr=[...Object.entries(state.notifications||{}).map(([id,n])=>({id,...n})),...Object.entries(state.globalNotifications||{}).map(([id,n])=>({id,...n,global:true}))].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  modal(`<h2>Notifications</h2>${arr.map(n=>`<div class="account-entry"><b>${esc(n.title||'Notification')}</b><br><small>${esc(n.message||'')}<br>${dt(n.createdAt)}</small></div>`).join('')||'<div class="notice-box">No notifications.</div>'}`);
}
function policiesModal(){ modal(`<h2>Policies & App Content</h2><h3>Privacy Policy</h3><p>${esc(state.settings?.privacyPolicy||'Not added')}</p><h3>Terms & Conditions</h3><p>${esc(state.settings?.terms||'Not added')}</p><h3>Fund Policy</h3><p>${esc(state.settings?.fundPolicy||'Not added')}</p><h3>Withdrawal Policy</h3><p>${esc(state.settings?.withdrawalPolicy||'Not added')}</p><h3>Bonus Policy</h3><p>${esc(state.settings?.bonusPolicy||'Not added')}</p>`); }

function premiumPopup(icon,title,subtitle,body,nextId,nextText){
  modal(`<div style="text-align:center;padding:4px 0 2px"><div style="width:66px;height:66px;border-radius:22px;margin:0 auto 12px;display:grid;place-items:center;font-size:32px;background:linear-gradient(135deg,#fff3df,#e9fff2);box-shadow:0 10px 28px rgba(0,0,0,.08)">${icon}</div><h2 style="margin:0;color:#172033">${title}</h2><p style="margin:6px 0 14px;color:#667085">${subtitle}</p><div style="height:4px;border-radius:99px;background:linear-gradient(90deg,#ff8a00 0 33%,#fff 33% 66%,#079447 66%);border:1px solid #eee;margin-bottom:16px"></div></div>${body}${nextId?`<button class="primary wide" id="${nextId}" style="margin-top:14px">${nextText}</button>`:''}`);
}
function activationGuidePopup(){
  const body=`<div class="guide-steps"><div class="account-entry"><b>① QR Code से Payment करें</b><br><small>Fund चुनें और दिखाए गए QR/UPI पर exact payable amount pay करें.</small></div><div class="account-entry"><b>② सही 12-digit UTR रखें</b><br><small>Payment के बाद प्राप्त UTR / Transaction ID को ध्यान से check करें.</small></div><div class="account-entry"><b>③ Activation Process</b><br><small>Payment verification और activation से जुड़ी सहायता के लिए official process follow करें.</small></div><div class="account-entry"><b>④ Bonus Claim</b><br><small>Eligible होने पर Bonus Claim option से bonus claim करें.</small></div><div class="account-entry"><b>⑤ Bank Account Add</b><br><small>Activated Fund में Add Bank Account से अपनी account details save करें.</small></div></div>`;
  premiumPopup('🛡️','Account Activation Guide','Secure • Simple • Step-by-Step',body,'guideNext','NEXT → Commission System');
}
function commissionGuidePopup(){
  const body=`<div class="commission-guide"><div class="account-entry"><b>🎮 Gaming Fund — 15%</b></div><div class="account-entry"><b>📈 Stock Fund — 30%</b></div><div class="account-entry"><b>🔄 Mix Fund — 25%</b></div><div class="account-entry"><b>🏛️ Political Fund — 30%</b></div><div class="account-entry"><b>🌐 Outside Fund — 40%</b></div><div class="account-entry"><b>🎯 Performance Bonus — 1%</b></div></div><div class="notice-box" style="margin-top:12px"><b>Live Commission Tracking</b><br>Fund activity के अनुसार Total Commission और transaction details live update होते हैं.</div>`;
  premiumPopup('💰','Commission System','Your Fund • Your Commission',body,'commissionNext','NEXT → Contact Support');
}
function supportGuidePopup(){
  const body=`<div class="notice-box" style="text-align:left"><b>TIRANGA PAY OFFICIAL SUPPORT</b><br><br>Account Activation, Payment Verification, UTR, Fund Activation, Bonus, Bank Account या अन्य account-related सहायता के लिए केवल हमारे official support options का उपयोग करें.</div><div class="account-entry" style="margin-top:12px;text-align:left"><b>📢 Official Telegram Channel</b><br><small>Latest updates, important notices और platform announcements के लिए official channel से जुड़ें.</small></div><button class="soft wide" id="openTelegramChannel">📢 JOIN OFFICIAL CHANNEL</button><div class="account-entry" style="margin-top:12px;text-align:left"><b>🎧 Customer Support</b><br><small>Account सहायता के लिए Support Team से संपर्क करें. Message करते समय अपनी User ID और problem details भेजें.</small></div><button class="soft wide" id="openSupportUser">🎧 CONTACT SUPPORT</button><div class="notice-box" style="margin-top:12px;text-align:left"><b>🕐 Support Timing:</b> Monday–Saturday, 10:00 AM–7:00 PM IST<br><b>🔐 Security:</b> OTP, UPI PIN, ATM PIN, CVV या Password कभी share न करें.</div>`;
  premiumPopup('☎️','Contact & Support','Official Help Center',body,'supportNext','NEXT → Company Network');
}

function partnershipPopup(){const rows=Object.values(state.partnerships||{}).filter(p=>p.active).sort((a,b)=>(a.order||999)-(b.order||999));modal(`<h2>🤝 Company Network</h2><p>Active names managed from the Admin Panel.</p><div class="partner-user-grid">${rows.map(p=>`<div class="partner-user-card"><span>${p.logo?`<img src="${esc(p.logo)}" alt="">`:esc(p.icon||'P')}</span><b>${esc(p.name||'')}</b>${p.verified?'<small>✓ Verified Partnership</small>':'<small>Listed Network</small>'}</div>`).join('')||'<div class="notice-box">No active network entries yet.</div>'}</div><div class="notice-box">Official partnership/registration status is shown only for entries marked Verified by Admin.</div>`);}
function bindModal(){
  $('modalClose')?.addEventListener('click',closeModal);
  document.querySelectorAll('[data-plan]').forEach(b=>b.onclick=()=>openPlan(b.dataset.plan));
  $('submitPayment')?.addEventListener('click',()=>submitPayment($('submitPayment').dataset.submitPlan).catch(e=>toast(e.message)));
  $('verifyActivationBtn')?.addEventListener('click',()=>verifyActivation($('verifyActivationBtn').dataset.verifyPlan).catch(e=>toast(e.message)));
  $('copyActivationCodeBtn')?.addEventListener('click',async()=>{const code=$('issuedActivationCode')?.textContent?.trim()||'';try{await navigator.clipboard.writeText(code);toast('Activation code copied.');}catch{toast('Code select karke copy karein.');}});
  $('paymentUtr')?.addEventListener('input',e=>{const digits=String(e.target.value||'').replace(/[^0-9]/g,'').slice(0,12); e.target.value=digits;});
  $('paymentUtr')?.addEventListener('paste',e=>{e.preventDefault(); const digits=String((e.clipboardData||window.clipboardData)?.getData('text')||'').replace(/[^0-9]/g,'').slice(0,12); e.target.value=digits; e.target.dispatchEvent(new Event('input',{bubbles:true}));});
  $('addFundAccount')?.addEventListener('click',()=>fundStep1($('addFundAccount').dataset.fund));
  $('fundStep1Next')?.addEventListener('click',()=>fundStep2($('fundStep1Next').dataset.fund));
  $('fundStep2Next')?.addEventListener('click',()=>fundStep3($('fundStep2Next').dataset.fund).catch(e=>toast(e.message)));
  $('saveFundAccount')?.addEventListener('click',()=>saveFundAccount($('saveFundAccount').dataset.fund).catch(e=>toast(e.message)));
  $('claimBonusBtn')?.addEventListener('click',()=>claimBonus().catch(e=>toast(e.message)));
  $('bankTab')?.addEventListener('click',()=>renderWithdrawalForm('bank')); $('upiTab')?.addEventListener('click',()=>renderWithdrawalForm('upi'));
  $('modalSupport')?.addEventListener('click',supportModal); $('goActivate')?.addEventListener('click',()=>openActivation());
  $('policiesBtn')?.addEventListener('click',policiesModal);
  $('openTelegram')?.addEventListener('click',()=>{const url=state.settings?.telegramLink;if(url)window.open(url,'_blank','noopener')});
  $('openTelegramChannel')?.addEventListener('click',()=>{const url=state.settings?.telegramLink;if(url)window.open(url,'_blank','noopener');else toast('Telegram Channel link not configured.');});
  $('openSupportUser')?.addEventListener('click',()=>{const url=state.settings?.supportUserLink;if(url)window.open(url,'_blank','noopener');else toast('Contact Support link not configured.');});
  $('guideNext')?.addEventListener('click',commissionGuidePopup); $('commissionNext')?.addEventListener('click',supportGuidePopup); $('supportNext')?.addEventListener('click',partnershipPopup);
}

async function addActivity(type,title,message){ if(!me)return; const r=push(ref(db,`activityLogs/${me.uid}`)); await set(r,{id:r.key,type,title,message,createdAt:now()}); }
function goPage(page){ document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${page}`)); document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===page)); window.scrollTo({top:0,behavior:'smooth'}); }

async function changeProfilePhoto(file){
  if(!file)return; if(file.size>8*1024*1024)throw Error('Image too large.'); const data=await resizeImage(file,320,320,.82); await set(ref(db,`users/${me.uid}/profilePhoto`),data); toast('Profile photo updated.');
}
function resizeImage(file,w,h,q){ return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=reject;r.onload=()=>{const img=new Image();img.onerror=reject;img.onload=()=>{const c=document.createElement('canvas');const ratio=Math.min(w/img.width,h/img.height,1);c.width=Math.max(1,Math.round(img.width*ratio));c.height=Math.max(1,Math.round(img.height*ratio));c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',q))};img.src=r.result};r.readAsDataURL(file)}); }

async function ensureOwnReferralCode(uid){
  try{
    const snap=await get(ref(db,`users/${uid}`));
    const u=snap.val()||{};
    const code=String(u.userCode||'').trim().toUpperCase();
    if(!code||!uid)return;
    const snap=await get(ref(db,`referralCodes/${code}`));
    if(!snap.exists()||String(snap.val())!==String(uid)) await set(ref(db,`referralCodes/${code}`),uid);
  }catch(e){console.warn('Referral code auto-sync failed:',e?.message||e)}
}

function clearUserListeners(){ unsubscribers.forEach(fn=>{try{fn()}catch{}}); unsubscribers=[]; }
function subscribe(path,cb){ const off=onValue(ref(db,path),s=>cb(s.val()||{})); unsubscribers.push(off); }

onValue(ref(db,'settings'),s=>{state.settings=s.val()||{}; if(!me){} else render();});
onValue(ref(db,'bankDirectory'),s=>{state.banks=s.val()||{}; if(me)render();});

onAuthStateChanged(auth,async user=>{
  clearUserListeners(); me=user||null;
  clearTimeout(autoLogoutTimer); autoLogoutTimer=null;
  if(!user){if(appLockUnsubscribe){try{appLockUnsubscribe()}catch{}}appLockUnsubscribe=null;hideAppLockPopup();$('authView').classList.remove('hidden');$('appView').classList.add('hidden');showAuth('welcome');return;}
  noticeDismissed=false;
  autoLogoutTimer=setTimeout(()=>{ if(auth.currentUser) signOut(auth).catch(()=>{}); },20*60*1000);
  $('authView').classList.add('hidden'); $('appView').classList.remove('hidden'); showLoading(true);
  try{
    const profileSnap=await get(ref(db,`users/${user.uid}`));
    const deviceId=getDeviceLockId();
    if(profileSnap.exists()){await set(ref(db,`users/${user.uid}/lastLoginAt`),now()).catch(()=>{});await set(ref(db,`users/${user.uid}/lastDevice`),currentDevice()).catch(()=>{});await set(ref(db,`users/${user.uid}/deviceId`),deviceId).catch(()=>{});}
    setupAppLock();
    subscribe(`users/${user.uid}`,v=>{state.user=v;render()});
    subscribe(`referralStats/${user.uid}`,v=>{state.referralStats=v;render()});
    subscribe(`referralRewards/${user.uid}`,v=>{state.referralRewards=v;render()});
    if(user.uid) setTimeout(()=>ensureOwnReferralCode(user.uid),0);
    subscribe(`activationPayments/${user.uid}`,v=>{state.payments=v;render()});
    subscribe(`transactions/${user.uid}`,v=>{state.transactions=v;render()});
    subscribe(`activityLogs/${user.uid}`,v=>{state.activities=v;render()});
    subscribe(`fundAccounts/${user.uid}`,v=>{state.fundAccounts=v;render()});
    subscribe(`fundSetupCodes/${user.uid}`,v=>{state.fundCodes=v;render()});
    subscribe(`withdrawals/${user.uid}`,v=>{state.withdrawals=v;render()});
    subscribe(`userActivationOverrides/${user.uid}`,v=>{state.overrides=v;render()});
    subscribe(`notifications/${user.uid}`,v=>{state.notifications=v;render()});
    subscribe(`activationNotices/${user.uid}`,v=>{state.activationNotices=v;render()});
    subscribe('settings',v=>{state.settings=v||{};render()});
    subscribe(`globalNotifications`,v=>{state.globalNotifications=v;render()});
    subscribe(`partnerships`,v=>{state.partnerships=v;render()});
    subscribe(`bonusClaims/${user.uid}`,v=>{state.bonusClaim=v;render()});
  } finally {showLoading(false);}
});

document.querySelectorAll('[data-auth]').forEach(b=>b.onclick=()=>showAuth(b.dataset.auth));
$('refreshCaptcha').onclick=refreshCaptcha;
$('loginBtn').onclick=async()=>{ $('loginMsg').textContent=''; try{showLoading(true);await signInWithEmailAndPassword(auth,$('loginEmail').value.trim(),$('loginPassword').value.trim())}catch(e){$('loginMsg').textContent=e.message}finally{showLoading(false)}};
$('forgotBtn').onclick=async()=>{const email=$('loginEmail').value.trim();if(!email)return $('loginMsg').textContent='Email enter karein.';try{await sendPasswordResetEmail(auth,email);$('loginMsg').style.color='#0b7a40';$('loginMsg').textContent='Password reset email sent.'}catch(e){$('loginMsg').textContent=e.message}};
$('registerBtn').onclick=async()=>{
  $('registerMsg').textContent='';
  const username=$('regUsername').value.trim(),phone=$('regPhone').value.trim(),email=$('regEmail').value.trim(),pass=$('regPassword').value,confirm=$('regConfirm').value,code=$('captchaInput').value.replace(/\s/g,''),referralCode=($('regReferralCode')?.value||sessionStorage.getItem('tpReferralCode')||'').trim().toUpperCase();
  if(username.length<2)return $('registerMsg').textContent='Username required.';
  if(!/^[6-9][0-9]{9}$/.test(phone))return $('registerMsg').textContent='Valid 10 digit mobile number required.';
  if(pass.length<6)return $('registerMsg').textContent='Password minimum 6 characters.';
  if(pass!==confirm)return $('registerMsg').textContent='Passwords do not match.';
  if(!referralCode)return $('registerMsg').textContent='Valid Referral Code is required.';
  if(code!==captcha)return $('registerMsg').textContent='Verification code incorrect.';
  try{
    showLoading(true);
    const refSnap=await get(ref(db,`referralCodes/${referralCode}`));
    if(!refSnap.exists()||!refSnap.val())throw Error('Invalid Referral Code. Please enter a real referral code.');
    const referredByUid=String(refSnap.val());
    if(referredByUid===me?.uid)throw Error('You cannot use your own Referral Code.');
    const cred=await createUserWithEmailAndPassword(auth,email,pass);
    const userCode='TP'+String(Date.now()).slice(-7)+Math.floor(Math.random()*90+10);
    await set(ref(db,`users/${cred.user.uid}`),{uid:cred.user.uid,userCode,username,phone,email,registeredAt:now(),accountStatus:'stopped',activationStatus:'not_submitted',balance:0,commission:0,bonusClaimed:false,invalidAttempts:0,penalty:0,blocked:false,referredByCode:referralCode,referredByUid,fundActivations:{gaming:{active:false},stock:{active:false},mix:{active:false},political:{active:false},outside:{active:false},allFunds:{active:false}}});
    await set(ref(db,`referralCodes/${userCode}`),cred.user.uid);
    await set(ref(db,`referralStats/${referredByUid}/${cred.user.uid}`),{uid:cred.user.uid,username,referralCode,registered:true,registeredAt:now(),active:false});
    const ar=push(ref(db,`activityLogs/${cred.user.uid}`));await set(ar,{id:ar.key,type:'account',title:'Registration Completed',message:`Referral Code verified: ${referralCode}`,createdAt:now()});
    toast('Registration successful.');
    const msg=$('registerMsg');if(msg)msg.innerHTML='Registration successful. Referral Code verified. Please complete activation.';
    sessionStorage.removeItem('tpReferralCode');
  }catch(e){console.error(e);$('registerMsg').textContent=e.message||'Registration failed.'}finally{showLoading(false)}
};
$('supportBeforeLogin').onclick=supportModal;
$('openActivationBtn').onclick=()=>openActivation(); $('logoutHome').onclick=()=>signOut(auth); $('notificationBtn').onclick=notificationsModal;
$('changePhotoBtn').onclick=()=>$('profilePhotoInput').click(); $('profilePhotoInput').onchange=e=>changeProfilePhoto(e.target.files?.[0]).catch(err=>toast(err.message));
document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>goPage(b.dataset.page));
$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal()});

$('copyReferralBtn')?.addEventListener('click',async()=>{const link=`${location.origin}${location.pathname}?ref=${encodeURIComponent(state.user?.userCode||'')}`;await navigator.clipboard?.writeText(link);toast('Referral link copied.')});$('shareReferralBtn')?.addEventListener('click',async()=>{const link=`${location.origin}${location.pathname}?ref=${encodeURIComponent(state.user?.userCode||'')}`;if(navigator.share) await navigator.share({title:'Tiranga Pay',text:'Join using my referral link',url:link});else {await navigator.clipboard?.writeText(link);toast('Referral link copied.')}});
if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{})); }
refreshCaptcha();

setInterval(()=>{if(me){renderTransactions();renderHome();}},10000);


// Dedicated referral page launcher (isolated; existing referral logic remains intact)
(function(){
  function refresh(){
    const u=state.user||{};
    const code=u.userCode||'—';
    const link=location.origin+location.pathname+'?ref='+encodeURIComponent(code);
    const set=(id,v)=>{const x=document.getElementById(id);if(x)x.textContent=v};
    set('tpRefCode',code); set('tpRefUrl',link);
    set('tpRefTotal',document.getElementById('referralCount')?.textContent||'0');
    set('tpRefActive',document.getElementById('referralActivatedCount')?.textContent||'0');
  }
  function open(){
    const p=document.getElementById('tp-referral-page'); if(!p)return;
    p.classList.add('is-open');p.setAttribute('aria-hidden','false');refresh();
  }
  function close(){
    const p=document.getElementById('tp-referral-page');if(!p)return;
    p.classList.remove('is-open');p.setAttribute('aria-hidden','true');
  }
  document.addEventListener('click',e=>{
    if(e.target.closest('#openReferralPage')){e.preventDefault();open();return}
    if(e.target.closest('#closeReferralPage')){e.preventDefault();close();return}
    if(e.target.closest('#tpRefCopy')){
      const t=document.getElementById('tpRefUrl')?.textContent||'';
      if(t&&navigator.clipboard){navigator.clipboard.writeText(t);if(typeof toast==='function')toast('Referral link copied.')}
    }
    if(e.target.closest('#tpRefShare')){
      const t=document.getElementById('tpRefUrl')?.textContent||'';
      if(navigator.share&&t)navigator.share({title:'Refer & Earn',text:'Join using my referral link',url:t}).catch(()=>{});
      else if(t&&navigator.clipboard){navigator.clipboard.writeText(t);if(typeof toast==='function')toast('Referral link copied.')}
    }
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  window.tpOpenReferralPage=open;
})();
