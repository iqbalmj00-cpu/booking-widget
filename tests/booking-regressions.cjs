/* Isolated source regression harness: installed TypeScript + React, no emitted files,
 * real accounts, environment files, or outbound network. Effects/Stripe are mocked. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const widget = fs.existsSync(path.join(root, 'src/components/Widget.tsx'));
const source = widget ? path.join(root, 'src') : root;
class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-09-08T16:00:00Z'])); }
    static now() { return Date.parse('2026-09-08T16:00:00Z'); }
}
const deny = () => { throw new Error('Unexpected outbound fetch'); };

function loader(mocks = {}, globals = {}) {
    const cache = new Map();
    const context = vm.createContext({ console, crypto:require("node:crypto").webcrypto, URL, URLSearchParams, Date:FixtureDate, Intl, Promise, setTimeout, clearTimeout, performance: { getEntriesByType: () => [{ type: 'reload' }] }, process: { env: {} }, fetch: deny, ...globals });
    function load(file) {
        file = path.resolve(file);
        if (mocks[file]) return mocks[file];
        if (cache.has(file)) return cache.get(file).exports;
        const module = { exports: {} }; cache.set(file, module);
        const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
        const req = name => {
            if (Object.hasOwn(mocks, name)) return mocks[name];
            if (name === 'server-only') return {}; // Next boundary marker; fixture env stays empty.
            if(name === 'lucide-react') return new Proxy({}, { get:(_, key)=>key==='__esModule'?true:()=>null });
            if(['next/link','next/image'].includes(name)) return {__esModule:true,default:()=>null};
            if (name.startsWith('.') || name.startsWith('@/')) {
                const candidate = name.startsWith('@/') ? path.join(source, name.slice(2)) : path.resolve(path.dirname(file), name);
                const resolved = [candidate, candidate + '.ts', candidate + '.tsx'].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
                if (!resolved) throw new Error(`Missing source import ${name}`);
                return load(resolved);
            }
            if (['react', 'react/jsx-runtime', 'react-dom/server', 'lucide-react', 'assert'].includes(name)) return require(name);
            throw new Error(`Unmocked import ${name}`);
        };
        vm.runInContext(`(function(require,module,exports){${js}\n})`, context, { filename: file })(req, module, module.exports);
        return module.exports;
    }
    return { load, context };
}
function hooks() {
    const state = []; let index = 0, pending = [], changed = false, renderFn, result;
    const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const api = { ...React,
        useState(init) { const i=index++; if (!state[i]) state[i]={ value: typeof init === 'function' ? init() : init }; return [state[i].value, value => { const v=typeof value==='function'?value(state[i].value):value; if(!Object.is(v,state[i].value)){state[i].value=v;changed=true;} }]; },
        useRef(value) { const i=index++; return state[i] ||= { current:value }; },
        useMemo(fn,deps) { const i=index++; if(!state[i] || !equal(state[i].deps,deps)) state[i]={deps,value:fn()}; return state[i].value; },
        useCallback(fn,deps) { return api.useMemo(()=>fn,deps); },
        useId() { return api.useMemo(()=>`fixture-${index}`,[]); },
        useEffect(fn,deps) { const i=index++; if(!state[i] || !equal(state[i].deps,deps)){const old=state[i];state[i]={deps};pending.push(()=>{old?.cleanup?.();state[i].cleanup=fn();});} },
    };
    const render = () => { index=0; pending=[]; changed=false; result=renderFn(); for(const effect of pending)effect(); return result; };
    return { api, mount(fn){renderFn=fn;render();}, async flush(){ for(let i=0;i<100;i++){await Promise.resolve();if(changed)render();} return result; }, get tree(){return result;}, unmount(){for(const s of state)s?.cleanup?.();} };
}
function nodes(tree) { const out=[]; function walk(n){if(Array.isArray(n))n.forEach(walk);else if(n && typeof n==='object' && n.props){out.push(n);walk(n.props.children);}}walk(tree);return out; }
function text(tree) { if(tree?.type?.name === "BookingReceipt") return renderToStaticMarkup(tree); if(Array.isArray(tree))return tree.map(text).join(''); if(tree?.props)return text(tree.props.children); return typeof tree==='string'||typeof tree==='number'?String(tree):''; }
function button(tree, label) { const el=nodes(tree).find(n=>n.type==='button' && text(n).includes(label));assert.ok(el,`Button ${label} exists`);return el; }
const memory = initial => { const values=new Map(Object.entries(initial));return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}; };
const later = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

async function main(mainOptions = {}) {
    const basic = loader();
    const flow = basic.load(path.join(source,'lib/bookingFlow.ts'));
    assert.equal(flow.allowedService('both',flow.companyMode('dumpster_rental',true)),'dumpster');
    assert.equal(flow.allowedService('both',flow.companyMode('both',true)),'both');
    const selected = new Date(2026,8,20);
    assert.equal(flow.calendarDate(selected),'2026-09-20');
    assert.equal(flow.calendarDate(flow.restoreCalendarDate('2026-09-20')),'2026-09-20');
    const phases=['contact','service_type','load_estimate','schedule','quote'];
    assert.equal(flow.reconcileStep(phases,6,'quote','old'),4);
    assert.equal(flow.reconcileStep(phases,4,'dumpster_details','old'),1);
    assert.equal(flow.reconcileStep(phases,999),4);
    const slot={ date:'2026-09-20',today:'2026-09-08',time:'08:00-10:00',loadedDate:'2026-09-20',loading:false,closed:false,slots:[{id:'08:00-10:00'}],rental:true,availability:'available',availabilityCurrent:true };
    assert.equal(flow.validSlotSelection(slot),true);
    for(const patch of [{time:'22:00-23:00'},{loading:true},{availability:'checking'},{availability:'unavailable'},{availabilityCurrent:false},{loadedDate:'2026-09-19'},{date:'2026-09-01'},{slots:[]}])assert.equal(flow.validSlotSelection({...slot,...patch}),false);
    assert.equal(flow.validSlotSelection({...slot,availability:'error'}),true);
    assert.equal(flow.sameDayTotal(200,'2026-09-20','America/Chicago',{surchargeType:'flat',surchargeAmount:25},new Date('2026-09-20T16:00:00Z')),225);
    assert.equal(flow.addSameDayFee(372,{surchargeType:'percentage',surchargeAmount:10}),409.2);
    assert.equal(flow.acknowledgedRequest({success:true,leadId:'isolated-lead'}),true);
    assert.equal(flow.acknowledgedRequest({success:true}),false);
    assert.equal(flow.acknowledgedRequest({success:true,leadId:'x',rejected:true}),false);

    const configModule=basic.load(path.join(source,widget?'lib/config.tsx':'lib/siteConfig.ts'));
    const tier={sizeCuYd:15,baseRate:372,baseRateMin:null,baseRateMax:null,includedDays:7,weightAllowanceTons:2,overageRatePerTon:50,extendedDailyRate:10};
    assert.equal(configModule.formatDumpsterPrice(tier),'$372');
    const logic=basic.load(path.join(source,'lib/bookingLogic.ts'));
    assert.equal(logic.applyPromoDiscount(372,'percentage',20),297.6);
    assert.ok(logic.deriveDumpsterNote({serviceType:'both',autoBooked:false,dumpsterError:'lost response'}).includes('Please call'));
    assert.ok(!logic.deriveDumpsterNote({serviceType:'both',autoBooked:false,dumpsterError:'lost response'}).includes('will follow up'));

    // Actual card hook: target removal/remount, incomplete state, failure + retry.
    const h=hooks();const cards=[];let setups=0,failSetup=false,active=true;
    const stripe={elements:()=>({create:()=>{const events={};const card={events,mount:target=>{card.target=target;events.ready?.();},on:(name,fn)=>events[name]=fn,destroy:()=>{card.destroyed=(card.destroyed||0)+1;}};cards.push(card);return card;}})};
    const cardLoader=loader({react:h.api,'@stripe/stripe-js':{loadStripe:async()=>stripe}},{console:{...console,error:()=>{}}});
    const {useBookingCard}=cardLoader.load(path.join(source,'lib/booking/useBookingCard.ts'));
    const setup=async()=>{setups++;if(failSetup)throw new Error('fixture');return {clientSecret:'fixture-only'};};
    h.mount(()=>useBookingCard('fixture-key',active,setup));
    h.tree.cardMountRef({id:'first'});await h.flush();
    assert.equal(cards.length,1);assert.equal(h.tree.stripeReady,true);
    cards[0].events.change({complete:true});await h.flush();assert.equal(h.tree.cardComplete,true);
    h.tree.cardMountRef(null);await h.flush();assert.equal(cards[0].destroyed,1);assert.equal(h.tree.cardComplete,false);
    h.tree.cardMountRef({id:'second'});await h.flush();assert.equal(cards.length,2);assert.equal(h.tree.cardComplete,false);assert.equal(setups,1);
    failSetup=true;h.tree.retryCard();await h.flush();assert.match(h.tree.setupError,/retry/i);assert.equal(h.tree.stripeReady,false);
    failSetup=false;h.tree.retryCard();await h.flush();assert.equal(h.tree.setupError,'');assert.equal(h.tree.stripeReady,true);h.unmount();

    const config={...(configModule.siteConfig||{}),companyName:'Fixture Hauling',companyMode:'both',offersDumpsterRental:true,phoneNumber:'2025550198',siteToken:'fixture-only',widgetApiUrl:'http://fixture.invalid',googleMapsKey:'',stripePublishableKey:'',pricingConfigured:true,pricing:{tiers:[{id:'quarter',label:'Quarter',fraction:'1/4',min:200,max:300}],surcharges:[],distanceTiers:[]},dumpsterPricing:{tiers:[tier],surcharges:[]},serviceAreaZips:['77001'],businessHours:null,timezone:'America/Chicago',serviceAreaCenter:null,serviceAreaRadiusMiles:0,serviceArea:'Katy',city:'Houston',sameDay:{surchargeType:'flat',surchargeAmount:25}};
    const defaultSaved={step:5,leadCaptured:true,leadId:'tab-A',tierIndex:1,serviceType:'both',containerSize:'15yd',debrisType:'household',rentalDuration:'1_week',selectedDate:'2026-09-20',selectedTime:'08:00-10:00',contact:{name:'Fixture Person',phone:'2025550198',email:'fixture@gmail.com',address:'1 Fixture Lane'},addressConfirmed:true,location:'curbside',termsAccepted:true};
    function wizardFixture(saved=defaultSaved,options={}) {
        const effectiveConfig={...config,...options.config};
        const h=hooks(), calls=[], events={}, history={state:{host:'preserved'},replaceState(value){this.state=value;},pushState(value){this.state=value;},back(){}};
        const storage=options.storage || memory({[widget?'syjBookingWizard:fixture-only':'syjBookingWizard']:JSON.stringify(saved)});
        let completion; const route={useRouter:()=>({push:p=>calls.push({redirect:p})}),useSearchParams:()=>new URLSearchParams(),notFound:()=>{throw new Error('404');}};
        const respond=async(url,init={})=>{calls.push({url,body:init.body?JSON.parse(init.body):null});
            if(url.includes('available-slots'))return options.slots?options.slots(url):{ok:true,status:200,json:async()=>({slots:[{start:'08:00',end:'10:00',label:'Morning',available:true}],sameDay:{isSameDay:true,surchargeType:'flat',surchargeAmount:25}})};
            if(url.includes('container-availability'))return options.availability?options.availability():{ok:true,status:200,json:async()=>({available:true})};
            if(url.includes('crm')||url.includes('ingest/website'))return options.submit?options.submit(init):{ok:true,status:200,json:async()=>({success:true,leadId:saved.leadId||'fresh-fixture',autoBooked:true})};
            if(url.includes('confirm-card'))return options.confirmCard ? options.confirmCard(init) : {ok:true,status:200,json:async()=>({success:true})};
            if(url.includes('promo'))return {ok:true,status:200,json:async()=>options.promo ?? ({valid:true,appliesTo:'both',discountType:'percentage',discountValue:20})};
            throw new Error(`Unmocked fixture request ${url}`);
        };
        const lm=loader({react:h.api,'next/navigation':route,[path.join(source,widget?'lib/config.tsx':'lib/siteConfig.ts')]:{...configModule,siteConfig:effectiveConfig,hasConfiguredPricing:()=>effectiveConfig.pricingConfigured,useConfig:()=>effectiveConfig},[path.join(source,widget?'components/VolumeEstimator.tsx':'components/booking/VolumeEstimator.tsx')]:{VolumeEstimator:()=>null},'@stripe/stripe-js':{loadStripe:deny},...(options.card ? {[path.join(source,'lib/booking/useBookingCard.ts')]:{useBookingCard:(key,active)=>{options.card.active?.(active);return options.card;}}} : {})}, {window:{history,location:{reload:()=>calls.push({reload:true})},gtag:(command,event,params)=>calls.push({event,params}),addEventListener:(e,fn)=>events[e]=fn,removeEventListener:()=>{}},sessionStorage:storage,localStorage:{getItem:()=>{throw new Error('Origin-wide lead read');},setItem:()=>{throw new Error('Origin-wide lead write');}},fetch:respond,...(options.fastTimers ? {setTimeout:fn=>{Promise.resolve().then(fn);return 0;},clearTimeout:()=>{}} : {})});
        const Wizard=lm.load(path.join(source,'components/BookingWizard.tsx')).default;
        h.mount(()=>Wizard({onComplete:data=>completion=data}));
        return {h,calls,events,history,storage,get completion(){return completion;}};
    }
    if (mainOptions.harness) return {wizardFixture,defaultSaved,button,loader,source,config,hooks,memory,text,nodes,widget};
    const f=wizardFixture();await f.h.flush();
    assert.equal(button(f.h.tree,'Continue').props.disabled,false);
    button(f.h.tree,'Continue').props.onClick();await f.h.flush();
    assert.match(text(f.h.tree),/225/);assert.match(text(f.h.tree),/372/);
    button(f.h.tree,'Confirm & Book').props.onClick();await f.h.flush();
    const posts=f.calls.filter(c=>c.body?.type);
    assert.equal(posts.length,2);assert.equal(posts[0].body.leadId,'tab-A');assert.equal(posts[1].body.leadId,'tab-A');
    assert.equal(posts[0].body.value,200);assert.equal(posts[1].body.value,372);
    assert.equal(posts[0].body.requestedDate,'2026-09-20');
    const completed=widget?f.completion:JSON.parse(f.storage.getItem('syjBookingConfirmation'));
    assert.equal(completed.pricingUnconfirmed,true);assert.equal(completed.price,'');assert.equal(completed.outcomes.junk.outcome,'request_saved');
    f.h.unmount();

    // A restored unoffered time and a delayed/refused rental cannot submit.
    const delayed=later();const bad=wizardFixture({...defaultSaved,step:6,selectedTime:'22:00-23:00'},{availability:()=>delayed.promise});await bad.h.flush();
    button(bad.h.tree,'Confirm & Book').props.onClick();await bad.h.flush();assert.equal(bad.calls.filter(c=>c.body?.type).length,0);
    delayed.resolve({ok:true,status:200,json:async()=>({available:false})});await bad.h.flush();assert.equal(button(bad.h.tree,'Continue').props.disabled,true);bad.h.unmount();

    // Browser Forward entries from the old flow reconcile by phase, not an invalid index.
    const hist=wizardFixture({...defaultSaved,step:1});await hist.h.flush();button(hist.h.tree,'Dumpster Rental').props.onClick();await hist.h.flush();
    hist.events.popstate({state:{wizardStep:6,wizardPhase:'quote',wizardFlow:'contact|service_type|load_estimate|dumpster_size|dumpster_details|schedule|quote'}});await hist.h.flush();
    assert.match(text(hist.h.tree),/Confirm & Book/);assert.equal(hist.history.state.wizardStep,4);assert.equal(hist.history.state.host,'preserved');hist.h.unmount();

    const rentalOnly=wizardFixture({...defaultSaved,step:1},{config:{companyMode:'dumpster_rental'}});await rentalOnly.h.flush();assert.match(text(rentalOnly.h.tree),/What size container/);assert.ok(!text(rentalOnly.h.tree).includes('What services'));rentalOnly.h.unmount();
    const noRentals=wizardFixture({...defaultSaved,step:1},{config:{offersDumpsterRental:false}});await noRentals.h.flush();assert.match(text(noRentals.h.tree),/How much junk/);noRentals.h.unmount();
    const noPrices=wizardFixture({...defaultSaved,step:2},{config:{pricingConfigured:false,pricing:{tiers:[],surcharges:[]}}});await noPrices.h.flush();assert.match(text(noPrices.h.tree),/No online price is available/);noPrices.h.unmount();

    const noQuote=wizardFixture({...defaultSaved,step:6},{config:{pricingConfigured:false,pricing:{tiers:[],surcharges:[]}}});await noQuote.h.flush();assert.match(text(noQuote.h.tree),/Quote confirmed on site/);assert.ok(!text(noQuote.h.tree).includes('$—'));noQuote.h.unmount();

    // Date-only alternatives remain the advertised day, including west of UTC.
    const suggested=wizardFixture(defaultSaved,{availability:()=>({ok:true,status:200,json:async()=>({available:false,nextAvailableDate:'2026-09-21'})})});await suggested.h.flush();
    button(suggested.h.tree,'September 21').props.onClick();await suggested.h.flush();
    assert.equal(JSON.parse(suggested.storage.getItem(widget?'syjBookingWizard:fixture-only':'syjBookingWizard')).selectedDate,'2026-09-21');suggested.h.unmount();

    // A JSON error for a new date must remove the prior date's live choices.
    const stale=wizardFixture({...defaultSaved,selectedTime:'17:00-18:00'}, {slots:url=>({ok:!url.includes('2026-09-21'),status:url.includes('2026-09-21')?500:200,json:async()=>url.includes('2026-09-21')?{error:'fixture'}:{slots:[{start:'17:00',end:'18:00',label:'Old date slot',available:true}]}})});
    await stale.h.flush();assert.match(text(stale.h.tree),/Old date slot/);
    nodes(stale.h.tree).find(n=>n.type?.name==='Calendar').props.onSelect(new Date(2026,8,21));await stale.h.flush();
    assert.ok(!text(stale.h.tree).includes('Old date slot'));assert.match(text(stale.h.tree),/standard request windows/);assert.equal(button(stale.h.tree,'Continue').props.disabled,true);stale.h.unmount();

    const partial=wizardFixture({...defaultSaved,step:6},{submit:init=>{const body=JSON.parse(init.body);if(body.type==='rental_lead')throw new Error('Lost response');return {ok:true,status:200,json:async()=>({success:true,leadId:'partial-fixture'})};}});
    await partial.h.flush();button(partial.h.tree,'Confirm & Book').props.onClick();await partial.h.flush();
    const partialData=widget?partial.completion:JSON.parse(partial.storage.getItem('syjBookingConfirmation'));assert.ok(!partialData);const partialDraft=JSON.parse(partial.storage.getItem(widget?'syjBookingWizard:fixture-only':'syjBookingWizard'));assert.equal(partialDraft.intent.attempts.junk.acknowledgement.outcome,'request_saved');assert.equal(partialDraft.intent.attempts.dumpster.acknowledgement.outcome,'uncertain');partial.h.unmount();

    const refused=wizardFixture({...defaultSaved,step:6},{submit:()=>({ok:true,status:200,json:async()=>({success:false,rejected:true,leadId:'fixture'})})});
    await refused.h.flush();button(refused.h.tree,'Confirm & Book').props.onClick();await refused.h.flush();assert.ok(!refused.completion);assert.equal(refused.calls.filter(c=>c.redirect).length,0);refused.h.unmount();

    const contact=wizardFixture({...defaultSaved,step:0,contact:{...defaultSaved.contact,phone:'1',email:'wrong'}});await contact.h.flush();
    const contactNodes=nodes(contact.h.tree);
    for(const suffix of ['phone','email']){const input=contactNodes.find(n=>n.type==='input'&&n.props.id?.endsWith('-'+suffix));assert.ok(input);assert.equal(input.props['aria-invalid'],true);assert.ok(contactNodes.some(n=>n.props.id===input.props['aria-describedby']));assert.ok(contactNodes.some(n=>n.type==='label'&&n.props.htmlFor===input.props.id));}
    contact.h.unmount();
    const choices=wizardFixture({...defaultSaved,step:4});await choices.h.flush();const options=nodes(choices.h.tree).filter(n=>n.props.className==='booking-choice');assert.ok(options.length>=7);for(const option of options){assert.equal(option.type,'button');assert.equal(option.props.type,'button');assert.equal(typeof option.props['aria-pressed'],'boolean');}choices.h.unmount();

    // Review regression: clearing the last service then using Forward cannot invent a receipt.
    const missingService=wizardFixture({...defaultSaved,serviceType:'junk',step:1});await missingService.h.flush();
    button(missingService.h.tree,'Junk Removal').props.onClick();await missingService.h.flush();
    missingService.events.popstate({state:{wizardStep:4,wizardPhase:'quote',wizardFlow:'contact|service_type|load_estimate|schedule|quote'}});await missingService.h.flush();
    button(missingService.h.tree,'Confirm & Book').props.onClick();await missingService.h.flush();
    assert.equal(missingService.calls.filter(c=>c.body?.type).length,0);
    assert.ok(!(widget?missingService.completion:missingService.storage.getItem('syjBookingConfirmation')));
    assert.match(text(missingService.h.tree),/What services do you need/);missingService.h.unmount();

    const missingDetails=wizardFixture({...defaultSaved,step:6,debrisType:null,rentalDuration:null});await missingDetails.h.flush();
    button(missingDetails.h.tree,'Confirm & Book').props.onClick();await missingDetails.h.flush();
    assert.equal(missingDetails.calls.filter(c=>c.body?.type).length,0);assert.match(text(missingDetails.h.tree),/Household Junk/);missingDetails.h.unmount();

    // Customer recovery messages must survive the API helper and final-submit handler.
    for(const [status,pattern] of [[400,/Check your contact details/],[409,/Check your contact details/],[429,/wait a few minutes/],[500,/before submitting again/]]) {
        const failure=wizardFixture({...defaultSaved,step:6},{submit:()=>({ok:false,status,json:async()=>({error:'Internal fixture diagnostic'})})});await failure.h.flush();
        button(failure.h.tree,'Confirm & Book').props.onClick();await failure.h.flush();assert.match(text(failure.h.tree),pattern);assert.ok(!text(failure.h.tree).includes('Internal fixture diagnostic'));failure.h.unmount();
    }
    const lost=wizardFixture({...defaultSaved,step:6},{submit:()=>{throw new Error('NetworkError when attempting to fetch resource');}});await lost.h.flush();
    button(lost.h.tree,'Confirm & Book').props.onClick();await lost.h.flush();assert.match(text(lost.h.tree),/before submitting again/);lost.h.unmount();

    const onsite=wizardFixture({...defaultSaved,step:6,edgeCases:{unknown:true},location:null});await onsite.h.flush();
    assert.match(text(onsite.h.tree),/On-Site Estimate/);assert.ok(!text(onsite.h.tree).includes('$225'));
    button(onsite.h.tree,'Confirm & Book').props.onClick();await onsite.h.flush();
    assert.equal(onsite.calls.find(c=>c.body?.type==='booking').body.value,undefined);onsite.h.unmount();

    if(widget) {
        let shownState = 0;
        const response=loader({}, {fetch:async()=>({ok:false,status:500,json:async()=>({error:'Internal database error'})})}).load(path.join(source,'lib/api.ts'));
        await assert.rejects(response.widgetApi.submitBooking({},config),e=>!e.message.includes('database')&&e.status===500);
        const invalid=loader({}, {fetch:async()=>({ok:true,status:200,json:async()=>{throw new Error('Unexpected token <')}})}).load(path.join(source,'lib/api.ts'));
        await assert.rejects(invalid.widgetApi.submitBooking({},config),e=>!e.message.includes('Unexpected token'));
        const show=loader({react:{...React,useState:()=>[shownState++ === 0 ? {name:'Fixture',date:'September 20',time:'Morning',price:'$225',serviceType:'both',dumpsterPrice:'15 yard — $372',debrisType:'Household Junk',rentalDuration:'About a week',dumpsterError:'uncertain',promoRequested:'FIXTURE'} : '',()=>{}]},[path.join(source,'components/BookingWizard.tsx')]:{__esModule:true,default:()=>null}},{}).load(path.join(source,'components/Widget.tsx')).default;
        const markup=renderToStaticMarkup(React.createElement(show,{config}));
        for(const value of ['Household Junk','About a week','has not received an acknowledgement','Call to review'])assert.ok(markup.includes(value),value);
        assert.ok(!markup.includes('junk removal is scheduled'));
    } else {
        const contactHooks=hooks(), fieldValues={fname:'',lname:'',phone:''};let sent=0,focused='';
        const Contact=loader({react:contactHooks.api}, {FormData:class{get(key){return fieldValues[key]||'';}},HTMLElement:class{},fetch:async()=>{sent++;return {ok:false,status:400,json:async()=>({error:'name and phone are required'})};}}).load(path.join(source,'components/redesign/ContactForm.tsx')).default;
        contactHooks.mount(()=>Contact({config}));const form={elements:{namedItem:()=>null},reset(){}};
        nodes(contactHooks.tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){},currentTarget:form});await contactHooks.flush();assert.equal(sent,0);assert.match(text(contactHooks.tree),/Enter your name/);
        fieldValues.lname='Fixture';fieldValues.phone='2025550198';nodes(contactHooks.tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){},currentTarget:form});await contactHooks.flush();assert.equal(sent,1);assert.match(text(contactHooks.tree),/Check your name, phone number and email/);contactHooks.unmount();
        const names=basic.load(path.join(source,'lib/locationNames.ts'));
        assert.deepEqual(Array.from(names.configuredLocationNames({city:'Houston',serviceArea:'Katy'})),['Houston','Katy']);
        const nav=basic.load(path.join(source,'lib/serviceNavigation.ts'));
        assert.equal(nav.buildServiceNavItems({services:['Yard Waste'],offersDumpsterRental:false})[0].href,'/services/yard-waste-removal');
        assert.equal(nav.buildServiceNavItems({services:['Junk Removal'],offersDumpsterRental:true,companyMode:'dumpster_rental'}).length,1);
        const reviewData={reviews:[{reviewerName:'Fixture',rating:5,body:'A useful review',platform:'google'}],stats:{totalCount:1,averageRating:5,distribution:{5:1}}};
        const review=loader({[path.join(source,'components/redesign/PageHero.tsx')]:{__esModule:true,default:()=>null},[path.join(source,'components/redesign/CtaBand.tsx')]:{__esModule:true,default:()=>null},'next/navigation':{notFound:()=>{throw new Error('Unexpected 404');}},[path.join(source,'lib/reviewData.ts')]:{fetchReviews:async()=>reviewData,hasEligibleReviews:basic.load(path.join(source,'lib/reviewData.ts')).hasEligibleReviews},[path.join(source,'lib/siteConfig.ts')]:{...configModule,siteConfig:config}});
        const page=await review.load(path.join(source,'app/(site)/reviews/page.tsx')).default();
        assert.match(renderToStaticMarkup(page), /A useful review/); // Render actual fallback components too.
        const blog=loader({[path.join(source,'components/redesign/PageHero.tsx')]:{__esModule:true,default:()=>null},[path.join(source,'components/redesign/DispatchBlocks.tsx')]:{DispatchCardSection:()=>null},'next/navigation':{notFound:()=>{throw new Error('Unexpected 404');}},[path.join(source,'lib/blogData.ts')]:{fetchBlogs:async()=>[]},[path.join(source,'lib/siteConfig.ts')]:{...configModule,siteConfig:{...config,enableBlog:true}}});
        const blogPage=await blog.load(path.join(source,'app/(site)/blog/page.tsx')).default();assert.match(text(blogPage),/No articles are available/);
    }
    console.log(`${widget?'Widget':'Website'} booking regressions passed (isolated source + mocked effects/requests; no provider runtime).`);
}
module.exports = main;
if (require.main === module) main().then(() => require("./booking-recovery.cjs")()).then(() => require("./rental-pricing.cjs")()).then(() => require("./remaining-booking-issues.cjs")()).catch(error=>{console.error(error);process.exitCode=1;});
