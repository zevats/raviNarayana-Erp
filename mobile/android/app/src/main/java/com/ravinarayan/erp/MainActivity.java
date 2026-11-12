package com.ravinarayan.erp;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.app.ActivityManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.LinearInterpolator;
import android.view.animation.OvershootInterpolator;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

/**
 * Ravinarayan app entry point.
 * - Opening animation, drawn by the app over the loading page (the system splash is only the
 *   brand background): the house for the ERP, the rider for delivery partners. It ends with a
 *   short fade once the page has loaded.
 * - Launcher icon: house by default, rider on a phone where a delivery partner signs in (switched
 *   when the app goes to the background, so the running app is never interrupted).
 * - Notification channels: "Delivery alerts" (new stops, custom sound) and "Delivery updates".
 */
public class MainActivity extends BridgeActivity {
    public static final String PREFS = "rn";
    public static final String CHANNEL_ALERTS = "delivery_alerts";
    public static final String CHANNEL_UPDATES = "delivery_updates";
    private static final long MIN_SHOW_MS = 1400;
    private static final long MAX_SHOW_MS = 10000;
    private static volatile boolean webReady = false;

    /** Called by RnAppPlugin.ready(): the web app has drawn its first screen. */
    public static void markWebReady() {
        webReady = true;
    }

