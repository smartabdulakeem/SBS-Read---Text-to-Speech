package com.voxread.ai;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Rect;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

/** Reads the text of whatever node the user taps in any app. The OverlayService
 *  captures a tap coordinate and asks this service for the text there. */
public class VoxReadAccessibilityService extends AccessibilityService {
    private static VoxReadAccessibilityService instance;

    public static VoxReadAccessibilityService getInstance() {
        return instance;
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Not used — we query on demand from the overlay.
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    /** Best text found at a screen coordinate, or null. */
    public String getTextAt(int x, int y) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        AccessibilityNodeInfo node = findSmallestTextNodeAt(root, x, y);
        if (node == null) node = findNodeAt(root, x, y);
        return node != null ? extractText(node) : null;
    }

    private AccessibilityNodeInfo findSmallestTextNodeAt(AccessibilityNodeInfo node, int x, int y) {
        if (node == null) return null;
        Rect b = new Rect();
        node.getBoundsInScreen(b);
        if (!b.contains(x, y)) return null;

        AccessibilityNodeInfo deeper = null;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            AccessibilityNodeInfo r = findSmallestTextNodeAt(child, x, y);
            if (r != null) deeper = r;
        }
        if (deeper != null) return deeper;
        return hasText(node) ? node : null;
    }

    private AccessibilityNodeInfo findNodeAt(AccessibilityNodeInfo node, int x, int y) {
        if (node == null) return null;
        Rect b = new Rect();
        node.getBoundsInScreen(b);
        if (!b.contains(x, y)) return null;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo r = findNodeAt(node.getChild(i), x, y);
            if (r != null) return r;
        }
        return node;
    }

    private boolean hasText(AccessibilityNodeInfo n) {
        CharSequence t = n.getText();
        if (t != null && t.toString().trim().length() > 0) return true;
        CharSequence d = n.getContentDescription();
        return d != null && d.toString().trim().length() > 0;
    }

    private String extractText(AccessibilityNodeInfo n) {
        if (n == null) return null;
        CharSequence t = n.getText();
        if (t != null && t.toString().trim().length() > 0) return t.toString();
        CharSequence d = n.getContentDescription();
        if (d != null && d.toString().trim().length() > 0) return d.toString();
        return null;
    }
}
