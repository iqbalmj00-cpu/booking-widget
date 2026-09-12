const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

async function main() {
    const h = await require('./booking-regressions.cjs')({harness:true});
    const {source,loader,config,wizardFixture,defaultSaved,button,text,widget} = h;
    const basic = loader();
    const pricing = basic.load(path.join(source,'lib/rentalPricing.ts'));
    const flow = basic.load(path.join(source,'lib/bookingIntent.ts'));
    const cfg = basic.load(path.join(source,widget?'lib/config.tsx':'lib/siteConfig.ts'));
    const tier = config.dumpsterPricing.tiers[0];

    assert.equal(cfg.formatDumpsterPrice(tier),'$372');
    assert.equal(cfg.formatDumpsterPrice({...tier,baseRate:372.49}),'$372.49');
    assert.equal(cfg.formatDumpsterPrice({...tier,baseRateMin:372,baseRateMax:372}),'$372');
    assert.equal(cfg.formatDumpsterPrice({...tier,baseRateMin:340,baseRateMax:490}),'$340');
    assert.equal(cfg.formatDumpsterPrice({...tier,baseRate:0}),'Rental price needs confirmation');
    assert.equal(pricing.rentalDaysForSelection('1_week'),7);
    assert.equal(pricing.rentalDaysForSelection('2_weeks'),14);
    for(const value of ['call_when_full','unknown',null]) assert.equal(pricing.rentalDaysForSelection(value),null);
    assert.deepEqual(JSON.parse(JSON.stringify(pricing.rentalExtensionEstimate(pricing.readRentalTerms({...tier,rentalDays:14})))),{extraDays:7,amount:70});
    assert.equal(pricing.rentalExtensionEstimate(pricing.readRentalTerms({...tier,rentalDays:14,extendedDailyRate:null})),null);
    assert.equal(pricing.rentalExtensionEstimate(pricing.readRentalTerms({...tier,rentalDays:null})),null);

    // Actual selected quote: the configured fixed amount and terms survive through the request.
    for(const [amount,tons,overage] of [[372,2,50],[372.49,1.5,36.75]]) {
        const rentalTier = {...tier,baseRate:amount,weightAllowanceTons:tons,overageRatePerTon:overage};
        const f=wizardFixture({...defaultSaved,step:6},{config:{dumpsterPricing:{tiers:[rentalTier],surcharges:[]}}});
        await f.h.flush();
        const quote=text(f.h.tree);
        assert.ok(!quote.includes('Starting at'));
        for(const phrase of [`$${amount}`,`${tons} tons included`,`${pricing.rentalMoney(overage)}/ton`, '7 days included', 'Rental period: 7 days']) assert.ok(quote.includes(phrase),phrase);
        button(f.h.tree,'Confirm & Book').props.onClick();await f.h.flush();
        const rental=f.calls.find(c=>c.body?.serviceType==='dumpster_rental');
        assert.equal(rental.body.value,amount);
        assert.equal(rental.body.metadata.rentalDuration,'1_week');
        f.h.unmount();
    }

    // Configured range maxima never change the accepted base; extended stays are a later estimate.
    const extended=wizardFixture({...defaultSaved,step:6,rentalDuration:'2_weeks',promoCode:'FIXTURE'},{config:{dumpsterPricing:{tiers:[{...tier,baseRateMin:340,baseRateMax:490}],surcharges:[]}}});
    await extended.h.flush();
    const extendedQuote=text(extended.h.tree);
    for(const phrase of ['$340','$292','Rental period: 14 days','Estimated later extra-day charge for 14 days: $70.00','Not included in the base rental price']) assert.ok(extendedQuote.includes(phrase),phrase);
    assert.ok(!extendedQuote.includes('$490'));assert.ok(!extendedQuote.includes('$392'));
    button(extended.h.tree,'Confirm & Book').props.onClick();await extended.h.flush();
    assert.equal(extended.calls.find(c=>c.body?.serviceType==='dumpster_rental').body.value,340);
    extended.h.unmount();
    for(const [duration,rate,expected] of [['call_when_full',10,null],['2_weeks',null,'extra-day charge needs confirmation']]) {
        const f=wizardFixture({...defaultSaved,step:6,rentalDuration:duration},{config:{dumpsterPricing:{tiers:[{...tier,extendedDailyRate:rate}],surcharges:[]}}});await f.h.flush();
        const quote=text(f.h.tree);assert.ok(!quote.includes('Estimated later extra-day charge'));if(expected) assert.ok(quote.includes(expected));f.h.unmount();
    }
    const rentalOnly=wizardFixture({...defaultSaved,serviceType:'dumpster',step:5});await rentalOnly.h.flush();
    assert.ok(!text(rentalOnly.h.tree).includes('pricing is finalized on-site'));
    assert.ok(text(rentalOnly.h.tree).includes('Rental pricing follows the listed base price and included terms'));
    rentalOnly.h.unmount();

    // Accepted receipt terms come from the saved response, never a subsequent company config.
    const response={contractVersion:2,success:true,service:'dumpster',outcome:'scheduled',leadId:'fixture-lead',jobId:'fixture-job',rentalId:'fixture-rental',
        pricing:{status:'accepted',subtotal:372,subtotalMax:null,promo:{status:'not_requested'}},
        rental:{status:'reserved',sizeCuYd:15,rentalDays:7,includedDays:7,weightAllowanceTons:2,overageRatePerTon:50,extendedDailyRate:10}};
    const outcome=flow.readOutcome({status:200,data:response},'dumpster');
    const confirmation=basic.load(path.join(source,'lib/bookingConfirmation.ts'));
    const saved=confirmation.parseBookingConfirmation(JSON.stringify({serviceType:'dumpster',outcomes:{dumpster:outcome}}));
    assert.deepEqual(JSON.parse(JSON.stringify(saved.outcomes.dumpster.rental)),JSON.parse(JSON.stringify(outcome.rental)));
    const Receipt=basic.load(path.join(source,'components/BookingReceipt.tsx')).default;
    const markup=renderToStaticMarkup(React.createElement(Receipt,{services:['dumpster'],outcomes:saved.outcomes}));
    for(const phrase of ['Accepted rental price: $372.00','15-yard container','Rental period: 7 days','7 days included','2 tons included','$50.00/ton']) assert.ok(markup.includes(phrase),phrase);
    assert.ok(!markup.includes('Starting at'));

    // Missing or malformed historical terms cannot imply 7 days, 2 tons, or $50/ton.
    const missing=flow.readOutcome({status:200,data:{...response,rental:{status:'reserved',includedDays:'7',weightAllowanceTons:-1,overageRatePerTon:Infinity}}},'dumpster');
    const missingMarkup=renderToStaticMarkup(React.createElement(Receipt,{services:['dumpster'],outcomes:{dumpster:missing}}));
    for(const phrase of ['Included rental period needs confirmation','Included weight needs confirmation','Weight overage rate needs confirmation']) assert.ok(missingMarkup.includes(phrase),phrase);
    for(const phrase of ['2 tons','7 days included','$50.00/ton','undefined','NaN','Infinity']) assert.ok(!missingMarkup.includes(phrase),phrase);
    const explicitZero=pricing.readRentalTerms({weightAllowanceTons:0,overageRatePerTon:0,extendedDailyRate:0});
    assert.equal(explicitZero.weightAllowanceTons,0);assert.equal(explicitZero.overageRatePerTon,0);
    console.log(`${widget?'Widget':'Website'} RT001 rental pricing regressions passed (isolated fixtures only).`);
}

module.exports=main;
if(require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
