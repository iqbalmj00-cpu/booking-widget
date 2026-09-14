import asset0 from "../assets/booking-volume/few-furniture-raptor.webp";
import asset1 from "../assets/booking-volume/few-boxes-raptor.webp";
import asset2 from "../assets/booking-volume/few-mixed-raptor.webp";
import asset3 from "../assets/booking-volume/few-yard-raptor.webp";
import asset4 from "../assets/booking-volume/few-truck-dimensioned.webp";
import asset5 from "../assets/booking-volume/quarter-furniture-raptor.webp";
import asset6 from "../assets/booking-volume/quarter-boxes-raptor.webp";
import asset7 from "../assets/booking-volume/quarter-mixed-raptor.webp";
import asset8 from "../assets/booking-volume/quarter-yard-raptor.webp";
import asset9 from "../assets/booking-volume/quarter-truck-dimensioned.webp";
import asset10 from "../assets/booking-volume/half-furniture-raptor.webp";
import asset11 from "../assets/booking-volume/half-boxes-raptor.webp";
import asset12 from "../assets/booking-volume/half-mixed-raptor.webp";
import asset13 from "../assets/booking-volume/half-yard-raptor.webp";
import asset14 from "../assets/booking-volume/half-truck-dimensioned.webp";
import asset15 from "../assets/booking-volume/three_quarter-furniture-raptor.webp";
import asset16 from "../assets/booking-volume/three_quarter-boxes-raptor.webp";
import asset17 from "../assets/booking-volume/three_quarter-mixed-raptor.webp";
import asset18 from "../assets/booking-volume/three_quarter-yard-raptor.webp";
import asset19 from "../assets/booking-volume/three_quarter-truck-dimensioned.webp";
import asset20 from "../assets/booking-volume/full-furniture-raptor.webp";
import asset21 from "../assets/booking-volume/full-boxes-raptor.webp";
import asset22 from "../assets/booking-volume/full-mixed-raptor.webp";
import asset23 from "../assets/booking-volume/full-yard-raptor.webp";
import asset24 from "../assets/booking-volume/full-truck-dimensioned.webp";

const assets: Record<string, string> = {
  "realistic/few-furniture-raptor": asset0,
  "realistic/few-boxes-raptor": asset1,
  "realistic/few-mixed-raptor": asset2,
  "realistic/few-yard-raptor": asset3,
  "blender/few-truck-dimensioned": asset4,
  "realistic/quarter-furniture-raptor": asset5,
  "realistic/quarter-boxes-raptor": asset6,
  "realistic/quarter-mixed-raptor": asset7,
  "realistic/quarter-yard-raptor": asset8,
  "blender/quarter-truck-dimensioned": asset9,
  "realistic/half-furniture-raptor": asset10,
  "realistic/half-boxes-raptor": asset11,
  "realistic/half-mixed-raptor": asset12,
  "realistic/half-yard-raptor": asset13,
  "blender/half-truck-dimensioned": asset14,
  "realistic/three_quarter-furniture-raptor": asset15,
  "realistic/three_quarter-boxes-raptor": asset16,
  "realistic/three_quarter-mixed-raptor": asset17,
  "realistic/three_quarter-yard-raptor": asset18,
  "blender/three_quarter-truck-dimensioned": asset19,
  "realistic/full-furniture-raptor": asset20,
  "realistic/full-boxes-raptor": asset21,
  "realistic/full-mixed-raptor": asset22,
  "realistic/full-yard-raptor": asset23,
  "blender/full-truck-dimensioned": asset24,
};

// Vite library builds embed these imports; no dependency on the host origin.
export function volumeAsset(style: string, stem: string): string {
  const url = assets[`${style}/${stem}`];
  if (!url) throw new Error(`Missing volume reference: ${style}/${stem}`);
  return url;
}
