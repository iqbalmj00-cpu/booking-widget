import { volumeAsset } from "./volumeAssets";
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import styles from "./VolumeEstimator.module.css";
import picturedExamples from "./volume-example-dimensions.json";
import truckDimensions from "./volume-truck-dimensions.json";

type VolumeEstimatorLevel = { volumeId: string; label: string; title: string; desc: string; cuYd: number; fill: number; };
export type VolumeImageStyle = "blender" | "realistic";
type VolumeEstimatorProps = {
  levels: VolumeEstimatorLevel[]; value: number; onChange: (index: number) => void;
  brandColor: string; className?: string;
  /** Review presentation only; never submitted as booking metadata. */
  imageStyle?: VolumeImageStyle;
};
const ASSET_KEYS = ["few", "quarter", "half", "three_quarter", "full"];
const YARD_NOTE = "Loose outdoor pile shown. Cutting, settling and loading change the truck space needed; the crew confirms the amount on-site.";
const EXAMPLES = [
  { id: "furniture", label: "Furniture" },
  { id: "boxes", label: "Boxes & bags" },
  { id: "mixed", label: "Mixed household" },
  { id: "yard", label: "Yard debris" },
];
// Display only. A Ford 5.5-ft pickup bed holds 52.8 ft³ below its rails.
// Ford's 2020 F-150 brochure, p. 27; never used for booking calculations.
const PICKUP_BED_CUBIC_YARDS = 52.8 / 27;
type PileReference = { description: string };
function pileReference(assetKey: string, family: string) {
  return (picturedExamples as Record<string, Record<string, PileReference>>)[assetKey]?.[family];
}

function TruckDimensions() {
  // Keep projected SVG coordinates stable across server/browser math engines.
  const round = (number: number) => Number(number.toFixed(3));
  return <svg viewBox="0 0 1200 800" className={styles.dimensionGuides} aria-hidden="true" focusable="false">
    {truckDimensions.guides.map(guide => {
      const [x1, y1] = guide.start, [x2, y2] = guide.end;
      const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
      const nx = -dy / length, ny = dx / length;
      const vertical = guide.axis === "height";
      const angle = round(Math.atan2(dy, dx) * 180 / Math.PI);
      const labelX = round(vertical ? x1 + 20 : (x1 + x2) / 2 - nx * 30);
      const labelY = round(vertical ? (y1 + y2) / 2 : (y1 + y2) / 2 - ny * 30);
      return <g key={guide.axis} data-dimension={guide.axis}>
        <path className={styles.dimensionExtension} vectorEffect="non-scaling-stroke" d={`M ${guide.anchors[0][0]} ${guide.anchors[0][1]} L ${x1} ${y1} M ${guide.anchors[1][0]} ${guide.anchors[1][1]} L ${x2} ${y2}`} />
        <path className={styles.dimensionRule} vectorEffect="non-scaling-stroke" d={`M ${x1} ${y1} L ${x2} ${y2} M ${round(x1 - nx * 10)} ${round(y1 - ny * 10)} L ${round(x1 + nx * 10)} ${round(y1 + ny * 10)} M ${round(x2 - nx * 10)} ${round(y2 - ny * 10)} L ${round(x2 + nx * 10)} ${round(y2 + ny * 10)}`} />
        <text x={labelX} y={labelY} transform={`rotate(${vertical ? 0 : angle} ${labelX} ${labelY})`} textAnchor={vertical ? "start" : "middle"} dominantBaseline="central" className={styles.dimensionText}>{guide.feet} ft</text>
      </g>;
    })}
  </svg>;
}

function TruckVisual({ assetKey, loadLabel }: { assetKey: string; loadLabel: string }) {
  return <div className={styles.truckDrawing}>
    <img className={styles.truckImage} src={volumeAsset("blender", `${assetKey}-truck-dimensioned`)}
      width={1200} height={800} sizes="(max-width: 600px) 90vw, (max-width: 1000px) 65vw, 700px"
      alt={`Illustrated reference cargo bed, 15 feet long, 6 feet wide and 4.5 feet high; ${loadLabel.toLowerCase()} highlighted in orange`} loading="eager" />
    <TruckDimensions />
  </div>;
}

