import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Check, ChevronLeft, ArrowRight, CreditCard, Lock, Truck, MapPin, CalendarDays, AlertTriangle, LockKeyhole, Hand, Wrench, Box, FileText, PenTool, Home, Building2 } from "lucide-react";
import ServiceIcon from "./ServiceIcon";
import AddressAutocomplete from "./AddressAutocomplete";
import { haversineDistance } from "../lib/haversine";
import { useConfig, formatDumpsterPrice, roundTo5 } from "../lib/config";
import { widgetApi } from "../lib/api";
import {
    VOLUME_OPTIONS,
    LOCATION_OPTIONS, TIME_SLOTS,
    CONTAINER_SIZES, DEBRIS_TYPES, RENTAL_DURATIONS,
    LOAD_TIERS, EDGE_CASES,
    getPhases, getPhaseLabel, isDayClosed, getAvailableTimeSlots,
    formatSlotTime,
    type ServiceType, type WizardPhase, type DynamicSlot,
} from "../lib/wizardData";
import { loadStripe, type Stripe, type StripeCardElement } from "@stripe/stripe-js";

export type BookingCompleteData = {
    name: string; date: string; time: string; price: string;
    serviceType: string; address?: string; dumpsterPrice?: string;
    debrisType?: string; rentalDuration?: string; autoBooked?: boolean;
};

/* ── Types ───────────────────────────────────────────────────────────────────── */
type ContactInfo = { name: string; phone: string; email: string; address: string; notes: string; customerType: "residential" | "commercial" };

/* ── Stripe (loaded lazily when configured) ── */
// hasStripe determined at runtime via config context (see component body)

/* ── V2: Animated Price Counter ──────────────────────────────────────── */
function AnimatedPrice({ value, fontSize = 28 }: { value: number; fontSize?: number }) {
    const [display, setDisplay] = useState(value);
    const rafRef = useRef<number | null>(null);
    const fromRef = useRef(value);
    useEffect(() => {
        if (fromRef.current === value) return;
        const from = fromRef.current;
        const to = value;
        const duration = 300;
        const start = performance.now();
        const tick = (now: number) => {
            const t = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            setDisplay(Math.round(from + (to - from) * eased));
            if (t < 1) rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        fromRef.current = value;
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [value]);
    return (
        <span style={{
            fontFamily: "var(--heading-font)", fontSize, fontWeight: 800,
            color: "var(--foreground)", lineHeight: 1, letterSpacing: -0.5, fontVariantNumeric: "tabular-nums",
        }}>
            ${display}
        </span>
    );
}

/* ── V2: Cab-Over Box Truck (detailed SVG with junk items per tier) ──── */
function BoxTruck({ tierIndex, mounted }: { tierIndex: number; mounted: boolean }) {
    const tier = LOAD_TIERS[tierIndex];
    const isOverflow = tierIndex === 5;
    const fillPct = Math.min(tier.fill, 1.0);
    const boxX = 60, boxY = 48, boxW = 260, boxH = 120;
    const boxBottom = boxY + boxH;
    const fillH = fillPct * boxH;
    const fillTop = boxBottom - fillH;
    return (
        <svg viewBox="0 0 480 228" width="100%" style={{
            display: "block",
            transform: mounted ? "translateX(0)" : "translateX(60px)",
            opacity: mounted ? 1 : 0,
            transition: "transform 0.7s cubic-bezier(0.16,1,0.3,1), opacity 0.5s ease",
        }}>
            <rect width="480" height="228" fill="none" />
            <rect x="0" y="190" width="480" height="38" fill="#f1f5f9" />
            <line x1="0" y1="190" x2="480" y2="190" stroke="#e2e8f0" strokeWidth="1" />
            <ellipse cx="245" cy="194" rx="195" ry="5" fill="var(--foreground)" opacity="0.05" />
            {/* Cargo box */}
            <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="3" fill="#eaecf0" stroke="#b8bec6" strokeWidth="1.5" />
            <rect x={boxX+2} y={boxY+2} width={boxW-4} height={boxH-4} rx="2" fill="#f0f2f5" />
            {[0.25,0.5,0.75].map(p=>(
                <line key={p} x1={boxX+boxW*p} y1={boxY} x2={boxX+boxW*p} y2={boxBottom} stroke="#d0d4da" strokeWidth="0.7"/>
            ))}
            {/* Junk clipped */}
            <defs><clipPath id="cargo"><rect x={boxX+2} y={boxY+2} width={boxW-4} height={boxH-4} rx="2"/></clipPath></defs>
            <g clipPath="url(#cargo)">
                <rect x={boxX} y={fillTop} width={boxW} height={fillH+2} fill="var(--brand)" opacity="0.04" style={{transition:"all 0.5s cubic-bezier(0.16,1,0.3,1)"}}/>
                {/* T0: ⅛ */}
                <g style={{opacity:tierIndex>=0?1:0,transition:"opacity 0.4s ease 0.05s"}}>
                    <rect x="75" y="132" width="60" height="34" rx="4" fill="#a08058"/>
                    <rect x="75" y="128" width="60" height="10" rx="3" fill="#b89468"/>
                    <rect x="71" y="124" width="10" height="44" rx="4" fill="#b08a60"/>
                    <rect x="129" y="124" width="10" height="44" rx="4" fill="#b08a60"/>
                    <line x1="92" y1="136" x2="92" y2="160" stroke="#8a6e44" strokeWidth="0.7" opacity="0.4"/>
                    <line x1="112" y1="136" x2="112" y2="160" stroke="#8a6e44" strokeWidth="0.7" opacity="0.4"/>
                    <rect x="150" y="100" width="40" height="66" rx="3" fill="#b4c0cc" stroke="#9aacb8" strokeWidth="1"/>
                    <rect x="154" y="104" width="32" height="26" rx="2" fill="#c6d0d8"/>
                    <rect x="154" y="134" width="32" height="26" rx="2" fill="#c6d0d8"/>
                    <circle cx="182" cy="117" r="1.5" fill="#8a9aaa"/>
                    <circle cx="182" cy="147" r="1.5" fill="#8a9aaa"/>
                </g>
                {/* T1: ¼ */}
                <g style={{opacity:tierIndex>=1?1:0,transition:"opacity 0.4s ease 0.1s"}}>
                    <rect x="200" y="132" width="36" height="34" rx="3" fill="#d4a050" stroke="#c49040" strokeWidth="0.7"/>
                    <line x1="218" y1="132" x2="218" y2="150" stroke="#c49040" strokeWidth="0.6" opacity="0.5"/>
                    <rect x="204" y="108" width="30" height="26" rx="3" fill="#ddb060" stroke="#c49040" strokeWidth="0.7"/>
                    <ellipse cx="252" cy="155" rx="15" ry="12" fill="#3a3a3a"/>
                    <ellipse cx="252" cy="151" rx="10" ry="5.5" fill="#484848"/>
                    <path d="M245 143 Q252 137 259 143" stroke="#555" strokeWidth="0.8" fill="none"/>
                    <ellipse cx="272" cy="157" rx="12" ry="10" fill="#333"/>
                    <rect x="244" y="122" width="22" height="20" rx="2" fill="#c89545" stroke="#b88535" strokeWidth="0.6"/>
                </g>
                {/* T2: ½ */}
                <g style={{opacity:tierIndex>=2?1:0,transition:"opacity 0.4s ease 0.15s"}}>
                    <rect x="72" y="84" width="52" height="40" rx="3" fill="#8b6b4a" stroke="#7a5c3e" strokeWidth="0.7"/>
                    <rect x="76" y="88" width="20" height="14" rx="1.5" fill="#7a5c3e"/>
                    <rect x="98" y="88" width="20" height="14" rx="1.5" fill="#7a5c3e"/>
                    <rect x="76" y="106" width="20" height="14" rx="1.5" fill="#7a5c3e"/>
                    <rect x="98" y="106" width="20" height="14" rx="1.5" fill="#7a5c3e"/>
                    <rect x="132" y="90" width="26" height="14" rx="3" fill="#a88460"/>
                    <rect x="136" y="104" width="4" height="22" rx="1" fill="#8a6d48"/>
                    <rect x="152" y="104" width="4" height="22" rx="1" fill="#8a6d48"/>
                    <rect x="242" y="94" width="28" height="32" rx="3" fill="#d4a050" stroke="#c49040" strokeWidth="0.7"/>
                    <rect x="204" y="84" width="34" height="26" rx="3" fill="#c89545" stroke="#b88535" strokeWidth="0.7"/>
                    <ellipse cx="286" cy="158" rx="13" ry="9" fill="#383838"/>
                    <rect x="276" y="118" width="22" height="28" rx="2" fill="#ddb060"/>
                </g>
                {/* T3: ¾ */}
                <g style={{opacity:tierIndex>=3?1:0,transition:"opacity 0.4s ease 0.2s"}}>
                    <rect x="128" y="58" width="11" height="64" rx="3" fill="#b8c4d0" stroke="#a0aab6" strokeWidth="0.7"/>
                    <rect x="146" y="64" width="42" height="7" rx="2" fill="#a88460"/>
                    <rect x="150" y="71" width="4" height="26" rx="1" fill="#8a6d48"/>
                    <rect x="180" y="71" width="4" height="26" rx="1" fill="#8a6d48"/>
                    <rect x="196" y="60" width="38" height="24" rx="3" fill="#2d3748"/>
                    <rect x="199" y="63" width="32" height="18" rx="2" fill="#4a5568"/>
                    <rect x="210" y="84" width="14" height="3" rx="1" fill="#4a5568"/>
                    <rect x="244" y="66" width="26" height="30" rx="3" fill="#ddb060" stroke="#c49040" strokeWidth="0.7"/>
                    <rect x="72" y="64" width="26" height="22" rx="3" fill="#c89545"/>
                    <rect x="100" y="60" width="22" height="26" rx="3" fill="#d4a050"/>
                    <rect x="276" y="86" width="22" height="28" rx="2" fill="#b4c0cc"/>
                    <ellipse cx="288" cy="132" rx="10" ry="9" fill="#383838"/>
                </g>
                {/* T4: Full */}
                <g style={{opacity:tierIndex>=4?1:0,transition:"opacity 0.4s ease 0.25s"}}>
                    <rect x="68" y="50" width="38" height="16" rx="2" fill="#c89545"/>
                    <rect x="110" y="50" width="30" height="12" rx="2" fill="#d4a050"/>
                    <rect x="144" y="50" width="36" height="14" rx="2" fill="#b8c4d0"/>
                    <rect x="184" y="50" width="32" height="12" rx="2" fill="#ddb060"/>
                    <rect x="220" y="50" width="38" height="16" rx="2" fill="#a88460"/>
                    <rect x="262" y="50" width="34" height="14" rx="2" fill="#c89545"/>
                    <rect x="80" y="50" width="8" height="10" rx="1" fill="#8b6b4a"/>
                    <rect x="164" y="51" width="6" height="8" rx="1" fill="#3a3a3a"/>
                    <rect x="254" y="50" width="6" height="12" rx="1" fill="#333"/>
                </g>
                {/* T5: overflow */}
                {isOverflow&&(<g style={{opacity:1,transition:"opacity 0.4s ease 0.3s"}}><rect x={boxX} y={boxY} width={boxW} height={boxH} fill="var(--brand)" opacity="0.06"/></g>)}
            </g>
            {/* Fill marker LEFT */}
            {!isOverflow&&(<>
                <line x1={boxX-4} y1={fillTop} x2={boxX+boxW+4} y2={fillTop} stroke="var(--brand)" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.5" style={{transition:"all 0.5s cubic-bezier(0.16,1,0.3,1)"}}/>
                <g style={{transition:"all 0.5s cubic-bezier(0.16,1,0.3,1)"}} transform={`translate(${boxX-56},${fillTop})`}>
                    <rect x="0" y="-12" width="50" height="22" rx="6" fill="var(--brand)"/>
                    <text x="25" y="3" textAnchor="middle" fontSize="10" fontWeight="700" fill="white" fontFamily="var(--heading-font)">{tier.label}</text>
                </g>
            </>)}
            {isOverflow&&(<g>
                <line x1={boxX-4} y1={boxY} x2={boxX+boxW+4} y2={boxY} stroke="var(--brand)" strokeWidth="2" opacity="0.7"/>
                <g transform={`translate(${boxX-58},${boxY})`}>
                    <rect x="0" y="-12" width="54" height="22" rx="6" fill="var(--brand)"/>
                    <text x="27" y="3" textAnchor="middle" fontSize="9" fontWeight="700" fill="white" fontFamily="var(--heading-font)">1+ LOADS</text>
                </g>
                <g opacity="0.5">
                    <path d={`M${boxX+boxW/2-20} ${boxY-10} L${boxX+boxW/2-20} ${boxY-22} L${boxX+boxW/2-14} ${boxY-16}`} fill="none" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d={`M${boxX+boxW/2+20} ${boxY-10} L${boxX+boxW/2+20} ${boxY-22} L${boxX+boxW/2+26} ${boxY-16}`} fill="none" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </g>
            </g>)}
            {/* Frame */}
            <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="3" fill="none" stroke="#8892a0" strokeWidth="2"/>
            <rect x={boxX-2} y={boxY-4} width={boxW+4} height="6" rx="2" fill="#6b7280"/>
            <rect x={boxX-4} y={boxBottom} width={boxW+52} height="10" rx="3" fill="#4b5563"/>
            {/* Cab */}
            <rect x="326" y="62" width="80" height="108" rx="6" fill="#1e293b"/>
            <rect x="400" y="62" width="32" height="108" rx="4" fill="#111827"/>
            <rect x="322" y="56" width="96" height="12" rx="5" fill="#334155"/>
            <rect x="322" y="54" width="96" height="6" rx="3" fill="#475569"/>
            <rect x="404" y="68" width="24" height="46" rx="4" fill="#60a5fa" opacity="0.5"/>
            <rect x="406" y="70" width="10" height="42" rx="3" fill="#93c5fd" opacity="0.25"/>
            <rect x="334" y="70" width="42" height="34" rx="4" fill="#60a5fa" opacity="0.4"/>
            <rect x="380" y="70" width="22" height="34" rx="4" fill="#60a5fa" opacity="0.35"/>
            <rect x="376" y="68" width="5" height="38" rx="1" fill="#1e293b"/>
            <rect x="336" y="110" width="38" height="56" rx="3" fill="none" stroke="#334155" strokeWidth="1.5"/>
            <rect x="356" y="132" width="14" height="4" rx="2" fill="#4b5563"/>
            <rect x="424" y="78" width="6" height="16" rx="3" fill="#fbbf24" opacity="0.9"/>
            <rect x="424" y="110" width="6" height="6" rx="2" fill="var(--brand)" opacity="0.7"/>
            <rect x="418" y="168" width="18" height="10" rx="3" fill="#6b7280"/>
            <rect x="326" y="170" width="50" height="6" rx="2" fill="#4b5563"/>
            <rect x="318" y="80" width="12" height="18" rx="3" fill="#374151"/>
            <rect x="314" y="82" width="8" height="14" rx="3" fill="#475569"/>
            <rect x="326" y="154" width="80" height="4" rx="1" fill="var(--brand)" opacity="0.6"/>
            <rect x={boxX} y={boxBottom-5} width={boxW} height="3" rx="1" fill="var(--brand)" opacity="0.25"/>
            {/* Wheels */}
            {[112,172].map(cx=>(<g key={cx}><circle cx={cx} cy="190" r="22" fill="#111827"/><circle cx={cx} cy="190" r="18" fill="#1e293b"/><circle cx={cx} cy="190" r="13" fill="#374151"/><circle cx={cx} cy="190" r="5.5" fill="#4b5563"/><circle cx={cx} cy="190" r="2" fill="#6b7280"/></g>))}
            <path d="M84 182 Q112 158 140 182" fill="#1e293b"/><path d="M144 182 Q172 158 200 182" fill="#1e293b"/>
            <circle cx="378" cy="190" r="22" fill="#111827"/><circle cx="378" cy="190" r="18" fill="#1e293b"/><circle cx="378" cy="190" r="13" fill="#374151"/><circle cx="378" cy="190" r="5.5" fill="#4b5563"/><circle cx="378" cy="190" r="2" fill="#6b7280"/>
            <path d="M350 182 Q378 158 406 182" fill="#1e293b"/>
        </svg>
    );
}

/* ── V2: 6-Node Step Slider ───────────────────────────────────────────── */
function StepSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const trackRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const steps = 6;
    const prevStep = useRef(value);
    const haptic = () => { try { if (navigator.vibrate) navigator.vibrate(10); } catch {} };
    const setWithHaptic = useCallback((v: number) => {
        const c = Math.max(0, Math.min(steps-1, v));
        if (c !== prevStep.current) { haptic(); prevStep.current = c; }
        onChange(c);
    }, [onChange]);
    const getStep = useCallback((clientX: number) => {
        if (!trackRef.current) return value;
        const rect = trackRef.current.getBoundingClientRect();
        return Math.round(Math.max(0, Math.min(1, (clientX-rect.left)/rect.width)) * (steps-1));
    }, [value]);
    const onStart = (x: number) => { setDragging(true); setWithHaptic(getStep(x)); };
    useEffect(() => {
        if (!dragging) return;
        const move = (e: MouseEvent | TouchEvent) => setWithHaptic(getStep((e as TouchEvent).touches ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX));
        const end = () => setDragging(false);
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", end);
        window.addEventListener("touchmove", move, { passive: true });
        window.addEventListener("touchend", end);
        return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", end); window.removeEventListener("touchmove", move); window.removeEventListener("touchend", end); };
    }, [dragging, getStep, setWithHaptic]);
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key==="ArrowRight"||e.key==="ArrowUp") { e.preventDefault(); setWithHaptic(value+1); }
        if (e.key==="ArrowLeft"||e.key==="ArrowDown") { e.preventDefault(); setWithHaptic(value-1); }
    };
    const pct = (value/(steps-1))*100;
    return (
        <div style={{ padding: "0 20px" }}>
            <div ref={trackRef} role="slider" aria-valuemin={0} aria-valuemax={5} aria-valuenow={value}
                aria-label="Load size" tabIndex={0} onKeyDown={onKeyDown}
                style={{ position:"relative", height:50, cursor:"pointer", touchAction:"none", userSelect:"none", outline:"none" }}
                onMouseDown={e=>onStart(e.clientX)} onTouchStart={e=>onStart(e.touches[0].clientX)}>
                <div style={{ position:"absolute", top:21, left:0, right:0, height:8, borderRadius:4, background:"var(--border, #e2e8f0)" }}/>
                <div style={{
                    position:"absolute", top:21, left:0, height:8, borderRadius:4,
                    width:`${pct}%`, background:`linear-gradient(90deg, var(--brand), var(--brand-dark))`,
                    boxShadow:"0 2px 8px rgba(var(--brand-rgb, 249,115,22),0.2)",
                    transition: dragging ? "none" : "width 0.35s cubic-bezier(0.16,1,0.3,1)",
                }}/>
                {Array.from({length:steps}).map((_,i)=>{
                    const left=(i/(steps-1))*100;
                    const cur=i===value, past=i<value;
                    return (
                        <div key={i} style={{
                            position:"absolute", top:cur?13:18, left:`${left}%`, transform:"translateX(-50%)",
                            width:cur?24:past?12:10, height:cur?24:past?12:10,
                            borderRadius:"50%", background:cur?"var(--card, #fff)":past?"var(--brand)":"var(--border, #cbd5e1)",
                            border:cur?"4px solid var(--brand)":"none",
                            boxShadow:cur?"0 0 0 4px rgba(var(--brand-rgb, 249,115,22),0.13), 0 2px 10px rgba(var(--brand-rgb, 249,115,22),0.25)":"none",
                            transition: dragging ? "none" : "all 0.3s cubic-bezier(0.16,1,0.3,1)",
                            zIndex:cur?3:1,
                        }}/>
                    );
                })}
            </div>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
                {LOAD_TIERS.map((t,i)=>(
                    <span key={i} style={{
                        fontSize:9.5, fontWeight:i===value?700:500,
                        color:i===value?"var(--brand)":"var(--muted, #b0b8c4)",
                        fontFamily:"var(--heading-font)",
                        textAlign:"center", flex:1, transition:"all 0.2s",
                    }}>{t.label}</span>
                ))}
            </div>
        </div>
    );
}

