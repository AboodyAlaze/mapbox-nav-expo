import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import {
  Camera,
  LocateIcon,
  MapRoundButton,
  MapboxNavigationView,
  Marker,
  NAV_COLORS,
  NavigationBottomBar,
  NavigationTopBanner,
  RoadNamePill,
  RouteIcon,
  SpeedLimitSign,
  VolumeIcon,
  isNativeModuleAvailable,
  type CameraAnimationMode,
  type CameraMode,
  type MapStyleName,
  type MapboxNavigationViewRef,
  type ProgressEvent,
  type ThemeMode,
  type VehicleType,
} from './modules/mapbox-navigation';

type Coord = { latitude: number; longitude: number };
type Store = Coord & { id: string; name: string; category: string };

// ---------------------------------------------------------------- helpers
const fmtDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

const haversine = (a: Coord, b: Coord) => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/** Demo stores around a point – replace with your own data (item.Location.latitude / longitude…). */
const makeDemoStores = (base: Coord): Store[] =>
  [
    ['Fresh Market', 'Grocery', 0.004, 0.004],
    ['Coffee Corner', 'Cafe', -0.003, 0.005],
    ['City Pharmacy', 'Pharmacy', 0.005, -0.004],
    ['Burger House', 'Restaurant', -0.005, -0.003],
    ['Tech Shop', 'Electronics', 0.001, 0.008],
  ].map(([name, category, dLat, dLng], i) => ({
    id: `store-${i}`,
    name: name as string,
    category: category as string,
    latitude: base.latitude + (dLat as number),
    longitude: base.longitude + (dLng as number),
  }));

const MAP_STYLES: { key: MapStyleName; label: string }[] = [
  { key: 'streets', label: 'Streets' },
  { key: 'navigation', label: 'Navigation' },
  { key: 'outdoors', label: 'Outdoors' },
  { key: 'satellite', label: 'Satellite' },
];
const THEMES: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];
const VEHICLES: { key: VehicleType; label: string }[] = [
  { key: 'car', label: '🚗 Car' },
  { key: 'bike', label: '🏍️ Motorbike' },
  { key: 'none', label: 'Arrow' },
];

