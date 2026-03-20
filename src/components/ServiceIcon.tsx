import {
    Trash2, Hammer, Armchair, Plug, Monitor, BedDouble, TreePine,
    HardHat, Home, Warehouse, Bath, Building2, Package, Container,
    KeyRound, Truck, ShieldCheck, MapPin, Phone, Ban, ClipboardList,
    CalendarDays, Smartphone, CircleCheckBig, BadgeDollarSign, Clock,
    Recycle, Mail, Sofa, ArrowUp, ArrowDown, Building,
    Ruler, Timer, Box,
    type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
    Trash2, Hammer, Armchair, Plug, Monitor, BedDouble, TreePine,
    HardHat, Home, Warehouse, Bath, Building2, Package, Container,
    KeyRound, Truck, ShieldCheck, MapPin, Phone, Ban, ClipboardList,
    CalendarDays, Smartphone, CircleCheckBig, BadgeDollarSign, Clock,
    Recycle, Mail, Sofa, ArrowUp, ArrowDown, Building,
    Ruler, Timer, Box,
};

export default function ServiceIcon({
    name,
    size = 24,
    color,
    style,
    className,
}: {
    name: string;
    size?: number;
    color?: string;
    style?: React.CSSProperties;
    className?: string;
}) {
    const Icon = ICON_MAP[name];
    if (!Icon) return <Truck size={size} color={color} style={style} className={className} />;
    return <Icon size={size} color={color} style={style} className={className} />;
}
