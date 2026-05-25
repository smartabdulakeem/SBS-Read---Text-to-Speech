package com.voxread.ai;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();

        if (Intent.ACTION_SEND.equals(action) && "text/plain".equals(type)) {
            final String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (sharedText != null) {
                this.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        String escaped = escapeJS(sharedText);
                        String js = "window.androidSharedText = \"" + escaped + "\";" +
                                    "window.dispatchEvent(new CustomEvent('androidShareText', { detail: \"" + escaped + "\" }));";
                        getBridge().getWebView().evaluateJavascript(js, null);
                    }
                });
            }
        }
    }

    private String escapeJS(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }
}
