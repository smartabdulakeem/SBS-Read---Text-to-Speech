package com.voxread.ai;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

/** Foreground service that shows a draggable floating bubble. Tapping the bubble
 *  enters "select" mode: a transparent full-screen overlay captures the next tap,
 *  then we ask the accessibility service for the text at that point and speak it. */
public class OverlayService extends Service {
    public static final String ACTION_START = "com.voxread.ai.START_BUBBLE";
    public static final String ACTION_STOP = "com.voxread.ai.STOP_BUBBLE";
    private static final String CHANNEL_ID = "voxread_overlay";

    private WindowManager wm;
    private View bubble;
    private View captureOverlay;
    private TtsHelper tts;
    private boolean capturing = false;

    private void showToastSafe(final String message) {
        new Handler(getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(getApplicationContext(), message, Toast.LENGTH_LONG).show();
            }
        });
    }

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            tts = new TtsHelper(this);
        } catch (Throwable t) {
            showToastSafe("VoxRead init failed: " + t.getMessage());
            t.printStackTrace();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START;
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            startForegroundWithNotification();
            showBubble();
        } catch (Throwable t) {
            showToastSafe("VoxRead starting failed: " + t.getMessage());
            t.printStackTrace();
            stopSelf();
        }
        return START_STICKY;
    }

    private void startForegroundWithNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "VoxRead Reader", NotificationManager.IMPORTANCE_LOW);
                nm.createNotificationChannel(ch);
            }
            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(this, CHANNEL_ID)
                    : new Notification.Builder(this);
            Notification n = b
                    .setContentTitle("VoxRead Select-to-Speak")
                    .setContentText("Tap the bubble, then tap text to read it.")
                    .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                    .setOngoing(true)
                    .build();
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(1, n);
            }
        } catch (Throwable t) {
            showToastSafe("FGS Notification failed: " + t.getMessage());
            t.printStackTrace();
            throw t;
        }
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void showBubble() {
        if (bubble != null) return;
        final TextView b = new TextView(this);
        b.setText("🔊"); // 🔊
        b.setTextSize(22);
        b.setPadding(28, 18, 28, 18);
        b.setBackgroundColor(Color.parseColor("#CC7C3AED"));
        b.setTextColor(Color.WHITE);

        final WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = 24;
        lp.y = 300;

        b.setOnTouchListener(new View.OnTouchListener() {
            float downX, downY;
            int startX, startY;
            boolean moved;

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = e.getRawX();
                        downY = e.getRawY();
                        startX = lp.x;
                        startY = lp.y;
                        moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) (e.getRawX() - downX);
                        int dy = (int) (e.getRawY() - downY);
                        if (Math.abs(dx) > 12 || Math.abs(dy) > 12) moved = true;
                        lp.x = startX + dx;
                        lp.y = startY + dy;
                        wm.updateViewLayout(bubble, lp);
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!moved) onBubbleTap();
                        return true;
                }
                return false;
            }
        });

        bubble = b;
        try {
            wm.addView(bubble, lp);
        } catch (Throwable t) {
            showToastSafe("Overlay draw failed: " + t.getMessage());
            t.printStackTrace();
            bubble = null;
            throw t;
        }
    }

    private void onBubbleTap() {
        if (tts != null && tts.isSpeaking()) {
            tts.stop();
            return;
        }
        startCapture();
    }

    private void startCapture() {
        if (captureOverlay != null) return;
        capturing = true;

        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.parseColor("#22000000"));

        TextView hint = new TextView(this);
        hint.setText("Tap the text you want read");
        hint.setTextColor(Color.WHITE);
        hint.setBackgroundColor(Color.parseColor("#CC000000"));
        hint.setPadding(28, 16, 28, 16);
        FrameLayout.LayoutParams hlp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        hlp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        hlp.topMargin = 64;
        overlay.addView(hint, hlp);

        final WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);

        overlay.setOnTouchListener((v, e) -> {
            if (e.getAction() == MotionEvent.ACTION_DOWN) {
                final int x = (int) e.getRawX();
                final int y = (int) e.getRawY();
                endCapture();
                handleTapAt(x, y);
                return true;
            }
            return false;
        });

        captureOverlay = overlay;
        wm.addView(captureOverlay, lp);
    }

    private void endCapture() {
        capturing = false;
        if (captureOverlay != null) {
            try { wm.removeView(captureOverlay); } catch (Exception ignored) {}
            captureOverlay = null;
        }
    }

    private void handleTapAt(final int x, final int y) {
        // Let the overlay removal settle so the underlying app is the active window.
        new Handler(getMainLooper()).postDelayed(() -> {
            VoxReadAccessibilityService svc = VoxReadAccessibilityService.getInstance();
            if (svc == null) {
                toast("Enable VoxRead in Accessibility settings first");
                return;
            }
            String text = svc.getTextAt(x, y);
            if (text != null && text.trim().length() > 0) {
                tts.speak(text);
            } else {
                toast("No readable text there — try another spot");
            }
        }, 140);
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onDestroy() {
        endCapture();
        if (bubble != null) {
            try { wm.removeView(bubble); } catch (Exception ignored) {}
            bubble = null;
        }
        if (tts != null) {
            tts.shutdown();
            tts = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
