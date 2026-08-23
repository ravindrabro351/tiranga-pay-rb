const {onValueCreated,onValueWritten}=require("firebase-functions/v2/database");
const admin=require("firebase-admin");admin.initializeApp();
exports.notifyAdmins=onValueCreated("/adminActivityFeed/{id}",async e=>{
 const x=e.data.val()||{},s=await admin.database().ref("adminFcmTokens").get(),tokens=[];
 s.forEach(a=>a.forEach(t=>{if(t.val()?.token)tokens.push(t.val().token)}));
 if(!tokens.length)return null;
 return admin.messaging().sendEachForMulticast({tokens,notification:{title:x.title||"Tiranga Pay Activity",body:(x.userEmail?x.userEmail+" · ":"")+(x.message||"")},data:{uid:String(x.uid||""),type:String(x.type||"activity")}});
});

const FUND_ORDER=["gaming","stock","mix","political","outside"];

exports.processReferralActivation=onValueWritten("/users/{uid}/fundActivations/{fund}/active",async event=>{
  const after=event.data.after.val();
  const before=event.data.before.val();
  if(after!==true || before===true) return null;
  const uid=event.params.uid, fund=event.params.fund;
  const db=admin.database();
  const userSnap=await db.ref(`users/${uid}`).get();
  const user=userSnap.val()||{};
  const referrerUid=String(user.referredByUid||"");
  if(!referrerUid || referrerUid===uid) return null;

  const statRef=db.ref(`referralStats/${referrerUid}/${uid}`);
  const statSnap=await statRef.get();
  if(!statSnap.exists()) return null;
  const stat=statSnap.val()||{};

  const rewardRef=db.ref(`referralRewards/${referrerUid}/${uid}/${fund}`);
  const rewardSnap=await rewardRef.get();
  if(rewardSnap.exists()) return null;

  let activationAmount=0;
  const requestId=String(user.fundActivations?.[fund]?.requestId||"");
  if(requestId){
    const paymentSnap=await db.ref(`activationPayments/${uid}/${requestId}`).get();
    activationAmount=Number(paymentSnap.val()?.amount||0);
  }
  const rewardAmount=Number((activationAmount*0.50).toFixed(2));
  const now=Date.now();
  const updates={};
  updates[`referralStats/${referrerUid}/${uid}/active`]=true;
  updates[`referralStats/${referrerUid}/${uid}/activatedAt`]=now;
  updates[`referralStats/${referrerUid}/${uid}/activatedFund`]=fund;
  updates[`referralStats/${referrerUid}/${uid}/activationAmount`]=activationAmount;
  updates[`referralRewards/${referrerUid}/${uid}/${fund}`]={amount:rewardAmount,rate:50,activationAmount,fund,createdAt:now,status:"confirmed"};

  if(rewardAmount>0){
    const txId=`REF-${uid.slice(0,8)}-${fund}-${now}`;
    updates[`transactions/${referrerUid}/${txId}`]={transactionId:txId,title:`Referral Reward • ${fund}`,type:"commission",amount:rewardAmount,status:"completed",source:"referral_activation",fund,referredUid:uid,createdAt:now,availableAt:now};
    const refUserSnap=await db.ref(`users/${referrerUid}`).get();
    const refUser=refUserSnap.val()||{};
    updates[`users/${referrerUid}/commission`]=Number(refUser.commission||0)+rewardAmount;
    updates[`users/${referrerUid}/withdrawableBalance`]=Number(refUser.withdrawableBalance||0)+rewardAmount;
  }

  const allStatsSnap=await db.ref(`referralStats/${referrerUid}`).get();
  const allStats=allStatsSnap.val()||{};
  let activatedCount=0;
  Object.values(allStats).forEach(x=>{if(x?.active===true)activatedCount++;});
  activatedCount=Math.max(activatedCount,1);
  updates[`users/${referrerUid}/referralProgress/activatedCount`]=activatedCount;
  updates[`users/${referrerUid}/referralProgress/requiredCount`]=3;

  if(activatedCount>=3){
    const refUserSnap=await db.ref(`users/${referrerUid}`).get();
    const refUser=refUserSnap.val()||{};
    if(refUser.referralFreeFundClaimed!==true){
      const acts=refUser.fundActivations||{};
      const freeFund=FUND_ORDER.find(k=>acts?.[k]?.active!==true)||null;
      if(freeFund){
        updates[`users/${referrerUid}/fundActivations/${freeFund}`]={...(acts[freeFund]||{}),active:true,activatedAt:now,activationMethod:"referral_reward",activatedBy:"system",freeActivation:true,referralRewardAt:now};
        updates[`users/${referrerUid}/referralFreeFundClaimed`]=true;
        updates[`users/${referrerUid}/referralProgress/freeFund`]=freeFund;
        updates[`users/${referrerUid}/referralProgress/freeActivatedAt`]=now;
      }
    }
  }

  await db.ref().update(updates);
  return null;
});
