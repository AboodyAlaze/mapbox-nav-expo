import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';

/**
 * Navigation UI drawn in React Native, so it looks IDENTICAL on iOS and Android
 * (same design as Mapbox's own navigation UI: dark-blue banner, MAX sign, street pill, bottom bar).
 * Feed it with the data of <MapboxNavigationView onProgress={…} />.
 */

export const NAV_COLORS = {
  banner: '#26405D',
  bannerHandle: '#4B6586',
  pill: '#5B9BE0',
  green: '#6FCF3C',
  white: '#FFFFFF',
  muted: '#C7D2E0',
};

// ------------------------------------------------------------------ formatting
export type UnitSystem = 'metric' | 'imperial';

const nf = (digits: number) => {
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits });
  } catch {
    return { format: (n: number) => n.toFixed(digits) } as Intl.NumberFormat;
  }
};

/** → { value: '800', unit: 'm' } | { value: '1,4', unit: 'km' } */
export function formatDistance(meters: number, units: UnitSystem = 'metric') {
  if (units === 'imperial') {
    const feet = meters * 3.28084;
    if (feet < 528) return { value: String(Math.max(10, Math.round(feet / 10) * 10)), unit: 'ft' };
    return { value: nf(1).format(meters / 1609.344), unit: 'mi' };
  }
  if (meters < 1000) return { value: String(Math.max(10, Math.round(meters / 10) * 10)), unit: 'm' };
  return { value: nf(1).format(meters / 1000), unit: 'km' };
}

export function formatDuration(seconds: number) {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return { big: String(mins), small: 'min' };
  return { big: `${Math.floor(mins / 60)}`, small: `h ${mins % 60} min` };
}

