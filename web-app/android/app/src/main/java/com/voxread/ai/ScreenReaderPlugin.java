package com.voxread.ai;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS bridge for the Select-to-Speak (read on screen) feature. */
@CapacitorPlugin(name = "ScreenReader")
public class ScreenReaderPlugin extends Plugin {

    @PluginMethod
    public void isOverlayPermissionGranted(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", Settings.canDrawOverlays(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void isAccessibilityEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", isAccessibilityServiceEnabled());
        call.resolve(ret);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void startBubble(PluginCall call) {
        if (!Settings.canDrawOverlays(getContext())) {
            call.reject("overlay-permission-missing");
            return;
        }
        Intent i = new Intent(getContext(), OverlayService.class);
        i.setAction(OverlayService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(i);
        } else {
            getContext().startService(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void stopBubble(PluginCall call) {
        Intent i = new Intent(getContext(), OverlayService.class);
        i.setAction(OverlayService.ACTION_STOP);
        getContext().startService(i);
        call.resolve();
    }

    /** Persist rate/pitch/lang so the overlay TtsHelper matches in-app settings. */
    @PluginMethod
    public void saveTtsPrefs(PluginCall call) {
        android.content.SharedPreferences.Editor e =
                getContext().getSharedPreferences("voxread_prefs", Context.MODE_PRIVATE).edit();
        if (call.hasOption("rate")) e.putFloat("rate", call.getFloat("rate", 1.0f));
        if (call.hasOption("pitch")) e.putFloat("pitch", call.getFloat("pitch", 1.0f));
        if (call.hasOption("lang")) e.putString("lang", call.getString("lang", ""));
        e.apply();
        call.resolve();
    }

    private boolean isAccessibilityServiceEnabled() {
        String expected = getContext().getPackageName() + "/" + VoxReadAccessibilityService.class.getName();
        String enabled = Settings.Secure.getString(getContext().getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (TextUtils.isEmpty(enabled)) return false;
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabled);
        while (splitter.hasNext()) {
            if (splitter.next().equalsIgnoreCase(expected)) return true;
        }
        return false;
    }
}