/* ── V2: Compare All Grid ────────────────────────────────────────────── */
function CompareGrid({ currentStep, onChange, pricing }: { currentStep: number; onChange: (i: number) => void; pricing: { tiers: { id: string; min: number; max: number }[] } }) {
    return (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8, padding:"0 12px" }}>
            {LOAD_TIERS.map((t,i)=>{
                const active = i===currentStep;
                const priceTier = pricing.tiers.find(pt => pt.id === t.volumeId);
                return (
                    <button key={i} onClick={()=>onChange(i)} style={{
                        padding:"12px 10px", borderRadius: "var(--card-radius, 12px)", cursor:"pointer", textAlign:"center",
                        border: active ? "2px solid var(--brand)" : "1.5px solid var(--border, #e2e8f0)",
                        background: active ? "rgba(var(--brand-rgb, 249,115,22),0.06)" : "var(--card, #fff)",
                        transition:"all 0.2s", position:"relative", fontFamily: "inherit",
                    }}>
                        {t.popular&&(
                            <div style={{
                                position:"absolute", top:-7, left:"50%", transform:"translateX(-50%)",
                                fontSize:8, fontWeight:700, color:"#fff", background:"var(--brand)",
                                padding:"1px 6px", borderRadius:999, letterSpacing:0.3,
                                textTransform:"uppercase", whiteSpace:"nowrap",
                            }}>Most common</div>
                        )}
                        <div style={{ fontSize:11, fontWeight:700, color:active?"var(--brand)":"var(--foreground)", fontFamily:"var(--heading-font)" }}>
                            {t.label}
                        </div>
                        <div style={{ fontSize:9.5, color:"var(--muted)", marginTop:3, lineHeight:1.3, minHeight:28 }}>{t.title}</div>
                        <div style={{ fontFamily:"var(--heading-font)", fontSize:16, fontWeight:800, color:"var(--foreground)", marginTop:6 }}>
                            {priceTier ? `$${roundTo5(priceTier.min)}` : "—"}
                        </div>
                        <div style={{ fontSize:9, color:"var(--muted)", marginTop:2 }}>{t.bags}</div>
                        <div style={{
                            width:14, height:14, borderRadius:"50%", margin:"8px auto 0",
                            border: active ? "4px solid var(--brand)" : "2px solid var(--border, #cbd5e1)",
                            background:"var(--card, #fff)", boxSizing:"border-box",
                            transition:"all 0.15s",
                        }}/>
                    </button>
                );
            })}
        </div>
    );
}

/* ── V2: Edge Case Toggle ────────────────────────────────────────────── */
function EdgeToggle({ item, checked, onChange }: { item: typeof EDGE_CASES[number]; checked: boolean; onChange: () => void }) {
    return (
        <label style={{ display:"flex", alignItems:"flex-start", gap:12, cursor:"pointer", padding:"10px 0" }} onClick={onChange}>
            <div style={{
                flexShrink:0, width:20, height:20, borderRadius:6, marginTop:1,
                border: checked ? "2px solid var(--brand)" : "2px solid var(--border, #cbd5e1)",
                background: checked ? "var(--brand)" : "var(--card, #fff)",
                display:"flex", alignItems:"center", justifyContent:"center",
                transition:"all 0.15s ease",
            }}>
                {checked&&(<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5L5 9L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>)}
            </div>
            <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:500, color:"var(--foreground)", lineHeight:1.35 }}>{item.label}</div>
                {item.detail&&<div style={{ fontSize:12, color:"var(--muted)", marginTop:1 }}>{item.detail}</div>}
            </div>
        </label>
    );
}

/* ── Calendar ──────────────────────────────────────────────────────────── */
function Calendar({ selected, onSelect, isDisabled }: { selected: Date | null; onSelect: (d: Date) => void; isDisabled?: (d: Date) => boolean }) {
    const today = new Date();
    const [viewMonth, setViewMonth] = useState(today.getMonth());
    const [viewYear, setViewYear] = useState(today.getFullYear());

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();

    const prevMonth = () => {
        if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
        else setViewMonth(m => m - 1);
    };
    const nextMonth = () => {
        if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
        else setViewMonth(m => m + 1);
    };

    const isSame = (d: Date | null, day: number) =>
        d && d.getDate() === day && d.getMonth() === viewMonth && d.getFullYear() === viewYear;
    const isPast = (day: number) => {
        const d = new Date(viewYear, viewMonth, day);
        return d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    };
    const isClosed = (day: number) => {
        if (!isDisabled) return false;
        return isDisabled(new Date(viewYear, viewMonth, day));
    };
    const isUnavailable = (day: number) => isPast(day) || isClosed(day);

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <button onClick={prevMonth} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "var(--foreground)" }}>←</button>
                <span style={{ fontWeight: 700, fontSize: 16, color: "var(--foreground)" }}>
                    {new Date(viewYear, viewMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </span>
                <button onClick={nextMonth} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "var(--foreground)" }}>→</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, textAlign: "center" }}>
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => (
                    <div key={d} style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", padding: "4px 0" }}>{d}</div>
                ))}
                {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
                    <button key={day} onClick={() => !isUnavailable(day) && onSelect(new Date(viewYear, viewMonth, day))}
                        style={{
                            width: 38, height: 38, borderRadius: "50%", border: "none", fontSize: 14, fontWeight: 600, cursor: isUnavailable(day) ? "default" : "pointer",
                            background: isSame(selected, day) ? "var(--brand)" : isClosed(day) ? "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(203,213,225,0.3) 3px, rgba(203,213,225,0.3) 6px)" : "transparent",
                            color: isSame(selected, day) ? "#fff" : isUnavailable(day) ? "#CBD5E1" : "var(--foreground)",
                            transition: "all 0.15s", margin: "0 auto", fontFamily: "inherit",
                        }}>
                        {day}
                    </button>
                ))}
            </div>
        </div>
    );
}