export const formatClock = (secondsFromNow: number) =>
  new Date(Date.now() + secondsFromNow * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ------------------------------------------------------------------ maneuver icon
type IconKind =
  | 'straight'
  | 'left'
  | 'right'
  | 'slight-left'
  | 'slight-right'
  | 'sharp-left'
  | 'sharp-right'
  | 'uturn'
  | 'roundabout'
  | 'arrive';

function resolveKind(type?: string, modifier?: string): IconKind {
  if (type === 'arrive') return 'arrive';
  if (type && /roundabout|rotary/.test(type)) return 'roundabout';
  switch (modifier) {
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'slight left':
      return 'slight-left';
    case 'slight right':
      return 'slight-right';
    case 'sharp left':
      return 'sharp-left';
    case 'sharp right':
      return 'sharp-right';
    case 'uturn':
      return 'uturn';
    default:
      return 'straight';
  }
}

const SW = 13;

function TurnRight({ color }: { color: string }) {
  return (
    <>
      <Path d="M30 94 V62 Q30 42 50 42 H62" stroke={color} strokeWidth={SW} fill="none" />
      <Path d="M60 22 L92 42 L60 62 Z" fill={color} />
    </>
  );
}

function SharpRight({ color }: { color: string }) {
  return (
    <>
      <Path d="M28 94 V46 Q28 30 44 30 L64 50" stroke={color} strokeWidth={SW} fill="none" strokeLinejoin="round" />
      <Path d="M84 70 L76.9 34.7 L48.7 62.9 Z" fill={color} />
    </>
  );
}

function Slight({ color }: { color: string }) {
  return (
    <>
      <Path d="M50 94 V50" stroke={color} strokeWidth={SW} fill="none" />
      <Path d="M30 54 L50 22 L70 54 Z" fill={color} />
    </>
  );
}

export function ManeuverIcon({
  type,
  modifier,
  size = 48,
  color = NAV_COLORS.white,
  holeColor = NAV_COLORS.banner,
}: {
  type?: string;
  modifier?: string;
  size?: number;
  color?: string;
  holeColor?: string;
}) {
  const kind = resolveKind(type, modifier);
  let content: React.ReactNode;

  switch (kind) {
    case 'right':
      content = <TurnRight color={color} />;
      break;
    case 'left':
      content = (
        <G transform="translate(100 0) scale(-1 1)">
          <TurnRight color={color} />
        </G>
      );
      break;
    case 'sharp-right':
      content = <SharpRight color={color} />;
      break;
    case 'sharp-left':
      content = (
        <G transform="translate(100 0) scale(-1 1)">
          <SharpRight color={color} />
        </G>
      );
      break;
    case 'slight-right':
      content = (
        <G rotation={35} originX={50} originY={94}>
          <Slight color={color} />
        </G>
      );
      break;
    case 'slight-left':
      content = (
        <G rotation={-35} originX={50} originY={94}>
          <Slight color={color} />
        </G>
      );
      break;
    case 'uturn':
      content = (
        <>
          <Path d="M66 94 V44 Q66 14 40 14 Q16 14 16 44 V56" stroke={color} strokeWidth={SW} fill="none" />
          <Path d="M0 54 L32 54 L16 84 Z" fill={color} />
        </>
      );
      break;
    case 'roundabout':
      content = (
        <>
          <Circle cx={50} cy={58} r={22} stroke={color} strokeWidth={SW - 2} fill="none" />
          <Path d="M50 98 V80" stroke={color} strokeWidth={SW - 2} />
          <Path d="M50 36 V26" stroke={color} strokeWidth={SW - 2} />
          <Path d="M34 28 L50 4 L66 28 Z" fill={color} />
        </>
      );
      break;
    case 'arrive':
      content = (
        <>
          <Path d="M50 94 C50 94 20 60 20 38 A30 30 0 0 1 80 38 C80 60 50 94 50 94 Z" fill={color} />
          <Circle cx={50} cy={38} r={11} fill={holeColor} />
        </>
      );
      break;
    default:
      content = (
        <>
          <Path d="M50 94 V38" stroke={color} strokeWidth={SW} fill="none" />
          <Path d="M28 42 L50 8 L72 42 Z" fill={color} />
        </>
      );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {content}
    </Svg>
  );
}

// ------------------------------------------------------------------ small icons
export function CloseIcon({ size = 26, color = NAV_COLORS.white }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1={5} y1={5} x2={19} y2={19} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Line x1={19} y1={5} x2={5} y2={19} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

export function VolumeIcon({ muted, size = 24, color = NAV_COLORS.white }: { muted?: boolean; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 9.5 H7 L12 5 V19 L7 14.5 H3 Z" fill={color} />
      {muted ? (
        <>
          <Line x1={15.5} y1={9} x2={21} y2={15} stroke={color} strokeWidth={2} strokeLinecap="round" />
          <Line x1={21} y1={9} x2={15.5} y2={15} stroke={color} strokeWidth={2} strokeLinecap="round" />
        </>
      ) : (
        <>
          <Path d="M15.5 8.5 Q18 12 15.5 15.5" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
          <Path d="M18 6 Q22.5 12 18 18" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}

export function RouteIcon({ size = 24, color = NAV_COLORS.white }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 8 H17" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M14 4.5 L18.5 8 L14 11.5" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M20 16 H7" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M10 12.5 L5.5 16 L10 19.5" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function LocateIcon({ size = 24, color = NAV_COLORS.white }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={6} stroke={color} strokeWidth={2} fill="none" />
      <Circle cx={12} cy={12} r={2.2} fill={color} />
      <Line x1={12} y1={1.5} x2={12} y2={5} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Line x1={12} y1={19} x2={12} y2={22.5} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Line x1={1.5} y1={12} x2={5} y2={12} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Line x1={19} y1={12} x2={22.5} y2={12} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

// ------------------------------------------------------------------ building blocks
/** Dark round map button (like the ones on the right side of Mapbox's navigation screen). */
export function MapRoundButton({ children, onPress, light }: { children: React.ReactNode; onPress?: () => void; light?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.roundButton, light && { backgroundColor: '#FFFFFF' }]}
      hitSlop={6}>
      {children}
    </Pressable>
  );
}

/** Top banner: maneuver icon + distance + road name. */
export function NavigationTopBanner({
  instruction,
  secondaryInstruction,
  distance,
  maneuverType,
  maneuverModifier,
  units = 'metric',
  topInset = 0,
}: {
  instruction?: string;
  secondaryInstruction?: string;
  distance: number;
  maneuverType?: string;
  maneuverModifier?: string;
  units?: UnitSystem;
  topInset?: number;
}) {
  const d = formatDistance(distance, units);
  return (
    <View style={[styles.banner, { paddingTop: topInset + 10 }]}>
      <View style={styles.bannerRow}>
        <View style={styles.bannerIconCol}>
          <ManeuverIcon type={maneuverType} modifier={maneuverModifier} size={46} />
          <Text style={styles.bannerDistance}>
            {d.value}
            <Text style={styles.bannerDistanceUnit}>{d.unit}</Text>
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle} numberOfLines={2}>
            {instruction ?? ''}
          </Text>
          {secondaryInstruction ? (
            <Text style={styles.bannerSub} numberOfLines={1}>
              {secondaryInstruction}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.bannerHandle} />
    </View>
  );
}

/** US-style "MAX 35" speed-limit sign (same on both platforms). */
export function SpeedLimitSign({ limit }: { limit: number }) {
  return (
    <View style={styles.maxSign}>
      <Text style={styles.maxLabel}>MAX</Text>
      <Text style={styles.maxValue}>{Math.round(limit)}</Text>
    </View>
  );
}

/** Light-blue pill with the current road name. */
export function RoadNamePill({ name }: { name: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

/** Bottom bar: remaining time (green), distance, clock ETA and a close (X) button. */
export function NavigationBottomBar({
  durationRemaining,
  distanceRemaining,
  units = 'metric',
  bottomInset = 0,
  onClose,
}: {
  durationRemaining: number;
  distanceRemaining: number;
  units?: UnitSystem;
  bottomInset?: number;
  onClose?: () => void;
}) {
  const t = formatDuration(durationRemaining);
  const d = formatDistance(distanceRemaining, units);
  return (
    <View style={[styles.bottomBar, { paddingBottom: bottomInset + 12 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.bottomTime}>
          {t.big} <Text style={styles.bottomTimeUnit}>{t.small}</Text>
        </Text>
        <Text style={styles.bottomDistance}>
          {d.value} {d.unit}
        </Text>
      </View>
      <Text style={styles.bottomEta}>{formatClock(durationRemaining)}</Text>
      <View style={styles.bottomDivider} />
      <Pressable onPress={onClose} hitSlop={12} style={styles.bottomClose}>
        <CloseIcon />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  roundButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: NAV_COLORS.banner,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },

  banner: {
    backgroundColor: NAV_COLORS.banner,
    paddingHorizontal: 18,
    paddingBottom: 6,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  bannerIconCol: { alignItems: 'flex-start', minWidth: 76 },
  bannerDistance: { color: NAV_COLORS.white, fontSize: 24, fontWeight: '700', marginTop: 2 },
  bannerDistanceUnit: { fontSize: 16, fontWeight: '600' },
  bannerTitle: { color: NAV_COLORS.white, fontSize: 30, fontWeight: '700', lineHeight: 36 },
  bannerSub: { color: NAV_COLORS.muted, fontSize: 16, marginTop: 2 },
  bannerHandle: {
    alignSelf: 'center',
    width: 34,
    height: 5,
    borderRadius: 3,
    backgroundColor: NAV_COLORS.bannerHandle,
    marginTop: 8,
  },

  maxSign: {
    width: 58,
    paddingVertical: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: '#111',
    alignItems: 'center',
    elevation: 6,
  },
  maxLabel: { fontSize: 13, fontWeight: '800', color: '#111', letterSpacing: 0.5 },
  maxValue: { fontSize: 32, fontWeight: '800', color: '#111', lineHeight: 36 },

  pill: {
    alignSelf: 'center',
    maxWidth: '86%',
    backgroundColor: NAV_COLORS.pill,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 7,
    elevation: 6,
  },
  pillText: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },

  bottomBar: {
    backgroundColor: NAV_COLORS.banner,
    paddingHorizontal: 22,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 12,
  },
  bottomTime: { color: NAV_COLORS.green, fontSize: 30, fontWeight: '700' },
  bottomTimeUnit: { fontSize: 24, fontWeight: '600' },
  bottomDistance: { color: NAV_COLORS.white, fontSize: 17, marginTop: 1 },
  bottomEta: { color: NAV_COLORS.muted, fontSize: 20, marginRight: 18 },
  bottomDivider: { width: 1, alignSelf: 'stretch', backgroundColor: NAV_COLORS.bannerHandle, marginVertical: 2 },
  bottomClose: { paddingLeft: 22, paddingRight: 4, justifyContent: 'center' },
});
