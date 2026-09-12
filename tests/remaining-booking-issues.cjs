const assert = require('node:assert/strict');
const path = require('node:path');
async function main() {
 const h=await require('./booking-regressions.cjs')({harness:true});
 const {wizardFixture:fixture,defaultSaved,button,text,nodes,loader,source,widget,config}=h;
 const flow=loader().load(path.join(source,'lib/bookingIntent.ts'));
 const price=loader().load(path.join(source,'lib/rentalPricing.ts'));
 const logic=loader().load(path.join(source,'lib/bookingFlow.ts'));
 const key=widget?'syjBookingWizard:fixture-only':'syjBookingWizard';
 const slots=(sameDay)=>({ok:true,json:async()=>({slots:[{start:'08:00',end:'10:00',label:'Morning',available:true}],sameDay})});
 const fresh={...defaultSaved,step:0,leadId:null,leadCaptured:false};
 const cfg={serviceAreaZips:['77001'],serviceAreaCenter:{lat:30,lng:-95},serviceAreaRadiusMiles:10,centerLat:30,centerLng:-95,maxRadius:10,pricing:{...config.pricing,distanceTiers:[{maxMiles:10,additionalCost:0},{maxMiles:50,additionalCost:30},{maxMiles:100,additionalCost:60}]}};
 for(const [lat,zip,verified,notice,cost] of [[31,'77001',true,'service radius',60],[30.05,'77001',true,null,0],[30.05,'99999',true,'ZIP',0],[null,'',false,null,0]]) {
  const f=fixture(fresh,{config:cfg});await f.h.flush();
  nodes(f.h.tree).find(n=>typeof n.props?.onPlaceSelect==='function').props.onPlaceSelect({address:'Synthetic address',zip,lat,lng:lat==null?null:-95,verified});await f.h.flush();
  assert.equal(button(f.h.tree,'Get My Free Quote').props.disabled,false);
  if(notice) assert.ok(text(f.h.tree).includes(notice));else assert.ok(!text(f.h.tree).includes('coverage needs review'));
  const saved=JSON.parse(f.storage.getItem(key));assert.equal(saved.distanceSurcharge,cost);assert.equal(saved.addressVerified,verified);f.h.unmount();
  const reload=fixture(saved,{config:cfg});await reload.h.flush();assert.equal(button(reload.h.tree,'Get My Free Quote').props.disabled,false);if(notice)assert.ok(text(reload.h.tree).includes(notice));assert.equal(JSON.parse(reload.storage.getItem(key)).distanceSurcharge,cost);reload.h.unmount();
  if(lat===31){const changed=fixture(saved,{config:{...cfg,maxRadius:100,serviceAreaRadiusMiles:100}});await changed.h.flush();assert.ok(!text(changed.h.tree).includes('coverage needs review'));assert.equal(JSON.parse(changed.storage.getItem(key)).distanceSurcharge,60);changed.h.unmount();}
 }
 // Older drafts already have distance; use it to restore the advisory and existing distance tiers.
 const legacy=fixture({...fresh,addressConfirmed:true,distanceMiles:69.1,distanceSurcharge:0},{config:cfg});await legacy.h.flush();assert.match(text(legacy.h.tree),/service radius/);assert.equal(button(legacy.h.tree,'Get My Free Quote').props.disabled,false);legacy.h.unmount();
 assert.equal(logic.addressCoverageNotice(true,true,10.001,10,null,[]).includes('radius'),true);
 assert.equal(logic.distanceTierSurcharge(10.001,cfg.pricing.distanceTiers),30);
 // Corruption must render recovery, retain identities and frozen requests, and send nothing.
 const id='123e4567-e89b-42d3-a456-426614174000';
 const intent={version:1,legacy:false,bookingSessionId:id,leadId:'existing-lead',attempts:{junk:{payload:{name:'Fixture',phone:'2025550198',bookingSessionId:id,value:200}}}};
 for(const tierIndex of [-1,1.5,5,999,'1',{},[],true]){
  const draft=flow.readWizardDraft(JSON.stringify({...fresh,tierIndex,intent}));assert.equal(draft.recoveryBlocked,true);assert.equal(draft.intent.bookingSessionId,id);
  const restored=flow.restoreIntent(draft);assert.equal(restored.blocked,true);assert.equal(restored.bookingSessionId,id);assert.equal(restored.attempts.junk.payload.value,200);
  const f=fixture(draft);await f.h.flush();assert.match(text(f.h.tree),/saved booking could not be read safely/i);assert.equal(f.calls.filter(c=>c.body?.type).length,0);const again=flow.restoreIntent(flow.readWizardDraft(f.storage.getItem(key)));assert.equal(again.blocked,true);assert.equal(again.bookingSessionId,id);f.h.unmount();
 }
 for(const tierIndex of [0,1,2,3,4]) {const draft=flow.readWizardDraft(JSON.stringify({...fresh,tierIndex,intent}));assert.ok(!draft.recoveryBlocked);assert.equal(draft.tierIndex,tierIndex);assert.equal(flow.restoreIntent(draft).bookingSessionId,id);const f=fixture(draft);await f.h.flush();f.h.unmount();}
 for(const raw of ['{','[]','null']) assert.equal(flow.readWizardDraft(raw).recoveryBlocked,true);
 // Rental quote and payload: both service modes, flat/percentage fees, promos, scopes and current server verdict.
 for(const serviceType of ['dumpster','both']) for(const [settings,promo,expected] of [
  [{isSameDay:true,surchargeType:'flat',surchargeAmount:25},null,397],
  [{isSameDay:true,surchargeType:'flat',surchargeAmount:25},{valid:true,appliesTo:'both',discountType:'percentage',discountValue:20},317.6],
  [{isSameDay:true,surchargeType:'percentage',surchargeAmount:10},{valid:true,appliesTo:'dumpster',discountType:'flat',discountValue:20},389.2],
  [{isSameDay:false,surchargeType:'flat',surchargeAmount:25},null,372],
  [{isSameDay:true,surchargeType:'flat',surchargeAmount:0},null,372],
  [{isSameDay:true,surchargeType:'flat',surchargeAmount:25},{valid:true,appliesTo:'junk',discountType:'percentage',discountValue:20},397]
 ]) {
  const f=fixture({...defaultSaved,serviceType,step:serviceType==='both'?6:5,promoCode:promo?'FIXTURE':null},{slots:()=>slots(settings),promo});await f.h.flush();
  const quote=text(f.h.tree);assert.ok(quote.includes(price.rentalMoney(expected)),quote);assert.ok(quote.includes('Base rental price: $372.00'));assert.match(quote,/subtotal \(before tax\)/);
  if(settings.isSameDay&&settings.surchargeAmount>0)assert.match(quote,/Same-day fee/);else assert.ok(!quote.includes('Same-day fee:'));
  button(f.h.tree,serviceType==='dumpster'?'Confirm Dumpster Rental':'Confirm & Book').props.onClick();await f.h.flush();assert.equal(f.calls.find(c=>c.body?.type==='rental_lead').body.value,372);f.h.unmount();
 }
 for(const [availability,expected] of [[{available:true,baseRate:450},'$475.00'],[{available:true,baseRate:null},'Pending Confirmation'],[{available:true,baseRate:-5},'Pending Confirmation'],[{available:true},'$397.00']]) {
  const f=fixture({...defaultSaved,step:6},{availability:()=>({ok:true,json:async()=>availability})});await f.h.flush();assert.ok(text(f.h.tree).includes(expected));f.h.unmount();
 }
 // Date change invalidates authoritative fee data immediately, then accepts the new response.
 const f=fixture({...defaultSaved,selectedDate:'2026-09-08',step:6},{config:{sameDaySurchargeType:'flat',sameDaySurchargeAmount:25},slots:url=>slots({isSameDay:url.includes('2026-09-08'),surchargeType:'flat',surchargeAmount:25})});await f.h.flush();assert.ok(text(f.h.tree).includes('$397.00'));
 f.events.popstate({state:{wizardStep:5}});await f.h.flush();nodes(f.h.tree).find(n=>n.type?.name==='Calendar').props.onSelect(new Date(2026,8,9));await f.h.flush();button(f.h.tree,'Continue').props.onClick();await f.h.flush();assert.ok(text(f.h.tree).includes('$372.00'));assert.ok(!text(f.h.tree).includes('Same-day fee:'));f.h.unmount();
 // Config fallback is used only without a current authoritative same-day response.
 for(const error of [true,false]) {
  const q=fixture({...defaultSaved,step:6,selectedDate:'2026-09-08'},{config:{sameDaySurchargeType:'percentage',sameDaySurchargeAmount:10,sameDay:{surchargeType:'percentage',surchargeAmount:10}},slots:()=>error?{ok:false,json:async()=>({})}:slots({isSameDay:true,surchargeType:'flat',surchargeAmount:0})});
  await q.h.flush();assert.ok(text(q.h.tree).includes(error?'$409.20':'$372.00'));if(widget&&error)assert.match(text(q.h.tree),/Date eligibility needs confirmation/);q.h.unmount();
 }
 // A corrupt tier without a saved identity must not mint a new booking session.
 const noIdentity=flow.readWizardDraft(JSON.stringify({...fresh,tierIndex:1.5}));assert.equal(flow.restoreIntent(noIdentity).bookingSessionId,undefined);
 // Exact backend rounding: amount first, then subtraction; clamp excessive promos.
 assert.equal(price.rentalQuoteSubtotal(0.05,{discountType:'percentage',discountValue:10}),0.04);
 assert.equal(price.rentalQuoteSubtotal(397,{discountType:'percentage',discountValue:200}),0);
 assert.equal(price.rentalQuoteSubtotal(397,{discountType:'flat',discountValue:500}),0);
 assert.equal(price.rentalQuoteBase({baseRate:372,baseRateMin:340},{baseRate:450}),450);
 assert.equal(price.rentalQuoteBase({baseRate:372,baseRateMin:340},null),340);
 console.log(`${widget?'Widget':'Website'}: issues 1, 3, 8 module/render/payload regressions passed.`);
}
module.exports=main;
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
