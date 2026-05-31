import { useState, useEffect, useCallback } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

// Bridge to the native ScreenReaderPlugin (Android Select-to-Speak).
const ScreenReader = registerPlugin('ScreenReader');
const IS_NATIVE = Capacitor.isNativePlatform();

export function useScreenReader() {
  const [overlayGranted, setOverlayGranted] = useState(false);
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
  const [notificationsGranted, setNotificationsGranted] = useState(false);
  const [bubbleOn, setBubbleOn] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!IS_NATIVE) return;
    try {
      const o = await ScreenReader.isOverlayPermissionGranted();
      setOverlayGranted(!!o?.granted);
      const a = await ScreenReader.isAccessibilityEnabled();
      setAccessibilityEnabled(!!a?.enabled);
      if (ScreenReader.isNotificationPermissionGranted) {
        const n = await ScreenReader.isNotificationPermissionGranted();
        setNotificationsGranted(!!n?.granted);
      } else {
        setNotificationsGranted(true);
      }
    } catch (e) {
      /* plugin unavailable (e.g. web) */
    }
  }, []);

  useEffect(() => {
    refresh();
    // Re-check whenever the user returns from a system settings screen.
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  const requestOverlay = useCallback(async () => {
    try { await ScreenReader.requestOverlayPermission(); } catch (e) { /* ignore */ }
  }, []);

  const openAccessibility = useCallback(async () => {
    try { await ScreenReader.openAccessibilitySettings(); } catch (e) { /* ignore */ }
  }, []);

  const requestNotifications = useCallback(async () => {
    try {
      if (ScreenReader.requestNotificationPermission) {
        const res = await ScreenReader.requestNotificationPermission();
        setNotificationsGranted(!!res?.granted);
      }
    } catch (e) {
      /* ignore */
    }
  }, []);

  const startBubble = useCallback(async () => {
    setBusy(true);
    try {
      if (IS_NATIVE && ScreenReader.requestNotificationPermission && !notificationsGranted) {
        const res = await ScreenReader.requestNotificationPermission();
        if (res?.granted) {
          setNotificationsGranted(true);
        }
      }
      await ScreenReader.startBubble();
      setBubbleOn(true);
    } catch (e) {
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh, notificationsGranted]);

  const stopBubble = useCallback(async () => {
    setBusy(true);
    try { await ScreenReader.stopBubble(); } catch (e) { /* ignore */ } finally {
      setBubbleOn(false);
      setBusy(false);
    }
  }, []);

  // Keep the overlay's TTS in sync with the in-app voice settings.
  const saveTtsPrefs = useCallback(async (prefs) => {
    if (!IS_NATIVE) return;
    try { await ScreenReader.saveTtsPrefs(prefs); } catch (e) { /* ignore */ }
  }, []);

  return {
    isNative: IS_NATIVE,
    overlayGranted,
    accessibilityEnabled,
    notificationsGranted,
    bubbleOn,
    busy,
    refresh,
    requestOverlay,
    openAccessibility,
    requestNotifications,
    startBubble,
    stopBubble,
    saveTtsPrefs,
  };
}