/* ── Session persistence helpers ────────────────────────────────────────── */
const WIZARD_STORAGE_KEY = "syjBookingWizard";

function loadSavedWizard() {
    if (typeof window === "undefined") return null;
    try {
        // Only restore on actual page refresh (F5), not fresh navigation to /book
        const navEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
        const isReload = navEntries.length > 0 && navEntries[0].type === "reload";
        if (!isReload) {
            sessionStorage.removeItem(WIZARD_STORAGE_KEY);
            return null;
        }
        const raw = sessionStorage.getItem(WIZARD_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

/* ── Main Wizard ───────────────────────────────────────────────────────── */
export default function BookingWizard({ onComplete, initialPromo }: { onComplete?: (data: BookingCompleteData) => void; initialPromo?: string }) {
    const config = useConfig();
    const hasStripe = !!config.stripePublishableKey;
    const apiOpts = { siteToken: config.siteToken, widgetApiUrl: config.widgetApiUrl };
    const saved = useRef(loadSavedWizard()).current;

    const [step, setStep] = useState(saved?.step ?? 0);
    const [tierIndex, setTierIndex] = useState<number>(saved?.tierIndex ?? 1);
    const [edgeCases, setEdgeCases] = useState<Record<string, boolean>>(saved?.edgeCases ?? {});
    const [viewMode, setViewMode] = useState<"slider" | "compare">("slider");
    const [mounted, setMounted] = useState(false);
    const [volume, setVolume] = useState<string | null>(saved?.volume ?? LOAD_TIERS[1].volumeId);
    const [location, setLocation] = useState<string | null>(saved?.location ?? null);
    const [selectedDate, setSelectedDate] = useState<Date | null>(saved?.selectedDate ? new Date(saved.selectedDate) : null);
    const [selectedTime, setSelectedTime] = useState<string | null>(() => {
        const t = saved?.selectedTime ?? null;
        if (t && !t.includes("-")) return null;
        return t;
    });
    const [dynamicSlots, setDynamicSlots] = useState<DynamicSlot[] | null>(null);
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [contact, setContact] = useState<ContactInfo>(saved?.contact ?? { name: "", phone: "", email: "", address: "", notes: "", customerType: "residential" });
    const [addressInArea, setAddressInArea] = useState(true);
    const [addressConfirmed, setAddressConfirmed] = useState(saved?.addressConfirmed ?? false);
    const [outOfAreaMsg, setOutOfAreaMsg] = useState<string | null>(null);
    const [distanceSurcharge, setDistanceSurcharge] = useState(saved?.distanceSurcharge ?? 0);
    const [distanceMiles, setDistanceMiles] = useState<number | null>(saved?.distanceMiles ?? null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [leadCaptured, setLeadCaptured] = useState(saved?.leadCaptured ?? false);
    const [storedCustomerId, setStoredCustomerId] = useState<string | null>(null);

    /* ── Terms & signature state ── */
    const [termsAccepted, setTermsAccepted] = useState(saved?.termsAccepted ?? false);
    const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(saved?.signatureDataUrl ?? null);
    const sigCanvasRef = useRef<HTMLCanvasElement>(null);
    const sigDrawingRef = useRef(false);

    /* ── Dumpster rental state ── */
    const [serviceType, setServiceType] = useState<ServiceType | null>(saved?.serviceType ?? (config.offersDumpsterRental ? null : "junk"));
    const [containerSize, setContainerSize] = useState<string | null>(saved?.containerSize ?? null);
    const [debrisType, setDebrisType] = useState<string | null>(saved?.debrisType ?? null);
    const [rentalDuration, setRentalDuration] = useState<string | null>(saved?.rentalDuration ?? null);

    /* ── Container availability state ── */
    const [containerAvailability, setContainerAvailability] = useState<{
        available: boolean; baseRate?: number; includedDays?: number;
        extendedDailyRate?: number; weightAllowanceTons?: number;
        overageRatePerTon?: number; alternativeSizes?: number[];
        nextAvailableDate?: string;
    } | null>(null);
    const [checkingAvailability, setCheckingAvailability] = useState(false);

    /* ── Promo code state ── */
    const [promoCode, setPromoCode] = useState<string | null>(initialPromo || saved?.promoCode || null);
    const [promoResult, setPromoResult] = useState<{
        valid: boolean; discountType?: string; discountValue?: number; label?: string; reason?: string;
    } | null>(null);
    const [promoValidating, setPromoValidating] = useState(false);
    const [promoInputOpen, setPromoInputOpen] = useState(saved?.promoInputOpen ?? false);
    const [promoInputValue, setPromoInputValue] = useState(saved?.promoInputValue ?? "");

    /* ── Payment preference state ── */
    const [paymentPreference, setPaymentPreference] = useState<"card" | "on_site" | null>(saved?.paymentPreference ?? null);

    /* ── Phase system ── */
    const phases = useMemo(() => getPhases(serviceType, config.offersDumpsterRental), [serviceType]);
    const currentPhase = phases[step] || "contact";

    /* ── Stripe card-on-file state ── */
    const [stripeReady, setStripeReady] = useState(false);
    const [cardComplete, setCardComplete] = useState(false);
    const [cardError, setCardError] = useState("");
    const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
    const [connectedAccountId, setConnectedAccountId] = useState<string | null>(null);
    const stripeRef = useRef<Stripe | null>(null);
    const cardRef = useRef<StripeCardElement | null>(null);
    const cardMountRef = useRef<HTMLDivElement | null>(null);

    /* ── Save wizard state to sessionStorage on every change ── */
    useEffect(() => {
        const data = {
            step, tierIndex, edgeCases, volume, location,
            selectedDate: selectedDate?.toISOString() ?? null,
            selectedTime, contact, distanceSurcharge, distanceMiles, leadCaptured,
            termsAccepted, signatureDataUrl, serviceType, containerSize, debrisType,
            rentalDuration, promoCode, promoInputOpen, promoInputValue, paymentPreference,
            addressConfirmed,
        };
        try { sessionStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(data)); } catch {}
    }, [step, tierIndex, edgeCases, volume, location,
        selectedDate, selectedTime, contact, distanceSurcharge, distanceMiles, leadCaptured,
        termsAccepted, signatureDataUrl, serviceType, containerSize, debrisType,
        rentalDuration, promoCode, promoInputOpen, promoInputValue, paymentPreference,
        addressConfirmed]);

    // Check container availability — only fires when date is selected for accurate date-aware check
    useEffect(() => {
        if (!containerSize || !selectedDate) { setContainerAvailability(null); return; }
        let cancelled = false;
        setCheckingAvailability(true);
        (async () => {
            try {
                const params: { size: string; date?: string; days?: string } = { size: String(parseInt(containerSize)) };
                if (selectedDate) params.date = selectedDate.toISOString().split("T")[0];
                if (rentalDuration) {
                    const daysMap: Record<string, string> = { "1_week": "7", "2_weeks": "14", "call_when_full": "14" };
                    params.days = daysMap[rentalDuration] || "14";
                }
                const data = await widgetApi.checkAvailability(params, apiOpts);
                if (!cancelled) setContainerAvailability(data);
            } catch {
                if (!cancelled) setContainerAvailability(null);
            } finally {
                if (!cancelled) setCheckingAvailability(false);
            }
        })();
        return () => { cancelled = true; };
    }, [containerSize, selectedDate, rentalDuration]);

    // Fetch dynamic time slots when date changes
    useEffect(() => {
        if (!selectedDate) { setDynamicSlots(null); return; }
        let cancelled = false;
        setLoadingSlots(true);
        const dateStr = selectedDate.toISOString().split("T")[0];
        widgetApi.getAvailableSlots(dateStr, apiOpts)
            .then(data => {
                if (!cancelled && data.slots) {
                    setDynamicSlots(data.slots);
                }
            })
            .catch(() => {
                if (!cancelled) setDynamicSlots(null);
            })
            .finally(() => { if (!cancelled) setLoadingSlots(false); });
        return () => { cancelled = true; };
    }, [selectedDate]);

    // Validate promo code when set (from URL or manual input)
    useEffect(() => {
        if (!promoCode) { setPromoResult(null); return; }
        let cancelled = false;
        setPromoValidating(true);
        widgetApi.validatePromo(promoCode, apiOpts)
            .then(data => { if (!cancelled) setPromoResult(data); })
            .catch(() => { if (!cancelled) setPromoResult({ valid: false, reason: "Validation failed" }); })
            .finally(() => { if (!cancelled) setPromoValidating(false); });
        return () => { cancelled = true; };
    }, [promoCode]);

    // Apply discount to a price
    const applyDiscount = (price: number): number => {
        if (!promoResult?.valid || !promoResult.discountValue) return price;
        if (promoResult.discountType === "percentage") return roundTo5(price * (1 - promoResult.discountValue / 100));
        if (promoResult.discountType === "flat") return roundTo5(Math.max(0, price - promoResult.discountValue));
        return price;
    };

    // 1. Create SetupIntent when entering quote phase (independent of payment preference)
    useEffect(() => {
        if (!hasStripe || currentPhase !== "quote" || setupClientSecret) return;
        let cancelled = false;
        (async () => {
            try {
                const data = await widgetApi.createSetupIntent(apiOpts);
                if (cancelled || !data.clientSecret) return;
                setSetupClientSecret(data.clientSecret);
                if (data.connectedAccountId) setConnectedAccountId(data.connectedAccountId);
            } catch (err) {
                console.error("SetupIntent creation error:", err);
            }
        })();
        return () => { cancelled = true; };
    }, [currentPhase, hasStripe, setupClientSecret]);

    // 2. Mount card element ONLY when Pay Online selected + SetupIntent ready + mount ref available
    useEffect(() => {
        if (!hasStripe || paymentPreference !== "card" || !setupClientSecret || cardRef.current) return;
        let cancelled = false;
        (async () => {
            try {
                // Load Stripe with connected account from API response (not from env var)
                const stripe = await loadStripe(
                    config.stripePublishableKey,
                    connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
                );
                if (cancelled || !stripe || !cardMountRef.current) return;
                stripeRef.current = stripe;
                const elements = stripe.elements({ clientSecret: setupClientSecret });
                const card = elements.create("card", {
                    style: {
                        base: { fontSize: "16px", color: "#1E293B", fontFamily: "inherit", "::placeholder": { color: "#94A3B8" } },
                        invalid: { color: "#DC2626" },
                    },
                });
                card.mount(cardMountRef.current);
                card.on("change", (e) => {
                    setCardComplete(e.complete);
                    setCardError(e.error?.message || "");
                });
                cardRef.current = card;
                setStripeReady(true);
            } catch (err) {
                console.error("Stripe card mount error:", err);
            }
        })();
        return () => { cancelled = true; };
    }, [paymentPreference, setupClientSecret, hasStripe, connectedAccountId]);

    // 3. Cleanup card element when switching away from "card"
    useEffect(() => {
        if (paymentPreference !== "card" && cardRef.current) {
            cardRef.current.destroy();
            cardRef.current = null;
            setStripeReady(false);
            setCardComplete(false);
            setCardError("");
        }
    }, [paymentPreference]);

    /* ── Browser back-button integration ── */
    useEffect(() => {
        // Replace current entry so we have step=0 as base
        window.history.replaceState({ wizardStep: 0 }, "");

        const onPopState = (e: PopStateEvent) => {
            const prevStep = e.state?.wizardStep;
            if (typeof prevStep === "number" && prevStep >= 0) {
                setStep(prevStep);
            } else {
                // No wizard state = user is leaving the page, let it happen
            }
        };
        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
    }, []);

    const goNext = () => {
        const next = step + 1;
        setStep(next);
        window.history.pushState({ wizardStep: next }, "");
    };
    const goBack = () => {
        if (step > 0) window.history.back(); // triggers popstate → setStep
        // If step === 0, browser back navigates away from /book naturally
    };

    const toggleEdge = (id: string) =>
        setEdgeCases(prev => ({ ...prev, [id]: !prev[id] }));

    const hasEdgeCase = Object.values(edgeCases).some(Boolean);

    /* ── Sync tierIndex → volume ── */
    useEffect(() => { setVolume(LOAD_TIERS[tierIndex].volumeId); }, [tierIndex]);
    useEffect(() => { const t = setTimeout(() => setMounted(true), 50); return () => clearTimeout(t); }, []);

    /* ── Pricing from config ─────────────────────────────────────── */
    const pricing = config.pricing;
    const tierData = pricing.tiers.find(t => t.id === volume);
    const stairsSurcharge = pricing.surcharges.find(s => s.id === "stairs");
    const priceAdj = (location === "upstairs" || location === "basement") && stairsSurcharge?.enabled
        ? stairsSurcharge.amount : 0;
    const totalAdj = priceAdj + distanceSurcharge;

    const canProceed = () => {
        switch (currentPhase) {
            case "contact": {
                const hasRequired = !!(contact.name && contact.phone && contact.email && contact.address);
                const areaOk = addressConfirmed && addressInArea && !outOfAreaMsg;
                return hasRequired && areaOk;
            }
            case "service_type": return serviceType !== null;
            case "load_estimate": return volume !== null;
            case "junk_location": return location !== null;
            case "dumpster_size": return containerSize !== null;
            case "dumpster_details": return debrisType !== null && rentalDuration !== null;
            case "schedule": {
                if (!selectedDate || !selectedTime) return false;
                if ((serviceType === "dumpster" || serviceType === "both") && containerAvailability?.available === false) return false;
                return true;
            }
            case "terms": return termsAccepted && !!signatureDataUrl;
            case "quote": return true;
            default: return false;
        }
    };

    /* ── Capture lead on Step 0 completion ─────────────────────────── */
    const captureLead = useCallback(async () => {
        if (leadCaptured) { goNext(); return; }
        setSubmitting(true);
        setError("");
        try {
            const data = await widgetApi.submitBooking({
                name: contact.name,
                phone: contact.phone,
                email: contact.email,
                address: contact.address,
                description: contact.notes || "Widget booking started",
                source: "WIDGET",
                metadata: { customerType: contact.customerType },
            }, apiOpts);
            if (data.leadId) localStorage.setItem("syjLeadId", data.leadId);
            if (data.customerId) setStoredCustomerId(data.customerId);
            setLeadCaptured(true);
            goNext();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
        } finally {
            setSubmitting(false);
        }
    }, [contact, leadCaptured]);

    /* ── Final booking submit ─────────────────────────────────────── */
    const handleSubmit = useCallback(async () => {
        setSubmitting(true);
        setError("");
        try {
            const leadId = typeof window !== "undefined" ? localStorage.getItem("syjLeadId") : null;
            const timeSlotOption = dynamicSlots?.find(s => `${s.start}-${s.end}` === selectedTime)
                ?? TIME_SLOTS.find(t => t.id === selectedTime);

            // Shared card confirmation (runs once, caches result)
            let confirmedPaymentMethodId: string | null = null;
            const confirmCard = async (): Promise<string | null> => {
                if (confirmedPaymentMethodId) return confirmedPaymentMethodId;
                if (!hasStripe || !stripeRef.current || !cardRef.current || !setupClientSecret) return null;
                const { setupIntent, error: stripeErr } = await stripeRef.current.confirmCardSetup(
                    setupClientSecret,
                    { payment_method: { card: cardRef.current, billing_details: { name: contact.name, phone: contact.phone, email: contact.email } } }
                );
                if (stripeErr) throw new Error(stripeErr.message || "Card save failed");
                confirmedPaymentMethodId = (setupIntent?.payment_method as string) || null;
                return confirmedPaymentMethodId;
            };

            /* ── JUNK REMOVAL payload ── */
            const sendJunkBooking = async () => {
                const loadTier = LOAD_TIERS[tierIndex];
                const edgeCaseIds = Object.entries(edgeCases).filter(([, v]) => v).map(([k]) => k);
                const description = hasEdgeCase
                    ? `${loadTier.title} — custom estimate (${edgeCaseIds.join(", ")})`
                    : `${loadTier.title} junk removal`;
                const volumeOption = VOLUME_OPTIONS.find(v => v.id === volume);
                const locationOption = LOCATION_OPTIONS.find(l => l.id === location);
                const minPrice = tierData ? roundTo5(tierData.min + totalAdj) : 0;
                const maxPrice = tierData ? roundTo5(tierData.max + totalAdj) : 0;
                const quoteRangeStr = hasEdgeCase ? "On-Site Estimate" : (tierData ? `$${minPrice} – $${maxPrice}` : "");
                const stairsAccessLabel = locationOption?.label || "Ground Floor";

                const payload: Record<string, unknown> = {
                    type: "booking", status: "booked", serviceType: "junk_removal",
                    name: contact.name, phone: contact.phone, email: contact.email, address: contact.address,
                    description, requestedDate: selectedDate?.toISOString().split("T")[0],
                    value: hasEdgeCase ? undefined : (minPrice || undefined), notes: contact.notes || "",
                    metadata: {
                        serviceType: "junk_removal",
                        customerType: contact.customerType,
                        timeSlot: selectedTime || "",
                        truckLoad: volumeOption?.fraction || "", quoteRange: quoteRangeStr,
                        loadTier: loadTier.title,
                        junkLocation: locationOption?.label || "", stairsAccess: stairsAccessLabel,
                        specialConditions: edgeCaseIds,
                        edgeCaseNote: hasEdgeCase ? "Customer flagged special conditions — crew estimates on-site" : "",
                        priceRange: hasEdgeCase ? null : (tierData ? [minPrice, maxPrice] : null),
                        surcharges: [
                            ...(priceAdj > 0 ? [{ id: "stairs", label: stairsSurcharge?.label, amount: priceAdj }] : []),
                            ...(distanceSurcharge > 0 ? [{ id: "distance", label: "Distance surcharge", amount: distanceSurcharge }] : []),
                        ],
                        termsAcceptedAt: new Date().toISOString(),
                        signatureDataUrl: signatureDataUrl || undefined,
                        ...(paymentPreference ? { paymentPreference } : {}),
                    },
                    source: "WIDGET",
                    ...(promoCode ? { promoCode } : {}),
                };
                if (leadId) payload.leadId = leadId;

                // Stripe card-on-file
                const pmId = paymentPreference === "card" ? await confirmCard() : null;
                if (pmId) (payload.metadata as Record<string, unknown>).stripePaymentMethodId = pmId;

                const data = await widgetApi.submitBooking(payload, apiOpts);
                if (data.error === "slot_full") {
                    setDynamicSlots(data.availableSlots || []);
                    setSelectedTime(null);
                    setStep(phases.indexOf("schedule"));
                    setError("That time slot just filled up. Please pick a new time.");
                    setSubmitting(false);
                    return "";
                }
                if (data.leadId) localStorage.setItem("syjLeadId", data.leadId);
                if (data.customerId) setStoredCustomerId(data.customerId);

                // Confirm card-on-file with dashboard (non-blocking)
                if (pmId && data.customerId) {
                    widgetApi.confirmCard(data.customerId, pmId, apiOpts)
                        .catch(err => console.warn("Card confirmation failed:", err));
                }

                return quoteRangeStr;
            };

            /* ── DUMPSTER RENTAL payload ── */
            const sendDumpsterLead = async (): Promise<{ autoBooked?: boolean }> => {
                const containerLabel = CONTAINER_SIZES.find(c => c.id === containerSize)?.label || containerSize || "";
                const debrisLabel = DEBRIS_TYPES.find(d => d.id === debrisType)?.label || debrisType || "";
                const durationLabel = RENTAL_DURATIONS.find(r => r.id === rentalDuration)?.label || rentalDuration || "";
                const description = `${containerLabel} dumpster, ${debrisLabel}, ${durationLabel}`;

                const payload: Record<string, unknown> = {
                    type: "rental_lead", status: "new",
                    serviceType: "dumpster_rental",
                    name: contact.name, phone: contact.phone, email: contact.email, address: contact.address,
                    description, requestedDate: selectedDate?.toISOString().split("T")[0],
                    notes: contact.notes || "",
                    metadata: {
                        serviceType: "dumpster_rental",
                        customerType: contact.customerType,
                        containerSize: containerSize || "", debrisType: debrisType || "",
                        rentalDuration: rentalDuration || "",
                        timeSlot: selectedTime || "",
                        termsAcceptedAt: new Date().toISOString(),
                        signatureDataUrl: signatureDataUrl || undefined,
                        ...(paymentPreference ? { paymentPreference } : {}),
                    },
                    source: "WIDGET",
                    ...(promoCode ? { promoCode } : {}),
                };
                if (leadId) payload.leadId = leadId;

                // Stripe card-on-file
                const pmId = paymentPreference === "card" ? await confirmCard() : null;
                if (pmId) (payload.metadata as Record<string, unknown>).stripePaymentMethodId = pmId;

                const data = await widgetApi.submitBooking(payload, apiOpts);
                if (data.error === "slot_full") {
                    setDynamicSlots(data.availableSlots || []);
                    setSelectedTime(null);
                    setStep(phases.indexOf("schedule"));
                    setError("That time slot just filled up. Please pick a new time.");
                    setSubmitting(false);
                    return { autoBooked: false };
                }
                if (data.leadId) localStorage.setItem("syjLeadId", data.leadId);
                if (data.customerId) setStoredCustomerId(data.customerId);

                // Confirm card-on-file with dashboard (non-blocking)
                if (pmId && data.customerId) {
                    widgetApi.confirmCard(data.customerId, pmId, apiOpts)
                        .catch(err => console.warn("Card confirmation failed:", err));
                }

                return { autoBooked: data.autoBooked };
            };

            /* ── Send signed waiver to dashboard ── */
            const sendWaiver = async () => {
                if (!signatureDataUrl || !leadId) return;
                try {
                    await widgetApi.submitWaiver({
                        leadId,
                        signature: signatureDataUrl,
                        customerName: contact.name,
                    }, apiOpts);
                } catch {
                    // Non-blocking — don't fail the booking if waiver upload fails
                    console.warn("Waiver upload failed silently");
                }
            };

            /* ── Execute based on service type ── */
            let priceStr = "";
            let dumpsterPriceStr = "";
            let dumpsterAutoBooked = false;
            const waiverPromise = sendWaiver(); // fire in parallel
            if (serviceType === "junk" || serviceType === "both") {
                priceStr = await sendJunkBooking();
            }
            if (serviceType === "dumpster" || serviceType === "both") {
                const dumpsterResult = await sendDumpsterLead();
                dumpsterAutoBooked = !!dumpsterResult.autoBooked;
                // Build dumpster price string from pricing tiers
                const sizeNum = containerSize ? parseInt(containerSize) : 0;
                const dTier = config.dumpsterPricing?.tiers.find(t => t.sizeCuYd === sizeNum);
                if (dTier && (dTier.baseRate > 0 || (dTier.baseRateMin != null && dTier.baseRateMin > 0))) {
                    const sizeLabel = CONTAINER_SIZES.find(c => c.id === containerSize)?.label || "";
                    dumpsterPriceStr = `${sizeLabel} — ${formatDumpsterPrice(dTier)}`;
                }
            }
            await waiverPromise; // ensure waiver completes before redirect

            try { sessionStorage.removeItem(WIZARD_STORAGE_KEY); } catch {}
            // Instead of Next.js router navigation, call the onComplete callback
            if (onComplete) {
                onComplete({
                    name: contact.name,
                    date: selectedDate?.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) || "",
                    time: timeSlotOption?.label || formatSlotTime(selectedTime) || "",
                    price: priceStr,
                    serviceType: serviceType || "junk",
                    address: contact.address || undefined,
                    dumpsterPrice: dumpsterPriceStr || undefined,
                    debrisType: debrisType ? (DEBRIS_TYPES.find(d => d.id === debrisType)?.label || debrisType) : undefined,
                    rentalDuration: rentalDuration ? (RENTAL_DURATIONS.find(r => r.id === rentalDuration)?.label || rentalDuration) : undefined,
                    autoBooked: dumpsterAutoBooked || undefined,
                });
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
        } finally {
            setSubmitting(false);
        }
    }, [contact, tierIndex, edgeCases, volume, location, selectedDate, selectedTime, tierData, priceAdj, distanceSurcharge, totalAdj, stairsSurcharge, onComplete, serviceType, containerSize, debrisType, rentalDuration, setupClientSecret, promoCode, paymentPreference]);

    const formatPhone = (val: string) => {
        const digits = val.replace(/\D/g, "").slice(0, 10);
        if (digits.length <= 3) return digits;
        if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    };



    /* ── Render ──────────────────────────────────────────────────────────── */
    return (
        <div style={{ minHeight: "100vh", background: "var(--background)" }}>
            {/* Progress bar */}
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px 0", display: "flex", gap: 6 }}>
                {phases.map((_p: WizardPhase, i: number) => (
                    <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? "var(--brand)" : "#E2E8F0", transition: "background 0.3s" }} />
                ))}
            </div>
            {/* Promo banner */}
            {promoResult?.valid && (
                <div style={{ maxWidth: 720, margin: "8px auto 0", padding: "10px 20px", background: "linear-gradient(135deg, #059669, #10B981)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>🎉 {promoResult.discountValue}{promoResult.discountType === "percentage" ? "%" : "$"} off applied!</span>
                    <button onClick={() => { setPromoCode(null); setPromoResult(null); setPromoInputValue(""); }} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>Remove</button>
                </div>
            )}
            {promoResult && !promoResult.valid && promoCode && (
                <div style={{ maxWidth: 720, margin: "8px auto 0", padding: "10px 20px", background: "#FEF2F2", borderRadius: 10, border: "1px solid #FECACA" }}>
                    <span style={{ color: "#991B1B", fontSize: 13, fontWeight: 600 }}>Code &ldquo;{promoCode}&rdquo; is not valid{promoResult.reason === "expired" ? " (expired)" : promoResult.reason === "max_uses_reached" ? " (fully redeemed)" : ""}.</span>
                </div>
            )}
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "8px 20px 0", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Step {step + 1} of {phases.length}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {getPhaseLabel(currentPhase)}
                </span>
            </div>

            {/* Content */}
            <div key={step} className="fade-up" style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 140px" }}>

                {/* ── CONTACT: Contact Info (Lead Capture) ────────────────────────── */}
                {currentPhase === "contact" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Hand size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>Let&apos;s get started!</h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>Tell us a bit about yourself so we can prepare your custom quote.</p>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            <div>
                                <label className="label">Full Name *</label>
                                <input className="input" placeholder="John Smith" value={contact.name} onChange={e => setContact(c => ({ ...c, name: e.target.value }))} />
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                <div>
                                    <label className="label">Phone *</label>
                                    <input className="input" placeholder="(555) 123-4567" value={contact.phone} onChange={e => setContact(c => ({ ...c, phone: formatPhone(e.target.value) }))} />
                                </div>
                                <div>
                                    <label className="label">Email *</label>
                                    <input className="input" type="email" placeholder="john@email.com" value={contact.email} onChange={e => setContact(c => ({ ...c, email: e.target.value }))} />
                                </div>
                            </div>
                            <div>
                                <label className="label">Service Address *</label>
                                <AddressAutocomplete
                                    googleMapsKey={config.googleMapsKey}
                                    serviceAreaZips={config.serviceAreaZips}
                                    phoneNumber={config.phoneNumber}
                                    value={contact.address}
                                    onChange={(val) => {
                                        setContact(c => ({ ...c, address: val }));
                                        setAddressConfirmed(false);
                                        setAddressInArea(true);
                                        setOutOfAreaMsg(null);
                                    }}
                                    onPlaceSelect={(place) => {
                                        setContact(c => ({ ...c, address: place.address }));
                                        setAddressConfirmed(true);
                                        // ZIP-based area check (existing)
                                        const zips = config.serviceAreaZips;
                                        let zipOk = true;
                                        if (zips.length > 0 && place.zip) {
                                            zipOk = zips.includes(place.zip);
                                        }
                                        // Distance-based area check + surcharge (new)
                                        let radiusOk = true;
                                        let newDistanceSurcharge = 0;
                                        if (config.serviceAreaCenter && place.lat && place.lng) {
                                            const dist = haversineDistance(place.lat, place.lng, config.serviceAreaCenter.lat, config.serviceAreaCenter.lng);
                                            setDistanceMiles(Math.round(dist * 10) / 10);
                                            if (config.serviceAreaRadiusMiles && dist > config.serviceAreaRadiusMiles) {
                                                radiusOk = false;
                                            } else {
                                                // Find matching distance tier
                                                const dTiers = pricing.distanceTiers || [];
                                                const sorted = [...dTiers].sort((a, b) => a.maxMiles - b.maxMiles);
                                                const matchedTier = sorted.find(t => dist <= t.maxMiles);
                                                newDistanceSurcharge = matchedTier ? matchedTier.additionalCost : (sorted.length > 0 ? sorted[sorted.length - 1].additionalCost : 0);
                                            }
                                        } else {
                                            setDistanceMiles(null);
                                        }
                                        setDistanceSurcharge(newDistanceSurcharge);
                                        if (!zipOk || !radiusOk) {
                                            setAddressInArea(false);
                                            setOutOfAreaMsg("We do not service your area. Sorry for the inconvenience.");
                                        } else {
                                            setAddressInArea(true);
                                            setOutOfAreaMsg(null);
                                        }
                                    }}
                                />
                                {outOfAreaMsg && (
                                    <div style={{ marginTop: 8, padding: "10px 14px", borderRadius: 10, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 13, color: "#DC2626", display: "flex", alignItems: "flex-start", gap: 8 }}>
                                        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                                        <span>{outOfAreaMsg}</span>
                                    </div>
                                )}
                                {!addressConfirmed && contact.address.length > 5 && !outOfAreaMsg && (
                                    <p style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
                                        Please select an address from the dropdown.
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="label">Property Type</label>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                    {(["residential", "commercial"] as const).map(type => (
                                        <button key={type} onClick={() => setContact(c => ({ ...c, customerType: type }))}
                                            style={{
                                                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                                                padding: "14px 16px", borderRadius: 12, cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit",
                                                border: `2px solid ${contact.customerType === type ? "var(--brand)" : "var(--border, #E2E8F0)"}`,
                                                background: contact.customerType === type ? "#FFF7ED" : "var(--card)",
                                                color: contact.customerType === type ? "var(--brand)" : "var(--foreground)",
                                                fontWeight: 600, fontSize: 14,
                                            }}>
                                            {type === "residential" ? <Home size={18} /> : <Building2 size={18} />}
                                            {type === "residential" ? "Residential" : "Commercial"}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="label">Notes (optional)</label>
                                <textarea className="input" rows={3} placeholder="Gate code, special instructions, etc." value={contact.notes} onChange={e => setContact(c => ({ ...c, notes: e.target.value }))} style={{ resize: "vertical" }} />
                            </div>
                        </div>

                        {error && (
                            <div style={{ marginTop: 16, padding: "12px 18px", borderRadius: 12, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 14, color: "#DC2626" }}>
                                {error}
                            </div>
                        )}

                        <button onClick={captureLead} disabled={!canProceed() || submitting}
                            style={{
                                width: "100%", marginTop: 24, padding: 18, borderRadius: "var(--btn-radius)", border: "none",
                                background: canProceed() && !submitting ? "linear-gradient(135deg, var(--brand), var(--brand-dark))" : "#E2E8F0",
                                color: canProceed() && !submitting ? "#fff" : "#94A3B8",
                                fontSize: 17, fontWeight: 700, cursor: canProceed() && !submitting ? "pointer" : "not-allowed",
                                fontFamily: "var(--heading-font)", boxShadow: canProceed() && !submitting ? "0 8px 24px rgba(249,115,22,0.3)" : "none",
                                transition: "all 0.2s",
                            }}>
                            {submitting ? "Saving..." : "Get My Free Quote →"}
                        </button>
                        <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
                            No obligation — we&apos;ll prepare a custom quote based on your items.
                        </p>
                    </div>
                )}

                {/* ── SERVICE TYPE: Junk / Dumpster / Both ──────────────────── */}
                {currentPhase === "service_type" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Wrench size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>What services do you need?</h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>Select one or both options below.</p>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 480, margin: "0 auto" }}>
                            {([{ id: "junk" as ServiceType, label: "Junk Removal", desc: "We send a crew to haul it all away", iconEl: <Truck size={36} color="var(--brand)" /> }, { id: "dumpster" as ServiceType, label: "Dumpster Rental", desc: "Container delivered to your location", iconEl: <Box size={36} color="var(--brand)" /> }]).map(opt => {
                                const sel = serviceType === opt.id || serviceType === "both";
                                return (
                                    <div key={opt.id} onClick={() => setServiceType(prev => {
                                        if (prev === "both" && opt.id === "junk") return "dumpster";
                                        if (prev === "both" && opt.id === "dumpster") return "junk";
                                        if (prev === opt.id) return null;
                                        if (prev && prev !== opt.id) return "both";
                                        return opt.id;
                                    })} style={{ background: sel ? "#FFF7ED" : "var(--card)", border: `2px solid ${sel ? "var(--brand)" : "var(--border, #E2E8F0)"}`, borderRadius: 16, padding: "28px 20px", textAlign: "center", cursor: "pointer", transition: "all 0.2s", position: "relative" }}>
                                        {sel && <div style={{ position: "absolute", top: 12, right: 12, width: 24, height: 24, borderRadius: "50%", background: "var(--brand)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={14} /></div>}
                                        <div style={{ marginBottom: 12 }}>{opt.iconEl}</div>
                                        <div style={{ fontWeight: 700, fontSize: 16, color: "var(--foreground)", marginBottom: 6 }}>{opt.label}</div>
                                        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{opt.desc}</div>
                                    </div>
                                );
                            })}
                        </div>
                        {serviceType === "both" && (<div style={{ marginTop: 16, padding: "12px 18px", borderRadius: 12, background: "#F0FDF4", border: "1px solid #BBF7D0", textAlign: "center", fontSize: 14, fontWeight: 600, color: "#16A34A" }}><Check size={14} style={{ display: "inline", verticalAlign: "middle" }} /> Both services selected!</div>)}
                    </div>
                )}

                {/* ── LOAD ESTIMATE (V2) ─────────────────────────────────────── */}
                {currentPhase === "load_estimate" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 12 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(var(--brand-rgb, 249,115,22),0.1)", border: "1px solid rgba(var(--brand-rgb, 249,115,22),0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Truck size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontFamily: "var(--heading-font)", fontSize: 24, fontWeight: 700, color: "var(--foreground)", margin: "0 0 4px", letterSpacing: -0.3 }}>
                                How much junk are we hauling?
                            </h1>
                            <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>Drag the slider — watch the truck fill up.</p>
                        </div>

                        {/* View toggle */}
                        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 12px", marginBottom: 10 }}>
                            <div style={{ display: "inline-flex", background: "var(--border, #f1f5f9)", borderRadius: 8, padding: 2 }}>
                                {([{ key: "slider" as const, label: "Slider" }, { key: "compare" as const, label: "Compare all" }]).map(v => (
                                    <button key={v.key} onClick={() => setViewMode(v.key)} style={{
                                        padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                                        fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                                        background: viewMode === v.key ? "var(--card, #fff)" : "transparent",
                                        color: viewMode === v.key ? "var(--foreground)" : "var(--muted)",
                                        boxShadow: viewMode === v.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                                        transition: "all 0.15s",
                                    }}>{v.label}</button>
                                ))}
                            </div>
                        </div>

                        {/* Truck + Slider OR Compare Grid */}
                        {viewMode === "slider" ? (
                            <>
                                <div style={{ margin: "0 12px", borderRadius: 20, overflow: "hidden", border: "1px solid var(--border, #e2e8f0)", background: "#f8fafc" }}>
                                    <BoxTruck tierIndex={tierIndex} mounted={mounted} />
                                </div>
                                <div style={{ marginTop: 20 }}><StepSlider value={tierIndex} onChange={setTierIndex} /></div>
                            </>
                        ) : (
                            <CompareGrid currentStep={tierIndex} onChange={setTierIndex} pricing={pricing} />
                        )}

                        {/* Info Card with client pricing */}
                        <div style={{ margin: "20px 12px 0", padding: "18px 20px", background: "var(--card, #fff)", borderRadius: "var(--card-radius, 16px)", border: "1px solid var(--border, #e2e8f0)", boxShadow: "0 1px 4px rgba(0,0,0,0.03)" }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                                <div style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 12, background: "rgba(var(--brand-rgb, 249,115,22),0.05)", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${Math.min(LOAD_TIERS[tierIndex].fill, 1) * 100}%`, background: "rgba(var(--brand-rgb, 249,115,22),0.1)", transition: "height 0.4s cubic-bezier(0.16,1,0.3,1)" }} />
                                    <Truck size={20} color="var(--brand)" style={{ position: "relative", zIndex: 1 }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontFamily: "var(--heading-font)", fontSize: 17, fontWeight: 700, color: "var(--foreground)", marginBottom: 3, lineHeight: 1.3 }}>
                                        {LOAD_TIERS[tierIndex].title}
                                        {LOAD_TIERS[tierIndex].popular && (
                                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--brand)", background: "rgba(var(--brand-rgb, 249,115,22),0.06)", padding: "2px 8px", borderRadius: 999, marginLeft: 8, verticalAlign: "middle", letterSpacing: 0.3, textTransform: "uppercase" }}>
                                                Most common
                                            </span>
                                        )}
                                    </div>
                                    <p style={{ fontSize: 14, color: "var(--muted)", margin: 0, lineHeight: 1.55 }}>{LOAD_TIERS[tierIndex].desc}</p>
                                </div>
                                <div style={{ flexShrink: 0, textAlign: "right" }}>
                                    {hasEdgeCase ? (
                                        <div style={{ background: "rgba(var(--foreground-rgb, 0,0,0),0.04)", borderRadius: 10, padding: "8px 12px" }}>
                                            <div style={{ fontFamily: "var(--heading-font)", fontSize: 11, fontWeight: 700, color: "var(--foreground)", lineHeight: 1.3, whiteSpace: "nowrap" }}>Free On-Site</div>
                                            <div style={{ fontFamily: "var(--heading-font)", fontSize: 11, fontWeight: 700, color: "var(--foreground)" }}>Estimate</div>
                                        </div>
                                    ) : (
                                        <div style={{ background: "rgba(var(--brand-rgb, 249,115,22),0.05)", borderRadius: 10, padding: "8px 12px" }}>
                                            <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 500, marginBottom: 1 }}>Starting from</div>
                                            {tierData && <AnimatedPrice value={roundTo5(tierData.min + totalAdj)} fontSize={22} />}
                                            <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 3, lineHeight: 1.2 }}>Finalized on-site</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border, #f1f5f9)", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, display: "flex", gap: 6 }}>
                                <span style={{ fontSize: 14, lineHeight: "18px", flexShrink: 0 }}>💡</span>
                                <span>This is an estimate based on load size. <strong style={{ color: "var(--foreground)" }}>Your crew will confirm the final price on-site before any work begins.</strong> You only pay for what we actually haul.</span>
                            </div>
                        </div>

                        {/* Guarantee badge */}
                        <div style={{
                            margin: "12px 12px 0", padding: "12px 16px",
                            background: "#f0fdf4", borderRadius: 12, border: "1px solid #bbf7d0",
                            display: "flex", alignItems: "center", gap: 10,
                        }}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
                                <path d="M10 1L12.5 4L16.5 3.5L15.5 7.5L18.5 10L15.5 12.5L16.5 16.5L12.5 16L10 19L7.5 16L3.5 16.5L4.5 12.5L1.5 10L4.5 7.5L3.5 3.5L7.5 4L10 1Z"
                                    fill="#22c55e" opacity="0.15" stroke="#16a34a" strokeWidth="1.2" />
                                <path d="M7 10.5L9 12.5L13 8" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span style={{ fontSize: 12.5, color: "#15803d", lineHeight: 1.4 }}>
                                <strong>Pay-less guarantee:</strong> If we haul less than estimated, your price goes down. Never up.
                            </span>
                        </div>

                        {/* Edge Cases */}
                        <div style={{ margin: "12px 12px 0", padding: "18px 20px", background: "var(--card, #fff)", borderRadius: "var(--card-radius, 16px)", border: "1px solid var(--border, #e2e8f0)", boxShadow: "0 1px 4px rgba(0,0,0,0.03)" }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Does your load include any of the following?</div>
                            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>These may require a custom quote.</div>
                            {EDGE_CASES.map((item, i) => (
                                <div key={item.id}>
                                    {i > 0 && <div style={{ height: 1, background: "var(--border, #f1f5f9)" }} />}
                                    <EdgeToggle item={item} checked={!!edgeCases[item.id]} onChange={() => toggleEdge(item.id)} />
                                </div>
                            ))}
                            {hasEdgeCase && (
                                <div style={{ marginTop: 12, padding: "10px 14px", background: "#FFFBEB", borderRadius: 10, border: "1px solid #FDE68A", display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "#92400E", lineHeight: 1.5 }}>
                                    <span style={{ fontSize: 16, lineHeight: "20px", flexShrink: 0 }}>⚠️</span>
                                    <span><strong>No worries.</strong> We&apos;ll send a crew to give you a free, no-obligation estimate on-site before any work begins.</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── JUNK LOCATION ────────────────────────────────────────────── */}
                {currentPhase === "junk_location" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><MapPin size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>Where is the junk located?</h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>This helps us plan access and determine crew size.</p>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                            {LOCATION_OPTIONS.map(loc => (
                                <div key={loc.id} className="card" onClick={() => setLocation(loc.id)}
                                    style={{ textAlign: "center", cursor: "pointer", position: "relative", background: location === loc.id ? "#FFF7ED" : "var(--card)", borderColor: location === loc.id ? "var(--brand)" : undefined }}>
                                    {location === loc.id && (
                                        <div style={{ position: "absolute", top: 10, right: 10, width: 22, height: 22, borderRadius: "50%", background: "var(--brand)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            <Check size={14} />
                                        </div>
                                    )}
                                    <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><ServiceIcon name={loc.icon} size={32} color="var(--brand)" /></div>
                                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--foreground)", marginBottom: 4 }}>{loc.label}</div>
                                    <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>{loc.desc}</div>
                                </div>
                            ))}
                        </div>
                        {(location === "upstairs" || location === "basement") && stairsSurcharge?.enabled && (
                            <div style={{ marginTop: 16, padding: "12px 18px", borderRadius: 12, background: "#FFFBEB", border: "1px solid #FEF3C7", fontSize: 13, color: "#92400E", display: "flex", alignItems: "center", gap: 8 }}>
                                <AlertTriangle size={16} style={{ display: "inline", verticalAlign: "middle", flexShrink: 0 }} /> Stairs access may add ${stairsSurcharge.amount} to the estimate due to extra labor.
                            </div>
                        )}
                    </div>
                )}

                {/* ── DUMPSTER SIZE ────────────────────────────────────────────── */}
                {currentPhase === "dumpster_size" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Box size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>What size container?</h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>Choose the dumpster size that best fits your project.</p>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
                            {CONTAINER_SIZES.map(cs => {
                                const sizeNum = parseInt(cs.id);
                                const tier = config.dumpsterPricing?.tiers.find(t => t.sizeCuYd === sizeNum);
                                const hasPrice = tier && (tier.baseRate > 0 || (tier.baseRateMin != null && tier.baseRateMin > 0));
                                // Use live availability data if this is the selected size
                                const isSelected = containerSize === cs.id;
                                const liveAvail = isSelected ? containerAvailability : null;
                                const liveRate = liveAvail?.available && liveAvail.baseRate ? liveAvail.baseRate : null;
                                const liveDays = liveAvail?.available && liveAvail.includedDays ? liveAvail.includedDays : null;
                                return (
                                <div key={cs.id} onClick={() => setContainerSize(cs.id)} style={{ background: isSelected ? "#FFF7ED" : "var(--card)", border: `2px solid ${isSelected ? "var(--brand)" : "var(--border, #E2E8F0)"}`, borderRadius: 16, padding: "20px 18px", cursor: "pointer", transition: "all 0.2s", position: "relative", display: "flex", flexDirection: "column" }}>
                                    {isSelected && <div style={{ position: "absolute", top: 10, right: 10, width: 22, height: 22, borderRadius: "50%", background: "var(--brand)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={14} /></div>}
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                        <ServiceIcon name={cs.icon} size={24} color="var(--brand)" />
                                        <div style={{ fontWeight: 800, fontSize: 26, color: "var(--brand)" }}>{cs.yards}</div>
                                    </div>
                                    {/* Live price from availability API or static fallback */}
                                    {liveRate ? (
                                        <div style={{ fontWeight: 900, fontSize: 18, color: "var(--foreground)", marginBottom: 4 }}>From ${roundTo5(liveRate)}</div>
                                    ) : hasPrice ? (
                                        <div style={{ fontWeight: 900, fontSize: 18, color: "var(--foreground)", marginBottom: 4 }}>{formatDumpsterPrice(tier)}</div>
                                    ) : null}
                                    {liveDays ? (
                                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{liveDays}-day rental included</div>
                                    ) : hasPrice ? (
                                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{tier.includedDays}-day rental · {tier.weightAllowanceTons}T included</div>
                                    ) : null}
                                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{cs.desc}</div>
                                    <div style={{ fontSize: 12, color: "var(--foreground)", background: "var(--background)", padding: "6px 10px", borderRadius: 8, lineHeight: 1.4, marginTop: "auto" }}><strong>Good for:</strong> {cs.goodFor}</div>
                                </div>
                                );
                            })}
                        </div>
                        {/* Availability indicator */}
                        {containerSize && (checkingAvailability || containerAvailability) && (
                            <div style={{ marginTop: 16, padding: "12px 18px", borderRadius: 12, textAlign: "center", fontSize: 14, fontWeight: 600, ...(checkingAvailability ? { background: "#F8FAFC", border: "1px solid #E2E8F0", color: "var(--muted)" } : containerAvailability?.available ? { background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#16A34A" } : containerAvailability && !containerAvailability.available ? { background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626" } : { background: "#F8FAFC", border: "1px solid #E2E8F0", color: "var(--muted)" }) }}>
                                {checkingAvailability ? "Checking availability..." : containerAvailability?.available ? "✓ In stock" : containerAvailability && !containerAvailability.available ? (<>{containerAvailability.nextAvailableDate ? `Next available: ${new Date(containerAvailability.nextAvailableDate).toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : "Currently unavailable"}{containerAvailability.alternativeSizes && containerAvailability.alternativeSizes.length > 0 && (<span style={{ display: "block", fontSize: 12, fontWeight: 500, marginTop: 4 }}>Other sizes in stock: {containerAvailability.alternativeSizes.map(s => `${s}yd³`).join(", ")}</span>)}</>) : null}
                            </div>
                        )}
                    </div>
                )}

                {/* ── DUMPSTER DETAILS ────────────────────────────────────────── */}
                {currentPhase === "dumpster_details" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><FileText size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>Rental Details</h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>Tell us about your project so we can prepare.</p>
                        </div>
                        <div style={{ marginBottom: 28 }}>
                            <h3 style={{ fontFamily: "var(--heading-font)", fontSize: 15, fontWeight: 700, color: "var(--foreground)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.02em" }}>What type of debris?</h3>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                                {DEBRIS_TYPES.map(dt => (
                                    <div key={dt.id} onClick={() => setDebrisType(dt.id)} style={{ background: debrisType === dt.id ? "#FFF7ED" : "var(--card)", border: `2px solid ${debrisType === dt.id ? "var(--brand)" : "var(--border, #E2E8F0)"}`, borderRadius: 12, padding: "14px 16px", cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 10 }}>
                                        <ServiceIcon name={dt.icon} size={20} color="var(--brand)" />
                                        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--foreground)" }}>{dt.label}</span>
                                        {debrisType === dt.id && <Check size={16} color="var(--brand)" style={{ marginLeft: "auto" }} />}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <h3 style={{ fontFamily: "var(--heading-font)", fontSize: 15, fontWeight: 700, color: "var(--foreground)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.02em" }}>How long do you need it?</h3>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                {RENTAL_DURATIONS.map(rd => (
                                    <div key={rd.id} onClick={() => setRentalDuration(rd.id)} style={{ background: rentalDuration === rd.id ? "#FFF7ED" : "var(--card)", border: `2px solid ${rentalDuration === rd.id ? "var(--brand)" : "var(--border, #E2E8F0)"}`, borderRadius: 12, padding: "16px 18px", cursor: "pointer", transition: "all 0.15s", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 15, color: "var(--foreground)", marginBottom: 2 }}>{rd.label}</div>
                                            <div style={{ fontSize: 12, color: "var(--muted)" }}>{rd.desc}</div>
                                        </div>
                                        {rentalDuration === rd.id && <Check size={18} color="var(--brand)" />}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── SCHEDULE ────────────────────────────────────────────────── */}
                {currentPhase === "schedule" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><CalendarDays size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>Pick a date &amp; time</h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>You can reschedule after booking if needed.</p>
                        </div>
                        <div style={{ background: "var(--card)", borderRadius: 16, padding: 24, border: "1px solid var(--border, #E2E8F0)", marginBottom: 24 }}>
                            <Calendar selected={selectedDate} onSelect={(d) => { setSelectedDate(d); setSelectedTime(null); }} isDisabled={(d) => isDayClosed(d, config.businessHours)} />
                        </div>
                        {selectedDate && (() => {
                            if (loadingSlots) return (
                                <div style={{ textAlign: "center", padding: 24, color: "var(--muted)", fontSize: 14 }}>Checking available times...</div>
                            );
                            const slotsToRender: DynamicSlot[] | null = dynamicSlots;
                            const fallbackSlots = getAvailableTimeSlots(selectedDate, config.businessHours);
                            const renderSlots = slotsToRender ?? fallbackSlots.map(s => ({
                                start: String(s.startHour).padStart(2, "0") + ":00",
                                end: String(s.startHour + 2).padStart(2, "0") + ":00",
                                label: s.label, available: true, remainingCapacity: 99,
                            }));
                            if (renderSlots.length === 0) return (
                                <div style={{ textAlign: "center", padding: 24, background: "#FEF2F2", borderRadius: 12, border: "1px solid #FECACA" }}>
                                    <AlertTriangle size={20} color="#DC2626" style={{ marginBottom: 8 }} />
                                    <div style={{ fontSize: 14, color: "#DC2626", fontWeight: 600 }}>{dynamicSlots ? "No availability on this day" : "We&apos;re closed on this day"}</div>
                                    <div style={{ fontSize: 13, color: "#DC2626", marginTop: 4 }}>Please select a different date.</div>
                                </div>
                            );
                            const allFull = renderSlots.every(s => !s.available);
                            return (
                                <div>
                                    <div style={{ fontFamily: "var(--heading-font)", fontSize: 16, fontWeight: 700, color: "var(--foreground)", marginBottom: 12, textAlign: "center" }}>
                                        Available times for {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                                    </div>
                                    {allFull && (
                                        <div style={{ textAlign: "center", padding: 16, marginBottom: 12, background: "#FEF2F2", borderRadius: 12, border: "1px solid #FECACA" }}>
                                            <div style={{ fontSize: 14, color: "#DC2626", fontWeight: 600 }}>All time slots are fully booked</div>
                                            <div style={{ fontSize: 13, color: "#DC2626", marginTop: 4 }}>Please try a different date.</div>
                                        </div>
                                    )}
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                                        {renderSlots.map(slot => {
                                            const slotKey = `${slot.start}-${slot.end}`;
                                            const isSelected = selectedTime === slotKey;
                                            const isFull = !slot.available;
                                            return (
                                                <button key={slotKey} onClick={() => !isFull && setSelectedTime(slotKey)}
                                                    disabled={isFull}
                                                    style={{
                                                        border: `2px solid ${isSelected ? "var(--brand)" : isFull ? "#E2E8F0" : "var(--border, #E2E8F0)"}`,
                                                        background: isSelected ? "#FFF7ED" : isFull ? "#F8FAFC" : "var(--card)",
                                                        borderRadius: 12, padding: 16, textAlign: "center",
                                                        cursor: isFull ? "not-allowed" : "pointer",
                                                        transition: "all 0.15s", fontFamily: "inherit",
                                                        opacity: isFull ? 0.5 : 1,
                                                    }}>
                                                    <div style={{ fontWeight: 600, fontSize: 14, color: isSelected ? "var(--brand)" : isFull ? "var(--muted)" : "var(--foreground)" }}>
                                                        {formatSlotTime(slot.start)} – {formatSlotTime(slot.end)}
                                                    </div>
                                                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                                                        {isFull ? "Fully booked" : slot.label}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}
                        {/* Date-specific availability indicator for dumpster rentals */}
                        {selectedDate && (serviceType === "dumpster" || serviceType === "both") && containerSize && (
                            <div style={{ marginTop: 16, padding: "14px 18px", borderRadius: 12, textAlign: "center", fontSize: 14, fontWeight: 600, ...(checkingAvailability ? { background: "#F8FAFC", border: "1px solid #E2E8F0", color: "var(--muted)" } : containerAvailability?.available ? { background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#16A34A" } : containerAvailability && !containerAvailability.available ? { background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626" } : { background: "#F8FAFC", border: "1px solid #E2E8F0", color: "var(--muted)" }) }}>
                                {checkingAvailability ? "Checking availability for your date..." : containerAvailability?.available ? `✓ ${CONTAINER_SIZES.find(c => c.id === containerSize)?.label || "Container"} available for ${selectedDate.toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : containerAvailability && !containerAvailability.available ? (<><AlertTriangle size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />{containerAvailability.nextAvailableDate ? (<>No {CONTAINER_SIZES.find(c => c.id === containerSize)?.label || "containers"} available for this date.<span style={{ display: "block", fontSize: 13, fontWeight: 500, marginTop: 6 }}>Next available: <button onClick={() => { setSelectedDate(new Date(containerAvailability.nextAvailableDate!)); setSelectedTime(null); }} style={{ background: "none", border: "none", color: "var(--brand)", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", fontSize: 13, padding: 0 }}>{new Date(containerAvailability.nextAvailableDate!).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</button></span></>) : `No ${CONTAINER_SIZES.find(c => c.id === containerSize)?.label || "containers"} available for this date.`}{containerAvailability.alternativeSizes && containerAvailability.alternativeSizes.length > 0 && (<span style={{ display: "block", fontSize: 12, fontWeight: 500, marginTop: 4, color: "var(--muted)" }}>Or try a different size: {containerAvailability.alternativeSizes.map(s => <button key={s} onClick={() => { setContainerSize(String(s)); setStep(phases.indexOf("dumpster_size")); }} style={{ background: "none", border: "none", color: "var(--brand)", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", fontSize: 12, padding: 0 }}>{s}yd³</button>).reduce<React.ReactNode[]>((acc, el, i) => i === 0 ? [el] : [...acc, ", ", el], [])}</span>)}</>) : null}
                            </div>
                        )}
                    </div>
                )}

                {/* ── TERMS & SIGNATURE ───────────────────────────────────────── */}
                {currentPhase === "terms" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><FileText size={26} color="var(--brand)" /></div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>Terms & Signature</h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>Please review and sign below to proceed.</p>
                        </div>

                        {/* Simplified Terms */}
                        <div style={{ background: "var(--card)", borderRadius: 16, border: "1px solid var(--border, #E2E8F0)", padding: 24, marginBottom: 24 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                                <FileText size={18} color="var(--brand)" />
                                Key Terms
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                {[
                                    "Final pricing is confirmed on-site based on actual volume.",
                                    "24-hour cancellation notice required. Late cancellations may incur a trip fee.",
                                    "We cannot haul hazardous materials, asbestos, or medical waste.",
                                    `${config.companyName} is fully licensed and insured.`,
                                ].map((term, i) => (
                                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                        <Check size={16} style={{ color: "var(--brand)", flexShrink: 0, marginTop: 2 }} />
                                        <span style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>{term}</span>
                                    </div>
                                ))}
                            </div>
                            <a href="/legal" target="_blank" rel="noopener noreferrer"
                                style={{ display: "inline-block", marginTop: 16, fontSize: 13, color: "var(--brand)", fontWeight: 600, textDecoration: "underline" }}>
                                Read full Terms of Service & Privacy Policy →
                            </a>
                        </div>

                        {/* Checkbox */}
                        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 20px", borderRadius: 12, border: `2px solid ${termsAccepted ? "var(--brand)" : "var(--border, #E2E8F0)"}`, background: termsAccepted ? "#FFF7ED" : "var(--card)", cursor: "pointer", transition: "all 0.15s", marginBottom: 24 }}>
                            <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)}
                                style={{ width: 20, height: 20, accentColor: "var(--brand)", flexShrink: 0, marginTop: 1 }} />
                            <span style={{ fontSize: 14, color: "var(--foreground)", lineHeight: 1.5 }}>
                                I agree to the <a href="/legal" target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)", fontWeight: 600 }}>Terms of Service</a> and <a href="/legal" target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)", fontWeight: 600 }}>Privacy Policy</a>
                            </span>
                        </label>

                        {/* Signature Pad */}
                        <div style={{ background: "var(--card)", borderRadius: 16, border: "1px solid var(--border, #E2E8F0)", padding: 24 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)", display: "flex", alignItems: "center", gap: 8 }}>
                                    <PenTool size={18} color="var(--brand)" />
                                    Your Signature
                                </div>
                                {signatureDataUrl && (
                                    <button onClick={() => {
                                        const canvas = sigCanvasRef.current;
                                        if (canvas) {
                                            const ctx = canvas.getContext("2d");
                                            ctx?.clearRect(0, 0, canvas.width, canvas.height);
                                        }
                                        setSignatureDataUrl(null);
                                    }} style={{ border: "none", background: "none", fontSize: 13, color: "#DC2626", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontFamily: "inherit" }}>
                                        ✕ Clear
                                    </button>
                                )}
                            </div>
                            <canvas
                                ref={sigCanvasRef}
                                width={560}
                                height={180}
                                style={{
                                    width: "100%", height: 180, borderRadius: 12,
                                    border: `2px dashed ${signatureDataUrl ? "var(--brand)" : "var(--border, #CBD5E1)"}`,
                                    background: "#FAFAFA", cursor: "crosshair", touchAction: "none",
                                }}
                                onMouseDown={(e) => {
                                    sigDrawingRef.current = true;
                                    const canvas = sigCanvasRef.current;
                                    if (!canvas) return;
                                    const ctx = canvas.getContext("2d");
                                    if (!ctx) return;
                                    const rect = canvas.getBoundingClientRect();
                                    const scaleX = canvas.width / rect.width;
                                    const scaleY = canvas.height / rect.height;
                                    ctx.beginPath();
                                    ctx.moveTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
                                }}
                                onMouseMove={(e) => {
                                    if (!sigDrawingRef.current) return;
                                    const canvas = sigCanvasRef.current;
                                    if (!canvas) return;
                                    const ctx = canvas.getContext("2d");
                                    if (!ctx) return;
                                    const rect = canvas.getBoundingClientRect();
                                    const scaleX = canvas.width / rect.width;
                                    const scaleY = canvas.height / rect.height;
                                    ctx.lineWidth = 2.5;
                                    ctx.lineCap = "round";
                                    ctx.strokeStyle = "#1E293B";
                                    ctx.lineTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
                                    ctx.stroke();
                                }}
                                onMouseUp={() => {
                                    sigDrawingRef.current = false;
                                    if (sigCanvasRef.current) setSignatureDataUrl(sigCanvasRef.current.toDataURL("image/png"));
                                }}
                                onMouseLeave={() => {
                                    if (sigDrawingRef.current) {
                                        sigDrawingRef.current = false;
                                        if (sigCanvasRef.current) setSignatureDataUrl(sigCanvasRef.current.toDataURL("image/png"));
                                    }
                                }}
                                onTouchStart={(e) => {
                                    e.preventDefault();
                                    sigDrawingRef.current = true;
                                    const canvas = sigCanvasRef.current;
                                    if (!canvas) return;
                                    const ctx = canvas.getContext("2d");
                                    if (!ctx) return;
                                    const rect = canvas.getBoundingClientRect();
                                    const scaleX = canvas.width / rect.width;
                                    const scaleY = canvas.height / rect.height;
                                    const touch = e.touches[0];
                                    ctx.beginPath();
                                    ctx.moveTo((touch.clientX - rect.left) * scaleX, (touch.clientY - rect.top) * scaleY);
                                }}
                                onTouchMove={(e) => {
                                    e.preventDefault();
                                    if (!sigDrawingRef.current) return;
                                    const canvas = sigCanvasRef.current;
                                    if (!canvas) return;
                                    const ctx = canvas.getContext("2d");
                                    if (!ctx) return;
                                    const rect = canvas.getBoundingClientRect();
                                    const scaleX = canvas.width / rect.width;
                                    const scaleY = canvas.height / rect.height;
                                    const touch = e.touches[0];
                                    ctx.lineWidth = 2.5;
                                    ctx.lineCap = "round";
                                    ctx.strokeStyle = "#1E293B";
                                    ctx.lineTo((touch.clientX - rect.left) * scaleX, (touch.clientY - rect.top) * scaleY);
                                    ctx.stroke();
                                }}
                                onTouchEnd={(e) => {
                                    e.preventDefault();
                                    sigDrawingRef.current = false;
                                    if (sigCanvasRef.current) setSignatureDataUrl(sigCanvasRef.current.toDataURL("image/png"));
                                }}
                            />
                            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, textAlign: "center" }}>
                                Draw your signature above using your mouse or finger
                            </p>
                        </div>
                    </div>
                )}

                {/* ── QUOTE: Summary & Book ─────────────────────────────── */}
                {currentPhase === "quote" && (
                    <div>
                        <div style={{ textAlign: "center", marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, var(--brand), var(--brand-dark))", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                                <Check size={24} color="#fff" />
                            </div>
                            <h1 style={{ fontSize: 26, marginBottom: 8, color: "var(--foreground)" }}>
                                {serviceType === "dumpster" ? "Your Dumpster Rental Request" : serviceType === "both" ? "Your Service Summary" : "Your Junk Removal Estimate"}
                            </h1>
                            <p style={{ color: "var(--muted)", fontSize: 15 }}>
                                {serviceType === "dumpster" ? "We'll call to confirm availability." : "Review your details below. Final price confirmed on-site."}
                            </p>
                        </div>
                        <div style={{ background: "var(--card)", borderRadius: 20, border: "1px solid var(--border, #E2E8F0)", overflow: "hidden", marginBottom: 24, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
                            {/* Price banner — only show for junk removal */}
                            {(serviceType === "junk" || serviceType === "both") && (
                                <div style={{ background: "var(--hero-bg)", padding: "32px 24px", textAlign: "center", position: "relative", overflow: "hidden" }}>
                                    <div style={{ fontSize: 12, color: "var(--hero-muted, #94A3B8)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, position: "relative", zIndex: 1 }}>
                                        {serviceType === "both" ? "Junk Removal Estimate" : "Estimated Price Range"}
                                    </div>
                                    {promoResult?.valid && tierData ? (
                                        <>
                                            <div style={{ fontSize: 18, color: "var(--hero-muted, #94A3B8)", textDecoration: "line-through", position: "relative", zIndex: 1 }}>
                                                ${roundTo5(tierData.min + totalAdj)} – ${roundTo5(tierData.max + totalAdj)}
                                            </div>
                                            <div style={{ fontFamily: "var(--heading-font)", fontSize: 44, fontWeight: 800, color: "#10B981", letterSpacing: "-0.03em", position: "relative", zIndex: 1 }}>
                                                ${applyDiscount(roundTo5(tierData.min + totalAdj))} – ${applyDiscount(roundTo5(tierData.max + totalAdj))}
                                            </div>
                                        </>
                                    ) : (
                                        <div style={{ fontFamily: "var(--heading-font)", fontSize: 44, fontWeight: 800, color: "var(--hero-text)", letterSpacing: "-0.03em", position: "relative", zIndex: 1 }}>
                                            ${tierData ? roundTo5(tierData.min + totalAdj) : "—"} – ${tierData ? roundTo5(tierData.max + totalAdj) : "—"}
                                        </div>
                                    )}
                                    {totalAdj > 0 && <div style={{ fontSize: 12, color: "#FBBF24", marginTop: 6, position: "relative", zIndex: 1 }}>
                                        {priceAdj > 0 && <>+${priceAdj} {stairsSurcharge?.label?.toLowerCase() || "stairs"}</>}
                                        {priceAdj > 0 && distanceSurcharge > 0 && " · "}
                                        {distanceSurcharge > 0 && <>+${distanceSurcharge} distance surcharge</>}
                                    </div>}
                                </div>
                            )}
                            {/* Dumpster pending banner */}
                            {(serviceType === "dumpster" || serviceType === "both") && (() => {
                                const sizeNum = containerSize ? parseInt(containerSize) : 0;
                                const dTier = config.dumpsterPricing?.tiers.find(t => t.sizeCuYd === sizeNum);
                                const dHasPrice = dTier && (dTier.baseRate > 0 || (dTier.baseRateMin != null && dTier.baseRateMin > 0));
                                return (
                                    <div style={{ background: serviceType === "dumpster" ? "var(--hero-bg)" : "#FFFBEB", padding: serviceType === "dumpster" ? "32px 24px" : "16px 24px", textAlign: "center" }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, color: serviceType === "dumpster" ? "var(--hero-muted, #94A3B8)" : "#92400E" }}>
                                            {serviceType === "both" ? "Dumpster Rental" : "Dumpster Rental"}
                                        </div>
                                        {dHasPrice ? (
                                            <>
                                                <div style={{ fontFamily: "var(--heading-font)", fontSize: serviceType === "dumpster" ? 44 : 28, fontWeight: 800, color: serviceType === "dumpster" ? "var(--hero-text)" : "#92400E" }}>
                                                    {CONTAINER_SIZES.find(c => c.id === containerSize)?.label || ""} — {formatDumpsterPrice(dTier)}
                                                </div>
                                                <div style={{ fontSize: 12, color: serviceType === "dumpster" ? "var(--hero-muted, #94A3B8)" : "#92400E", marginTop: 4 }}>
                                                    {dTier.includedDays}-day rental · {dTier.weightAllowanceTons} tons included · ${dTier.overageRatePerTon}/ton overage{dTier.extendedDailyRate ? ` · $${dTier.extendedDailyRate}/day extended` : ""}
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div style={{ fontFamily: "var(--heading-font)", fontSize: serviceType === "dumpster" ? 28 : 20, fontWeight: 800, color: serviceType === "dumpster" ? "var(--hero-text)" : "#92400E" }}>
                                                    📋 Pending Confirmation
                                                </div>
                                                <div style={{ fontSize: 12, color: serviceType === "dumpster" ? "var(--hero-muted, #94A3B8)" : "#92400E", marginTop: 4 }}>We&apos;ll call within 2 hours to confirm availability</div>
                                            </>
                                        )}
                                    </div>
                                );
                            })()}
                            {/* Have a promo code? */}
                            {!promoResult?.valid && (
                                <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--border, #E2E8F0)" }}>
                                    {!promoInputOpen ? (
                                        <button onClick={() => setPromoInputOpen(true)} style={{ background: "none", border: "none", color: "var(--brand)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                                            🏷️ Have a promo code?
                                        </button>
                                    ) : (
                                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                            <input
                                                type="text" placeholder="Enter code" value={promoInputValue}
                                                onChange={(e) => setPromoInputValue(e.target.value.toUpperCase())}
                                                style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border, #E2E8F0)", fontSize: 14, fontFamily: "inherit", textTransform: "uppercase", letterSpacing: "0.05em" }}
                                                onKeyDown={(e) => { if (e.key === "Enter" && promoInputValue.trim()) { setPromoCode(promoInputValue.trim()); } }}
                                            />
                                            <button
                                                onClick={() => { if (promoInputValue.trim()) setPromoCode(promoInputValue.trim()); }}
                                                disabled={!promoInputValue.trim() || promoValidating}
                                                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--brand)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: promoInputValue.trim() ? "pointer" : "default", opacity: promoInputValue.trim() ? 1 : 0.5, fontFamily: "inherit" }}
                                            >
                                                {promoValidating ? "..." : "Apply"}
                                            </button>
                                            <button onClick={() => { setPromoInputOpen(false); setPromoInputValue(""); }} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", padding: "0 4px" }}>×</button>
                                        </div>
                                    )}
                                </div>
                            )}
                            <div style={{ padding: 24 }}>
                                {(() => {
                                    const rows: { label: string; value: string }[] = [
                                        { label: "Name", value: contact.name },
                                        { label: "Phone", value: contact.phone },
                                        { label: "Address", value: contact.address },
                                    ];
                                    if (serviceType === "junk" || serviceType === "both") {
                                        rows.push(
                                            { label: "Load Size", value: `${LOAD_TIERS[tierIndex].label} — ${LOAD_TIERS[tierIndex].title}` },
                                            ...(hasEdgeCase ? [{ label: "Conditions", value: EDGE_CASES.filter(ec => edgeCases[ec.id]).map(ec => ec.label).join(", ") }] : []),
                                            { label: "Truck Load", value: tierData?.label || "—" },
                                            { label: "Location", value: LOCATION_OPTIONS.find(l => l.id === location)?.label || "—" },
                                        );
                                    }
                                    if (serviceType === "dumpster" || serviceType === "both") {
                                        rows.push(
                                            { label: "Container", value: CONTAINER_SIZES.find(c => c.id === containerSize)?.label || "—" },
                                            { label: "Debris Type", value: DEBRIS_TYPES.find(d => d.id === debrisType)?.label || "—" },
                                            { label: "Duration", value: RENTAL_DURATIONS.find(r => r.id === rentalDuration)?.label || "—" },
                                        );
                                    }
                                    rows.push(
                                        { label: serviceType === "dumpster" ? "Delivery Date" : "Date", value: selectedDate?.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) || "—" },
                                        { label: "Time", value: dynamicSlots?.find(s => `${s.start}-${s.end}` === selectedTime)?.label || formatSlotTime(selectedTime) || "—" },
                                    );
                                    return rows.map((row, i) => (
                                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: i < rows.length - 1 ? "1px solid var(--border, #F1F5F9)" : "none" }}>
                                            <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 500 }}>{row.label}</span>
                                            <span style={{ fontSize: 14, color: "var(--foreground)", fontWeight: 600, textAlign: "right", maxWidth: "60%" }}>{row.value}</span>
                                        </div>
                                    ));
                                })()}
                            </div>
                        </div>

                        {/* ── Payment Preference ── */}
                        {hasStripe && (
                            <div style={{ marginBottom: 24 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                                    <CreditCard size={20} style={{ color: "var(--brand)" }} />
                                    <span style={{ fontWeight: 700, fontSize: 15, color: "var(--foreground)" }}>How would you like to pay?</span>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                                    {([
                                        { id: "card" as const, icon: "💳", label: "Pay Online", sub: "Save card on file" },
                                        { id: "on_site" as const, icon: "💵", label: "Pay On-Site", sub: "Cash or check" },
                                    ]).map((opt) => (
                                        <button key={opt.id} onClick={() => setPaymentPreference(opt.id)}
                                            style={{
                                                padding: "16px 14px", borderRadius: 14, cursor: "pointer", textAlign: "center", fontFamily: "inherit",
                                                border: paymentPreference === opt.id ? "2px solid var(--brand)" : "1.5px solid var(--border, #E2E8F0)",
                                                background: paymentPreference === opt.id ? "var(--hero-bg, #F8FAFC)" : "var(--card)",
                                                transition: "all 0.2s",
                                            }}>
                                            <div style={{ fontSize: 28, marginBottom: 6 }}>{opt.icon}</div>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--foreground)" }}>{opt.label}</div>
                                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{opt.sub}</div>
                                        </button>
                                    ))}
                                </div>

                                {/* ── Card on File (conditionally rendered — only in DOM when Pay Online selected) ── */}
                                {paymentPreference === "card" && (
                                    <div style={{ background: "var(--card)", borderRadius: 16, border: "1px solid var(--border, #E2E8F0)", padding: 24 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                                            <Lock size={14} style={{ color: "#16A34A" }} />
                                            <span style={{ fontSize: 13, color: "#16A34A", fontWeight: 600 }}>Secure & encrypted</span>
                                        </div>
                                        <div
                                            ref={cardMountRef}
                                            style={{
                                                padding: "14px 16px", borderRadius: 10, border: "1.5px solid var(--border, #E2E8F0)",
                                                background: "#FAFAFA", minHeight: 44, transition: "border-color 0.2s",
                                            }}
                                        />
                                        {cardError && (
                                            <p style={{ fontSize: 12, color: "#DC2626", marginTop: 8 }}>{cardError}</p>
                                        )}
                                    </div>
                                )}

                                {/* ── "Not charged" warning banner ── */}
                                <div style={{
                                    marginTop: 16, padding: "16px 20px", borderRadius: 14,
                                    background: "linear-gradient(135deg, #F0FDF4, #DCFCE7)", border: "1px solid #BBF7D0",
                                    display: "flex", alignItems: "flex-start", gap: 12,
                                }}>
                                    <LockKeyhole size={22} style={{ color: "#16A34A", flexShrink: 0, marginTop: 2 }} />
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: 15, color: "#166534", marginBottom: 4 }}>
                                            {paymentPreference === "card" ? "You will NOT be charged today" : "No payment required now"}
                                        </div>
                                        <div style={{ fontSize: 13, color: "#166534", lineHeight: 1.5 }}>
                                            {paymentPreference === "card"
                                                ? (serviceType === "dumpster"
                                                    ? "Your card is saved securely and will only be charged after the container is delivered to your location."
                                                    : "Your card is saved securely and will only be charged after your job is complete. The final price will be confirmed by your crew on-site.")
                                                : "You\u2019ll pay your crew directly when the job is complete. Cash, check, or card accepted on-site."}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {error && (
                            <div style={{ marginTop: 16, padding: "12px 18px", borderRadius: 12, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 14, color: "#DC2626" }}>
                                {error}
                            </div>
                        )}

                        <button onClick={handleSubmit} disabled={submitting || (hasStripe && (paymentPreference === null || (paymentPreference === "card" && !cardComplete)))}
                            style={{
                                width: "100%", marginTop: 24, padding: 18, borderRadius: "var(--btn-radius)", border: "none",
                                background: !submitting ? "linear-gradient(135deg, var(--brand), var(--brand-dark))" : "#E2E8F0",
                                color: !submitting ? "#fff" : "#94A3B8",
                                fontSize: 17, fontWeight: 700, cursor: !submitting ? "pointer" : "not-allowed",
                                fontFamily: "var(--heading-font)", boxShadow: !submitting ? "0 8px 24px rgba(249,115,22,0.3)" : "none",
                                transition: "all 0.2s",
                            }}>
                            {submitting ? "Submitting..." : serviceType === "dumpster" ? "Confirm Dumpster Rental →" : serviceType === "both" ? "Confirm & Book →" : "Confirm & Book My Pickup →"}
                        </button>
                        <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
                            {serviceType === "dumpster" ? "Your card will not be charged until delivery." : serviceType === "both" ? "Junk removal auto-booked. Dumpster delivery confirmed separately." : "No payment today — final price confirmed when our crew arrives."}
                        </p>
                    </div>
                )}
            </div>

            {/* ── Footer Nav (all steps except contact and quote) ────────────── */}
            {currentPhase !== "contact" && currentPhase !== "quote" && (
                <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "var(--card)", borderTop: "1px solid var(--border, #E2E8F0)", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 50 }}>
                    <button onClick={goBack} style={{ border: "none", background: "none", fontSize: 15, color: "var(--muted)", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit" }}>
                        <ChevronLeft size={18} /> Back
                    </button>
                    <button onClick={goNext} disabled={!canProceed()}
                        style={{
                            padding: "14px 44px", borderRadius: "var(--btn-radius)", border: "none", fontSize: 15, fontWeight: 700, cursor: canProceed() ? "pointer" : "not-allowed",
                            fontFamily: "inherit", transition: "all 0.2s",
                            background: canProceed() ? "var(--brand)" : "#E2E8F0",
                            color: canProceed() ? "#fff" : "#94A3B8",
                            boxShadow: canProceed() ? "0 4px 16px rgba(249,115,22,0.3)" : "none",
                        }}>
                        Continue
                    </button>
                </div>
            )}
        </div>
    );
}
