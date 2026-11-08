import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android wrapper. The published app is a Worker + PWA, so the native shell
 * loads the live site inside a WebView: that keeps check-ins, first-party
 * cookies and the realtime socket on the app's own origin, which a bundled
 * `dist/` copy cannot do (its origin would be `https://localhost`).
 *
 *   npm run android:sync   # after each web build / deploy
 *   npm run android:apk    # build a debug-signed APK
 *
 * Repoint `server.url` when the app moves to its own domain.
 */
const publishedOrigin =
  process.env.CHURCH_RADAR_ORIGIN ??
  "https://site-7d0666e0b7dd4270bb605ef825d84164.freebuff.page";

const config: CapacitorConfig = {
  appId: "app.churchradar.mobile",
  appName: "Church Radar",
  webDir: "dist",
  server: {
    url: publishedOrigin,
    androidScheme: "https",
    errorPath: "connection.html",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#04070d",
  },
};

export default config;
