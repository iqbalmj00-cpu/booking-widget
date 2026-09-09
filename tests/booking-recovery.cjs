const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');

function ack(service, patch={}) {
    return {contractVersion:2,success:true,service,outcome:'scheduled',scheduled:true,leadId:'accepted-lead',jobId:'shared-job',rentalId:service==='dumpster'?'rental-1':null,customerId:'customer-1',
        schedule:{timezone:'America/Los_Angeles',calendarDate:'2026-09-20',date:'2026-09-20T07:00:00Z',start:null,windowStart:'2026-09-20T15:00:00Z',windowEnd:'2026-09-20T17:00:00Z',planStatus:'tentative'},
        pricing:{status:'accepted',base:100,subtotal:75,subtotalMax:150,discount:25,fees:[],promo:{status:'applied'},tax:null,total:null},payment:{status:'unknown'},...patch};
}
const response = (data,status=200,headers={}) => ({ok:status>=200&&status<300,status,headers:new Headers(headers),json:async()=>data});

module.exports = async function recoveryTests() {
    const h = await require('./booking-regressions.cjs')({harness:true});
    const {wizardFixture,defaultSaved,button,loader,source,config,hooks,memory,text,widget}=h;
    const key=widget?'syjBookingWizard:fixture-only':'syjBookingWizard';
    const receiptKey=widget?`${key}:receipt`:'syjBookingConfirmation';
    const posted=f=>f.calls.filter(c=>c.body?.intent==='submit');
    const draft=f=>JSON.parse(f.storage.getItem(key));
    const fresh={...defaultSaved,step:6,leadId:null,leadCaptured:false};
    const service=body=>body.serviceType==='dumpster_rental'?'dumpster':'junk';
    const okSubmit=init=>response(ack(service(JSON.parse(init.body))));
    const basic=loader();
    const flow=basic.load(path.join(source,'lib/bookingIntent.ts'));

    // Validate the wire contract and preserve unknown money, structured conflicts, retry timing.
    for(const state of ['scheduled','request_saved','pending_approval','closed','uncertain','rejected']) {
        const status=state==='uncertain'?202:state==='rejected'||state==='closed'?409:200;
        assert.equal(flow.readOutcome({status,data:ack('junk',{outcome:state})},'junk').outcome,state);
    }
    for(const data of [null,[],{success:true},{...ack('junk'),service:'dumpster'},{...ack('junk'),jobId:null},{...ack('junk'),contractVersion:99}]) assert.equal(flow.readOutcome({status:200,data},'junk').outcome,'uncertain');
    assert.equal(flow.readOutcome({status:200,data:{success:true,leadId:'legacy'}},'junk').outcome,'request_saved');
    const unknown=flow.readOutcome({status:200,data:ack('junk',{pricing:{status:'accepted',subtotal:'75',subtotalMax:Infinity}})},'junk');
    assert.equal(unknown.pricing.subtotal,null);assert.equal(flow.acceptedPriceLabel(unknown),null);
    assert.equal(flow.readOutcome({status:202,data:ack('junk',{outcome:'uncertain'})},'junk').pricing.promo.status,'unknown');
    const scheduled=flow.readOutcome({status:200,data:ack('junk')},'junk');
    assert.match(flow.savedScheduleLabel(scheduled),/8:00 AM – 10:00 AM arrival window/);assert.match(flow.savedScheduleLabel(scheduled),/America\/Los_Angeles/);
    const complete=flow.readOutcome({status:200,data:ack('dumpster',{rental:{status:'active',deliveryStatus:'completed',deliveryCompleted:true}})},'dumpster');
    assert.equal(flow.savedScheduleLabel(complete),null);assert.match(flow.outcomeMessage(complete),/Delivery completed/);

    // Real capture handler, then remount and final submission: one UUID, persisted before every POST.
    let captureId;
    const capture=wizardFixture({...fresh,step:0},{submit:init=>{const p=JSON.parse(init.body);const saved=draft(capture);assert.equal(saved.intent.bookingSessionId,p.bookingSessionId);captureId=p.bookingSessionId;assert.equal(p.intent,'capture');assert.equal(p.requestedDate,undefined);return response(ack('junk',{outcome:'request_saved',jobId:null}));}});
    await capture.h.flush();button(capture.h.tree,'Get My Free Quote').props.onClick();await capture.h.flush();assert.match(captureId,/^[0-9a-f-]{36}$/);assert.equal(draft(capture).leadId,'accepted-lead');capture.h.unmount();
    const capturedDraft={...draft(capture),step:6};capture.storage.setItem(key,JSON.stringify(capturedDraft));
    const final=wizardFixture(capturedDraft,{storage:capture.storage,submit:init=>{const p=JSON.parse(init.body);assert.equal(p.bookingSessionId,captureId);assert.ok(draft(final).intent.attempts.junk);assert.ok(draft(final).intent.attempts.dumpster);return okSubmit(init);}});
    await final.h.flush();button(final.h.tree,'Confirm & Book').props.onClick();await final.h.flush();assert.equal(posted(final).length,2);
    assert.equal(posted(final)[0].body.metadata.quoteMin,200);assert.equal(posted(final)[0].body.metadata.quoteMax,300);
    const receipt=JSON.parse(final.storage.getItem(receiptKey));assert.equal(receipt.outcomes.junk.pricing.subtotal,75);assert.equal(receipt.outcomes.junk.pricing.subtotalMax,150);
    assert.ok(final.storage.getItem(key));if(!widget)assert.equal(final.calls.filter(c=>c.event==='booking_complete').length,1);final.h.unmount();

    // Definitive capture rejection permits corrected fields, with the same UUID even across reload.
    for(const rejectionStatus of [400,422]) for(const reloadBetween of [false,true]) {
        const sent=[];
        const server=init=>{const p=JSON.parse(init.body);sent.push(p);return p.email==='fixed@outlook.com'?response(ack('junk',{outcome:'request_saved',jobId:null})):response({error:'Email validation failed'},rejectionStatus);};
        let rejected=wizardFixture({...fresh,step:0},{submit:server});await rejected.h.flush();button(rejected.h.tree,'Get My Free Quote').props.onClick();await rejected.h.flush();
        assert.equal(draft(rejected).intent.captureAcknowledgement.httpStatus,rejectionStatus);const rejectedId=draft(rejected).intent.bookingSessionId;
        if(reloadBetween){const store=rejected.storage;const saved=draft(rejected);rejected.h.unmount();rejected=wizardFixture(saved,{storage:store,submit:server});await rejected.h.flush();}
        h.nodes(rejected.h.tree).find(n=>n.type==='input'&&n.props.id?.endsWith('-email')).props.onChange({target:{value:'fixed@outlook.com'}});await rejected.h.flush();
        button(rejected.h.tree,'Get My Free Quote').props.onClick();await rejected.h.flush();assert.deepEqual(sent.map(p=>p.email),['fixture@gmail.com','fixed@outlook.com']);assert.ok(sent.every(p=>p.bookingSessionId===rejectedId));assert.equal(draft(rejected).intent.captureAcknowledgement.outcome,'request_saved');assert.equal(draft(rejected).leadCaptured,true);rejected.h.unmount();
    }
    // Unknown captures remain byte-equivalent despite edits/reload; a validation correction that then loses its response is frozen too.
    for(const unknownStatus of [0,202,503]) {
        const sent=[];let mode='reject';
        const server=init=>{const p=JSON.parse(init.body);sent.push(JSON.stringify(p));if(mode==='reject')return response({error:'Invalid email'},400);if(mode==='unknown'){if(unknownStatus===0)throw Error('Lost capture response');return response(ack('junk',{outcome:'uncertain',jobId:null}),unknownStatus);}return response(ack('junk',{outcome:'request_saved',jobId:null}));};
        let original=wizardFixture({...fresh,step:0},{submit:server});await original.h.flush();button(original.h.tree,'Get My Free Quote').props.onClick();await original.h.flush();
        h.nodes(original.h.tree).find(n=>n.type==='input'&&n.props.id?.endsWith('-email')).props.onChange({target:{value:'fixed@outlook.com'}});await original.h.flush();mode='unknown';button(original.h.tree,'Get My Free Quote').props.onClick();await original.h.flush();assert.equal(draft(original).intent.captureAcknowledgement.outcome,'uncertain');
        const store=original.storage,saved=draft(original);original.h.unmount();original=wizardFixture(saved,{storage:store,submit:server});await original.h.flush();h.nodes(original.h.tree).find(n=>n.type==='input'&&n.props.id?.endsWith('-email')).props.onChange({target:{value:'different@outlook.com'}});await original.h.flush();mode='accept';button(original.h.tree,'Get My Free Quote').props.onClick();await original.h.flush();assert.equal(sent[1],sent[2]);assert.equal(draft(original).intent.captureAcknowledgement.outcome,'request_saved');original.h.unmount();
    }

    // Response lost after the synthetic server committed either leg: reload twice, replay only unresolved.
    for(const lostService of ['junk','dumpster']) {
        const records=new Map();let created=0,redemptions=0;
        const server=(init,lose)=>{const p=JSON.parse(init.body),s=service(p),id=`${p.bookingSessionId}:${s}`;
            if(!records.has(id)){records.set(id,JSON.stringify(p));created++;if(redemptions===0)redemptions++;}
            else assert.equal(JSON.stringify(p),records.get(id),'ambiguous replay must be byte-equivalent');
            if(lose&&s===lostService)throw Error('Response lost after commit');return response(ack(s));};
        const first=wizardFixture(fresh,{submit:init=>server(init,true)});await first.h.flush();button(first.h.tree,'Confirm & Book').props.onClick();await first.h.flush();
        assert.equal(created,2);assert.equal(redemptions,1);assert.equal(first.storage.getItem(receiptKey),null);assert.equal(first.calls.filter(c=>c.event==='booking_complete').length,0);
        const id=draft(first).intent.bookingSessionId;first.h.unmount();
        const remount=wizardFixture(draft(first),{storage:first.storage,submit:init=>server(init,false)});await remount.h.flush();assert.equal(posted(remount).length,0);assert.equal(draft(remount).intent.bookingSessionId,id);remount.h.unmount();
        const reload=wizardFixture(draft(first),{storage:first.storage,submit:init=>server(init,false),slots:()=>response({slots:[]}),availability:()=>response({available:false})});await reload.h.flush();
        button(reload.h.tree,'Check saved booking status').props.onClick();await reload.h.flush();assert.equal(posted(reload).length,1);assert.equal(service(posted(reload)[0].body),lostService);assert.equal(created,2);assert.equal(redemptions,1);assert.ok(reload.storage.getItem(receiptKey));reload.h.unmount();
    }

    // 202 is bounded and recoverable; accepted later leg never gets sent again.
    let pending=true;
    const uncertain=wizardFixture(fresh,{fastTimers:true,submit:init=>{const s=service(JSON.parse(init.body));return response(ack(s,pending&&s==='junk'?{outcome:'uncertain',scheduled:false,jobId:null,retryAfter:0}:{}),pending&&s==='junk'?202:200);}});
    await uncertain.h.flush();button(uncertain.h.tree,'Confirm & Book').props.onClick();await uncertain.h.flush();
    assert.equal(posted(uncertain).filter(c=>service(c.body)==='junk').length,3);assert.equal(posted(uncertain).filter(c=>service(c.body)==='dumpster').length,1);assert.equal(uncertain.storage.getItem(receiptKey),null);
    pending=false;button(uncertain.h.tree,'Check saved booking status').props.onClick();await uncertain.h.flush();assert.equal(posted(uncertain).length,5);assert.ok(uncertain.storage.getItem(receiptKey));uncertain.h.unmount();

    // Separate booking is deliberate; remount/review does not duplicate analytics or POSTs.
    const review=wizardFixture(draft(final),{storage:final.storage,submit:okSubmit});await review.h.flush();button(review.h.tree,'View saved receipt').props.onClick();await review.h.flush();assert.equal(posted(review).length,0);assert.equal(review.calls.filter(c=>c.event==='booking_complete').length,0);
    button(review.h.tree,'Start new booking').props.onClick();await review.h.flush();assert.equal(review.storage.getItem(key),null);review.h.unmount();
    const newBooking=wizardFixture(fresh,{storage:review.storage,submit:okSubmit});await newBooking.h.flush();assert.notEqual(draft(newBooking).intent.bookingSessionId,captureId);newBooking.h.unmount();

    // Legacy drafts must never receive a new UUID, even after stale-ID recovery.
    const legacy=wizardFixture({...defaultSaved,step:6},{submit:init=>{const p=JSON.parse(init.body);assert.equal(p.bookingSessionId,undefined);return p.leadId==='tab-A'?response({error:'Lead not found'},404):response(ack(service(p)));}});
    await legacy.h.flush();button(legacy.h.tree,'Confirm & Book').props.onClick();await legacy.h.flush();assert.equal(posted(legacy).length,3);assert.equal(posted(legacy)[2].body.leadId,'accepted-lead');legacy.h.unmount();

    const legacyUnknown=flow.restoreIntent({intent:{version:1,legacy:true,leadId:null,attempts:{junk:{payload:{name:'Fixture',phone:'2025550198'}}}}});
    assert.equal(legacyUnknown.bookingSessionId,undefined);assert.equal(legacyUnknown.legacy,true);

    // Malformed storage cannot silently turn an old booking into a fresh intent.
    const malformed=wizardFixture(fresh,{storage:memory({[key]:'{bad json'})});await malformed.h.flush();assert.match(text(malformed.h.tree),/booking status/);assert.equal(posted(malformed).length,0);malformed.h.unmount();
    const disabled=memory({[key]:JSON.stringify(fresh)});disabled.setItem=()=>{throw Error('Quota');};
    const unavailable=wizardFixture(fresh,{storage:disabled,submit:okSubmit});await unavailable.h.flush();button(unavailable.h.tree,'Confirm & Book').props.onClick();await unavailable.h.flush();assert.equal(posted(unavailable).length,0);assert.match(text(unavailable.h.tree),/could not save/);unavailable.h.unmount();

    // Booking acknowledgement recovery never repeats card setup or card persistence.
    let setupCount=0,cardCount=0;const active=[];
    const card={stripeReady:true,cardComplete:true,cardError:null,setupError:null,retryCard:()=>{},setupClientSecret:'fixture',stripeRef:{current:{confirmCardSetup:async()=>{setupCount++;return {setupIntent:{payment_method:'pm_fixture'}};}}},cardRef:{current:{}},cardMountRef:()=>{},active:v=>active.push(v)};
    let cardLost=true;
    const withCard=wizardFixture({...fresh,paymentPreference:'card'},{config:{stripePublishableKey:'pk_fixture'},card,confirmCard:()=>{cardCount++;return response({success:true});},submit:init=>{if(cardLost&&service(JSON.parse(init.body))==='junk')throw Error('Lost response');return okSubmit(init);}});
    await withCard.h.flush();button(withCard.h.tree,'Confirm & Book').props.onClick();await withCard.h.flush();assert.equal(setupCount,1);assert.equal(cardCount,1);withCard.h.unmount();
    cardLost=false;active.length=0;
    const cardReload=wizardFixture(draft(withCard),{storage:withCard.storage,config:{stripePublishableKey:'pk_fixture'},card,confirmCard:()=>{cardCount++;return response({success:true});},submit:okSubmit});
    await cardReload.h.flush();button(cardReload.h.tree,'Check saved booking status').props.onClick();await cardReload.h.flush();assert.equal(setupCount,1);assert.equal(cardCount,1);assert.ok(active.every(v=>v===false));cardReload.h.unmount();
    // A storage failure after a response keeps that acknowledgement visible in memory.
    const afterStore=memory({[key]:JSON.stringify(fresh)});const afterFailure=wizardFixture(fresh,{storage:afterStore,submit:init=>{afterStore.setItem=()=>{throw Error('Quota after acceptance');};return okSubmit(init);}});
    await afterFailure.h.flush();button(afterFailure.h.tree,'Confirm & Book').props.onClick();await afterFailure.h.flush();assert.equal(posted(afterFailure).length,1);assert.match(text(afterFailure.h.tree),/75.00/);assert.match(text(afterFailure.h.tree),/Keep this tab open/);assert.equal(afterStore.getItem(receiptKey),null);afterFailure.h.unmount();
    const cancelled=flow.readOutcome({status:200,data:ack('dumpster',{outcome:'request_saved',scheduled:false,autoBooked:false,code:'delivery_cancelled',rental:{status:'reserved',deliveryStatus:'cancelled'}})},'dumpster');
    assert.equal(cancelled.outcome,'request_saved');assert.equal(cancelled.pricing.subtotal,75);assert.equal(flow.savedScheduleLabel(cancelled),null);assert.match(flow.outcomeMessage(cancelled),/delivery was cancelled/);

    // Transport: use the actual widget adapter / website CRM proxy, preserving status/body/headers.
    for(const [status,body] of [[202,ack('junk',{outcome:'uncertain',retryAfter:2})],[409,ack('junk',{success:false,outcome:'rejected',code:'booking_change_requires_review',alternatives:[{date:'2026-09-21'}]})]]) {
        const fetch=async()=>new Response(JSON.stringify(body),{status,headers:{'Retry-After':'2'}});
        let result;
        if(widget) {
            const api=loader({}, {fetch}).load(path.join(source,'lib/api.ts'));
            result=await api.widgetApi.submitBookingResponse({},config);
            if(status===409)await assert.rejects(api.widgetApi.submitBooking({},config),e=>e.status===409&&e.code===body.code&&e.data.alternatives.length===1);
        } else {
            class NextResponse extends Response {static json(data,init){return new NextResponse(JSON.stringify(data),init);}}
            const proxy=loader({'next/server':{NextResponse}}, {Request,Response,Headers,fetch,process:{env:{SITE_TOKEN:'fixture',INGEST_API_KEY:'fixture',DASHBOARD_URL:'http://fixture.invalid'}}}).load(path.join(source,'app/api/crm/route.ts'));
            const res=await proxy.POST(new Request('http://fixture.invalid',{method:'POST',body:'{}'}));result={status:res.status,data:await res.json(),retryAfter:res.headers.get('Retry-After')};
        }
        assert.equal(result.status,status);assert.deepEqual(result.data,body);assert.equal(result.retryAfter,'2');
    }

    // Actual receipt rendering from the persisted acknowledgement, including full-price promo failure.
    const Receipt=basic.load(path.join(source,'components/BookingReceipt.tsx')).default;
    const markup=renderToStaticMarkup(React.createElement(Receipt,{services:['junk','dumpster'],outcomes:{junk:scheduled,dumpster:{...complete,pricing:{...complete.pricing,subtotal:400,subtotalMax:null,promo:{status:'unavailable'}}}},phone:'2025550198'}));
    for(const phrase of ['$75.00 – $150.00','8:00 AM – 10:00 AM','Delivery completed','regular pricing','Tax, final total and payment'])assert.ok(markup.includes(phrase),phrase);
    assert.ok(!markup.includes('confirmed for delivery'));assert.ok(!markup.includes('paid'));
    if(widget) {
        const hh=hooks();const Widget=loader({react:hh.api,[path.join(source,'components/BookingWizard.tsx')]:{__esModule:true,default:()=>null}},{sessionStorage:memory({[receiptKey]:JSON.stringify(receipt)})}).load(path.join(source,'components/Widget.tsx')).default;
        hh.mount(()=>Widget({config}));await hh.flush();assert.match(text(hh.tree),/75.00/);hh.unmount();
    } else {
        const vis=basic.load(path.join(source,'lib/visibility.ts'));
        assert.equal(vis.shouldRenderContactPage({...config,contactEnabled:true,mailboxConnected:false}),true);
        assert.equal(vis.shouldRenderContactPage({...config,contactEnabled:false,mailboxConnected:true}),false);
        const envConfig=loader({}, {process:{env:{NEXT_PUBLIC_CONTACT_ENABLED:'true',NEXT_PUBLIC_MAILBOX_CONNECTED:'false'}}}).load(path.join(source,'lib/siteConfig.ts'));assert.equal(envConfig.siteConfig.contactEnabled,true);assert.equal(envConfig.siteConfig.mailboxConnected,false);assert.equal(envConfig.createSiteConfigFromPublicConfig({contactEnabled:false,mailboxConnected:true}).contactEnabled,false);
        const read=basic.load(path.join(source,'lib/bookingConfirmation.ts')).parseBookingConfirmation(JSON.stringify(receipt));assert.equal(read.outcomes.junk.pricing.subtotalMax,150);
    }
    console.log(`${widget?'Widget':'Website'} durable booking recovery regressions passed.`);
};
