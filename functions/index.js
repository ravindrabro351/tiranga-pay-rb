const {onValueCreated}=require("firebase-functions/v2/database");
const admin=require("firebase-admin");admin.initializeApp();
exports.notifyAdmins=onValueCreated("/adminActivityFeed/{id}",async e=>{
 const x=e.data.val()||{},s=await admin.database().ref("adminFcmTokens").get(),tokens=[];
 s.forEach(a=>a.forEach(t=>{if(t.val()?.token)tokens.push(t.val().token)}));
 if(!tokens.length)return null;
 return admin.messaging().sendEachForMulticast({tokens,notification:{title:x.title||"Tiranga Pay Activity",body:(x.userEmail?x.userEmail+" · ":"")+(x.message||"")},data:{uid:String(x.uid||""),type:String(x.type||"activity")}});
});