// ---------------------------------------------------------------- app
export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const insets = useSafeAreaInsets();
  const navRef = useRef<MapboxNavigationViewRef>(null);
  const lastLocation = useRef<Coord | null>(null);
  const seeded = useRef(false);
  const systemScheme = useColorScheme();

  const [permissionState, setPermissionState] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [ready, setReady] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [routing, setRouting] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('idle');
  const [offRoute, setOffRoute] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stores, setStores] = useState<Store[]>([]);
  const [selected, setSelected] = useState<Store | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);

  const [mapStyle, setMapStyle] = useState<MapStyleName>('streets');
  const [theme, setTheme] = useState<ThemeMode>('system');
  const [vehicle, setVehicle] = useState<VehicleType>('car');
  const [vehicleScale, setVehicleScale] = useState(8);
  const [vehicleRotation, setVehicleRotation] = useState(0);
  const [simulate, setSimulate] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showsUserLocation, setShowsUserLocation] = useState(true);
  const [zoomEnabled, setZoomEnabled] = useState(true);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [rotateEnabled, setRotateEnabled] = useState(true);
  const [pitchEnabled, setPitchEnabled] = useState(true);
  const [jsCamera, setJsCamera] = useState(false);
  const [cam, setCam] = useState<{
    zoom: number;
    pitch: number;
    heading: number;
    mode: CameraAnimationMode;
    duration: number;
    center?: [number, number];
  }>({ zoom: 13, pitch: 0, heading: 0, mode: 'flyTo', duration: 1000 });

  const dark = theme === 'dark' || (theme === 'system' && systemScheme === 'dark');
  const c = useMemo(() => palette(dark), [dark]);

  // ------------------------------------------------------------ permissions
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as any);
      }
      setPermissionState(status === 'granted' ? 'granted' : 'denied');
    })();
  }, []);

  // ------------------------------------------------------------ actions
  const onMarkerPress = useCallback(
    (store: Store) => {
      if (navigating) return;
      setSettingsOpen(false);
      setError(null);
      setArrived(false);
      setSelected(store); // ← the marker event: opens the sheet with a "Directions" button
    },
    [navigating]
  );

  const closeSheet = useCallback(() => {
    setSelected(null);
    setRouting(false);
    setError(null);
  }, []);

  const directions = useCallback(async () => {
    setError(null);
    setRouting(true);
    await navRef.current?.startNavigation(); // requests the route, then starts guidance
  }, []);

  const stop = useCallback(async () => {
    await navRef.current?.stopNavigation();
    setNavigating(false);
    setProgress(null);
    setOffRoute(false);
    setSelected(null);
    setRouting(false);
  }, []);

  const finishArrival = useCallback(async () => {
    await navRef.current?.stopNavigation();
    setArrived(false);
    setSelected(null);
  }, []);

  const flyToMe = useCallback(() => {
    const me = lastLocation.current;
    if (!me) return;
    setCam((k) => ({ ...k, center: [me.longitude + Math.random() * 1e-7, me.latitude] }));
  }, []);

  const toggleStores = useCallback((on: boolean) => {
    if (!on) return setStores([]);
    setStores(makeDemoStores(lastLocation.current ?? { latitude: 36.1912, longitude: 44.0092 }));
  }, []);

  const sheet: 'arrived' | 'place' | 'settings' | null = navigating
    ? null
    : arrived
      ? 'arrived'
      : selected
        ? 'place'
        : settingsOpen
          ? 'settings'
          : null;

  // ------------------------------------------------------------ render guards
  if (!isNativeModuleAvailable) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={[styles.title, { color: c.text }]}>Development build required</Text>
        <Text style={[styles.body, { color: c.sub }]}>
          This app uses a native module, so it cannot run in Expo Go.{'\n\n'}Run:{'\n'}npx expo run:android{'\n'}
          npx expo run:ios
        </Text>
      </View>
    );
  }
  if (permissionState === 'checking') {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator />
      </View>
    );
  }
  if (permissionState === 'denied') {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={[styles.title, { color: c.text }]}>Location permission needed</Text>
        <Text style={[styles.body, { color: c.sub }]}>
          Please allow location access in the system settings and restart the app.
        </Text>
      </View>
    );
  }

  const distanceToSelected =
    selected && lastLocation.current ? fmtDistance(haversine(lastLocation.current, selected)) : undefined;

  const bannerHeightGuess = insets.top + 150; // used to place the MAX sign under the banner

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <StatusBar style={navigating ? 'light' : dark ? 'light' : 'dark'} />

      <MapboxNavigationView
        ref={navRef}
        style={StyleSheet.absoluteFill}
        destination={selected ? { latitude: selected.latitude, longitude: selected.longitude } : undefined}
        showDestinationPin={false}
        simulate={simulate}
        simulationSpeed={2}
        muted={muted}
        profile="driving-traffic"
        language="en"
        units="metric"
        showsUserLocation={showsUserLocation}
        zoomEnabled={zoomEnabled}
        scrollEnabled={scrollEnabled}
        rotateEnabled={rotateEnabled}
        pitchEnabled={pitchEnabled}
        mapStyle={mapStyle}
        theme={theme}
        vehicle={vehicle}
        vehicleScale={vehicleScale}
        vehicleRotation={vehicleRotation}
        showManeuverBanner={false}
        showSpeedLimit={false}
        onReady={() => setReady(true)}
        onLocation={(e) => {
          lastLocation.current = { latitude: e.latitude, longitude: e.longitude };
          if (!seeded.current) {
            seeded.current = true;
            setStores(makeDemoStores(lastLocation.current));
          }
        }}
        onRouteError={(e) => {
          setRouting(false);
          setError(e.message);
        }}
        onError={(e) => {
          setRouting(false);
          setError(e.message);
        }}
        onNavigationStarted={() => {
          setNavigating(true);
          setRouting(false);
          setArrived(false);
        }}
        onNavigationStopped={() => setNavigating(false)}
        onProgress={setProgress}
        onOffRoute={(e) => setOffRoute(e.offRoute)}
        onArrival={(e) => {
          if (e.final) {
            setArrived(true);
            setNavigating(false);
          }
        }}
        onCameraModeChanged={(e) => setCameraMode(e.mode)}>
        {jsCamera ? (
          <Camera
            zoomLevel={cam.zoom}
            pitch={cam.pitch}
            heading={cam.heading}
            centerCoordinate={cam.center}
            animationMode={cam.mode}
            animationDuration={cam.duration}
          />
        ) : null}
        {stores.map((s) => (
          <Marker
            key={s.id}
            id={s.id}
            coordinate={{ latitude: s.latitude, longitude: s.longitude }}
            iconKey="store-pin"
            onPress={() => onMarkerPress(s)}>
            <Svg width={34} height={44} viewBox="0 0 34 44">
              <Path
                d="M17 0C7.6 0 0 7.5 0 16.8 0 29 17 44 17 44s17-15 17-27.2C34 7.5 26.4 0 17 0z"
                fill="#FDCF10"
              />
              <Circle cx="17" cy="17" r="8" fill="#13557A" />
            </Svg>
          </Marker>
        ))}
      </MapboxNavigationView>

      {/* ============================================================ NAVIGATION UI (only after Directions) */}
      {navigating ? (
        <>
          <View style={styles.topArea} pointerEvents="box-none">
            <NavigationTopBanner
              instruction={progress?.instruction ?? 'Starting navigation…'}
              secondaryInstruction={progress?.secondaryInstruction}
              distance={progress?.stepDistanceRemaining ?? 0}
              maneuverType={progress?.maneuverType}
              maneuverModifier={progress?.maneuverModifier}
              topInset={insets.top}
            />
          </View>

          {progress?.speedLimit ? (
            <View style={[styles.maxWrap, { top: bannerHeightGuess }]} pointerEvents="none">
              <SpeedLimitSign limit={progress.speedLimit} />
            </View>
          ) : null}

          <View style={[styles.sideButtons, { top: bannerHeightGuess }]}>
            <MapRoundButton
              onPress={() => (cameraMode === 'overview' ? navRef.current?.recenter() : navRef.current?.showOverview())}>
              <RouteIcon />
            </MapRoundButton>
            <MapRoundButton onPress={() => setMuted((m) => !m)}>
              <VolumeIcon muted={muted} />
            </MapRoundButton>
            {cameraMode === 'idle' ? (
              <MapRoundButton onPress={() => navRef.current?.recenter()}>
                <LocateIcon />
              </MapRoundButton>
            ) : null}
          </View>

          {offRoute ? (
            <View style={[styles.offRoute, { top: bannerHeightGuess }]}>
              <Text style={styles.offRouteText}>Off route – rerouting…</Text>
            </View>
          ) : null}

          <View style={[styles.bottomArea, { bottom: 0 }]} pointerEvents="box-none">
            {progress?.roadName ? (
              <View style={{ marginBottom: 12 }}>
                <RoadNamePill name={progress.roadName} />
              </View>
            ) : null}
            <NavigationBottomBar
              durationRemaining={progress?.durationRemaining ?? 0}
              distanceRemaining={progress?.distanceRemaining ?? 0}
              bottomInset={insets.bottom}
              onClose={stop}
            />
          </View>
        </>
      ) : (
        /* ---------------------------------------------------------- browse-mode buttons */
        <View style={[styles.fabColumn, { top: insets.top + 12 }]}>
          <RoundFab
            c={c}
            label="⚙"
            onPress={() => {
              setSelected(null);
              setSettingsOpen((o) => !o);
            }}
          />
          {cameraMode !== 'following' ? (
            <RoundFab c={c} label="◎" onPress={() => navRef.current?.recenter()} />
          ) : null}
        </View>
      )}

      {/* ============================================================ BOTTOM SHEETS (browse mode) */}
      <Sheet visible={sheet !== null} c={c} onHeight={setSheetHeight} bottomInset={insets.bottom}>
        {sheet === 'place' && selected ? (
          <>
            <View style={styles.handle} />
            <View style={styles.rowTop}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.placeName, { color: c.text }]} numberOfLines={2}>
                  {selected.name}
                </Text>
                <Text style={[styles.badge, { color: c.primary }]}>{selected.category}</Text>
              </View>
              <Pressable onPress={closeSheet} hitSlop={12}>
                <Text style={[styles.close, { color: c.sub }]}>✕</Text>
              </Pressable>
            </View>
            {distanceToSelected ? (
              <Text style={[styles.meta, { color: c.sub }]}>{distanceToSelected} away (straight line)</Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: c.primary }, (!ready || routing) && styles.disabled]}
              disabled={!ready || routing}
              onPress={directions}>
              {routing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>➤  Directions</Text>}
            </Pressable>
          </>
        ) : null}

        {sheet === 'arrived' ? (
          <>
            <Text style={[styles.placeName, { color: c.accent }]}>You have arrived 🎉</Text>
            {selected?.name ? <Text style={[styles.meta, { color: c.sub }]}>{selected.name}</Text> : null}
            <Pressable style={[styles.primaryBtn, { backgroundColor: c.primary }]} onPress={finishArrival}>
              <Text style={styles.primaryText}>Done</Text>
            </Pressable>
          </>
        ) : null}

        {sheet === 'settings' ? (
          <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
            <View style={styles.rowTop}>
              <Text style={[styles.placeName, { color: c.text, flex: 1 }]}>Settings</Text>
              <Pressable onPress={() => setSettingsOpen(false)} hitSlop={12}>
                <Text style={[styles.close, { color: c.sub }]}>✕</Text>
              </Pressable>
            </View>

            <Text style={[styles.label, { color: c.sub }]}>Map style</Text>
            <View style={styles.chips}>
              {MAP_STYLES.map((s) => (
                <Chip key={s.key} c={c} label={s.label} active={mapStyle === s.key} onPress={() => setMapStyle(s.key)} />
              ))}
            </View>

            <Text style={[styles.label, { color: c.sub }]}>Appearance</Text>
            <View style={styles.chips}>
              {THEMES.map((t) => (
                <Chip key={t.key} c={c} label={t.label} active={theme === t.key} onPress={() => setTheme(t.key)} />
              ))}
            </View>

            <Text style={[styles.label, { color: c.sub }]}>My vehicle</Text>
            <View style={styles.chips}>
              {VEHICLES.map((v) => (
                <Chip key={v.key} c={c} label={v.label} active={vehicle === v.key} onPress={() => setVehicle(v.key)} />
              ))}
            </View>
            {vehicle !== 'none' ? (
              <>
                <View style={[styles.chips, { alignItems: 'center' }]}>
                  <Text style={[styles.meta, { color: c.sub }]}>Size</Text>
                  <Chip c={c} label="−5" active={false} onPress={() => setVehicleScale((v) => Math.max(1, v - 5))} />
                  <Chip c={c} label="−1" active={false} onPress={() => setVehicleScale((v) => Math.max(1, v - 1))} />
                  <Text style={[styles.meta, { color: c.text, minWidth: 30, textAlign: 'center' }]}>{vehicleScale}</Text>
                  <Chip c={c} label="+1" active={false} onPress={() => setVehicleScale((v) => Math.min(100, v + 1))} />
                  <Chip c={c} label="+5" active={false} onPress={() => setVehicleScale((v) => Math.min(100, v + 5))} />
                </View>
                <View style={styles.chips}>
                  <Chip
                    c={c}
                    label="↻ Flip direction"
                    active={vehicleRotation !== 0}
                    onPress={() => setVehicleRotation((r) => (r === 0 ? 180 : 0))}
                  />
                  <Chip c={c} label="Reset size (8)" active={false} onPress={() => setVehicleScale(8)} />
                </View>
              </>
            ) : null}

            <Text style={[styles.label, { color: c.sub, marginTop: 18 }]}>MARKERS</Text>
            <ToggleRow c={c} label="Demo stores (pressable <Marker/>)" value={stores.length > 0} onChange={toggleStores} />

            <Text style={[styles.label, { color: c.sub, marginTop: 18 }]}>MAP PROPS (react-native-maps style)</Text>
            <ToggleRow c={c} label="showsUserLocation" value={showsUserLocation} onChange={setShowsUserLocation} />
            <ToggleRow c={c} label="zoomEnabled" value={zoomEnabled} onChange={setZoomEnabled} />
            <ToggleRow c={c} label="scrollEnabled" value={scrollEnabled} onChange={setScrollEnabled} />
            <ToggleRow c={c} label="rotateEnabled" value={rotateEnabled} onChange={setRotateEnabled} />
            <ToggleRow c={c} label="pitchEnabled" value={pitchEnabled} onChange={setPitchEnabled} />

            <Text style={[styles.label, { color: c.sub, marginTop: 18 }]}>CAMERA</Text>
            <ToggleRow c={c} label="Control camera from JS (<Camera/>)" value={jsCamera} onChange={setJsCamera} />
            {jsCamera ? (
              <>
                <View style={[styles.chips, { alignItems: 'center' }]}>
                  <Text style={[styles.meta, { color: c.sub }]}>zoomLevel</Text>
                  <Chip c={c} label="−" active={false} onPress={() => setCam((k) => ({ ...k, zoom: Math.max(1, k.zoom - 1) }))} />
                  <Text style={[styles.meta, { color: c.text, minWidth: 26, textAlign: 'center' }]}>{cam.zoom}</Text>
                  <Chip c={c} label="+" active={false} onPress={() => setCam((k) => ({ ...k, zoom: Math.min(20, k.zoom + 1) }))} />
                </View>
                <Text style={[styles.label, { color: c.sub, marginTop: 6 }]}>pitch</Text>
                <View style={styles.chips}>
                  {[0, 30, 60].map((v) => (
                    <Chip key={v} c={c} label={`${v}°`} active={cam.pitch === v} onPress={() => setCam((k) => ({ ...k, pitch: v }))} />
                  ))}
                </View>
                <Text style={[styles.label, { color: c.sub, marginTop: 6 }]}>heading</Text>
                <View style={styles.chips}>
                  {[0, 90, 180, 270].map((v) => (
                    <Chip key={v} c={c} label={`${v}°`} active={cam.heading === v} onPress={() => setCam((k) => ({ ...k, heading: v }))} />
                  ))}
                </View>
                <Text style={[styles.label, { color: c.sub, marginTop: 6 }]}>animationMode</Text>
                <View style={styles.chips}>
                  {(['flyTo', 'easeTo', 'moveTo'] as CameraAnimationMode[]).map((m) => (
                    <Chip key={m} c={c} label={m} active={cam.mode === m} onPress={() => setCam((k) => ({ ...k, mode: m }))} />
                  ))}
                </View>
                <View style={styles.chips}>
                  <Chip c={c} label="✈ Fly to my location" active={false} onPress={flyToMe} />
                </View>
              </>
            ) : null}

            <View style={[styles.rowTop, { marginTop: 14 }]}>
              <Text style={[styles.meta, { color: c.text, flex: 1 }]}>Simulate driving (testing)</Text>
              <Switch value={simulate} onValueChange={setSimulate} />
            </View>
            <View style={[styles.rowTop, { marginTop: 6, marginBottom: 6 }]}>
              <Text style={[styles.meta, { color: c.text, flex: 1 }]}>Mute voice guidance</Text>
              <Switch value={muted} onValueChange={setMuted} />
            </View>
          </ScrollView>
        ) : null}
      </Sheet>
    </View>
  );
}

