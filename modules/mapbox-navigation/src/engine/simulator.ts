import { pointAt, type Route } from './route';
import type { Fix } from './engine';

/** Drives along a route at a constant speed and emits one fix per second (for testing without driving). */
export class RouteSimulator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private along = 0;
  private last = 0;

  /** @param speed meters per second (default 14 ≈ 50 km/h). */
  constructor(
    private readonly route: Route,
    private readonly speed = 14,
    private readonly intervalMs = 1000
  ) {}

  start(onFix: (fix: Fix) => void, onEnd?: () => void) {
    this.stop();
    this.along = 0;
    this.last = Date.now();
    const emit = () => {
      const now = Date.now();
      const dt = Math.min(2, (now - this.last) / 1000);
      this.last = now;
      this.along = Math.min(this.route.distance, this.along + this.speed * dt);
      const p = pointAt(this.route, this.along);
      onFix({ lng: p.point[0], lat: p.point[1], heading: p.bearing, speed: this.speed, accuracy: 4, timestamp: now });
      if (this.along >= this.route.distance) {
        this.stop();
        onEnd?.();
      }
    };
    emit();
    this.timer = setInterval(emit, this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
