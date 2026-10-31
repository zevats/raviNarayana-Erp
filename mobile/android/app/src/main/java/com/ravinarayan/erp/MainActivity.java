package com.ravinarayan.erp;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Ravinarayan app entry point.
 * - Shows the splash for the edition last used on this phone (green ERP or orange Delivery).
 * - Creates the notification channels: "Delivery alerts" (new stops, custom alert sound,
 *   high importance, shown on the lock screen) and "Delivery updates" (cancellations).
 */
public class MainActivity extends BridgeActivity {
    public static final String PREFS = "rn";
    public static final String CHANNEL_ALERTS = "delivery_alerts";
    public static final String CHANNEL_UPDATES = "delivery_updates";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RnAppPlugin.class);
        String brand = getSharedPreferences(PREFS, MODE_PRIVATE).getString("brand", "standard");
        if ("delivery".equals(brand)) setTheme(R.style.AppTheme_NoActionBarLaunch_Delivery);
        super.onCreate(savedInstanceState);
        createChannels();
    }

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