    private FrameLayout overlay;
    private final List<Animator> loops = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long shownAt;
    private boolean closing;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RnAppPlugin.class);
        boolean delivery = "delivery".equals(getSharedPreferences(PREFS, MODE_PRIVATE).getString("brand", "standard"));
        if (delivery) setTheme(R.style.AppTheme_NoActionBarLaunch_Delivery);
        super.onCreate(savedInstanceState);
        // The app sets its own text sizes: the phone's system font size must not enlarge the pages
        // (it pushed the top bar and wide content off screen, with sideways scrolling).
        try {
            if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().getSettings().setTextZoom(100);
        } catch (Throwable ignored) {
            // The WebView keeps its default.
        }
        applyTaskDescription(delivery);
        createChannels();
        if (savedInstanceState == null) {
            webReady = false;
            try {
                showOpening(delivery);
            } catch (Throwable ignored) {
                removeOverlay();
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // The edition can change after sign-in (setBrand): the recent-apps card follows it.
        applyTaskDescription("delivery".equals(getSharedPreferences(PREFS, MODE_PRIVATE).getString("brand", "standard")));
    }

    /**
     * The recent-apps card: the app's name, its logo and a brand colour, set explicitly for both
     * editions (without this some phones showed no name or logo for the Owner/Manager app).
     */
    private void applyTaskDescription(boolean delivery) {
        int color = delivery ? Color.parseColor("#C9501C") : Color.parseColor("#173A29");
        try {
            // The same icon as on the home screen (logo on its own background), drawn into a bitmap:
            // a bare transparent logo did not show on the Owner/Manager card on some phones.
            android.graphics.drawable.Drawable d = getResources().getDrawable(delivery ? R.mipmap.ic_launcher_delivery : R.mipmap.ic_launcher, getTheme());
            int size = Math.round(96 * getResources().getDisplayMetrics().density);
            Bitmap icon = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            android.graphics.Canvas canvas = new android.graphics.Canvas(icon);
            d.setBounds(0, 0, size, size);
            d.draw(canvas);
            setTaskDescription(new ActivityManager.TaskDescription("Ravinarayan", icon, color));
        } catch (Throwable first) {
            try {
                Bitmap logo = BitmapFactory.decodeResource(getResources(), delivery ? R.drawable.anim_logo_delivery : R.drawable.anim_logo_home);
                setTaskDescription(new ActivityManager.TaskDescription("Ravinarayan", logo, color));
            } catch (Throwable ignored) {
                // The system's default card is kept.
            }
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        applyLauncherIcon(this);
    }

    /** Enables the launcher entry that matches the remembered edition (house or rider). */
    public static void applyLauncherIcon(Context ctx) {
        try {
            SharedPreferences p = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
            boolean delivery = "delivery".equals(p.getString("brand", "standard"));
            if (p.getBoolean("iconDelivery", false) == delivery) return;
            PackageManager pm = ctx.getPackageManager();
            ComponentName home = new ComponentName(ctx, ctx.getPackageName() + ".LauncherHome");
            ComponentName rider = new ComponentName(ctx, ctx.getPackageName() + ".LauncherDelivery");
            // Enable the new entry first, then disable the old one, so there is always an icon.
            pm.setComponentEnabledSetting(delivery ? rider : home, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            pm.setComponentEnabledSetting(delivery ? home : rider, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
            p.edit().putBoolean("iconDelivery", delivery).apply();
        } catch (Throwable ignored) {
            // The icon simply stays as it is.
        }
    }

    // ------------------------------------------------------------------ opening animation

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void showOpening(boolean delivery) {
        ViewGroup root = findViewById(android.R.id.content);
        if (root == null) return;
        overlay = new FrameLayout(this);
        overlay.setClickable(true);
        overlay.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (delivery) {
            GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[] { Color.parseColor("#E07434"), Color.parseColor("#C9501C"), Color.parseColor("#9E3A10") });
            overlay.setBackground(bg);
        } else {
            overlay.setBackgroundColor(Color.parseColor("#FBF9F3"));
        }
        root.addView(overlay);
        getWindow().setStatusBarColor(delivery ? Color.parseColor("#D2602A") : Color.parseColor("#FBF9F3"));
        if (!delivery && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }

        FrameLayout stage = new FrameLayout(this);
        FrameLayout.LayoutParams stageLp = new FrameLayout.LayoutParams(dp(300), dp(300), Gravity.CENTER);
        stageLp.bottomMargin = dp(70);
        overlay.addView(stage, stageLp);

        if (delivery) buildRider(stage); else buildHouse(stage);
        buildWordmark(delivery);
        buildLoader(delivery);

        shownAt = System.currentTimeMillis();
        handler.postDelayed(this::watchLoad, 300);
    }

    /** House: soft rings pulse out behind the logo, which rises and settles, then breathes. */
    private void buildHouse(FrameLayout stage) {
        for (int i = 0; i < 2; i++) {
            View ring = new View(this);
            GradientDrawable g = new GradientDrawable();
            g.setShape(GradientDrawable.OVAL);
            g.setColor(Color.parseColor("#141E3A2B"));
            g.setStroke(dp(2), Color.parseColor("#331E3A2B"));
            ring.setBackground(g);
            stage.addView(ring, new FrameLayout.LayoutParams(dp(200), dp(200), Gravity.CENTER));
            ring.setScaleX(0.6f);
            ring.setScaleY(0.6f);
            ring.setAlpha(0f);
            AnimatorSet pulse = new AnimatorSet();
            ObjectAnimator sx = ObjectAnimator.ofFloat(ring, "scaleX", 0.6f, 1.45f);
            ObjectAnimator sy = ObjectAnimator.ofFloat(ring, "scaleY", 0.6f, 1.45f);
            ObjectAnimator a = ObjectAnimator.ofFloat(ring, "alpha", 0.9f, 0f);
            for (ObjectAnimator o : new ObjectAnimator[] { sx, sy, a }) {
                o.setRepeatCount(ValueAnimator.INFINITE);
                o.setDuration(2200);
            }
            pulse.playTogether(sx, sy, a);
            pulse.setInterpolator(new DecelerateInterpolator(1.6f));
            pulse.setStartDelay(500 + i * 1100L);
            pulse.start();
            loops.add(pulse);
        }
        View glow = new View(this);
        GradientDrawable halo = new GradientDrawable();
        halo.setShape(GradientDrawable.OVAL);
        halo.setColor(Color.parseColor("#EEF3EA"));
        glow.setBackground(halo);
        stage.addView(glow, new FrameLayout.LayoutParams(dp(176), dp(176), Gravity.CENTER));
        glow.setScaleX(0.4f);
        glow.setScaleY(0.4f);
        glow.animate().scaleX(1f).scaleY(1f).setDuration(650).setInterpolator(new OvershootInterpolator(1.2f)).start();

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.anim_logo_home);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        stage.addView(logo, new FrameLayout.LayoutParams(dp(150), dp(150), Gravity.CENTER));
        logo.setAlpha(0f);
        logo.setScaleX(0.72f);
        logo.setScaleY(0.72f);
        logo.setTranslationY(dp(26));
        logo.animate().alpha(1f).scaleX(1f).scaleY(1f).translationY(0).setStartDelay(120).setDuration(720)
            .setInterpolator(new OvershootInterpolator(1.4f))
            .withEndAction(() -> {
                ObjectAnimator bx = ObjectAnimator.ofFloat(logo, "scaleX", 1f, 1.04f);
                ObjectAnimator by = ObjectAnimator.ofFloat(logo, "scaleY", 1f, 1.04f);
                for (ObjectAnimator o : new ObjectAnimator[] { bx, by }) {
                    o.setRepeatMode(ValueAnimator.REVERSE);
                    o.setRepeatCount(ValueAnimator.INFINITE);
                    o.setDuration(1300);
                    o.setInterpolator(new AccelerateDecelerateInterpolator());
                    o.start();
                    loops.add(o);
                }
            })
            .start();
    }

    /** Rider: sweeps in from the left behind streaking speed lines, then rides with a gentle bob. */
    private void buildRider(FrameLayout stage) {
        float[] widths = { 58, 92, 40 };
        float[] tops = { -38, -6, 26 };
        for (int i = 0; i < widths.length; i++) {
            View line = new View(this);
            GradientDrawable g = new GradientDrawable();
            g.setCornerRadius(dp(4));
            g.setColor(Color.parseColor(i == 1 ? "#FFF1E2" : "#B3FFF1E2"));
            line.setBackground(g);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(widths[i]), dp(7), Gravity.CENTER_VERTICAL | Gravity.START);
            lp.topMargin = dp(tops[i]);
            lp.leftMargin = dp(6);
            stage.addView(line, lp);
            line.setAlpha(0f);
            line.setTranslationX(-dp(140));
            ObjectAnimator move = ObjectAnimator.ofFloat(line, "translationX", -dp(140), dp(10), -dp(30));
            ObjectAnimator fade = ObjectAnimator.ofFloat(line, "alpha", 0f, 1f, 0f);
            for (ObjectAnimator o : new ObjectAnimator[] { move, fade }) {
                o.setDuration(900);
                o.setRepeatCount(ValueAnimator.INFINITE);
                o.setInterpolator(new LinearInterpolator());
                o.setStartDelay(260 + i * 140L);
                o.start();
                loops.add(o);
            }
        }
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.anim_logo_delivery);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        FrameLayout.LayoutParams llp = new FrameLayout.LayoutParams(dp(176), dp(176), Gravity.CENTER);
        llp.leftMargin = dp(36);
        stage.addView(logo, llp);
        logo.setAlpha(0f);
        logo.setTranslationX(-dp(260));
        logo.setRotation(-6f);
        logo.animate().alpha(1f).translationX(0).rotation(0).setStartDelay(80).setDuration(760)
            .setInterpolator(new OvershootInterpolator(1.1f))
            .withEndAction(() -> {
                ObjectAnimator bob = ObjectAnimator.ofFloat(logo, "translationY", 0f, -dp(5), 0f, dp(2), 0f);
                bob.setDuration(700);
                bob.setRepeatCount(ValueAnimator.INFINITE);
                bob.setInterpolator(new LinearInterpolator());
                bob.start();
                loops.add(bob);
            })
            .start();
    }

    private void buildWordmark(boolean delivery) {
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView name = new TextView(this);
        name.setText("Ravinarayan");
        name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
        name.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        name.setSingleLine(true);
        name.setIncludeFontPadding(false);
        name.setPadding(dp(8), 0, dp(8), 0);
        name.setTextColor(delivery ? Color.WHITE : Color.parseColor("#1E3A2B"));
        TextView sub = new TextView(this);
        sub.setText(delivery ? "DELIVERY" : "PG & TIFFIN");
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        sub.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        sub.setLetterSpacing(0.32f);
        sub.setSingleLine(true);
        sub.setPadding(dp(8), 0, dp(8), 0);
        sub.setTextColor(delivery ? Color.parseColor("#FFE3C9") : Color.parseColor("#9C7B4E"));
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sp.topMargin = dp(4);
        words.addView(name, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        words.addView(sub, sp);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        lp.topMargin = dp(150);
        overlay.addView(words, lp);
        words.setAlpha(0f);
        words.setTranslationY(dp(14));
        words.animate().alpha(1f).translationY(0).setStartDelay(520).setDuration(560).setInterpolator(new DecelerateInterpolator(2f)).start();
    }

    /** A slim bar near the bottom: a highlight that runs across while the app loads. */
    private void buildLoader(boolean delivery) {
        FrameLayout track = new FrameLayout(this);
        GradientDrawable t = new GradientDrawable();
        t.setCornerRadius(dp(2));
        t.setColor(delivery ? Color.parseColor("#40FFFFFF") : Color.parseColor("#1A1E3A2B"));
        track.setBackground(t);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(120), dp(4), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        lp.bottomMargin = dp(64);
        overlay.addView(track, lp);
        View bar = new View(this);
        GradientDrawable b = new GradientDrawable();
        b.setCornerRadius(dp(2));
        b.setColor(delivery ? Color.WHITE : Color.parseColor("#1E3A2B"));
        bar.setBackground(b);
        track.addView(bar, new FrameLayout.LayoutParams(dp(40), dp(4)));
        track.setClipChildren(true);
        ObjectAnimator run = ObjectAnimator.ofFloat(bar, "translationX", -dp(40), dp(120));
        run.setDuration(1100);
        run.setRepeatCount(ValueAnimator.INFINITE);
        run.setInterpolator(new AccelerateDecelerateInterpolator());
        run.setStartDelay(600);
        run.start();
        loops.add(run);
        track.setAlpha(0f);
        track.animate().alpha(1f).setStartDelay(600).setDuration(400).start();
    }

    /** Ends the animation once the page has loaded (shown for a moment at least, never forever). */
    private void watchLoad() {
        if (overlay == null || closing) return;
        long elapsed = System.currentTimeMillis() - shownAt;
        int progress = 0;
        try {
            WebView wv = getBridge() != null ? getBridge().getWebView() : null;
            progress = wv != null ? wv.getProgress() : 0;
        } catch (Throwable ignored) {
            progress = 100;
        }
        // Ends when the web app says it is ready (after a short minimum), or as a fallback once the
        // page has loaded for a while, and never later than MAX_SHOW_MS.
        if ((webReady && elapsed >= MIN_SHOW_MS) || (progress >= 100 && elapsed >= 4500) || elapsed >= MAX_SHOW_MS) {
            closing = true;
            overlay.animate().alpha(0f).scaleX(1.04f).scaleY(1.04f).setDuration(320).setInterpolator(new DecelerateInterpolator())
                .setListener(new AnimatorListenerAdapter() {
                    @Override
                    public void onAnimationEnd(Animator animation) {
                        removeOverlay();
                    }
                })
                .start();
        } else {
            handler.postDelayed(this::watchLoad, 120);
        }
    }

    private void removeOverlay() {
        for (Animator a : loops) {
            try {
                a.cancel();
            } catch (Throwable ignored) {
            }
        }
        loops.clear();
        if (overlay != null && overlay.getParent() instanceof ViewGroup) ((ViewGroup) overlay.getParent()).removeView(overlay);
        overlay = null;
        // Back to the app's own bars (the theme after the splash).
        getWindow().setStatusBarColor(getResources().getColor(R.color.rnGreen, getTheme()));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) getWindow().getDecorView().setSystemUiVisibility(0);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    // ------------------------------------------------------------------ notification channels

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        Uri sound = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getPackageName() + "/" + R.raw.delivery_alert);
        AudioAttributes audio = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

        NotificationChannel alerts = new NotificationChannel(CHANNEL_ALERTS, "Delivery alerts", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("New deliveries assigned to you");
        alerts.setSound(sound, audio);
        alerts.enableVibration(true);
        alerts.setVibrationPattern(new long[] { 0, 250, 120, 250, 120, 400 });
        alerts.enableLights(true);
        alerts.setLightColor(Color.parseColor("#C9501C"));
        alerts.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(alerts);

        NotificationChannel updates = new NotificationChannel(CHANNEL_UPDATES, "Delivery updates", NotificationManager.IMPORTANCE_DEFAULT);
        updates.setDescription("Changes to your deliveries, such as cancellations");
        nm.createNotificationChannel(updates);
    }
}