// ---------------------------------------------------------------- components
function Sheet({
  visible,
  children,
  c,
  onHeight,
  bottomInset,
}: {
  visible: boolean;
  children: React.ReactNode;
  c: ReturnType<typeof palette>;
  onHeight: (h: number) => void;
  bottomInset: number;
}) {
  const translate = useRef(new Animated.Value(700)).current;
  useEffect(() => {
    Animated.spring(translate, {
      toValue: visible ? 0 : 700,
      useNativeDriver: true,
      damping: 20,
      stiffness: 180,
      mass: 0.9,
    }).start();
  }, [visible, translate]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.sheet,
        { backgroundColor: c.card, paddingBottom: 18 + bottomInset, transform: [{ translateY: translate }] },
      ]}
      onLayout={(e) => onHeight(Math.round(e.nativeEvent.layout.height))}>
      {children}
    </Animated.View>
  );
}

function RoundFab({ label, onPress, c }: { label: string; onPress: () => void; c: ReturnType<typeof palette> }) {
  return (
    <Pressable style={[styles.fab, { backgroundColor: c.card }]} onPress={onPress}>
      <Text style={[styles.fabText, { color: c.text }]}>{label}</Text>
    </Pressable>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  c,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  c: ReturnType<typeof palette>;
}) {
  return (
    <View style={[styles.rowTop, { marginTop: 6 }]}>
      <Text style={[styles.meta, { color: c.text, flex: 1 }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  c,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  c: ReturnType<typeof palette>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { borderColor: active ? c.primary : c.border, backgroundColor: active ? c.soft : 'transparent' }]}>
      <Text style={{ color: active ? c.primary : c.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function palette(dark: boolean) {
  return dark
    ? { bg: '#0f1115', card: '#1b1e24', text: '#f2f4f7', sub: '#98a2b3', border: '#344054', primary: '#3b82f6', soft: '#1f2d4a', accent: '#5fd6a0' }
    : { bg: '#ffffff', card: '#ffffff', text: '#101828', sub: '#667085', border: '#d0d5dd', primary: '#0a58ca', soft: '#e7f0ff', accent: '#0b5d3b' };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  body: { fontSize: 15, textAlign: 'center' },

  topArea: { position: 'absolute', top: 0, left: 0, right: 0 },
  maxWrap: { position: 'absolute', left: 14 },
  sideButtons: { position: 'absolute', right: 12, gap: 12 },
  offRoute: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: '#b42318',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  offRouteText: { color: '#fff', fontWeight: '600' },
  bottomArea: { position: 'absolute', left: 0, right: 0 },

  fabColumn: { position: 'absolute', right: 12, gap: 10 },
  fab: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', elevation: 6 },
  fabText: { fontSize: 22 },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    gap: 8,
    elevation: 16,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#98a2b355', marginBottom: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  placeName: { fontSize: 20, fontWeight: '800' },
  badge: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  close: { fontSize: 20, padding: 4 },
  meta: { fontSize: 14 },
  label: { fontSize: 13, marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 6 },
  error: { fontSize: 13, color: '#f04438' },

  primaryBtn: { marginTop: 6, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  disabled: { opacity: 0.55 },
});

// keep NAV_COLORS referenced for consumers that want to reuse the palette
export const NAVIGATION_PALETTE = NAV_COLORS;