export function VolumeEstimator({ levels, value, onChange, brandColor, className, imageStyle = "realistic" }: VolumeEstimatorProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [expandedExample, setExpandedExample] = useState(EXAMPLES[0]);
  const radios = useRef<Array<HTMLButtonElement | null>>([]);
  const visibleLevels = levels;
  const maxIndex = visibleLevels.length - 1;
  const selectedIndex = Math.max(0, Math.min(maxIndex, Number.isFinite(value) ? Math.trunc(value) : 1));
  const selectedLevel = visibleLevels[selectedIndex];
  if (!selectedLevel) return null;
  const isMultiLoad = selectedLevel.volumeId === "multi";
  const assetKey = isMultiLoad ? "full" : ASSET_KEYS.includes(selectedLevel.volumeId) ? selectedLevel.volumeId : "quarter";
  const color = /^#[0-9a-f]{6}$/i.test(brandColor.trim()) ? brandColor.trim() : "#d8662d";
  const full = selectedLevel.fill >= 1;
  const loadLabel = isMultiLoad ? "1+ Load" : full ? "Full truck" : `${selectedLevel.label.replace(/\s*load/i, "")} truck`;
  const picturedLoadLabel = isMultiLoad ? "Full truck reference" : loadLabel;
  const pickupBeds = Math.max(1, Math.round(selectedLevel.cuYd / PICKUP_BED_CUBIC_YARDS));
  const comparison = isMultiLoad ? "More than one full truck of junk." : `Illustrated amount: about ${pickupBeds} pickup bed${pickupBeds === 1 ? "" : "s"}, filled level with the sides.`;
  const expandedTruck = expandedExample.id === "truck";
  const expandedDescription = expandedTruck ? "Illustrated reference bed: 15 ft × 6 ft × 4.5 ft = 15 cubic yards." : pileReference(assetKey, expandedExample.id)?.description;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    switch (event.key) {
      case "ArrowRight": case "ArrowDown": next = (selectedIndex + 1) % visibleLevels.length; break;
      case "ArrowLeft": case "ArrowUp": next = (selectedIndex - 1 + visibleLevels.length) % visibleLevels.length; break;
      case "Home": next = 0; break;
      case "End": next = maxIndex; break;
      default: return;
    }
    event.preventDefault();
    onChange(next);
    radios.current[next]?.focus();
  };
  return (
    <section className={["syj-volume-estimator", styles.root, className].filter(Boolean).join(" ")} style={{ "--ve-brand": color } as CSSProperties} aria-label="Visual load size guide">
      <div className={styles.selectorHead}>
        <span className={styles.eyebrow}>Choose your closest load</span><span className={styles.helper}>You can adjust this</span>
      </div>
      <div className={styles.radioRow} role="radiogroup" aria-label="Truck load size" aria-describedby={`${id}-guide`} onKeyDown={onKeyDown}>
        {visibleLevels.map((level, index) => (
          <button key={level.volumeId} ref={node => { radios.current[index] = node; }} type="button" role="radio"
            aria-label={level.volumeId === "multi" ? "1+ Load — more than one truck" : `${level.fill >= 1 ? "Full" : level.label.replace(/\s*load/i, "")} truck load`} aria-checked={selectedIndex === index}
            tabIndex={selectedIndex === index ? 0 : -1} className={styles.radio} onClick={() => onChange(index)}>
            <span className={[styles.miniBed, level.volumeId === "multi" ? styles.miniBedPlus : ""].join(" ")} aria-hidden="true"><span style={{ width: `${Math.min(1, level.fill) * 100}%` }} /></span>
            <strong>{level.volumeId === "multi" ? "1+" : level.fill >= 1 ? "Full" : level.label.replace(/\s*load/i, "")}</strong><span className={styles.radioCaption}>{level.volumeId === "multi" ? "Load" : "truck"}</span>
          </button>
        ))}
      </div>
      <div className={styles.panels}>
        <article className={styles.truckPanel}>
          <div className={styles.truckHeading}>
            <p className={styles.eyebrow}>{isMultiLoad ? "More than one truck" : "Illustrated truck reference"}</p><h2 className={styles.title}>{loadLabel}</h2>
          </div>
          <button type="button" className={styles.truckVisual} aria-label="View larger truck capacity diagram" onClick={() => { setExpandedExample({ id: "truck", label: "Truck capacity" }); dialog.current?.showModal(); }}>
            <TruckVisual assetKey={assetKey} loadLabel={isMultiLoad ? "Full truck" : loadLabel} />
            <span className={styles.expandIcon} aria-hidden="true">↗</span>
          </button>
          <div className={styles.tierDetails}>
            <p className={styles.tierComparison}>{comparison}</p>
            <p className={styles.volumeAmount}>{isMultiLoad ? "More than one provider truckload · confirmed on-site" : <>Reference: {selectedLevel.cuYd.toLocaleString("en-US", { maximumFractionDigits: 3 })} cubic yards shown in orange</>}</p>
          </div>
          <p className={styles.fullBedNote}>{isMultiLoad ? "One full truck shown for comparison" : "Illustrated full bed"}: 15 × 6 × 4.5 ft = 15 cubic yards</p>
          {isMultiLoad ? <p className={`${styles.capacity} ${styles.multiEstimate}`}>On-site estimate<span>We’ll confirm the total load and price before any work begins.</span></p> : <div className={styles.capacity} aria-hidden="true">
            <div className={styles.capacityTrack}><span style={{ width: `${selectedLevel.fill * 100}%` }} /></div>
            <div className={styles.capacityLabels}><span>Empty</span><strong>{selectedLevel.fill * 100}%</strong><span>Full</span></div>
          </div>}
        </article>
        <div className={styles.examplesPanel}>
          <div className={styles.examplesHeading}>
            <h2 className={styles.examplesTitle}>{isMultiLoad ? "Compare with one full load" : "What that can look like"}</h2>
            <p id={`${id}-guide`} className={styles.copy}>{isMultiLoad ? "Each picture is a separate comparison reference. Choose 1+ Load if your total junk will not fit in one full truck." : "Each picture is a separate illustrative comparison. Packing and materials affect the truck space needed."}</p>
          </div>
          <div className={styles.examples}>
            {EXAMPLES.map((example, index) => (
              <figure key={example.id} className={styles.example}>
                <button type="button" className={styles.exampleVisual} aria-label={`View larger ${example.label.toLowerCase()} example`} aria-describedby={`${id}-${example.id}-caption`} onClick={() => { setExpandedExample(example); dialog.current?.showModal(); }}>
                  <span className={styles.exampleNumber} aria-hidden="true">0{index + 1}</span>
                  <img src={volumeAsset(imageStyle, `${assetKey}-${example.id}-raptor`)}
                    width={1200} height={800} sizes="(max-width: 600px) 90vw, (max-width: 1000px) 45vw, 420px"
                    alt={`${example.label}: ${pileReference(assetKey, example.id)?.description} F-150 pickup shown for scale.`}
                    className={styles.exampleImage} loading="eager" />
                  <span className={styles.expandIcon} aria-hidden="true">↗</span>
                </button>
                <figcaption id={`${id}-${example.id}-caption`} className={styles.caption}><strong>{example.label}</strong><span>{pileReference(assetKey, example.id)?.description}</span>{example.id === "yard" && <span className={styles.yardNote}>{YARD_NOTE}</span>}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.guidance}><span className={styles.guidanceIcon} aria-hidden="true">↔</span>
        {isMultiLoad ? <p><strong>No need to count every item.</strong> Choose 1+ Load for the overall amount, then continue with your booking. We’ll assess the total on-site.</p> : <p><strong>Compare the overall amount.</strong> Your items can be different. Try the next size up or down to find the closest fit.</p>}
      </div>
      <p className={styles.footnote}>Pictures use a 15-cubic-yard reference truck. Your provider’s truck capacity may differ. Piles vary with packing; the pickup is shown for scale. Your provider confirms actual capacity, final load and price on-site.</p>
      <dialog ref={dialog} className={styles.dialog} aria-label={`${expandedExample.label} load example`} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
        <div className={styles.dialogHead}><div><strong>{expandedExample.label} · {picturedLoadLabel}</strong><p>{expandedDescription}</p><p>{isMultiLoad ? "One full load shown for comparison; your 1+ Load total is confirmed on-site." : expandedTruck ? `Reference picture: ${selectedLevel.cuYd} cubic yards highlighted in orange` : "Illustrative comparison · F-150 shown for scale"}</p>{expandedExample.id === "yard" && <p className={styles.yardNote}>{YARD_NOTE}</p>}</div><button type="button" onClick={() => dialog.current?.close()} aria-label="Close enlarged example">Close ×</button></div>
        {expandedTruck ? <TruckVisual assetKey={assetKey} loadLabel={isMultiLoad ? "Full truck" : loadLabel} /> :
          <img src={volumeAsset(imageStyle, `${assetKey}-${expandedExample.id}-raptor`)} width={1200} height={800} sizes="90vw" alt={`${expandedExample.label}: ${expandedDescription}`} className={styles.enlargedImage} />}

      </dialog>
      <span className={styles.srOnly} role="status">{isMultiLoad ? "Selected 1+ Load, more than one truck. On-site estimate. Four full-load examples shown for comparison." : `Selected ${loadLabel.toLowerCase()}. Four reference examples updated.`}</span>
    </section>
  );
}
